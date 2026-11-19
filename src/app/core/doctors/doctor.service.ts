import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { Doctor, DoctorSearchCriteria, Page, Specialization } from './doctor.models';

export const DOCTORS_PAGE_SIZE = 10;
/** Same limit as the API (search max 100 characters). */
export const SEARCH_MAX_LENGTH = 100;

@Injectable({ providedIn: 'root' })
export class DoctorService {
  private readonly http = inject(HttpClient);

  /** Active specializations for the filter (FR-2.1). */
  specializations(): Observable<Specialization[]> {
    return this.http
      .get<{ items: Specialization[] }>('/api/v1/specializations')
      .pipe(map((res) => res.items));
  }

  /** FR-2.4 / FR-2.5: list, filter by specialization, search by name, paginate. */
  search(criteria: DoctorSearchCriteria): Observable<Page<Doctor>> {
    let params = new HttpParams().set('page', criteria.page).set('pageSize', DOCTORS_PAGE_SIZE);
    const search = criteria.search.trim();
    if (search) params = params.set('search', search);
    if (criteria.specializationId)
      params = params.set('specializationId', criteria.specializationId);
    return this.http.get<Page<Doctor>>('/api/v1/doctors', { params });
  }
}

/**
 * Reads search criteria from URL query params, ignoring anything invalid
 * (so a hand-edited URL like ?page=-1&specializationId=abc still works).
 */
export function criteriaFromParams(params: {
  get(name: string): string | null;
}): DoctorSearchCriteria {
  const positiveInt = (value: string | null): number | null => {
    if (!value || !/^\d+$/.test(value)) return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  };
  return {
    search: (params.get('q') ?? '').trim().slice(0, SEARCH_MAX_LENGTH),
    specializationId: positiveInt(params.get('specializationId')),
    page: positiveInt(params.get('page')) ?? 1,
  };
}

/** The opposite of criteriaFromParams: only non-default values go into the URL. */
export function paramsFromCriteria(criteria: DoctorSearchCriteria): Record<string, string | null> {
  const search = criteria.search.trim();
  return {
    q: search || null,
    specializationId: criteria.specializationId ? String(criteria.specializationId) : null,
    page: criteria.page > 1 ? String(criteria.page) : null,
  };
}
