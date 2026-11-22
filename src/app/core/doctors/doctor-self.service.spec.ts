import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { appointment } from '../../../testing/appointments';
import { DoctorSelfService } from './doctor-self.service';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    service: TestBed.inject(DoctorSelfService),
    http: TestBed.inject(HttpTestingController),
  };
}

afterEach(() => TestBed.inject(HttpTestingController).verify());

describe('DoctorSelfService', () => {
  it('day(date) reads my appointments for that date', () => {
    const { service, http } = setup();
    service.day('2030-01-08').subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/appointments/me');
    expect(req.request.params.get('date')).toBe('2030-01-08');
    req.flush({ date: '2030-01-08', items: [] });
  });

  it.each(['complete', 'no-show'] as const)('close(id, %s) posts to that endpoint', (outcome) => {
    const { service, http } = setup();
    let status;
    service.close(4, outcome).subscribe((a) => (status = a.status));

    const req = http.expectOne(`/api/v1/appointments/4/${outcome}`);
    expect(req.request.method).toBe('POST');
    req.flush({ appointment: appointment(4, { status: 'COMPLETED' }) });
    expect(status).toBe('COMPLETED');
  });

  it('saveSchedule sends only day / start / end', () => {
    const { service, http } = setup();
    service
      .saveSchedule([{ id: 7, dayOfWeek: 1, startTime: '10:00', endTime: '13:00' }])
      .subscribe();

    const req = http.expectOne('/api/v1/doctors/me/schedule');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      blocks: [{ dayOfWeek: 1, startTime: '10:00', endTime: '13:00' }],
    });
    req.flush({ blocks: [] });
  });

  it('leaves() returns the dates', () => {
    const { service, http } = setup();
    let dates;
    service.leaves().subscribe((d) => (dates = d));

    http.expectOne('/api/v1/doctors/me/leaves').flush({ items: [{ date: '2030-01-20' }] });
    expect(dates).toEqual(['2030-01-20']);
  });

  it('addLeave returns the number of existing bookings', () => {
    const { service, http } = setup();
    let count;
    service.addLeave('2030-01-20').subscribe((n) => (count = n));

    http
      .expectOne('/api/v1/doctors/me/leaves')
      .flush({ leave: { date: '2030-01-20' }, existingBookings: 3 });
    expect(count).toBe(3);
  });

  it('removeLeave sends DELETE /me/leaves/:date', () => {
    const { service, http } = setup();
    service.removeLeave('2030-01-20').subscribe();

    const req = http.expectOne('/api/v1/doctors/me/leaves/2030-01-20');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
