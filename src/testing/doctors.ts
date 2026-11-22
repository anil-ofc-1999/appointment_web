import { Doctor, Page, Specialization } from '../app/core/doctors/doctor.models';

/** Test data for doctor search specs. */

export const specializations: Specialization[] = [
  { id: 1, name: 'Cardiology', isActive: true },
  { id: 2, name: 'Dermatology', isActive: true },
];

export function doctor(id: number, name: string, overrides: Partial<Doctor> = {}): Doctor {
  return {
    id,
    name,
    specialization: { id: 1, name: 'Cardiology' },
    fee: 500,
    slotMinutes: 30,
    bio: null,
    isActive: true,
    ...overrides,
  };
}

export function page(
  items: Doctor[],
  { page = 1, pageSize = 10, total = items.length } = {},
): Page<Doctor> {
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
