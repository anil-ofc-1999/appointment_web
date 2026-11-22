import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { AdminDoctor, AdminService, AppointmentFilters } from '../../core/admin/admin.service';
import { parseApiError } from '../../core/api-error';
import { Appointment, AppointmentStatus } from '../../core/appointments/appointment.models';
import { AppointmentService } from '../../core/appointments/appointment.service';
import { formatLongDate, isValidDate } from '../../core/clinic-date';
import { Page } from '../../core/doctors/doctor.models';

const STATUSES: { value: AppointmentStatus; label: string }[] = [
  { value: 'BOOKED', label: 'Booked' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'NO_SHOW', label: 'No-show' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/** FR-6.3 all appointments with filters; FR-5.5 admin cancels any BOOKED appointment. */
@Component({
  selector: 'app-admin-appointments',
  templateUrl: './admin-appointments.html',
  styleUrl: './admin.scss',
})
export class AdminAppointments implements OnInit {
  private readonly admin = inject(AdminService);
  private readonly appointmentsApi = inject(AppointmentService);

  protected readonly statuses = STATUSES;
  protected readonly doctors = signal<AdminDoctor[]>([]);
  protected readonly filters = signal<AppointmentFilters>({
    doctorId: null,
    status: null,
    from: null,
    to: null,
    page: 1,
  });
  protected readonly filterError = signal<string | null>(null);
  protected readonly state = signal<'loading' | 'loaded' | 'error'>('loading');
  protected readonly result = signal<Page<Appointment> | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly confirmingId = signal<number | null>(null);
  protected readonly busyId = signal<number | null>(null);
  protected readonly rowError = signal<{ id: number; message: string } | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.doctorId || f.status || f.from || f.to);
  });
  protected readonly dateLabel = formatLongDate;
  protected readonly statusLabel = (s: AppointmentStatus) =>
    STATUSES.find((x) => x.value === s)?.label ?? s;

  ngOnInit(): void {
    this.admin.doctors().subscribe({
      next: (page) => this.doctors.set(page.items),
      error: () => this.doctors.set([]),
    });
    this.load();
  }

  protected setFilter(field: 'doctorId' | 'status' | 'from' | 'to', raw: string): void {
    const value =
      field === 'doctorId'
        ? raw
          ? Number(raw)
          : null
        : field === 'status'
          ? raw || null
          : raw || null;
    const next = { ...this.filters(), [field]: value, page: 1 } as AppointmentFilters;

    // Same rules as the API, so the user sees the problem before any request.
    if ((next.from && !isValidDate(next.from)) || (next.to && !isValidDate(next.to))) {
      this.filterError.set('Use a valid date.');
      return;
    }
    if (next.from && next.to && next.from > next.to) {
      this.filters.set(next);
      this.filterError.set('"From" must be on or before "To".');
      return;
    }
    this.filterError.set(null);
    this.filters.set(next);
    this.load();
  }

  protected clearFilters(): void {
    this.filterError.set(null);
    this.filters.set({ doctorId: null, status: null, from: null, to: null, page: 1 });
    this.load();
  }

  protected goToPage(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.loadError.set(null);
    this.admin.appointments(this.filters()).subscribe({
      next: (page) => {
        this.result.set(page);
        this.state.set('loaded');
      },
      error: (err: unknown) => {
        this.result.set(null);
        this.loadError.set(parseApiError(err).message);
        this.state.set('error');
      },
    });
  }

  protected askCancel(id: number): void {
    this.notice.set(null);
    this.rowError.set(null);
    this.confirmingId.set(id);
  }

  protected keep(): void {
    this.confirmingId.set(null);
  }

  /** FR-5.5: the admin can cancel any BOOKED appointment, at any time. */
  protected cancel(a: Appointment): void {
    if (this.busyId() !== null) return;
    this.busyId.set(a.id);
    this.appointmentsApi.cancel(a.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.confirmingId.set(null);
        this.notice.set(
          `Appointment #${a.id} (${a.patient.name} with ${a.doctor.name}) was cancelled.`,
        );
        this.load();
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.confirmingId.set(null);
        this.rowError.set({ id: a.id, message: parseApiError(err).message });
      },
    });
  }
}
