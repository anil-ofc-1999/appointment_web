import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import {
  Subject,
  catchError,
  combineLatest,
  filter,
  finalize,
  map,
  of,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

import { parseApiError } from '../../core/api-error';
import { Appointment } from '../../core/appointments/appointment.models';
import { AppointmentService, canChange } from '../../core/appointments/appointment.service';
import {
  addDays,
  bookableDateOrToday,
  bookableRange,
  formatLongDate,
  formatShortDate,
  isValidDate,
} from '../../core/clinic-date';
import { Slot, SlotsResponse } from '../../core/doctors/doctor.models';
import { DoctorService } from '../../core/doctors/doctor.service';

type PageState = 'loading' | 'ready' | 'not-found' | 'locked' | 'error';

/** Errors after which this new slot can never work — pick another one. */
const PICK_ANOTHER = new Set([
  'SLOT_ALREADY_BOOKED',
  'SLOT_IN_PAST',
  'BEYOND_BOOKING_WINDOW',
  'DOCTOR_ON_LEAVE',
  'OUTSIDE_SCHEDULE',
  'SAME_SLOT',
  'DAILY_LIMIT_REACHED',
]);

/** FR-5.2: move an upcoming appointment to another slot of the same doctor. */
@Component({
  selector: 'app-reschedule',
  imports: [RouterLink],
  templateUrl: './reschedule.html',
  styleUrl: './reschedule.scss',
})
export class Reschedule {
  private readonly appointments = inject(AppointmentService);
  private readonly doctors = inject(DoctorService);
  private readonly router = inject(Router);

  /** Route param :id and query param ?date=. */
  readonly id = input<string>();
  readonly date = input<string>();

  private readonly retry$ = new Subject<void>();

  protected readonly range = bookableRange();
  protected readonly state = signal<PageState>('loading');
  protected readonly loadError = signal<string | null>(null);
  protected readonly current = signal<Appointment | null>(null);

  protected readonly selectedDate = computed(() =>
    bookableDateOrToday(this.date() ?? this.current()?.date),
  );
  protected readonly quickDays = computed(() =>
    Array.from({ length: 7 }, (_, i) => {
      const value = addDays(this.range.min, i);
      return { value, label: i === 0 ? 'Today' : formatShortDate(value) };
    }),
  );
  protected readonly slotsState = signal<'loading' | 'loaded' | 'error'>('loading');
  protected readonly slots = signal<SlotsResponse | null>(null);
  protected readonly slotsError = signal<string | null>(null);
  protected readonly selected = signal<Slot | null>(null);

  protected readonly saving = signal(false);
  protected readonly saveError = signal<{ code: string; message: string } | null>(null);
  protected readonly dateLabel = formatLongDate;

  protected readonly appointmentId = computed(() => {
    const raw = this.id() ?? '';
    const n = Number(raw);
    return /^\d+$/.test(raw) && Number.isSafeInteger(n) && n > 0 ? n : null;
  });

  private readonly slotsKey = computed(() => {
    const current = this.current();
    return this.state() === 'ready' && current
      ? `${current.doctor.id}|${this.selectedDate()}`
      : null;
  });

  constructor() {
    toObservable(this.appointmentId)
      .pipe(
        switchMap((id) => this.loadAppointment(id)),
        takeUntilDestroyed(),
      )
      .subscribe();

    // One value says what to load ("doctorId|date"), so a new appointment and its date
    // arriving together cause ONE request; nothing is loaded for a locked appointment.
    combineLatest([toObservable(this.slotsKey), this.retry$.pipe(startWith(undefined))])
      .pipe(
        map(([key]) => key),
        filter((key) => key !== null),
        switchMap((key) => {
          const [doctorId, date] = key!.split('|');
          return this.loadSlots(Number(doctorId), date);
        }),
        takeUntilDestroyed(),
      )
      .subscribe();

    effect(() => {
      this.selectedDate();
      this.selected.set(null);
      this.saveError.set(null);
    });
  }

  protected isCurrent(slot: Slot): boolean {
    return slot.startAt === this.current()?.startAt;
  }

  protected chooseDate(value: string): void {
    if (!isValidDate(value) || value < this.range.min || value > this.range.max) return;
    void this.router.navigate([], { queryParams: { date: value } });
  }

  protected choose(slot: Slot): void {
    if (slot.status !== 'AVAILABLE' || this.isCurrent(slot)) return;
    this.saveError.set(null);
    this.selected.set(slot);
  }

  protected retrySlots(): void {
    this.retry$.next();
  }

  protected save(): void {
    const current = this.current();
    const slot = this.selected();
    if (!current || !slot || this.saving()) return;

    this.saving.set(true);
    this.saveError.set(null);
    this.appointments
      .reschedule(current.id, slot.startAt)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (result) =>
          void this.router.navigate(['/appointments'], {
            queryParams: { rescheduled: result.appointment.id },
          }),
        error: (err: unknown) => {
          const parsed = parseApiError(err);
          this.saveError.set({ code: parsed.code, message: parsed.message });
          if (PICK_ANOTHER.has(parsed.code)) {
            this.selected.set(null);
            this.retrySlots(); // refresh: the grid may have changed
          }
        },
      });
  }

  private loadAppointment(id: number | null) {
    this.current.set(null);
    if (id === null) {
      this.state.set('not-found');
      return of(null);
    }
    this.state.set('loading');
    return this.appointments.mine().pipe(
      tap((list) => {
        const appointment = [...list.upcoming, ...list.past].find((a) => a.id === id) ?? null;
        if (!appointment) {
          this.state.set('not-found');
        } else if (!canChange(appointment)) {
          this.current.set(appointment);
          this.state.set('locked');
        } else {
          this.current.set(appointment);
          this.state.set('ready');
        }
      }),
      catchError((err: unknown) => {
        this.loadError.set(parseApiError(err).message);
        this.state.set('error');
        return of(null);
      }),
    );
  }

  private loadSlots(doctorId: number, date: string) {
    this.slotsState.set('loading');
    this.slotsError.set(null);
    return this.doctors.slots(doctorId, date).pipe(
      tap((result) => {
        this.slots.set(result);
        this.slotsState.set('loaded');
      }),
      catchError((err: unknown) => {
        this.slots.set(null);
        this.slotsError.set(parseApiError(err).message);
        this.slotsState.set('error');
        return of(null);
      }),
    );
  }

  protected reloadAppointment(): void {
    this.loadAppointment(this.appointmentId()).subscribe();
  }
}
