import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { appointment } from '../../../testing/appointments';
import { AppointmentService, canChange } from './appointment.service';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    service: TestBed.inject(AppointmentService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('AppointmentService.book (FR-4.1)', () => {
  it('posts doctorId and startAt and returns the appointment', () => {
    const { service, http } = setup();
    let result;
    service.book(5, '2030-01-08T04:30:00.000Z').subscribe((a) => (result = a));

    const req = http.expectOne('/api/v1/appointments');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ doctorId: 5, startAt: '2030-01-08T04:30:00.000Z' });
    req.flush({ appointment: appointment(11) }, { status: 201, statusText: 'Created' });

    expect(result).toMatchObject({ id: 11, status: 'BOOKED' });
    http.verify();
  });

  it('passes a 409 to the caller', () => {
    const { service, http } = setup();
    let status = 0;
    service
      .book(5, '2030-01-08T04:30:00.000Z')
      .subscribe({ error: (e: { status: number }) => (status = e.status) });

    http.expectOne('/api/v1/appointments').flush(
      { error: { code: 'SLOT_ALREADY_BOOKED', message: 'x' } },
      {
        status: 409,
        statusText: 'Conflict',
      },
    );

    expect(status).toBe(409);
  });
});

describe('AppointmentService — my list, cancel, reschedule', () => {
  it('mine() reads upcoming and past', () => {
    const { service, http } = setup();
    let result;
    service.mine().subscribe((r) => (result = r));

    http.expectOne('/api/v1/appointments/me').flush({ upcoming: [appointment(1)], past: [] });

    expect(result).toEqual({ upcoming: [appointment(1)], past: [] });
  });

  it('cancel(id) posts to /:id/cancel and returns the appointment', () => {
    const { service, http } = setup();
    let result;
    service.cancel(3).subscribe((a) => (result = a));

    const req = http.expectOne('/api/v1/appointments/3/cancel');
    expect(req.request.method).toBe('POST');
    req.flush({ appointment: appointment(3, { status: 'CANCELLED' }) });

    expect(result).toMatchObject({ id: 3, status: 'CANCELLED' });
  });

  it('reschedule(id, startAt) posts the new time', () => {
    const { service, http } = setup();
    let result;
    service.reschedule(3, '2030-01-09T04:30:00.000Z').subscribe((r) => (result = r));

    const req = http.expectOne('/api/v1/appointments/3/reschedule');
    expect(req.request.body).toEqual({ startAt: '2030-01-09T04:30:00.000Z' });
    req.flush({ appointment: appointment(4), previousAppointmentId: 3 });

    expect(result).toMatchObject({ previousAppointmentId: 3, appointment: { id: 4 } });
  });
});

describe('canChange (FR-5.1: up to 2 hours before)', () => {
  const start = new Date('2030-01-08T04:30:00.000Z').getTime();
  const HOUR = 60 * 60 * 1000;

  it('true 3 hours before', () => {
    expect(canChange(appointment(1), start - 3 * HOUR)).toBe(true);
  });

  it('true exactly 2 hours before (boundary)', () => {
    expect(canChange(appointment(1), start - 2 * HOUR)).toBe(true);
  });

  it('false 1 minute less than 2 hours before', () => {
    expect(canChange(appointment(1), start - 2 * HOUR + 60_000)).toBe(false);
  });

  it('false after the start', () => {
    expect(canChange(appointment(1), start + HOUR)).toBe(false);
  });

  it.each(['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const)('false when %s', (status) => {
    expect(canChange(appointment(1, { status }), start - 5 * HOUR)).toBe(false);
  });
});
