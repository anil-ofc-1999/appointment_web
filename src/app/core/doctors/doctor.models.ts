/** Types that mirror appointment_node_API doctor endpoints (FR-2). */

export interface Specialization {
  id: number;
  name: string;
  isActive: boolean;
}

export interface Doctor {
  id: number;
  name: string;
  specialization: { id: number; name: string };
  fee: number;
  slotMinutes: number;
  bio: string | null;
  isActive: boolean;
}

/** Paged list response (FR-2.5). */
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface DoctorSearchCriteria {
  search: string;
  specializationId: number | null;
  page: number;
}
