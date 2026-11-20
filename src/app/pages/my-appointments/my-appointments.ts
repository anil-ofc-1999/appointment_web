import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { parseApiError } from '../../core/api-error';
import { Appointment } from '../../core/appointments/appointment.models';
import {
  AppointmentService,
  MyAppointments as MyList,
  canChange,
} from '../../core/appointments/appointment.service';
import { formatLongDate } from '../../core/clinic-date';

type Tab = 'upcoming' | 'past';
type LoadState = 'loading' | 'loaded' | 'error';

const STATUS_LABELS: Record<Appointment['status'], string> = {
  BOOKED: 'Booked',
  COMPLETED: 'Completed',
  NO_SHOW: 'Missed',
  CANCELLED: 'Cancelled',
};

/** Screen 5 (REQUIREMENTS §8): My Appointments — FR-6.1, FR-5.1, FR-5.2. */
@Component({
  selector: 'app-my-appointments',
  imports: [RouterLink],
  templateUrl: './my-appointments.html',
  styleUrl: './my-appointments.scss',
})
export class MyAppointments implements OnInit {
  private readonly appointments = inject(AppointmentService);
  private readonly router = inject(Router);

  /** Query params: ?tab=past and ?rescheduled=<new id> (after a reschedule). */
  readonly tab = input<string>();
  readonly rescheduled = input<string>();

  protected readonly activeTab = computed<Tab>(() => (this.tab() === 'past' ? 'past' : 'upcoming'));
  protected readonly state = signal<LoadState>('loading');
  protected readonly list = signal<MyList>({ upcoming: [], past: [] });
  protected readonly loadError = signal<string | null>(null);

  /** The appointment whose "Cancel" was clicked and waits for "Yes, cancel". */
  protected readonly confirmingId = signal<number | null>(null);
  protected readonly cancellingId = signal<number | null>(null);
  protected readonly actionError = signal<{ id: number; message: string } | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly shown = computed(() => this.list()[this.activeTab()]);
  protected readonly dateLabel = formatLongDate;
  protected readonly statusLabel = (status: Appointment['status']) => STATUS_LABELS[status];
  protected readonly canChange = (a: Appointment) => canChange(a);

  ngOnInit(): void {
    if (this.rescheduled()) this.notice.set('Your appointment was rescheduled.');
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.loadError.set(null);
    this.appointments.mine().subscribe({
      next: (list) => {
        this.list.set(list);
        this.state.set('loaded');
      },
      error: (err: unknown) => {
        this.loadError.set(parseApiError(err).message);
        this.state.set('error');
      },
    });
  }

  protected showTab(tab: Tab): void {
    void this.router.navigate([], { queryParams: { tab: tab === 'past' ? 'past' : null } });
  }

  protected askCancel(id: number): void {
    this.actionError.set(null);
    this.notice.set(null);
    this.confirmingId.set(id);
  }

  protected keep(): void {
    this.confirmingId.set(null);
  }

  protected confirmCancel(appointment: Appointment): void {
    if (this.cancellingId() !== null) return;
    this.cancellingId.set(appointment.id);
    this.appointments
      .cancel(appointment.id)
      .pipe(finalize(() => this.cancellingId.set(null)))
      .subscribe({
        next: () => {
          this.confirmingId.set(null);
          this.notice.set(
            `Your appointment with ${appointment.doctor.name} on ${this.dateLabel(appointment.date)} at ${appointment.time} was cancelled.`,
          );
          this.load();
        },
        error: (err: unknown) => {
          this.confirmingId.set(null);
          this.actionError.set({ id: appointment.id, message: parseApiError(err).message });
        },
      });
  }
}
