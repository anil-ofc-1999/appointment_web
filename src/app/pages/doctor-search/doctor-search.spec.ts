import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { doctor, page, specializations } from '../../../testing/doctors';
import { apiError } from '../../../testing/fake-jwt';
import { Doctor, Page } from '../../core/doctors/doctor.models';
import { DoctorSearch } from './doctor-search';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ALL = [
  doctor(1, 'Dr. Arjun Rao', { fee: 800 }),
  doctor(2, 'Dr. Kiran Shah', {
    specialization: { id: 2, name: 'Dermatology' },
    slotMinutes: 15,
    bio: 'Skin and hair specialist.',
  }),
];

async function open(url = '/doctors', { loadSpecializations = true } = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'doctors', component: DoctorSearch }]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, DoctorSearch);
  const http = TestBed.inject(HttpTestingController);
  const router = TestBed.inject(Router);
  if (loadSpecializations)
    http.expectOne('/api/v1/specializations').flush({ items: specializations });

  const el = () => harness.routeNativeElement as HTMLElement;
  const stable = () => harness.fixture.whenStable();

  return {
    harness,
    http,
    router,
    el,
    stable,
    /** The pending doctor list request. */
    doctorsRequest: (): TestRequest => http.expectOne((r) => r.url === '/api/v1/doctors'),
    async respond(body: Page<Doctor>) {
      http.expectOne((r) => r.url === '/api/v1/doctors').flush(body);
      await stable();
    },
    text: (testId: string) => el().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim(),
    cards: () =>
      [...el().querySelectorAll('[data-testid="doctor-card"] h2')].map((h) =>
        h.textContent?.trim(),
      ),
    input: () => el().querySelector<HTMLInputElement>('#doctor-search-text')!,
    select: () => el().querySelector<HTMLSelectElement>('#doctor-search-specialization')!,
    button: (label: string) =>
      [...el().querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === label,
      ),
    async type(value: string) {
      const input = el().querySelector<HTMLInputElement>('#doctor-search-text')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await stable();
    },
    async chooseSpecialization(value: string) {
      const select = el().querySelector<HTMLSelectElement>('#doctor-search-specialization')!;
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await stable();
    },
    url: () => router.url,
  };
}

type Screen = Awaited<ReturnType<typeof open>>;

/** Waits for the debounce and the URL change, then returns the new request. */
async function afterDebounce(screen: Screen) {
  await wait(350);
  await screen.stable();
  return screen.doctorsRequest();
}

afterEach(() => TestBed.inject(HttpTestingController).verify());

describe('Doctor search — positive scenarios', () => {
  it('lists all doctors with the count, sorted as the API sends them', async () => {
    const screen = await open();
    await screen.respond(page(ALL));

    expect(screen.cards()).toEqual(['Dr. Arjun Rao', 'Dr. Kiran Shah']);
    expect(screen.text('result-count')).toBe('2 doctors found');
  });

  it('shows name, specialization, fee, slot length and bio on each card', async () => {
    const screen = await open();
    await screen.respond(page(ALL));

    const cards = screen.el().querySelectorAll('[data-testid="doctor-card"]');
    expect(cards[0].textContent).toContain('Cardiology');
    expect(cards[0].textContent).toContain('₹800');
    expect(cards[0].textContent).toContain('30 min slots');
    expect(cards[1].textContent).toContain('Dermatology');
    expect(cards[1].textContent).toContain('15 min slots');
    expect(cards[1].textContent).toContain('Skin and hair specialist.');
  });

  it('links each card to the doctor detail page', async () => {
    const screen = await open();
    await screen.respond(page(ALL));

    const link = screen.el().querySelector<HTMLAnchorElement>('[data-testid="doctor-card"] a')!;
    expect(link.getAttribute('href')).toBe('/doctors/1');
    expect(link.textContent).toContain('for Dr. Arjun Rao'); // screen-reader text
  });

  it('says "1 doctor found" for a single result', async () => {
    const screen = await open();
    await screen.respond(page([ALL[0]]));

    expect(screen.text('result-count')).toBe('1 doctor found');
  });

  it('fills the specialization dropdown with "All" first', async () => {
    const screen = await open();
    await screen.respond(page(ALL));

    const options = [...screen.select().options].map((o) => o.textContent?.trim());
    expect(options).toEqual(['All specializations', 'Cardiology', 'Dermatology']);
  });

  it('searches by name after the user stops typing (debounce) and puts it in the URL', async () => {
    const screen = await open();
    await screen.respond(page(ALL));

    await screen.type('  rao ');
    const req = await afterDebounce(screen);

    expect(req.request.params.get('search')).toBe('rao');
    expect(screen.url()).toBe('/doctors?q=rao');
    req.flush(page([ALL[0]]));
  });

  it('sends only ONE request while typing quickly', async () => {
    const screen = await open();
    await screen.respond(page(ALL));

    await screen.type('r');
    await screen.type('ra');
    await screen.type('rao');
    const req = await afterDebounce(screen);

    expect(req.request.params.get('search')).toBe('rao');
    req.flush(page([ALL[0]]));
  });

  it('pressing Enter searches immediately', async () => {
    const screen = await open();
    await screen.respond(page(ALL));

    screen.input().value = 'kiran';
    screen.input().dispatchEvent(new Event('input'));
    screen.el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await screen.stable();

    expect(screen.doctorsRequest().request.params.get('search')).toBe('kiran');
    await wait(350); // the debounced value is the same -> no second request
    await screen.stable();
    screen.http.expectNone((r) => r.url === '/api/v1/doctors');
  });

  it('filters by specialization and resets to page 1', async () => {
    const screen = await open('/doctors?page=2');
    await screen.respond(page(ALL, { page: 2, total: 12 }));

    await screen.chooseSpecialization('2');

    const req = screen.doctorsRequest();
    expect(req.request.params.get('specializationId')).toBe('2');
    expect(req.request.params.get('page')).toBe('1');
    expect(screen.url()).toBe('/doctors?specializationId=2');
    req.flush(page([ALL[1]]));
  });

  it('combines name search and specialization', async () => {
    const screen = await open('/doctors?specializationId=1');
    await screen.respond(page([ALL[0]]));

    await screen.type('arjun');
    const req = await afterDebounce(screen);

    expect(req.request.params.get('search')).toBe('arjun');
    expect(req.request.params.get('specializationId')).toBe('1');
    req.flush(page([ALL[0]]));
  });

  it('restores the search from the URL (reload / shared link)', async () => {
    const screen = await open('/doctors?q=rao&specializationId=2&page=2');

    const req = screen.doctorsRequest();
    expect(req.request.params.get('search')).toBe('rao');
    expect(req.request.params.get('specializationId')).toBe('2');
    expect(req.request.params.get('page')).toBe('2');
    req.flush(page([ALL[1]], { page: 2, total: 11 }));
    await screen.stable();

    expect(screen.input().value).toBe('rao');
    expect(screen.select().value).toBe('2');
  });

  it('pages forward and back; buttons are disabled at the ends', async () => {
    const screen = await open();
    await screen.respond(page(ALL, { total: 25 }));

    expect(screen.text('page-info')).toBe('Page 1 of 3');
    expect(screen.button('Previous')!.disabled).toBe(true);

    screen.button('Next')!.click();
    await screen.stable();
    expect(screen.doctorsRequest().request.params.get('page')).toBe('2');
    // (request flushed below)
    screen.http.match((r) => r.url === '/api/v1/doctors');
    await screen.stable();
    expect(screen.url()).toBe('/doctors?page=2');
  });

  it('disables Next on the last page', async () => {
    const screen = await open('/doctors?page=3');
    await screen.respond(page(ALL, { page: 3, total: 25 }));

    expect(screen.button('Next')!.disabled).toBe(true);
    expect(screen.button('Previous')!.disabled).toBe(false);
  });

  it('hides the pager when everything fits on one page', async () => {
    const screen = await open();
    await screen.respond(page(ALL));

    expect(screen.el().querySelector('.pager')).toBeNull();
  });

  it('"Clear filters" removes search and specialization', async () => {
    const screen = await open('/doctors?q=rao&specializationId=1');
    await screen.respond(page([ALL[0]]));

    screen.button('Clear filters')!.click();
    await screen.stable();

    const req = screen.doctorsRequest();
    expect(req.request.params.has('search')).toBe(false);
    expect(req.request.params.has('specializationId')).toBe(false);
    expect(screen.url()).toBe('/doctors');
    req.flush(page(ALL));
    await screen.stable();
    expect(screen.input().value).toBe('');
    expect(screen.button('Clear filters')).toBeUndefined();
  });

  it('shows a loading message while waiting (aria-busy)', async () => {
    const screen = await open();

    expect(screen.text('loading')).toBe('Loading doctors…');
    expect(screen.el().querySelector('.results')?.getAttribute('aria-busy')).toBe('true');
    await screen.respond(page(ALL));
    expect(screen.el().querySelector('.results')?.getAttribute('aria-busy')).toBe('false');
  });

  it('has labels for the search box and the dropdown (NFR-9)', async () => {
    const screen = await open();
    await screen.respond(page(ALL));

    expect(screen.el().querySelector('label[for="doctor-search-text"]')).not.toBeNull();
    expect(screen.el().querySelector('label[for="doctor-search-specialization"]')).not.toBeNull();
    expect(screen.el().querySelector('form[role="search"]')).not.toBeNull();
  });
});

describe('Doctor search — negative scenarios', () => {
  it('no results: says what was searched and offers to show all', async () => {
    const screen = await open('/doctors?q=zzz&specializationId=2');
    await screen.respond(page([]));

    expect(screen.text('no-results')).toContain('No doctors found');
    expect(screen.text('no-results')).toContain('“zzz”');
    expect(screen.text('no-results')).toContain('in Dermatology');

    screen.button('Show all doctors')!.click();
    await screen.stable();
    expect(screen.doctorsRequest().request.params.keys().sort()).toEqual(['page', 'pageSize']);
  });

  it('no doctors at all: plain message without a "show all" button', async () => {
    const screen = await open();
    await screen.respond(page([]));

    expect(screen.text('no-results')).toContain('No doctors found');
    expect(screen.button('Show all doctors')).toBeUndefined();
  });

  it('ignores invalid values typed into the URL', async () => {
    const screen = await open('/doctors?page=-1&specializationId=abc&q=%20%20');

    const req = screen.doctorsRequest();
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.has('specializationId')).toBe(false);
    expect(req.request.params.has('search')).toBe(false);
    req.flush(page(ALL));
  });

  it('cuts a very long search from the URL to 100 characters', async () => {
    const screen = await open(`/doctors?q=${'a'.repeat(300)}`);

    expect(screen.doctorsRequest().request.params.get('search')).toHaveLength(100);
    screen.http.match(() => true);
  });

  it('limits the search box to 100 characters', async () => {
    const screen = await open();
    await screen.respond(page(ALL));

    expect(screen.input().getAttribute('maxlength')).toBe('100');
  });

  it('a search of only spaces is not sent', async () => {
    const screen = await open();
    await screen.respond(page(ALL));

    await screen.type('     ');
    await wait(350);
    await screen.stable();

    screen.http.expectNone((r) => r.url === '/api/v1/doctors'); // same as before: no search
  });

  it('a page past the end: explains and offers the first page', async () => {
    const screen = await open('/doctors?page=9');
    await screen.respond(page([], { page: 9, total: 4 }));

    expect(screen.text('page-out-of-range')).toContain('This page is empty.');
    screen.button('Go to the first page')!.click();
    await screen.stable();
    expect(screen.doctorsRequest().request.params.get('page')).toBe('1');
  });

  it('server error: shows a message and "Try again" recovers', async () => {
    const screen = await open();
    screen.doctorsRequest().flush('oops', { status: 500, statusText: 'Server Error' });
    await screen.stable();

    expect(screen.text('search-error')).toContain('Something went wrong');
    expect(screen.cards()).toEqual([]);

    screen.button('Try again')!.click();
    await screen.stable();
    await screen.respond(page(ALL));

    expect(screen.el().querySelector('[data-testid="search-error"]')).toBeNull();
    expect(screen.cards()).toHaveLength(2);
  });

  it('server down: says it cannot reach the server', async () => {
    const screen = await open();
    screen.doctorsRequest().error(new ProgressEvent('error'));
    await screen.stable();

    expect(screen.text('search-error')).toContain('Cannot reach the server');
  });

  it('shows the API message for a 400 error', async () => {
    const screen = await open();
    screen.doctorsRequest().flush(apiError('VALIDATION_ERROR', 'Some fields are invalid.'), {
      status: 400,
      statusText: 'Bad Request',
    });
    await screen.stable();

    expect(screen.text('search-error')).toContain('Please fix the highlighted fields.');
  });

  it('specializations fail to load: shows a hint, name search still works', async () => {
    const screen = await open('/doctors', { loadSpecializations: false });
    screen.http
      .expectOne('/api/v1/specializations')
      .flush('down', { status: 503, statusText: 'Unavailable' });
    await screen.respond(page(ALL));

    expect(screen.text('specializations-error')).toContain('Could not load specializations');
    expect([...screen.select().options]).toHaveLength(1);
    expect(screen.cards()).toHaveLength(2);
  });

  it('regression: Enter + typing timer navigate only ONCE (an extra one cancelled the 401 redirect)', async () => {
    const screen = await open();
    await screen.respond(page(ALL));
    const navigate = vi.spyOn(screen.router, 'navigate');

    screen.input().value = 'kiran';
    screen.input().dispatchEvent(new Event('input'));
    screen.el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await screen.stable();
    screen.doctorsRequest().flush(page([ALL[1]]));
    await wait(350);
    await screen.stable();

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('regression: typing the same text again after "Clear filters" searches again', async () => {
    const screen = await open();
    await screen.respond(page(ALL));

    await screen.type('rao');
    (await afterDebounce(screen)).flush(page([ALL[0]]));
    await screen.stable();

    screen.button('Clear filters')!.click();
    await screen.stable();
    screen.doctorsRequest().flush(page(ALL));
    await screen.stable();

    await screen.type('rao');
    const again = await afterDebounce(screen);

    expect(again.request.params.get('search')).toBe('rao');
    again.flush(page([ALL[0]]));
  });

  it('a slow old answer never replaces a newer search (old request is cancelled)', async () => {
    const screen = await open();
    const first = screen.doctorsRequest();
    await screen.stable(); // dropdown options rendered

    await screen.chooseSpecialization('2');
    const second = screen.doctorsRequest();

    expect(first.cancelled).toBe(true);
    second.flush(page([ALL[1]]));
    await screen.stable();
    expect(screen.cards()).toEqual(['Dr. Kiran Shah']);
  });
});
