import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { Appointment } from './appointment.models';

@Injectable({ providedIn: 'root' })
export class AppointmentService {
  private readonly http = inject(HttpClient);

  /** FR-4.1: book a slot (patients only). startAt exactly as the slots API returned it. */
  book(doctorId: number, startAt: string): Observable<Appointment> {
    return this.http
      .post<{ appointment: Appointment }>('/api/v1/appointments', { doctorId, startAt })
      .pipe(map((res) => res.appointment));
  }
}
