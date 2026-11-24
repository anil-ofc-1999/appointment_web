import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { Appointment, AppointmentStatus } from '../appointments/appointment.models';
import { User } from '../auth/auth.models';
import { ScheduleBlock } from '../doctors/doctor-self.service';
import { Doctor, Page, Specialization } from '../doctors/doctor.models';

/** Doctor as the admin sees it (FR-2.2, FR-2.3): with login email and account status. */
export interface AdminDoctor extends Doctor {
  email: string;
  userId: number;
  accountActive: boolean;
}

export interface NewDoctor {
  name: string;
  email: string;
  password: string;
  specializationId: number;
  fee: number;
  slotMinutes: 15 | 30;
  bio?: string;
}

export type DoctorChanges = Partial<{
  name: string;
  specializationId: number;
  fee: number;
  slotMinutes: 15 | 30;
  bio: string | null;
  isActive: boolean;
}>;

export interface AppointmentFilters {
  doctorId: number | null;
  status: AppointmentStatus | null;
  from: string | null;
  to: string | null;
  page: number;
}

export const ADMIN_PAGE_SIZE = 20;

/** Admin-only endpoints (FR-2.1 – FR-2.3, FR-6.3, FR-5.5). */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);

  /** D-35: new password for a doctor / patient (admins are refused by the API). */
  resetPassword(email: string, newPassword: string): Observable<User> {
    return this.http
      .post<{ user: User }>('/api/v1/users/reset-password', { email, newPassword })
      .pipe(map((res) => res.user));
  }

  /** D-36: a doctor's weekly hours (same rules as the doctor's own editor). */
  doctorSchedule(doctorId: number): Observable<ScheduleBlock[]> {
    return this.http
      .get<{ blocks: ScheduleBlock[] }>(`/api/v1/doctors/${doctorId}/schedule`)
      .pipe(map((res) => res.blocks));
  }

  saveDoctorSchedule(doctorId: number, blocks: ScheduleBlock[]): Observable<ScheduleBlock[]> {
    const body = {
      blocks: blocks.map(({ dayOfWeek, startTime, endTime }) => ({
        dayOfWeek,
        startTime,
        endTime,
      })),
    };
    return this.http
      .put<{ blocks: ScheduleBlock[] }>(`/api/v1/doctors/${doctorId}/schedule`, body)
      .pipe(map((res) => res.blocks));
  }

  /** All doctors including inactive ones (one page of up to 50). */
  doctors(page = 1): Observable<Page<AdminDoctor>> {
    return this.http.get<Page<AdminDoctor>>('/api/v1/doctors', {
      params: { includeInactive: 'true', page, pageSize: 50 },
    });
  }

  createDoctor(body: NewDoctor): Observable<AdminDoctor> {
    return this.http
      .post<{ doctor: AdminDoctor }>('/api/v1/doctors', body)
      .pipe(map((res) => res.doctor));
  }

  updateDoctor(id: number, changes: DoctorChanges): Observable<AdminDoctor> {
    return this.http
      .patch<{ doctor: AdminDoctor }>(`/api/v1/doctors/${id}`, changes)
      .pipe(map((res) => res.doctor));
  }

  /** All specializations including inactive ones. */
  specializations(): Observable<Specialization[]> {
    return this.http
      .get<{ items: Specialization[] }>('/api/v1/specializations', {
        params: { includeInactive: 'true' },
      })
      .pipe(map((res) => res.items));
  }

  createSpecialization(name: string): Observable<Specialization> {
    return this.http
      .post<{ specialization: Specialization }>('/api/v1/specializations', { name })
      .pipe(map((res) => res.specialization));
  }

  updateSpecialization(
    id: number,
    changes: Partial<Pick<Specialization, 'name' | 'isActive'>>,
  ): Observable<Specialization> {
    return this.http
      .patch<{ specialization: Specialization }>(`/api/v1/specializations/${id}`, changes)
      .pipe(map((res) => res.specialization));
  }

  /** FR-6.3: all appointments, newest first, with filters. */
  appointments(filters: AppointmentFilters): Observable<Page<Appointment>> {
    let params = new HttpParams().set('page', filters.page).set('pageSize', ADMIN_PAGE_SIZE);
    if (filters.doctorId) params = params.set('doctorId', filters.doctorId);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    return this.http.get<Page<Appointment>>('/api/v1/appointments', { params });
  }
}
