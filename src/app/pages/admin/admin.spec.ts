import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { appointment } from '../../../testing/appointments';
import { doctor } from '../../../testing/doctors';
import { apiError } from '../../../testing/fake-jwt';
import { AdminDoctor } from '../../core/admin/admin.service';
import { Appointment } from '../../core/appointments/appointment.models';
import { AdminAppointments } from './admin-appointments';
import { AdminDoctors } from './admin-doctors';
import { AdminPanel } from './admin-panel';
import { AdminSpecializations } from './admin-specializations';

const page = <T>(items: T[], { p = 1, size = 20, total = items.length } = {}) => ({
  items,
  page: p,
  pageSize: size,
  total,
  totalPages: Math.ceil(total / size),
});

const SPECS = [
  { id: 1, name: 'Cardiology', isActive: true },
  { id: 2, name: 'Dermatology', isActive: true },
  { id: 3, name: 'Old Spec', isActive: false },
];

const adminDoctor = (
  id: number,
  name: string,
  overrides: Partial<AdminDoctor> = {},
): AdminDoctor => ({
  ...doctor(id, name),
  email: `${name.split(' ')[1].toLowerCase()}@example.com`,
  userId: 100 + id,
  accountActive: true,
  ...overrides,
});

const MEERA = adminDoctor(5, 'Dr. Meera', { fee: 900 });
const RETIRED = adminDoctor(6, 'Dr. Retired', { isActive: false });

const ROWS: Appointment[] = [
  appointment(1),
  appointment(2, { status: 'COMPLETED', patient: { id: 8, name: 'Ravi' } }),
];

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  return TestBed.inject(HttpTestingController);
}

async function mount<T>(component: Type<T>) {
  const http = setup();
  const fixture: ComponentFixture<T> = TestBed.createComponent(component);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const stable = () => fixture.whenStable();
  const button = (label: string, scope: ParentNode = el) =>
    [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label,
    );
  return {
    http,
    el,
    stable,
    button,
    async click(label: string, scope?: ParentNode) {
      button(label, scope)!.click();
      await stable();
    },
    text: (testId: string) => el.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim(),
    async set(selector: string, value: string, event = 'input') {
      const input = el.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event(event));
      input.dispatchEvent(new Event('blur'));
      await stable();
    },
  };
}

afterEach(() => TestBed.inject(HttpTestingController).verify());

// ---------------------------------------------------------------------------

describe('Admin — appointments (FR-6.3, FR-5.5)', () => {
  async function open(rows = ROWS, total = rows.length) {
    const s = await mount(AdminAppointments);
    s.http.expectOne((r) => r.url === '/api/v1/doctors').flush(page([MEERA, RETIRED]));
    s.http.expectOne((r) => r.url === '/api/v1/appointments').flush(page(rows, { total }));
    await s.stable();
    return s;
  }

  it('lists all appointments with doctor, patient and status', async () => {
    const s = await open();

    const rows = [...s.el.querySelectorAll('[data-testid="admin-appointment"]')];
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toContain('Ravi');
    expect(rows[1].querySelector('[data-testid="status"]')?.textContent?.trim()).toBe('Completed');
    expect(s.text('admin-appointments-count')).toBe('2 appointment(s)');
  });

  it('the doctor filter lists inactive doctors too (marked)', async () => {
    const s = await open();

    const options = [...s.el.querySelectorAll('#filter-doctor option')].map((o) =>
      o.textContent?.trim(),
    );
    expect(options).toEqual(['All doctors', 'Dr. Meera', 'Dr. Retired (inactive)']);
  });

  it('each filter reloads from page 1 with that filter', async () => {
    const s = await open();

    await s.set('#filter-doctor', '5', 'change');
    let req = s.http.expectOne((r) => r.url === '/api/v1/appointments');
    expect(req.request.params.get('doctorId')).toBe('5');
    req.flush(page([]));
    await s.stable();

    await s.set('#filter-status', 'CANCELLED', 'change');
    req = s.http.expectOne((r) => r.url === '/api/v1/appointments');
    expect(req.request.params.get('status')).toBe('CANCELLED');
    expect(req.request.params.get('doctorId')).toBe('5');
    req.flush(page([]));
    await s.stable();
    expect(s.text('no-admin-appointments')).toBe('No appointments match these filters.');
  });

  it('a date range "from" after "to" is refused before calling the API', async () => {
    const s = await open();

    await s.set('#filter-from', '2030-01-10', 'change');
    s.http.expectOne((r) => r.url === '/api/v1/appointments').flush(page([]));
    await s.stable();
    await s.set('#filter-to', '2030-01-05', 'change');

    expect(s.text('filter-error')).toBe('"From" must be on or before "To".');
    s.http.expectNone((r) => r.url === '/api/v1/appointments');
  });

  it('"Clear filters" resets everything', async () => {
    const s = await open();
    await s.set('#filter-status', 'BOOKED', 'change');
    s.http.expectOne((r) => r.url === '/api/v1/appointments').flush(page(ROWS));
    await s.stable();

    await s.click('Clear filters');

    const req = s.http.expectOne((r) => r.url === '/api/v1/appointments');
    expect(req.request.params.keys().sort()).toEqual(['page', 'pageSize']);
    req.flush(page(ROWS));
  });

  it('pages with Next', async () => {
    const s = await open(ROWS, 45);

    expect(s.text('admin-page-info')).toBe('Page 1 of 3');
    await s.click('Next');
    const req = s.http.expectOne((r) => r.url === '/api/v1/appointments');
    expect(req.request.params.get('page')).toBe('2');
    req.flush(page(ROWS, { p: 2, total: 45 }));
  });

  it('only BOOKED rows can be cancelled; asks first; cancel reloads with a notice', async () => {
    const s = await open();
    const [booked, completed] = [
      ...s.el.querySelectorAll<HTMLElement>('[data-testid="admin-appointment"]'),
    ];
    expect(s.button('Cancel', completed)).toBeUndefined();

    await s.click('Cancel', booked);
    await s.click('Yes, cancel');
    s.http
      .expectOne('/api/v1/appointments/1/cancel')
      .flush({ appointment: { ...ROWS[0], status: 'CANCELLED' } });
    await s.stable();
    s.http.expectOne((r) => r.url === '/api/v1/appointments').flush(page(ROWS));
    await s.stable();

    expect(s.text('admin-notice')).toContain('Appointment #1');
  });

  it('"No" keeps the appointment', async () => {
    const s = await open();
    await s.click('Cancel');
    await s.click('No');

    s.http.expectNone('/api/v1/appointments/1/cancel');
    expect(s.button('Cancel')).toBeDefined();
  });

  it('a refused cancel shows the reason on that row', async () => {
    const s = await open();
    await s.click('Cancel');
    await s.click('Yes, cancel');
    s.http
      .expectOne('/api/v1/appointments/1/cancel')
      .flush(apiError('INVALID_STATUS_TRANSITION', 'x'), { status: 409, statusText: 'Conflict' });
    await s.stable();

    expect(s.text('admin-row-error')).toContain('can no longer be changed');
  });

  it('load error: message and "Try again"', async () => {
    const s = await mount(AdminAppointments);
    s.http.expectOne((r) => r.url === '/api/v1/doctors').flush(page([]));
    s.http
      .expectOne((r) => r.url === '/api/v1/appointments')
      .flush('x', { status: 500, statusText: 'E' });
    await s.stable();

    expect(s.text('admin-appointments-error')).toContain('Something went wrong');
    await s.click('Try again');
    s.http.expectOne((r) => r.url === '/api/v1/appointments').flush(page(ROWS));
  });
});

// ---------------------------------------------------------------------------

describe('Admin — doctors (FR-2.2, FR-2.3)', () => {
  async function open(doctors = [MEERA, RETIRED]) {
    const s = await mount(AdminDoctors);
    s.http.expectOne((r) => r.url === '/api/v1/specializations').flush({ items: SPECS });
    s.http.expectOne((r) => r.url === '/api/v1/doctors').flush(page(doctors));
    await s.stable();
    return s;
  }

  const card = (s: Awaited<ReturnType<typeof open>>, id: number) =>
    s.el.querySelector<HTMLElement>(`[data-testid="admin-doctor"][data-id="${id}"]`)!;

  it('lists doctors with state, specialization, fee and login email', async () => {
    const s = await open();

    expect(card(s, 5).textContent).toContain('Cardiology');
    expect(card(s, 5).textContent).toContain('₹900');
    expect(card(s, 5).textContent).toContain('meera@example.com');
    expect(card(s, 6).querySelector('[data-testid="doctor-state"]')?.textContent?.trim()).toBe(
      'Inactive',
    );
    expect(s.button('Activate', card(s, 6))).toBeDefined();
  });

  it('"Reset password" opens the Accounts tab with the doctor email (D-35)', async () => {
    const s = await open();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    await s.click('Reset password', card(s, 5));

    expect(navigate).toHaveBeenCalledWith([], {
      queryParams: { tab: 'accounts', email: 'meera@example.com' },
    });
  });

  it('fees with paise show 2 decimals, whole fees none', async () => {
    const s = await open([adminDoctor(7, 'Dr. Paise', { fee: 725.5 }), MEERA]);

    expect(card(s, 7).textContent).toContain('₹725.50');
    expect(card(s, 5).textContent).toContain('₹900 ');
  });

  it('no doctors: says so', async () => {
    const s = await open([]);

    expect(s.text('no-admin-doctors')).toContain('No doctors yet');
  });

  it('deactivate sends isActive false and updates the card', async () => {
    const s = await open();

    await s.click('Deactivate', card(s, 5));
    const req = s.http.expectOne('/api/v1/doctors/5');
    expect(req.request.body).toEqual({ isActive: false });
    req.flush({ doctor: { ...MEERA, isActive: false } });
    await s.stable();

    expect(card(s, 5).textContent).toContain('Inactive');
    expect(s.text('doctors-notice')).toContain('existing bookings are kept');
  });

  it('edit sends only the changed fields', async () => {
    const s = await open();
    await s.click('Edit', card(s, 5));

    await s.set('#edit-fee-5', '950');
    await s.set('#edit-slot-5', '15', 'change');
    await s.click('Save changes');

    const req = s.http.expectOne('/api/v1/doctors/5');
    expect(req.request.body).toEqual({ fee: 950, slotMinutes: 15 });
    req.flush({ doctor: { ...MEERA, fee: 950, slotMinutes: 15 } });
    await s.stable();
    expect(card(s, 5).textContent).toContain('₹950');
  });

  it('edit without changes just closes the form', async () => {
    const s = await open();
    await s.click('Edit', card(s, 5));

    await s.click('Save changes');

    s.http.expectNone('/api/v1/doctors/5');
    expect(s.button('Edit', card(s, 5))).toBeDefined();
  });

  it('edit refuses an invalid fee', async () => {
    const s = await open();
    await s.click('Edit', card(s, 5));

    await s.set('#edit-fee-5', '12.345');
    await s.click('Save changes');

    expect(card(s, 5).querySelector('.field-error')?.textContent).toContain('like 500 or 499.50');
    s.http.expectNone('/api/v1/doctors/5');
  });

  it('add: empty form shows errors and sends nothing', async () => {
    const s = await open();
    await s.click('Add doctor');

    await s.click('Save doctor');

    expect(
      s.el.querySelectorAll('[data-testid="add-doctor-form"] .field-error').length,
    ).toBeGreaterThanOrEqual(5);
    s.http.expectNone((r) => r.method === 'POST');
  });

  it('add: only active specializations can be chosen', async () => {
    const s = await open();
    await s.click('Add doctor');

    const options = [...s.el.querySelectorAll('#new-specialization option')].map((o) =>
      o.textContent?.trim(),
    );
    expect(options).toEqual(['Choose…', 'Cardiology', 'Dermatology']);
  });

  async function fillNewDoctor(
    s: Awaited<ReturnType<typeof open>>,
    overrides: Record<string, string> = {},
  ) {
    const values: Record<string, string> = {
      '#new-name': 'Dr. Fresh',
      '#new-email': 'fresh@example.com',
      '#new-password': 'Password123',
      '#new-fee': '650',
      ...overrides,
    };
    for (const [sel, value] of Object.entries(values)) await s.set(sel, value);
    await s.set('#new-specialization', overrides['#new-specialization'] ?? '2', 'change');
  }

  it('add: valid form posts the doctor and reloads', async () => {
    const s = await open();
    await s.click('Add doctor');
    await fillNewDoctor(s);

    await s.click('Save doctor');
    const req = s.http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/doctors');
    expect(req.request.body).toEqual({
      name: 'Dr. Fresh',
      email: 'fresh@example.com',
      password: 'Password123',
      specializationId: 2,
      fee: 650,
      slotMinutes: 30,
    });
    req.flush({ doctor: adminDoctor(9, 'Dr. Fresh') }, { status: 201, statusText: 'Created' });
    await s.stable();
    s.http.expectOne((r) => r.url === '/api/v1/specializations').flush({ items: SPECS });
    s.http.expectOne((r) => r.url === '/api/v1/doctors').flush(page([MEERA]));
    await s.stable();

    expect(s.text('doctors-notice')).toContain('Dr. Fresh was added');
  });

  it.each([
    ['#new-password', 'password', 'one number'],
    ['#new-fee', '-5', 'like 500 or 499.50'],
    ['#new-email', 'nope', 'valid email'],
  ])('add: %s = %j is refused', async (selector, value, message) => {
    const s = await open();
    await s.click('Add doctor');
    await fillNewDoctor(s, { [selector]: value });

    await s.click('Save doctor');

    expect(s.el.querySelector('[data-testid="add-doctor-form"]')?.textContent).toContain(message);
    s.http.expectNone((r) => r.method === 'POST');
  });

  it('add: email already used -> message on the email field', async () => {
    const s = await open();
    await s.click('Add doctor');
    await fillNewDoctor(s);

    await s.click('Save doctor');
    s.http
      .expectOne((r) => r.method === 'POST')
      .flush(apiError('EMAIL_TAKEN', 'x'), { status: 409, statusText: 'Conflict' });
    await s.stable();

    expect(s.el.querySelector('[data-testid="add-doctor-form"]')?.textContent).toContain(
      'This email is already used.',
    );
  });

  it('load error: message and "Try again"', async () => {
    const s = await mount(AdminDoctors);
    s.http.expectOne((r) => r.url === '/api/v1/specializations').flush({ items: [] });
    s.http
      .expectOne((r) => r.url === '/api/v1/doctors')
      .flush('x', { status: 500, statusText: 'E' });
    await s.stable();

    expect(s.text('admin-doctors-error')).toContain('Could not load doctors');
  });
});

// ---------------------------------------------------------------------------

describe('Admin — specializations (FR-2.1)', () => {
  async function open(items = SPECS) {
    const s = await mount(AdminSpecializations);
    s.http.expectOne((r) => r.url === '/api/v1/specializations').flush({ items });
    await s.stable();
    return s;
  }

  const row = (s: Awaited<ReturnType<typeof open>>, id: number) =>
    s.el.querySelector<HTMLElement>(`[data-testid="admin-specialization"][data-id="${id}"]`)!;

  it('lists all specializations with state', async () => {
    const s = await open();

    expect(
      row(s, 3).querySelector('[data-testid="specialization-state"]')?.textContent?.trim(),
    ).toBe('Inactive');
    expect(s.button('Activate', row(s, 3))).toBeDefined();
  });

  it('adds a trimmed name and reloads', async () => {
    const s = await open();
    await s.set('#new-specialization-name', '  Neurology ');

    await s.click('Add');
    const req = s.http.expectOne((r) => r.method === 'POST');
    expect(req.request.body).toEqual({ name: 'Neurology' });
    req.flush({ specialization: { id: 4, name: 'Neurology', isActive: true } });
    await s.stable();
    s.http.expectOne((r) => r.url === '/api/v1/specializations').flush({ items: SPECS });
    await s.stable();

    expect(s.text('specializations-notice')).toBe('Neurology was added.');
  });

  it.each([
    ['empty', '', 'Enter a name.'],
    ['1 letter', 'A', 'At least 2 characters.'],
  ])('refuses a %s name without calling the API', async (_label, value, message) => {
    const s = await open();
    await s.set('#new-specialization-name', value);

    await s.click('Add');

    expect(s.text('specializations-notice')).toBe(message);
    s.http.expectNone((r) => r.method === 'POST');
  });

  it('duplicate name: clear message', async () => {
    const s = await open();
    await s.set('#new-specialization-name', 'cardiology');

    await s.click('Add');
    s.http
      .expectOne((r) => r.method === 'POST')
      .flush(apiError('SPECIALIZATION_EXISTS', 'x'), { status: 409, statusText: 'Conflict' });
    await s.stable();

    expect(s.text('specializations-notice')).toBe(
      'A specialization with this name already exists.',
    );
  });

  it('renames one', async () => {
    const s = await open();
    await s.click('Rename', row(s, 2));
    await s.set('#rename-2', 'Skin');

    await s.click('Save');
    const req = s.http.expectOne('/api/v1/specializations/2');
    expect(req.request.body).toEqual({ name: 'Skin' });
    req.flush({ specialization: { id: 2, name: 'Skin', isActive: true } });
    await s.stable();

    expect(row(s, 2).textContent).toContain('Skin');
  });

  it('renaming to the same name just closes the form', async () => {
    const s = await open();
    await s.click('Rename', row(s, 1));

    await s.click('Save');

    s.http.expectNone('/api/v1/specializations/1');
  });

  it('deactivate explains that its doctors are hidden', async () => {
    const s = await open();

    await s.click('Deactivate', row(s, 1));
    s.http
      .expectOne('/api/v1/specializations/1')
      .flush({ specialization: { id: 1, name: 'Cardiology', isActive: false } });
    await s.stable();

    expect(s.text('specializations-notice')).toContain('its doctors are hidden from patients');
  });

  it('no specializations: says so', async () => {
    const s = await open([]);

    expect(s.text('no-specializations')).toBe('No specializations yet.');
  });
});

// ---------------------------------------------------------------------------

describe('Admin panel — tabs', () => {
  it('shows Appointments by default and switches tabs through the URL', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'admin', component: AdminPanel }], withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin', AdminPanel);
    const http = TestBed.inject(HttpTestingController);
    const el = harness.routeNativeElement as HTMLElement;

    expect(el.querySelector('#tab-appointments')?.getAttribute('aria-selected')).toBe('true');
    http.match(() => true).forEach((r) => r.flush(page([])));

    [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((b) => b.textContent?.trim() === 'Doctors')!
      .click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/admin?tab=doctors');
    http
      .match(() => true)
      .forEach((r) => r.flush(r.request.url.includes('special') ? { items: [] } : page([])));
  });
});
