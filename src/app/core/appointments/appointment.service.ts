import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { Appointment } from './appointment.models';

/** Patients may change a booking only up to this many hours before it starts (FR-5.1). */
export const CHANGE_CUTOFF_HOURS = 2;

export interface MyAppointments {
  /** BOOKED and not started yet, soonest first. */
  upcoming: Appointment[];
  /** Everything else, newest first. */
  past: Appointment[];
}

export interface RescheduleResult {
  appointment: Appointment;
  previousAppointmentId: number;
}

@Injectable({ providedIn: 'root' })
export class AppointmentService {
  private readonly http = inject(HttpClient);

  /** FR-4.1: book a slot (patients only). startAt exactly as the slots API returned it. */
  book(doctorId: number, startAt: string): Observable<Appointment> {
    return this.http
      .post<{ appointment: Appointment }>('/api/v1/appointments', { doctorId, startAt })
      .pipe(map((res) => res.appointment));
  }

  /** FR-6.1: the patient's own appointments. */
  mine(): Observable<MyAppointments> {
    return this.http.get<MyAppointments>('/api/v1/appointments/me');
  }

  /** FR-5.1: cancel (patient: own, up to 2 hours before). */
  cancel(id: number): Observable<Appointment> {
    return this.http
      .post<{ appointment: Appointment }>(`/api/v1/appointments/${id}/cancel`, {})
      .pipe(map((res) => res.appointment));
  }

  /** FR-5.2: move to another slot of the same doctor (atomic on the server). */
  reschedule(id: number, startAt: string): Observable<RescheduleResult> {
    return this.http.post<RescheduleResult>(`/api/v1/appointments/${id}/reschedule`, { startAt });
  }
}

/** True while a patient may still cancel / reschedule (the API has the final say). */
export function canChange(appointment: Appointment, now: number = Date.now()): boolean {
  return (
    appointment.status === 'BOOKED' &&
    new Date(appointment.startAt).getTime() - now >= CHANGE_CUTOFF_HOURS * 60 * 60 * 1000
  );
}
