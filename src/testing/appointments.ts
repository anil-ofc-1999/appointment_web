import { Appointment } from '../app/core/appointments/appointment.models';

/** Test data for appointment specs. Default: Tue 2030-01-08 10:00 clinic time, BOOKED. */
export function appointment(id: number, overrides: Partial<Appointment> = {}): Appointment {
  return {
    id,
    status: 'BOOKED',
    startAt: '2030-01-08T04:30:00.000Z',
    endAt: '2030-01-08T05:00:00.000Z',
    date: '2030-01-08',
    time: '10:00',
    doctor: { id: 5, name: 'Dr. Meera Iyer', specialization: 'Cardiology' },
    patient: { id: 7, name: 'Asha Reddy' },
    cancelledBy: null,
    cancelledAt: null,
    createdAt: '2030-01-07T02:30:00.000Z',
    ...overrides,
  };
}
