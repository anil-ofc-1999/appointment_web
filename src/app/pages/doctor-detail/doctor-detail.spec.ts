import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { doctor } from '../../../testing/doctors';
import { apiError } from '../../../testing/fake-jwt';
import { Slot, SlotsResponse } from '../../core/doctors/doctor.models';
import { DoctorDetail } from './doctor-detail';

// "Now": Monday 2030-01-07 08:00 in the clinic.
const NOW = new Date('2030-01-07T08:00:00+05:30');
const TODAY = '2030-01-07';

const DR = doctor(5, 'Dr. Meera Iyer', {
  fee: 900,
  bio: 'Heart specialist.',
  specialization: { id: 1, name: 'Cardiology' },
});

function slot(date: string, time: string, status: Slot['status'] = 'AVAILABLE'): Slot {
  const start = new Date(`${date}T${time}:00+05:30`);
  return {
    time,
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
    status,
  };
}

function slots(date: string, list: Slot[], onLeave = false): SlotsResponse {
  return { doctorId: 5, date, slotMinutes: 30, onLeave, slots: list };
}

const DAY = (date: string) => [
  slot(date, '10:00'),
  slot(date, '10:30', 'BOOKED'),
  slot(date, '12:00'),
  slot(date, '17:30'),
];

async function open(url = '/doctors/5') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        [{ path: 'doctors/:id', component: DoctorDetail }],
        withComponentInputBinding(),
      ),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, DoctorDetail);
  const http = TestBed.inject(HttpTestingController);
  const router = TestBed.inject(Router);
  const el = () => harness.routeNativeElement as HTMLElement;
  const stable = () => harness.fixture.whenStable();

  return {
    http,
    router,
    el,
    stable,
    doctorRequest: (id = 5): TestRequest => http.expectOne(`/api/v1/doctors/${id}`),
    slotsRequest: (): TestRequest => http.expectOne((r) => r.url === '/api/v1/doctors/5/slots'),
    async loadDoctor() {
      http.expectOne('/api/v1/doctors/5').flush({ doctor: DR });
      await stable();
    },
    async loadSlots(body: SlotsResponse) {
      http.expectOne((r) => r.url === '/api/v1/doctors/5/slots').flush(body);
      await stable();
    },
    text: (testId: string) => el().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim(),
    slotButtons: () => [...el().querySelectorAll<HTMLButtonElement>('[data-testid="slot"]')],
    slotButton: (time: string) =>
      [...el().querySelectorAll<HTMLButtonElement>('[data-testid="slot"]')].find((b) =>
        b.textContent?.trim().startsWith(time),
      )!,
    dayButton: (date: string) =>
      el().querySelector<HTMLButtonElement>(`.day[data-date="${date}"]`)!,
    continueButton: () =>
      [...el().querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === 'Continue to booking',
      )!,
    button: (label: string) =>
      [...el().querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === label,
      ),
    dateInput: () => el().querySelector<HTMLInputElement>('#doctor-detail-date')!,
    url: () => router.url,
  };
}

type Screen = Awaited<ReturnType<typeof open>>;

async function ready(screen: Screen, date = TODAY, list = DAY(date)) {
  await screen.loadDoctor();
  await screen.loadSlots(slots(date, list));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  TestBed.inject(HttpTestingController).verify();
  vi.useRealTimers();
});

describe('Doctor detail — positive scenarios', () => {
  it('shows the doctor profile', async () => {
    const screen = await open();
    await ready(screen);

    const profile = screen.text('doctor-profile');
    expect(profile).toContain('Dr. Meera Iyer');
    expect(profile).toContain('Cardiology');
    expect(profile).toContain('₹900');
    expect(profile).toContain('30 min per appointment');
    expect(profile).toContain('Heart specialist.');
  });

  it('loads today’s slots by default', async () => {
    const screen = await open();
    await screen.loadDoctor();

    expect(screen.slotsRequest().request.params.get('date')).toBe(TODAY);
    screen.http.match(() => true);
  });

  it('shows 7 quick day buttons starting with "Today" (selected)', async () => {
    const screen = await open();
    await ready(screen);

    const days = [...screen.el().querySelectorAll<HTMLButtonElement>('.day')];
    expect(days.map((d) => d.textContent?.trim())).toEqual([
      'Today',
      'Tue 8 Jan',
      'Wed 9 Jan',
      'Thu 10 Jan',
      'Fri 11 Jan',
      'Sat 12 Jan',
      'Sun 13 Jan',
    ]);
    expect(screen.dayButton(TODAY).getAttribute('aria-pressed')).toBe('true');
  });

  it('limits the date picker to today .. today + 30 days (FR-4.3)', async () => {
    const screen = await open();
    await ready(screen);

    expect(screen.dateInput().min).toBe('2030-01-07');
    expect(screen.dateInput().max).toBe('2030-02-06');
  });

  it('clicking a day puts it in the URL and loads its slots', async () => {
    const screen = await open();
    await ready(screen);

    screen.dayButton('2030-01-09').click();
    await screen.stable();

    expect(screen.url()).toBe('/doctors/5?date=2030-01-09');
    expect(screen.slotsRequest().request.params.get('date')).toBe('2030-01-09');
  });

  it('picking a date in the date input loads that day', async () => {
    const screen = await open();
    await ready(screen);

    screen.dateInput().value = '2030-02-01';
    screen.dateInput().dispatchEvent(new Event('change'));
    await screen.stable();

    expect(screen.slotsRequest().request.params.get('date')).toBe('2030-02-01');
  });

  it('opens the date from the URL (reload / Back)', async () => {
    const screen = await open('/doctors/5?date=2030-01-10');
    await ready(screen, '2030-01-10');

    expect(screen.dayButton('2030-01-10').getAttribute('aria-pressed')).toBe('true');
    expect(screen.text('slots-heading')).toBe('Slots on Thursday, 10 January 2030');
  });

  it('groups slots into Morning / Afternoon / Evening and counts free ones', async () => {
    const screen = await open();
    await ready(screen);

    const groups = [...screen.el().querySelectorAll('.slots h3')].map((h) => h.textContent?.trim());
    expect(groups).toEqual(['Morning', 'Afternoon', 'Evening']);
    expect(screen.text('slots-summary')).toBe('3 of 4 slots available');
  });

  it('choosing a free slot selects it and enables "Continue"', async () => {
    const screen = await open();
    await ready(screen);
    expect(screen.continueButton().disabled).toBe(true);

    screen.slotButton('12:00').click();
    await screen.stable();

    expect(screen.slotButton('12:00').getAttribute('aria-pressed')).toBe('true');
    expect(screen.text('selected-slot')).toBe('Selected: Monday, 7 January 2030, 12:00');
    expect(screen.continueButton().disabled).toBe(false);
  });

  it('choosing another slot moves the selection', async () => {
    const screen = await open();
    await ready(screen);

    screen.slotButton('10:00').click();
    screen.slotButton('17:30').click();
    await screen.stable();

    expect(screen.slotButton('10:00').getAttribute('aria-pressed')).toBe('false');
    expect(screen.slotButton('17:30').getAttribute('aria-pressed')).toBe('true');
  });

  it('"Continue to booking" goes to the booking page with the slot', async () => {
    const screen = await open();
    await ready(screen);
    const navigate = vi.spyOn(screen.router, 'navigate').mockResolvedValue(true);

    screen.slotButton('10:00').click();
    await screen.stable();
    screen.continueButton().click();

    expect(navigate).toHaveBeenCalledWith(['/doctors', 5, 'book'], {
      queryParams: { startAt: '2030-01-07T04:30:00.000Z' },
    });
  });

  it('a new date clears the selected slot', async () => {
    const screen = await open();
    await ready(screen);
    screen.slotButton('10:00').click();
    await screen.stable();

    screen.dayButton('2030-01-08').click();
    await screen.stable();
    await screen.loadSlots(slots('2030-01-08', DAY('2030-01-08')));

    expect(screen.el().querySelector('[data-testid="selected-slot"]')).toBeNull();
    expect(screen.continueButton().disabled).toBe(true);
  });

  it('has a link back to the doctor list', async () => {
    const screen = await open();
    await ready(screen);

    expect(screen.el().querySelector('a.back')?.getAttribute('href')).toBe('/doctors');
  });
});

describe('Doctor detail — negative scenarios (slots)', () => {
  it('a booked slot is disabled, says "Booked" and cannot be chosen', async () => {
    const screen = await open();
    await ready(screen);

    const booked = screen.slotButton('10:30');
    expect(booked.disabled).toBe(true);
    expect(booked.textContent).toContain('Booked');
    expect(booked.dataset['status']).toBe('BOOKED');

    booked.click();
    await screen.stable();
    expect(screen.continueButton().disabled).toBe(true);
  });

  it('all slots booked: says so and "Continue" stays disabled', async () => {
    const screen = await open();
    await ready(screen, TODAY, [slot(TODAY, '10:00', 'BOOKED'), slot(TODAY, '10:30', 'BOOKED')]);

    expect(screen.text('fully-booked')).toContain('All slots on this day are booked');
    expect(screen.slotButtons().every((b) => b.disabled)).toBe(true);
    expect(screen.continueButton().disabled).toBe(true);
  });

  it('doctor on leave: explains and shows no slots (FR-3.3)', async () => {
    const screen = await open();
    await screen.loadDoctor();
    await screen.loadSlots(slots(TODAY, [], true));

    expect(screen.text('on-leave')).toContain('Dr. Meera Iyer is on leave on this day');
    expect(screen.slotButtons()).toHaveLength(0);
  });

  it('no schedule that day: "No slots on this day"', async () => {
    const screen = await open();
    await ready(screen, TODAY, []);

    expect(screen.text('no-slots')).toContain('No slots on this day');
  });

  it.each([
    ['an invalid date', 'abc'],
    ['a past date', '2030-01-01'],
    ['more than 30 days ahead', '2030-02-07'],
    ['an impossible date', '2030-02-30'],
  ])('%s in the URL falls back to today', async (_label, date) => {
    const screen = await open(`/doctors/5?date=${date}`);
    await screen.loadDoctor();

    expect(screen.slotsRequest().request.params.get('date')).toBe(TODAY);
    screen.http.match(() => true);
  });

  it('a date beyond 30 days typed into the date input is ignored', async () => {
    const screen = await open();
    await ready(screen);
    const navigate = vi.spyOn(screen.router, 'navigate');

    screen.dateInput().value = '2030-03-01';
    screen.dateInput().dispatchEvent(new Event('change'));
    await screen.stable();

    expect(navigate).not.toHaveBeenCalled();
    screen.http.expectNone((r) => r.url === '/api/v1/doctors/5/slots');
  });

  it('slots server error: message and "Try again" recovers', async () => {
    const screen = await open();
    await screen.loadDoctor();
    screen.slotsRequest().flush('oops', { status: 500, statusText: 'Error' });
    await screen.stable();

    expect(screen.text('slots-error')).toContain('Something went wrong');

    screen.button('Try again')!.click();
    await screen.stable();
    await screen.loadSlots(slots(TODAY, DAY(TODAY)));
    expect(screen.slotButtons()).toHaveLength(4);
  });

  it('server down while loading slots: connection message', async () => {
    const screen = await open();
    await screen.loadDoctor();
    screen.slotsRequest().error(new ProgressEvent('error'));
    await screen.stable();

    expect(screen.text('slots-error')).toContain('Cannot reach the server');
  });

  it('switching days fast: the old slots request is cancelled', async () => {
    const screen = await open();
    await screen.loadDoctor();
    const first = screen.slotsRequest();

    screen.dayButton('2030-01-09').click();
    await screen.stable();

    expect(first.cancelled).toBe(true);
    await screen.loadSlots(slots('2030-01-09', DAY('2030-01-09')));
    expect(screen.text('slots-heading')).toContain('9 January');
  });
});

describe('Doctor detail — negative scenarios (doctor)', () => {
  it.each(['abc', '0', '-1', '1.5'])(
    'id %j: shows "Doctor not found" without calling the API',
    async (id) => {
      const screen = await open(`/doctors/${id}`);

      expect(screen.text('doctor-not-found')).toContain('Doctor not found');
      screen.http.expectNone(() => true);
    },
  );

  it('unknown or inactive doctor (404): "Doctor not found" with a way back', async () => {
    const screen = await open();
    screen.doctorRequest().flush(apiError('DOCTOR_NOT_FOUND', 'Doctor not found.'), {
      status: 404,
      statusText: 'Not Found',
    });
    screen.http.match((r) => r.url.includes('/slots'));
    await screen.stable();

    expect(screen.text('doctor-not-found')).toContain('not taking appointments');
    expect(
      screen.el().querySelector('[data-testid="doctor-not-found"] a')?.getAttribute('href'),
    ).toBe('/doctors');
  });

  it('server error loading the doctor: message and "Try again" recovers', async () => {
    const screen = await open();
    screen.doctorRequest().flush('oops', { status: 500, statusText: 'Error' });
    await screen.stable();

    expect(screen.text('doctor-error')).toContain('Something went wrong');

    screen.button('Try again')!.click();
    await screen.stable();
    await screen.loadDoctor();
    expect(screen.text('doctor-profile')).toContain('Dr. Meera Iyer');
    screen.http.match(() => true);
  });

  it('shows a loading message first', async () => {
    const screen = await open();

    expect(screen.text('doctor-loading')).toBe('Loading doctor…');
    screen.http.match(() => true);
  });
});
