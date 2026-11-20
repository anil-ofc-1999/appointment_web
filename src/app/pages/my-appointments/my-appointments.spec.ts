import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { appointment } from '../../../testing/appointments';
import { apiError } from '../../../testing/fake-jwt';
import { Appointment } from '../../core/appointments/appointment.models';
import { MyAppointments } from './my-appointments';

// "Now": Monday 2030-01-07 08:00 clinic time.
const NOW = new Date('2030-01-07T08:00:00+05:30');

const TUE_10 = appointment(1); // Tue 8 Jan 10:00 — can change
const SOON = appointment(2, {
  // today 09:30 — only 1.5 hours away: locked
  startAt: '2030-01-07T04:00:00.000Z',
  endAt: '2030-01-07T04:30:00.000Z',
  date: '2030-01-07',
  time: '09:30',
  doctor: { id: 6, name: 'Dr. Kiran Shah', specialization: 'Dermatology' },
});
const PAST = [
  appointment(10, { status: 'COMPLETED', date: '2030-01-03', time: '11:00' }),
  appointment(11, { status: 'NO_SHOW', date: '2030-01-02', time: '12:00' }),
  appointment(12, { status: 'CANCELLED', date: '2030-01-01', time: '16:00' }),
];

async function open(url = '/appointments') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        [
          { path: 'appointments', component: MyAppointments },
          { path: '**', children: [] },
        ],
        withComponentInputBinding(),
      ),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, MyAppointments);
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
    async respond(upcoming: Appointment[] = [TUE_10, SOON], past: Appointment[] = PAST) {
      http.expectOne('/api/v1/appointments/me').flush({ upcoming, past });
      await stable();
    },
    text: (testId: string) => el().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim(),
    cards: () => [...el().querySelectorAll<HTMLElement>('[data-testid="appointment"]')],
    card: (id: number) =>
      el().querySelector<HTMLElement>(`[data-testid="appointment"][data-id="${id}"]`)!,
    button,
    async click(label: string, scope?: ParentNode) {
      button(label, scope)!.click();
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

describe('My appointments — positive scenarios', () => {
  it('shows Upcoming by default with counts on both tabs', async () => {
    const screen = await open();
    await screen.respond();

    const tabs = [...screen.el().querySelectorAll('[role="tab"]')].map((t) =>
      t.textContent?.trim(),
    );
    expect(tabs).toEqual(['Upcoming (2)', 'Past (3)']);
    expect(screen.el().querySelector('#tab-upcoming')?.getAttribute('aria-selected')).toBe('true');
    expect(screen.cards()).toHaveLength(2);
  });

  it('each card shows doctor, specialization, date, time and status', async () => {
    const screen = await open();
    await screen.respond();

    const card = screen.card(1);
    expect(card.textContent).toContain('Dr. Meera Iyer');
    expect(card.textContent).toContain('Cardiology');
    expect(card.textContent).toContain('Tuesday, 8 January 2030 at 10:00');
    expect(card.querySelector('[data-testid="status"]')?.textContent?.trim()).toBe('Booked');
  });

  it('the Past tab (from the URL) lists final statuses with friendly labels', async () => {
    const screen = await open('/appointments?tab=past');
    await screen.respond();

    expect(
      screen.cards().map((c) => c.querySelector('[data-testid="status"]')?.textContent?.trim()),
    ).toEqual(['Completed', 'Missed', 'Cancelled']);
    expect(screen.el().querySelector('[data-testid="appointment"] .actions')).toBeNull();
  });

  it('clicking a tab puts it in the URL', async () => {
    const screen = await open();
    await screen.respond();

    await screen.click('Past (3)');

    expect(screen.router.url).toBe('/appointments?tab=past');
  });

  it('upcoming appointments more than 2 hours away have Reschedule and Cancel', async () => {
    const screen = await open();
    await screen.respond();

    const card = screen.card(1);
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/appointments/1/reschedule');
    expect(screen.button('Cancel', card)).toBeDefined();
  });

  it('Cancel asks first; "No, keep it" changes nothing', async () => {
    const screen = await open();
    await screen.respond();

    await screen.click('Cancel', screen.card(1));
    expect(screen.text('confirm-cancel')).toBe('Cancel this appointment?');

    await screen.click('No, keep it');
    expect(screen.el().querySelector('[data-testid="confirm-cancel"]')).toBeNull();
    screen.http.expectNone('/api/v1/appointments/1/cancel');
  });

  it('"Yes, cancel" cancels, shows a message and reloads the list', async () => {
    const screen = await open();
    await screen.respond();

    await screen.click('Cancel', screen.card(1));
    await screen.click('Yes, cancel');
    screen.http
      .expectOne('/api/v1/appointments/1/cancel')
      .flush({ appointment: appointment(1, { status: 'CANCELLED' }) });
    await screen.stable();
    await screen.respond([SOON], [appointment(1, { status: 'CANCELLED' }), ...PAST]);

    expect(screen.text('notice')).toBe(
      'Your appointment with Dr. Meera Iyer on Tuesday, 8 January 2030 at 10:00 was cancelled.',
    );
    expect(screen.cards()).toHaveLength(1);
  });

  it('shows "Cancelling…" and a double click sends one request', async () => {
    const screen = await open();
    await screen.respond();
    await screen.click('Cancel', screen.card(1));

    screen.button('Yes, cancel')!.click();
    screen.el().querySelector<HTMLButtonElement>('.btn-danger')!.click();
    await screen.stable();

    expect(screen.el().querySelector('.btn-danger')?.textContent?.trim()).toBe('Cancelling…');
    expect(screen.http.match('/api/v1/appointments/1/cancel')).toHaveLength(1);
  });

  it('after a reschedule: shows a success message', async () => {
    const screen = await open('/appointments?rescheduled=4');
    await screen.respond();

    expect(screen.text('notice')).toBe('Your appointment was rescheduled.');
  });
});

describe('My appointments — negative scenarios', () => {
  it('less than 2 hours before: no buttons, explains why (FR-5.1)', async () => {
    const screen = await open();
    await screen.respond();

    const card = screen.card(2);
    expect(card.querySelector('[data-testid="locked"]')?.textContent).toContain(
      'less than 2 hours before',
    );
    expect(screen.button('Cancel', card)).toBeUndefined();
    expect(card.querySelector('a')).toBeNull();
  });

  it('no upcoming appointments: says so and links to Find a doctor', async () => {
    const screen = await open();
    await screen.respond([], PAST);

    expect(screen.text('no-appointments')).toContain('You have no upcoming appointments.');
    expect(
      screen.el().querySelector('[data-testid="no-appointments"] a')?.getAttribute('href'),
    ).toBe('/doctors');
  });

  it('no past appointments: says so', async () => {
    const screen = await open('/appointments?tab=past');
    await screen.respond([TUE_10], []);

    expect(screen.text('no-appointments')).toBe('No past appointments yet.');
  });

  it('cancel refused by the server (time passed meanwhile): shows the reason on that card', async () => {
    const screen = await open();
    await screen.respond();

    await screen.click('Cancel', screen.card(1));
    await screen.click('Yes, cancel');
    screen.http
      .expectOne('/api/v1/appointments/1/cancel')
      .flush(apiError('CHANGE_WINDOW_PASSED', 'x'), { status: 400, statusText: 'Bad Request' });
    await screen.stable();

    expect(screen.card(1).querySelector('[data-testid="action-error"]')?.textContent).toContain(
      'up to 2 hours before',
    );
    expect(screen.el().querySelector('[data-testid="notice"]')).toBeNull();
  });

  it('cancel of an appointment that is no longer BOOKED (409): clear message', async () => {
    const screen = await open();
    await screen.respond();

    await screen.click('Cancel', screen.card(1));
    await screen.click('Yes, cancel');
    screen.http
      .expectOne('/api/v1/appointments/1/cancel')
      .flush(apiError('INVALID_STATUS_TRANSITION', 'x'), { status: 409, statusText: 'Conflict' });
    await screen.stable();

    expect(screen.text('action-error')).toContain('can no longer be changed');
  });

  it('server down while cancelling: connection message, list unchanged', async () => {
    const screen = await open();
    await screen.respond();

    await screen.click('Cancel', screen.card(1));
    await screen.click('Yes, cancel');
    screen.http.expectOne('/api/v1/appointments/1/cancel').error(new ProgressEvent('error'));
    await screen.stable();

    expect(screen.text('action-error')).toContain('Cannot reach the server');
    expect(screen.cards()).toHaveLength(2);
  });

  it('list fails to load: error and "Try again" recovers', async () => {
    const screen = await open();
    screen.http
      .expectOne('/api/v1/appointments/me')
      .flush('x', { status: 500, statusText: 'Error' });
    await screen.stable();
    expect(screen.text('appointments-error')).toContain('Something went wrong');

    await screen.click('Try again');
    await screen.respond();
    expect(screen.cards()).toHaveLength(2);
  });

  it('shows a loading message first', async () => {
    const screen = await open();

    expect(screen.text('appointments-loading')).toBe('Loading your appointments…');
    await screen.respond();
  });

  it('an unknown ?tab value shows Upcoming', async () => {
    const screen = await open('/appointments?tab=weird');
    await screen.respond();

    expect(screen.el().querySelector('#tab-upcoming')?.getAttribute('aria-selected')).toBe('true');
  });
});
