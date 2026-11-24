import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { appointment } from '../../../testing/appointments';
import { apiError } from '../../../testing/fake-jwt';
import { Appointment } from '../../core/appointments/appointment.models';
import { ScheduleBlock } from '../../core/doctors/doctor-self.service';
import { DoctorDashboard } from './doctor-dashboard';

// "Now": Tuesday 2030-01-08 10:15 clinic time.
const NOW = new Date('2030-01-08T10:15:00+05:30');
const TODAY = '2030-01-08';

const at = (time: string, overrides: Partial<Appointment> = {}) => {
  const start = new Date(`${TODAY}T${time}:00+05:30`);
  return appointment(Number(time.replace(':', '')), {
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
    date: TODAY,
    time,
    ...overrides,
  });
};

const STARTED = at('10:00', { patient: { id: 1, name: 'Asha Reddy' } });
const LATER = at('11:30', { patient: { id: 2, name: 'Ravi Kumar' } });
const CANCELLED = at('09:00', { status: 'CANCELLED', patient: { id: 3, name: 'Sneha Patil' } });

const SCHEDULE: ScheduleBlock[] = [
  { id: 1, dayOfWeek: 1, startTime: '10:00', endTime: '13:00' },
  { id: 2, dayOfWeek: 1, startTime: '16:00', endTime: '19:00' },
  { id: 3, dayOfWeek: 3, startTime: '09:00', endTime: '12:00' },
];

async function open(url = '/dashboard') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        [{ path: 'dashboard', component: DoctorDashboard }],
        withComponentInputBinding(),
      ),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, DoctorDashboard);
  const http = TestBed.inject(HttpTestingController);
  const el = () => harness.routeNativeElement as HTMLElement;
  const stable = () => harness.fixture.whenStable();
  const button = (label: string, scope: ParentNode = el()) =>
    [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label,
    );

  return {
    http,
    el,
    stable,
    router: TestBed.inject(Router),
    button,
    async click(label: string, scope?: ParentNode) {
      button(label, scope)!.click();
      await stable();
    },
    dayRequest: () => http.expectOne((r) => r.url === '/api/v1/appointments/me'),
    async respondAll(
      items: Appointment[] = [CANCELLED, STARTED, LATER],
      blocks = SCHEDULE,
      leaves: string[] = ['2030-01-20'],
    ) {
      http.expectOne((r) => r.url === '/api/v1/appointments/me').flush({ date: TODAY, items });
      // The schedule editor only loads when the "Weekly schedule" tab is open.
      http.match('/api/v1/doctors/me/schedule').forEach((r) => r.flush({ blocks }));
      http
        .expectOne('/api/v1/doctors/me/leaves')
        .flush({ items: leaves.map((date) => ({ date })) });
      await stable();
    },
    text: (testId: string) => el().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim(),
    row: (id: number) =>
      el().querySelector<HTMLElement>(`[data-testid="day-row"][data-id="${id}"]`)!,
    async set(selector: string, value: string, event = 'change') {
      const input = el().querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event(event));
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
});

describe('Dashboard — appointments of a day (FR-6.2)', () => {
  it('loads today by default and lists time, patient and status', async () => {
    const screen = await open();
    expect(screen.dayRequest().request.params.get('date')).toBe(TODAY);
    screen.http.match(() => true);
  });

  it('shows the rows with friendly statuses and a summary', async () => {
    const screen = await open();
    await screen.respondAll();

    const rows = [...screen.el().querySelectorAll('[data-testid="day-row"]')].map((r) =>
      [...r.querySelectorAll('td')].slice(0, 3).map((td) => td.textContent?.trim()),
    );
    expect(rows).toEqual([
      ['09:00', 'Sneha Patil', 'Cancelled'],
      ['10:00', 'Asha Reddy', 'Booked'],
      ['11:30', 'Ravi Kumar', 'Booked'],
    ]);
    expect(screen.text('day-summary')).toBe('3 appointment(s), 2 still booked');
    expect(screen.text('day-heading')).toBe('Tuesday, 8 January 2030');
  });

  it('Previous / Next day change the date in the URL and reload', async () => {
    const screen = await open();
    await screen.respondAll();

    await screen.click('Next day →');
    expect(screen.router.url).toBe('/dashboard?date=2030-01-09');
    expect(screen.dayRequest().request.params.get('date')).toBe('2030-01-09');

    await screen.click('← Previous day');
    screen.http.match(() => true);
    expect(screen.router.url).toBe('/dashboard');
  });

  it('a past date can be opened (history)', async () => {
    const screen = await open('/dashboard?date=2029-12-31');

    expect(screen.dayRequest().request.params.get('date')).toBe('2029-12-31');
    screen.http.match(() => true);
  });

  it('an invalid date in the URL falls back to today', async () => {
    const screen = await open('/dashboard?date=nonsense');

    expect(screen.dayRequest().request.params.get('date')).toBe(TODAY);
    screen.http.match(() => true);
  });

  it('started BOOKED appointments get "Completed" and "No-show" (FR-5.4)', async () => {
    const screen = await open();
    await screen.respondAll();

    expect(screen.button('Completed', screen.row(STARTED.id))).toBeDefined();
    expect(screen.button('No-show', screen.row(STARTED.id))).toBeDefined();
  });

  it('not started yet: no buttons, says from when', async () => {
    const screen = await open();
    await screen.respondAll();

    expect(screen.button('Completed', screen.row(LATER.id))).toBeUndefined();
    expect(screen.row(LATER.id).textContent).toContain('After 11:30');
  });

  it('final statuses have no buttons (FR-5.6)', async () => {
    const screen = await open();
    await screen.respondAll();

    expect(screen.row(CANCELLED.id).querySelector('button')).toBeNull();
  });

  it('"Completed" updates the row', async () => {
    const screen = await open();
    await screen.respondAll();

    await screen.click('Completed', screen.row(STARTED.id));
    const req = screen.http.expectOne(`/api/v1/appointments/${STARTED.id}/complete`);
    expect(req.request.method).toBe('POST');
    req.flush({ appointment: { ...STARTED, status: 'COMPLETED' } });
    await screen.stable();

    expect(
      screen.row(STARTED.id).querySelector('[data-testid="row-status"]')?.textContent?.trim(),
    ).toBe('Completed');
    expect(screen.button('Completed', screen.row(STARTED.id))).toBeUndefined();
  });

  it('"No-show" calls the no-show endpoint', async () => {
    const screen = await open();
    await screen.respondAll();

    await screen.click('No-show', screen.row(STARTED.id));
    screen.http
      .expectOne(`/api/v1/appointments/${STARTED.id}/no-show`)
      .flush({ appointment: { ...STARTED, status: 'NO_SHOW' } });
    await screen.stable();

    expect(screen.row(STARTED.id).textContent).toContain('No-show');
  });

  it('a refused change shows the reason on that row', async () => {
    const screen = await open();
    await screen.respondAll();

    await screen.click('Completed', screen.row(STARTED.id));
    screen.http
      .expectOne(`/api/v1/appointments/${STARTED.id}/complete`)
      .flush(apiError('INVALID_STATUS_TRANSITION', 'x'), { status: 409, statusText: 'Conflict' });
    await screen.stable();

    expect(
      screen.row(STARTED.id).querySelector('[data-testid="row-error"]')?.textContent,
    ).toContain('can no longer be changed');
  });

  it('an empty day says so', async () => {
    const screen = await open();
    await screen.respondAll([]);

    expect(screen.text('no-day-appointments')).toBe('No appointments on this day.');
  });

  it('the day fails to load: error and "Try again"', async () => {
    const screen = await open();
    screen.dayRequest().flush('x', { status: 500, statusText: 'Error' });
    screen.http.match(() => true);
    await screen.stable();

    expect(screen.text('day-error')).toContain('Something went wrong');
    await screen.click('Try again');
    screen.dayRequest().flush({ date: TODAY, items: [] });
    await screen.stable();
    expect(screen.text('no-day-appointments')).toBeDefined();
  });
});

describe('Dashboard — weekly schedule (FR-3.1, FR-3.2)', () => {
  async function scheduleTab() {
    const screen = await open('/dashboard?tab=schedule');
    await screen.respondAll();
    return screen;
  }

  const day = (screen: Awaited<ReturnType<typeof open>>, dayOfWeek: number) =>
    screen
      .el()
      .querySelector<HTMLElement>(`[data-testid="schedule-day"][data-day="${dayOfWeek}"]`)!;

  it('shows every weekday with its blocks or "Not working"', async () => {
    const screen = await scheduleTab();

    expect(day(screen, 1).textContent).toContain('10:00–13:00');
    expect(day(screen, 1).textContent).toContain('16:00–19:00');
    expect(day(screen, 0).textContent).toContain('Not working');
    expect(screen.el().querySelectorAll('[data-testid="schedule-day"]')).toHaveLength(7);
  });

  it('"Save schedule" is disabled until something changes', async () => {
    const screen = await scheduleTab();

    expect(screen.button('Save schedule')!.disabled).toBe(true);
  });

  it('adds a block, then saves the whole week without ids', async () => {
    const screen = await scheduleTab();

    await screen.set('#block-day', '5');
    await screen.set('#block-start', '14:00');
    await screen.set('#block-end', '17:00');
    await screen.click('Add');
    expect(day(screen, 5).textContent).toContain('14:00–17:00');
    expect(screen.text('unsaved')).toBe('You have unsaved changes.');

    await screen.click('Save schedule');
    const req = screen.http.expectOne('/api/v1/doctors/me/schedule');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.blocks).toContainEqual({
      dayOfWeek: 5,
      startTime: '14:00',
      endTime: '17:00',
    });
    expect(req.request.body.blocks.every((b: object) => !('id' in b))).toBe(true);
    req.flush({
      blocks: [...SCHEDULE, { id: 9, dayOfWeek: 5, startTime: '14:00', endTime: '17:00' }],
    });
    await screen.stable();

    expect(screen.text('schedule-message')).toBe('Schedule saved. Existing bookings are kept.');
    expect(screen.el().querySelector('[data-testid="unsaved"]')).toBeNull();
  });

  it('removing both Monday blocks, adding one and saving sends exactly that', async () => {
    const screen = await scheduleTab();

    for (const label of ['Remove Monday 10:00 to 13:00', 'Remove Monday 16:00 to 19:00']) {
      screen.el().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();
      await screen.stable();
    }
    await screen.set('#block-day', '1');
    await screen.set('#block-start', '08:00');
    await screen.set('#block-end', '09:00');
    await screen.click('Add');
    await screen.click('Save schedule');

    const req = screen.http.expectOne('/api/v1/doctors/me/schedule');
    expect(req.request.body.blocks).toEqual([
      { dayOfWeek: 3, startTime: '09:00', endTime: '12:00' },
      { dayOfWeek: 1, startTime: '08:00', endTime: '09:00' },
    ]);
    req.flush({ blocks: [] });
  });

  it('removes a block', async () => {
    const screen = await scheduleTab();

    screen
      .el()
      .querySelector<HTMLButtonElement>('[aria-label="Remove Wednesday 09:00 to 12:00"]')!
      .click();
    await screen.stable();

    expect(day(screen, 3).textContent).toContain('Not working');
    expect(screen.button('Save schedule')!.disabled).toBe(false);
  });

  it.each([
    ['end before start', '13:00', '10:00', 'End time must be after start time.'],
    ['end equal to start', '10:00', '10:00', 'End time must be after start time.'],
    ['overlapping Monday 10–13', '12:00', '14:00', 'overlaps another block on Monday'],
  ])('refuses a block with %s', async (_label, start, end, message) => {
    const screen = await scheduleTab();

    await screen.set('#block-day', '1');
    await screen.set('#block-start', start);
    await screen.set('#block-end', end);
    await screen.click('Add');

    expect(screen.text('block-error')).toContain(message);
    expect(screen.button('Save schedule')!.disabled).toBe(true);
  });

  it('a block touching another one (13:00–16:00) is allowed', async () => {
    const screen = await scheduleTab();

    await screen.set('#block-day', '1');
    await screen.set('#block-start', '13:00');
    await screen.set('#block-end', '16:00');
    await screen.click('Add');

    expect(screen.el().querySelector('[data-testid="block-error"]')).toBeNull();
  });

  it('server says SCHEDULE_OVERLAP: clear message, changes kept', async () => {
    const screen = await scheduleTab();
    await screen.set('#block-day', '6');
    await screen.click('Add');

    await screen.click('Save schedule');
    screen.http
      .expectOne('/api/v1/doctors/me/schedule')
      .flush(apiError('SCHEDULE_OVERLAP', 'x'), { status: 400, statusText: 'Bad Request' });
    await screen.stable();

    expect(screen.text('schedule-message')).toContain('overlap');
    expect(screen.text('unsaved')).toBeDefined();
  });

  it('"Discard" reloads the saved schedule', async () => {
    const screen = await scheduleTab();
    await screen.set('#block-day', '6');
    await screen.click('Add');

    await screen.click('Discard');
    screen.http.expectOne('/api/v1/doctors/me/schedule').flush({ blocks: SCHEDULE });
    await screen.stable();

    expect(day(screen, 6).textContent).toContain('Not working');
  });

  it('schedule fails to load: error and "Try again"', async () => {
    const screen = await open('/dashboard?tab=schedule');
    screen.dayRequest().flush({ date: TODAY, items: [] });
    screen.http
      .expectOne('/api/v1/doctors/me/schedule')
      .flush('x', { status: 500, statusText: 'E' });
    screen.http.expectOne('/api/v1/doctors/me/leaves').flush({ items: [] });
    await screen.stable();

    expect(screen.text('schedule-load-error')).toContain('Could not load your schedule');
  });
});

describe('Dashboard — leave days (FR-3.3)', () => {
  async function leavesTab(leaves = ['2030-01-20']) {
    const screen = await open('/dashboard?tab=leaves');
    await screen.respondAll(undefined, undefined, leaves);
    return screen;
  }

  it('lists upcoming leave days', async () => {
    const screen = await leavesTab(['2030-01-10', '2030-01-20']);

    expect(
      [...screen.el().querySelectorAll('[data-testid="leave"]')].map((l) =>
        l.getAttribute('data-date'),
      ),
    ).toEqual(['2030-01-10', '2030-01-20']);
  });

  it('no leave days: says so', async () => {
    const screen = await leavesTab([]);

    expect(screen.text('no-leaves')).toBe('No upcoming leave days.');
  });

  it('the date picker starts at today', async () => {
    const screen = await leavesTab();

    expect(screen.el().querySelector<HTMLInputElement>('#leave-date')!.min).toBe(TODAY);
  });

  it('adds a leave day and reloads the list', async () => {
    const screen = await leavesTab();
    await screen.set('#leave-date', '2030-01-15', 'input');

    await screen.click('Add leave day');
    const req = screen.http.expectOne('/api/v1/doctors/me/leaves');
    expect(req.request.body).toEqual({ date: '2030-01-15' });
    req.flush(
      { leave: { date: '2030-01-15' }, existingBookings: 0 },
      { status: 201, statusText: 'Created' },
    );
    await screen.stable();
    screen.http.expectOne('/api/v1/doctors/me/leaves').flush({ items: [{ date: '2030-01-15' }] });
    await screen.stable();

    expect(screen.text('leave-message')).toBe('Tuesday, 15 January 2030 is now a leave day.');
  });

  it('warns when bookings already exist on that day', async () => {
    const screen = await leavesTab();
    await screen.set('#leave-date', '2030-01-15', 'input');

    await screen.click('Add leave day');
    screen.http
      .expectOne('/api/v1/doctors/me/leaves')
      .flush({ leave: { date: '2030-01-15' }, existingBookings: 2 });
    await screen.stable();
    screen.http.expectOne('/api/v1/doctors/me/leaves').flush({ items: [] });
    await screen.stable();

    expect(screen.text('leave-message')).toContain('2 existing booking(s) on that day are kept');
  });

  it('no date chosen: asks for one, no request', async () => {
    const screen = await leavesTab();

    await screen.click('Add leave day');

    expect(screen.text('leave-message')).toBe('Choose a date.');
    screen.http.expectNone('/api/v1/doctors/me/leaves');
  });

  it('a past date is refused before calling the API', async () => {
    const screen = await leavesTab();
    await screen.set('#leave-date', '2030-01-01', 'input');

    await screen.click('Add leave day');

    expect(screen.text('leave-message')).toBe('Leave cannot be in the past.');
    screen.http.expectNone('/api/v1/doctors/me/leaves');
  });

  it('LEAVE_EXISTS: "already a leave day"', async () => {
    const screen = await leavesTab();
    await screen.set('#leave-date', '2030-01-20', 'input');

    await screen.click('Add leave day');
    screen.http
      .expectOne('/api/v1/doctors/me/leaves')
      .flush(apiError('LEAVE_EXISTS', 'x'), { status: 409, statusText: 'Conflict' });
    await screen.stable();

    expect(screen.text('leave-message')).toBe('This date is already a leave day.');
  });

  it('removing a leave day makes it a working day again', async () => {
    const screen = await leavesTab();

    await screen.click('Remove');
    const req = screen.http.expectOne('/api/v1/doctors/me/leaves/2030-01-20');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await screen.stable();
    screen.http.expectOne('/api/v1/doctors/me/leaves').flush({ items: [] });
    await screen.stable();

    expect(screen.text('leave-message')).toBe('Sunday, 20 January 2030 is a working day again.');
  });

  it('leaves fail to load: error and "Try again"', async () => {
    const screen = await open('/dashboard?tab=leaves');
    screen.dayRequest().flush({ date: TODAY, items: [] });
    screen.http.expectNone('/api/v1/doctors/me/schedule'); // not on the schedule tab
    screen.http.expectOne('/api/v1/doctors/me/leaves').flush('x', { status: 500, statusText: 'E' });
    await screen.stable();

    expect(screen.text('leaves-load-error')).toContain('Could not load your leave days');
  });
});

describe('Dashboard — tabs', () => {
  it('switching tabs puts the tab in the URL', async () => {
    const screen = await open();
    await screen.respondAll();

    await screen.click('Leave days');
    expect(screen.router.url).toBe('/dashboard?tab=leaves');

    await screen.click('Appointments');
    expect(screen.router.url).toBe('/dashboard');
  });
});
