import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { appointment } from '../../../testing/appointments';
import { doctor } from '../../../testing/doctors';
import { apiError, loginResponse, testUser } from '../../../testing/fake-jwt';
import { Role } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { BookingConfirm } from './booking-confirm';

// "Now": Monday 2030-01-07 08:00 clinic time.
const NOW = new Date('2030-01-07T08:00:00+05:30');
const SLOT = '2030-01-08T04:30:00.000Z'; // Tue 8 Jan 10:00 clinic time
const DR = doctor(5, 'Dr. Meera Iyer', { fee: 900 });

async function open(url = `/doctors/5/book?startAt=${SLOT}`, role: Role | null = 'PATIENT') {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        [
          { path: 'doctors/:id/book', component: BookingConfirm },
          { path: '**', children: [] },
        ],
        withComponentInputBinding(),
      ),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  if (role) {
    TestBed.inject(AuthService).login({ email: 'a@example.com', password: 'x' }).subscribe();
    http.expectOne('/api/v1/auth/login').flush(loginResponse(undefined, { ...testUser, role }));
  }
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, BookingConfirm);
  const el = () => harness.routeNativeElement as HTMLElement;
  const stable = () => harness.fixture.whenStable();

  return {
    http,
    el,
    stable,
    async loadDoctor() {
      http.expectOne('/api/v1/doctors/5').flush({ doctor: DR });
      await stable();
    },
    bookRequest: (): TestRequest => http.expectOne('/api/v1/appointments'),
    async failBooking(status: number, code: string) {
      http.expectOne('/api/v1/appointments').flush(apiError(code, 'raw'), {
        status,
        statusText: 'Error',
      });
      await stable();
    },
    text: (testId: string) => el().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim(),
    confirmButton: () =>
      [...el().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        /Confirm booking|Booking…/.test(b.textContent ?? ''),
      )!,
    link: (label: string) =>
      [...el().querySelectorAll<HTMLAnchorElement>('a')].find(
        (a) => a.textContent?.trim() === label,
      ),
    async confirm() {
      [...el().querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.trim() === 'Confirm booking')!
        .click();
      await stable();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  TestBed.inject(HttpTestingController).verify();
  vi.useRealTimers();
  localStorage.clear();
});

describe('Booking confirmation — positive scenarios', () => {
  it('shows doctor, specialization, date, time, length and fee', async () => {
    const screen = await open();
    await screen.loadDoctor();

    const summary = screen.text('booking-summary');
    expect(summary).toContain('Dr. Meera Iyer');
    expect(summary).toContain('Cardiology');
    expect(summary).toContain('Tuesday, 8 January 2030');
    expect(summary).toContain('10:00 (30 minutes)');
    expect(summary).toContain('₹900');
  });

  it('mentions the 2-hour change rule', async () => {
    const screen = await open();
    await screen.loadDoctor();

    expect(screen.el().textContent).toContain('up to 2 hours before');
  });

  it('confirms: posts doctorId + startAt and shows the booked appointment', async () => {
    const screen = await open();
    await screen.loadDoctor();

    await screen.confirm();
    const req = screen.bookRequest();
    expect(req.request.body).toEqual({ doctorId: 5, startAt: SLOT });
    req.flush({ appointment: appointment(42) }, { status: 201, statusText: 'Created' });
    await screen.stable();

    expect(screen.text('booking-success')).toContain('Appointment booked');
    expect(screen.text('booking-success')).toContain('Dr. Meera Iyer');
    expect(screen.text('booked-status')).toBe('BOOKED');
    expect(screen.text('booked-id')).toBe('#42');
    expect(screen.link('See my appointments')?.getAttribute('href')).toBe('/appointments');
    expect(screen.link('Book another')?.getAttribute('href')).toBe('/doctors');
  });

  it('shows "Booking…" and disables the button while waiting', async () => {
    const screen = await open();
    await screen.loadDoctor();

    await screen.confirm();

    expect(screen.confirmButton().disabled).toBe(true);
    expect(screen.confirmButton().textContent).toContain('Booking…');
    screen.bookRequest().flush({ appointment: appointment(1) });
  });

  it('a double click sends only one booking', async () => {
    const screen = await open();
    await screen.loadDoctor();

    screen.confirmButton().click();
    screen.confirmButton().click();
    await screen.stable();

    expect(screen.http.match('/api/v1/appointments')).toHaveLength(1);
  });

  it('"Back" returns to the doctor on the same date', async () => {
    const screen = await open();
    await screen.loadDoctor();

    expect(screen.link('Back')?.getAttribute('href')).toBe('/doctors/5?date=2030-01-08');
  });
});

describe('Booking confirmation — negative scenarios (API answers)', () => {
  it.each([
    ['SLOT_ALREADY_BOOKED', 409, 'someone has just booked this slot'],
    ['SLOT_IN_PAST', 400, 'already passed'],
    ['BEYOND_BOOKING_WINDOW', 400, '30 days ahead'],
    ['DOCTOR_ON_LEAVE', 400, 'on leave'],
    ['OUTSIDE_SCHEDULE', 400, 'does not work at this time'],
  ])('%s: explains, offers another slot, blocks retry', async (code, status, text) => {
    const screen = await open();
    await screen.loadDoctor();

    await screen.confirm();
    await screen.failBooking(status, code);

    expect(screen.text('booking-error')).toContain(text);
    expect(screen.link('Choose another slot')?.getAttribute('href')).toBe(
      '/doctors/5?date=2030-01-08',
    );
    expect(screen.confirmButton().disabled).toBe(true);
  });

  it('DAILY_LIMIT_REACHED: explains and links to my appointments (FR-4.5)', async () => {
    const screen = await open();
    await screen.loadDoctor();

    await screen.confirm();
    await screen.failBooking(409, 'DAILY_LIMIT_REACHED');

    expect(screen.text('booking-error')).toContain('Only one per day');
    expect(screen.el().querySelector('[data-testid="booking-error"] a')?.getAttribute('href')).toBe(
      '/appointments',
    );
    expect(screen.confirmButton().disabled).toBe(true);
  });

  it('doctor became inactive meanwhile: "Doctor not found"', async () => {
    const screen = await open();
    await screen.loadDoctor();

    await screen.confirm();
    await screen.failBooking(404, 'DOCTOR_NOT_FOUND');

    expect(screen.text('booking-doctor-not-found')).toContain('Doctor not found');
  });

  it('server down: message and the user can try again', async () => {
    const screen = await open();
    await screen.loadDoctor();

    await screen.confirm();
    screen.bookRequest().error(new ProgressEvent('error'));
    await screen.stable();

    expect(screen.text('booking-error')).toContain('Cannot reach the server');
    expect(screen.confirmButton().disabled).toBe(false);

    await screen.confirm();
    screen.bookRequest().flush({ appointment: appointment(9) });
    await screen.stable();
    expect(screen.text('booking-success')).toBeDefined();
  });

  it('server error 500: generic message, retry allowed', async () => {
    const screen = await open();
    await screen.loadDoctor();

    await screen.confirm();
    screen.bookRequest().flush('oops', { status: 500, statusText: 'Error' });
    await screen.stable();

    expect(screen.text('booking-error')).toContain('Something went wrong');
    expect(screen.confirmButton().disabled).toBe(false);
  });
});

describe('Booking confirmation — negative scenarios (bad link / wrong user)', () => {
  it.each([
    ['no startAt', '/doctors/5/book'],
    ['startAt is not a date', '/doctors/5/book?startAt=tomorrow'],
    ['startAt without time zone', '/doctors/5/book?startAt=2030-01-08T10:00:00'],
    ['startAt in the past', '/doctors/5/book?startAt=2030-01-06T04:30:00.000Z'],
    ['startAt more than 30 days ahead', '/doctors/5/book?startAt=2030-02-10T04:30:00.000Z'],
  ])('%s: "This slot cannot be booked", no API call', async (_label, url) => {
    const screen = await open(url);

    expect(screen.text('invalid-slot')).toContain('This slot cannot be booked');
    expect(screen.link('Choose a slot')?.getAttribute('href')).toBe('/doctors/5');
    screen.http.expectNone(() => true);
  });

  it.each(['abc', '0'])('doctor id %j: "Doctor not found"', async (id) => {
    const screen = await open(`/doctors/${id}/book?startAt=${SLOT}`);

    expect(screen.text('booking-doctor-not-found')).toContain('Doctor not found');
    screen.http.expectNone(() => true);
  });

  it('unknown / inactive doctor (404): "Doctor not found"', async () => {
    const screen = await open();
    screen.http
      .expectOne('/api/v1/doctors/5')
      .flush(apiError('DOCTOR_NOT_FOUND', 'x'), { status: 404, statusText: 'Not Found' });
    await screen.stable();

    expect(screen.text('booking-doctor-not-found')).toBeDefined();
  });

  it('doctor fails to load: error and "Try again"', async () => {
    const screen = await open();
    screen.http.expectOne('/api/v1/doctors/5').flush('x', { status: 500, statusText: 'Error' });
    await screen.stable();
    expect(screen.text('booking-load-error')).toContain('Something went wrong');

    [...screen.el().querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Try again')!
      .click();
    await screen.loadDoctor();
    expect(screen.text('booking-summary')).toContain('Dr. Meera Iyer');
  });

  it.each<Role>(['DOCTOR', 'ADMIN'])(
    'a %s cannot book: explains and the button is disabled (FR-4.1)',
    async (role) => {
      const screen = await open(undefined, role);
      await screen.loadDoctor();

      expect(screen.text('not-patient')).toContain('Only patients can book');
      expect(screen.confirmButton().disabled).toBe(true);
      screen.http.expectNone('/api/v1/appointments');
    },
  );
});
