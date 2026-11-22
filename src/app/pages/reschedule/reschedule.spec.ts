import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { appointment } from '../../../testing/appointments';
import { apiError } from '../../../testing/fake-jwt';
import { Appointment } from '../../core/appointments/appointment.models';
import { Slot, SlotsResponse } from '../../core/doctors/doctor.models';
import { Reschedule } from './reschedule';

// "Now": Monday 2030-01-07 08:00 clinic time.
const NOW = new Date('2030-01-07T08:00:00+05:30');
const MINE = appointment(1); // Tue 8 Jan 10:00 with doctor 5

function slot(date: string, time: string, status: Slot['status'] = 'AVAILABLE'): Slot {
  const start = new Date(`${date}T${time}:00+05:30`);
  return {
    time,
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
    status,
  };
}

const TUE_SLOTS: SlotsResponse = {
  doctorId: 5,
  date: '2030-01-08',
  slotMinutes: 30,
  onLeave: false,
  // the patient's own 10:00 slot shows as BOOKED in the API
  slots: [
    slot('2030-01-08', '10:00', 'BOOKED'),
    slot('2030-01-08', '10:30'),
    slot('2030-01-08', '11:00', 'BOOKED'),
  ],
};

async function open(url = '/appointments/1/reschedule') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        [
          { path: 'appointments/:id/reschedule', component: Reschedule },
          { path: '**', children: [] },
        ],
        withComponentInputBinding(),
      ),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, Reschedule);
  const http = TestBed.inject(HttpTestingController);
  const el = () => harness.routeNativeElement as HTMLElement;
  const stable = () => harness.fixture.whenStable();

  return {
    http,
    el,
    stable,
    router: TestBed.inject(Router),
    async loadMine(upcoming: Appointment[] = [MINE], past: Appointment[] = []) {
      http.expectOne('/api/v1/appointments/me').flush({ upcoming, past });
      await stable();
    },
    slotsRequest: () => http.expectOne((r) => r.url === '/api/v1/doctors/5/slots'),
    async loadSlots(body: SlotsResponse = TUE_SLOTS) {
      http.expectOne((r) => r.url === '/api/v1/doctors/5/slots').flush(body);
      await stable();
    },
    text: (testId: string) => el().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim(),
    slotButton: (time: string) =>
      [...el().querySelectorAll<HTMLButtonElement>('[data-testid="slot"]')].find((b) =>
        b.textContent?.trim().startsWith(time),
      )!,
    saveButton: () =>
      [...el().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        /Confirm new time|Saving…/.test(b.textContent ?? ''),
      )!,
  };
}

type Screen = Awaited<ReturnType<typeof open>>;

async function ready(screen: Screen) {
  await screen.loadMine();
  await screen.loadSlots();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  TestBed.inject(HttpTestingController).verify();
  vi.useRealTimers();
});

describe('Reschedule — positive scenarios', () => {
  it('shows the current appointment and opens on its date', async () => {
    const screen = await open();
    await screen.loadMine();

    expect(screen.text('current-appointment')).toContain(
      'Dr. Meera Iyer on Tuesday, 8 January 2030 at 10:00',
    );
    expect(screen.slotsRequest().request.params.get('date')).toBe('2030-01-08');
    screen.http.match(() => true);
  });

  it('marks my current slot as "Your time" and disabled', async () => {
    const screen = await open();
    await ready(screen);

    const mine = screen.slotButton('10:00');
    expect(mine.disabled).toBe(true);
    expect(mine.textContent).toContain('Your time');
    expect(screen.slotButton('11:00').textContent).toContain('Booked');
  });

  it('choosing a free slot shows the new time and enables "Confirm new time"', async () => {
    const screen = await open();
    await ready(screen);
    expect(screen.saveButton().disabled).toBe(true);

    screen.slotButton('10:30').click();
    await screen.stable();

    expect(screen.text('new-time')).toBe('New time: Tuesday, 8 January 2030 at 10:30');
    expect(screen.saveButton().disabled).toBe(false);
  });

  it('confirming reschedules and goes back to My appointments with a message', async () => {
    const screen = await open();
    await ready(screen);
    const navigate = vi.spyOn(screen.router, 'navigate').mockResolvedValue(true);

    screen.slotButton('10:30').click();
    await screen.stable();
    screen.saveButton().click();
    await screen.stable();

    const req = screen.http.expectOne('/api/v1/appointments/1/reschedule');
    expect(req.request.body).toEqual({ startAt: '2030-01-08T05:00:00.000Z' });
    req.flush({ appointment: appointment(9), previousAppointmentId: 1 });
    await screen.stable();

    expect(navigate).toHaveBeenCalledWith(['/appointments'], { queryParams: { rescheduled: 9 } });
  });

  it('another date loads that day', async () => {
    const screen = await open();
    await ready(screen);

    screen.el().querySelector<HTMLButtonElement>('.day[data-date="2030-01-10"]')!.click();
    await screen.stable();

    expect(screen.slotsRequest().request.params.get('date')).toBe('2030-01-10');
  });

  it('says the current booking is kept until the new time is confirmed', async () => {
    const screen = await open();
    await ready(screen);

    expect(screen.el().textContent).toContain('Your current booking stays until');
  });
});

describe('Reschedule — negative scenarios', () => {
  it.each([
    ['SLOT_ALREADY_BOOKED', 409, 'someone has just booked this slot'],
    ['DAILY_LIMIT_REACHED', 409, 'Only one per day'],
    ['OUTSIDE_SCHEDULE', 400, 'does not work at this time'],
  ])('%s: message, selection cleared, slots refreshed', async (code, status, text) => {
    const screen = await open();
    await ready(screen);
    screen.slotButton('10:30').click();
    await screen.stable();
    screen.saveButton().click();
    await screen.stable();

    screen.http
      .expectOne('/api/v1/appointments/1/reschedule')
      .flush(apiError(code, 'x'), { status, statusText: 'Error' });
    await screen.stable();

    expect(screen.text('reschedule-error')).toContain(text);
    expect(screen.saveButton().disabled).toBe(true);
    await screen.loadSlots(); // refreshed grid
  });

  it('CHANGE_WINDOW_PASSED (time ran out meanwhile): explains', async () => {
    const screen = await open();
    await ready(screen);
    screen.slotButton('10:30').click();
    await screen.stable();
    screen.saveButton().click();
    await screen.stable();

    screen.http
      .expectOne('/api/v1/appointments/1/reschedule')
      .flush(apiError('CHANGE_WINDOW_PASSED', 'x'), { status: 400, statusText: 'Error' });
    await screen.stable();

    expect(screen.text('reschedule-error')).toContain('up to 2 hours before');
  });

  it('server down while saving: message, can try again', async () => {
    const screen = await open();
    await ready(screen);
    screen.slotButton('10:30').click();
    await screen.stable();
    screen.saveButton().click();
    await screen.stable();

    screen.http.expectOne('/api/v1/appointments/1/reschedule').error(new ProgressEvent('error'));
    await screen.stable();

    expect(screen.text('reschedule-error')).toContain('Cannot reach the server');
    expect(screen.saveButton().disabled).toBe(false);
  });

  it('an appointment that is not mine / does not exist: "Appointment not found"', async () => {
    const screen = await open('/appointments/77/reschedule');
    await screen.loadMine();

    expect(screen.text('reschedule-not-found')).toContain('Appointment not found');
  });

  it.each(['abc', '0'])('id %j: "Appointment not found" without calling the API', async (id) => {
    const screen = await open(`/appointments/${id}/reschedule`);

    expect(screen.text('reschedule-not-found')).toBeDefined();
    screen.http.expectNone(() => true);
  });

  it('less than 2 hours before: "can no longer be changed", no slot grid', async () => {
    const screen = await open();
    await screen.loadMine([
      appointment(1, { startAt: '2030-01-07T04:00:00.000Z', date: '2030-01-07', time: '09:30' }),
    ]);

    expect(screen.text('reschedule-locked')).toContain('can no longer be changed');
    screen.http.expectNone((r) => r.url.includes('/slots'));
  });

  it('a cancelled appointment (in Past) cannot be rescheduled', async () => {
    const screen = await open();
    await screen.loadMine([], [appointment(1, { status: 'CANCELLED' })]);

    expect(screen.text('reschedule-locked')).toBeDefined();
  });

  it('doctor on leave on the chosen day: explains', async () => {
    const screen = await open();
    await screen.loadMine();
    await screen.loadSlots({ ...TUE_SLOTS, onLeave: true, slots: [] });

    expect(screen.text('on-leave')).toContain('on leave');
  });

  it('slots fail to load: message and "Try again"', async () => {
    const screen = await open();
    await screen.loadMine();
    screen.slotsRequest().flush('x', { status: 500, statusText: 'Error' });
    await screen.stable();

    expect(screen.text('reschedule-slots-error')).toContain('Something went wrong');
    [...screen.el().querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Try again')!
      .click();
    await screen.stable();
    await screen.loadSlots();
    expect(screen.slotButton('10:30')).toBeDefined();
  });

  it('the list fails to load: error message', async () => {
    const screen = await open();
    screen.http.expectOne('/api/v1/appointments/me').flush('x', { status: 500, statusText: 'E' });
    await screen.stable();

    expect(screen.text('reschedule-load-error')).toContain('Something went wrong');
  });
});
