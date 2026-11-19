import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { appointment } from '../../../testing/appointments';
import { AppointmentService } from './appointment.service';

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
