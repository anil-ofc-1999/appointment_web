/** Types that mirror appointment_node_API appointment endpoints (FR-4 to FR-6). */

export type AppointmentStatus = 'BOOKED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';

export interface Appointment {
  id: number;
  status: AppointmentStatus;
  /** UTC ISO instants. */
  startAt: string;
  endAt: string;
  /** Clinic-local date 'YYYY-MM-DD' and time 'HH:MM'. */
  date: string;
  time: string;
  doctor: { id: number; name: string; specialization: string };
  patient: { id: number; name: string };
  cancelledBy: number | null;
  cancelledAt: string | null;
  createdAt: string;
}
