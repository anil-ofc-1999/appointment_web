import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { Appointment } from '../appointments/appointment.models';

/** One weekly working block (FR-3.1). dayOfWeek: 0 = Sunday .. 6 = Saturday. */
export interface ScheduleBlock {
  id?: number;
  dayOfWeek: number;
  startTime: string; // 'HH:MM'
  endTime: string;
}

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Endpoints for the logged-in DOCTOR (FR-6.2, FR-5.4, FR-3.1 – FR-3.3). */
@Injectable({ providedIn: 'root' })
export class DoctorSelfService {
  private readonly http = inject(HttpClient);

  /** My appointments on one clinic date. */
  day(date: string): Observable<{ date: string; items: Appointment[] }> {
    return this.http.get<{ date: string; items: Appointment[] }>('/api/v1/appointments/me', {
      params: { date },
    });
  }

  /** FR-5.4: mark COMPLETED or NO_SHOW (only after the start time). */
  close(id: number, outcome: 'complete' | 'no-show'): Observable<Appointment> {
    return this.http
      .post<{ appointment: Appointment }>(`/api/v1/appointments/${id}/${outcome}`, {})
      .pipe(map((res) => res.appointment));
  }

  schedule(): Observable<ScheduleBlock[]> {
    return this.http
      .get<{ blocks: ScheduleBlock[] }>('/api/v1/doctors/me/schedule')
      .pipe(map((res) => res.blocks));
  }

  /** Replaces the whole weekly schedule. Existing bookings are kept (FR-3.6). */
  saveSchedule(blocks: ScheduleBlock[]): Observable<ScheduleBlock[]> {
    const body = {
      blocks: blocks.map(({ dayOfWeek, startTime, endTime }) => ({
        dayOfWeek,
        startTime,
        endTime,
      })),
    };
    return this.http
      .put<{ blocks: ScheduleBlock[] }>('/api/v1/doctors/me/schedule', body)
      .pipe(map((res) => res.blocks));
  }

  /** Today's and future leave days. */
  leaves(): Observable<string[]> {
    return this.http
      .get<{ items: { date: string }[] }>('/api/v1/doctors/me/leaves')
      .pipe(map((res) => res.items.map((i) => i.date)));
  }

  /** Returns how many bookings already exist on that day (they are kept). */
  addLeave(date: string): Observable<number> {
    return this.http
      .post<{ existingBookings: number }>('/api/v1/doctors/me/leaves', { date })
      .pipe(map((res) => res.existingBookings));
  }

  removeLeave(date: string): Observable<void> {
    return this.http.delete<void>(`/api/v1/doctors/me/leaves/${date}`);
  }
}
