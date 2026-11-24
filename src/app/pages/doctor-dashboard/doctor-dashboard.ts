import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subject, catchError, combineLatest, of, startWith, switchMap, tap } from 'rxjs';

import { parseApiError } from '../../core/api-error';
import { Appointment } from '../../core/appointments/appointment.models';
import { addDays, clinicToday, formatLongDate, isValidDate } from '../../core/clinic-date';
import { DoctorSelfService } from '../../core/doctors/doctor-self.service';
import { ScheduleEditor, ScheduleSource } from '../../shared/schedule-editor/schedule-editor';

type Tab = 'appointments' | 'schedule' | 'leaves';

const STATUS_LABELS: Record<Appointment['status'], string> = {
  BOOKED: 'Booked',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-show',
  CANCELLED: 'Cancelled',
};

/** Screen 6 (REQUIREMENTS §8): Doctor dashboard — FR-6.2, FR-5.4, FR-3.1 to FR-3.3. */
@Component({
  selector: 'app-doctor-dashboard',
  imports: [ScheduleEditor],
  templateUrl: './doctor-dashboard.html',
  styleUrl: './doctor-dashboard.scss',
})
export class DoctorDashboard implements OnInit {
  private readonly api = inject(DoctorSelfService);
  private readonly router = inject(Router);

  /** Query params ?tab= and ?date=. */
  readonly tab = input<string>();
  readonly date = input<string>();

  protected readonly today = clinicToday();
  protected readonly activeTab = computed<Tab>(() =>
    this.tab() === 'schedule' || this.tab() === 'leaves' ? (this.tab() as Tab) : 'appointments',
  );

  // ----- appointments of a day -----
  /** Any valid date (past days are history); invalid -> today. */
  protected readonly selectedDate = computed(() =>
    isValidDate(this.date()) ? this.date()! : this.today,
  );
  protected readonly dayState = signal<'loading' | 'loaded' | 'error'>('loading');
  protected readonly dayItems = signal<Appointment[]>([]);
  protected readonly dayError = signal<string | null>(null);
  protected readonly busyId = signal<number | null>(null);
  protected readonly rowError = signal<{ id: number; message: string } | null>(null);
  private readonly reloadDay$ = new Subject<void>();

  protected readonly bookedCount = computed(
    () => this.dayItems().filter((a) => a.status === 'BOOKED').length,
  );

  /** The doctor's own weekly hours for the shared editor (FR-3.1). */
  protected readonly ownSchedule: ScheduleSource = {
    load: () => this.api.schedule(),
    save: (blocks) => this.api.saveSchedule(blocks),
  };

  // ----- leave days -----
  protected readonly leaves = signal<string[]>([]);
  protected readonly leavesState = signal<'loading' | 'loaded' | 'error'>('loading');
  protected readonly leaveDate = signal('');
  protected readonly leaveMessage = signal<{
    kind: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);
  protected readonly savingLeave = signal(false);

  protected readonly dateLabel = formatLongDate;
  protected readonly statusLabel = (s: Appointment['status']) => STATUS_LABELS[s];

  constructor() {
    combineLatest([toObservable(this.selectedDate), this.reloadDay$.pipe(startWith(undefined))])
      .pipe(
        switchMap(([date]) => this.loadDay(date)),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  ngOnInit(): void {
    this.loadLeaves();
  }

  protected showTab(tab: Tab): void {
    void this.router.navigate([], {
      queryParams: { tab: tab === 'appointments' ? null : tab },
      queryParamsHandling: 'merge',
    });
  }

  // ----- appointments -----

  protected chooseDate(value: string): void {
    if (!isValidDate(value)) return;
    void this.router.navigate([], {
      queryParams: { date: value === this.today ? null : value },
      queryParamsHandling: 'merge',
    });
  }

  protected shiftDay(days: number): void {
    this.chooseDate(addDays(this.selectedDate(), days));
  }

  protected reloadDay(): void {
    this.reloadDay$.next();
  }

  /** FR-5.4: only BOOKED appointments that have started can be closed. */
  protected canClose(a: Appointment): boolean {
    return a.status === 'BOOKED' && new Date(a.startAt).getTime() <= Date.now();
  }

  protected close(a: Appointment, outcome: 'complete' | 'no-show'): void {
    if (this.busyId() !== null) return;
    this.busyId.set(a.id);
    this.rowError.set(null);
    this.api.close(a.id, outcome).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.dayItems.update((items) => items.map((x) => (x.id === updated.id ? updated : x)));
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.rowError.set({ id: a.id, message: parseApiError(err).message });
      },
    });
  }

  private loadDay(date: string) {
    this.dayState.set('loading');
    this.dayError.set(null);
    this.rowError.set(null);
    return this.api.day(date).pipe(
      tap((res) => {
        this.dayItems.set(res.items);
        this.dayState.set('loaded');
      }),
      catchError((err: unknown) => {
        this.dayItems.set([]);
        this.dayError.set(parseApiError(err).message);
        this.dayState.set('error');
        return of(null);
      }),
    );
  }

  // ----- leaves -----

  protected loadLeaves(): void {
    this.leavesState.set('loading');
    this.api.leaves().subscribe({
      next: (dates) => {
        this.leaves.set(dates);
        this.leavesState.set('loaded');
      },
      error: () => this.leavesState.set('error'),
    });
  }

  protected addLeave(): void {
    const date = this.leaveDate();
    if (!isValidDate(date)) {
      this.leaveMessage.set({ kind: 'error', text: 'Choose a date.' });
      return;
    }
    if (date < this.today) {
      this.leaveMessage.set({ kind: 'error', text: 'Leave cannot be in the past.' });
      return;
    }
    if (this.savingLeave()) return;
    this.savingLeave.set(true);
    this.leaveMessage.set(null);
    this.api.addLeave(date).subscribe({
      next: (existingBookings) => {
        this.savingLeave.set(false);
        this.leaveDate.set('');
        this.leaveMessage.set(
          existingBookings > 0
            ? {
                kind: 'warning',
                text: `${this.dateLabel(date)} is now a leave day. ${existingBookings} existing booking(s) on that day are kept — please contact those patients.`,
              }
            : { kind: 'success', text: `${this.dateLabel(date)} is now a leave day.` },
        );
        this.loadLeaves();
      },
      error: (err: unknown) => {
        this.savingLeave.set(false);
        const parsed = parseApiError(err);
        const text =
          parsed.code === 'LEAVE_EXISTS'
            ? 'This date is already a leave day.'
            : parsed.code === 'LEAVE_IN_PAST'
              ? 'Leave cannot be in the past.'
              : parsed.message;
        this.leaveMessage.set({ kind: 'error', text });
      },
    });
  }

  protected removeLeave(date: string): void {
    this.leaveMessage.set(null);
    this.api.removeLeave(date).subscribe({
      next: () => {
        this.leaveMessage.set({
          kind: 'success',
          text: `${this.dateLabel(date)} is a working day again.`,
        });
        this.loadLeaves();
      },
      error: (err: unknown) => {
        this.leaveMessage.set({ kind: 'error', text: parseApiError(err).message });
        this.loadLeaves();
      },
    });
  }
}
