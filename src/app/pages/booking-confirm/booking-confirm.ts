import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, finalize, of, switchMap, tap } from 'rxjs';

import { parseApiError } from '../../core/api-error';
import { Appointment } from '../../core/appointments/appointment.models';
import { AppointmentService } from '../../core/appointments/appointment.service';
import { AuthService } from '../../core/auth/auth.service';
import {
  BOOKING_WINDOW_DAYS,
  clinicDateOf,
  clinicTimeOf,
  formatLongDate,
  isIsoInstant,
} from '../../core/clinic-date';
import { Doctor } from '../../core/doctors/doctor.models';
import { DoctorService } from '../../core/doctors/doctor.service';

type PageState = 'loading' | 'ready' | 'invalid-slot' | 'not-found' | 'error' | 'booked';

/** Errors after which this slot can never be booked — offer to pick another one. */
const PICK_ANOTHER = new Set([
  'SLOT_ALREADY_BOOKED',
  'SLOT_IN_PAST',
  'BEYOND_BOOKING_WINDOW',
  'DOCTOR_ON_LEAVE',
  'OUTSIDE_SCHEDULE',
]);

/** Screen 4 (REQUIREMENTS §8): Booking confirmation — FR-4.1 to FR-4.7. */
@Component({
  selector: 'app-booking-confirm',
  imports: [RouterLink, CurrencyPipe],
  templateUrl: './booking-confirm.html',
  styleUrl: './booking-confirm.scss',
})
export class BookingConfirm {
  private readonly doctors = inject(DoctorService);
  private readonly appointments = inject(AppointmentService);
  private readonly auth = inject(AuthService);

  /** Route param :id and query param ?startAt=. */
  readonly id = input<string>();
  readonly startAt = input<string>();

  protected readonly state = signal<PageState>('loading');
  protected readonly doctor = signal<Doctor | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly bookError = signal<{ code: string; message: string } | null>(null);
  protected readonly booked = signal<Appointment | null>(null);

  /** FR-4.1: only patients can book. */
  protected readonly isPatient = computed(() => this.auth.user()?.role === 'PATIENT');

  protected readonly doctorId = computed(() => {
    const raw = this.id() ?? '';
    const n = Number(raw);
    return /^\d+$/.test(raw) && Number.isSafeInteger(n) && n > 0 ? n : null;
  });

  /** The slot from the URL, if it looks bookable (the API still has the final say). */
  protected readonly slot = computed(() => {
    const startAt = this.startAt();
    if (!isIsoInstant(startAt)) return null;
    const time = new Date(startAt).getTime();
    const now = Date.now();
    if (time <= now || time > now + BOOKING_WINDOW_DAYS * 24 * 60 * 60 * 1000) return null;
    const date = clinicDateOf(startAt);
    return { startAt, date, time: clinicTimeOf(startAt), dateLabel: formatLongDate(date) };
  });

  protected readonly backLink = computed(() => ({
    commands: ['/doctors', this.doctorId() ?? ''],
    queryParams: this.slot() ? { date: this.slot()!.date } : {},
  }));

  protected readonly canPickAnother = computed(() => {
    const code = this.bookError()?.code;
    return !!code && PICK_ANOTHER.has(code);
  });

  /** Retrying cannot help after these errors (network / server errors can be retried). */
  protected readonly cannotRetry = computed(
    () => this.canPickAnother() || this.bookError()?.code === 'DAILY_LIMIT_REACHED',
  );

  protected readonly dateLabel = formatLongDate;

  constructor() {
    toObservable(this.doctorId)
      .pipe(
        switchMap((id) => this.load(id)),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  protected retryLoad(): void {
    this.load(this.doctorId()).subscribe();
  }

  protected confirm(): void {
    const slot = this.slot();
    const id = this.doctorId();
    if (!slot || !id || this.submitting() || !this.isPatient()) return;

    this.submitting.set(true);
    this.bookError.set(null);
    this.appointments
      .book(id, slot.startAt)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (appointment) => {
          this.booked.set(appointment);
          this.state.set('booked');
        },
        error: (err: unknown) => {
          const parsed = parseApiError(err);
          if (parsed.code === 'DOCTOR_NOT_FOUND') {
            this.state.set('not-found');
            return;
          }
          this.bookError.set({ code: parsed.code, message: parsed.message });
        },
      });
  }

  private load(id: number | null) {
    this.doctor.set(null);
    this.loadError.set(null);
    if (id === null) {
      this.state.set('not-found');
      return of(null);
    }
    if (!this.slot()) {
      this.state.set('invalid-slot');
      return of(null);
    }
    this.state.set('loading');
    return this.doctors.doctor(id).pipe(
      tap((doctor) => {
        this.doctor.set(doctor);
        this.state.set('ready');
      }),
      catchError((err: unknown) => {
        const parsed = parseApiError(err);
        if (parsed.code === 'DOCTOR_NOT_FOUND') {
          this.state.set('not-found');
        } else {
          this.loadError.set(parsed.message);
          this.state.set('error');
        }
        return of(null);
      }),
    );
  }
}
