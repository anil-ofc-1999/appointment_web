import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap } from '@angular/router';

import { doctor, page, specializations } from '../../../testing/doctors';
import { DoctorService, criteriaFromParams, paramsFromCriteria } from './doctor.service';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { service: TestBed.inject(DoctorService), http: TestBed.inject(HttpTestingController) };
}

describe('DoctorService', () => {
  it('loads specializations', () => {
    const { service, http } = setup();
    let result;
    service.specializations().subscribe((items) => (result = items));

    http.expectOne('/api/v1/specializations').flush({ items: specializations });

    expect(result).toEqual(specializations);
    http.verify();
  });

  it('always sends page and pageSize=10', () => {
    const { service, http } = setup();
    service.search({ search: '', specializationId: null, page: 1 }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/doctors');
    expect(req.request.params.keys().sort()).toEqual(['page', 'pageSize']);
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('10');
  });

  it('sends a trimmed search and the specialization when given', () => {
    const { service, http } = setup();
    let result;
    service
      .search({ search: '  rao ', specializationId: 2, page: 3 })
      .subscribe((p) => (result = p));

    const req = http.expectOne((r) => r.url === '/api/v1/doctors');
    expect(req.request.params.get('search')).toBe('rao');
    expect(req.request.params.get('specializationId')).toBe('2');
    expect(req.request.params.get('page')).toBe('3');
    req.flush(page([doctor(1, 'Dr. Arjun Rao')]));
    expect(result).toMatchObject({ total: 1 });
  });

  it('does not send a search of only spaces', () => {
    const { service, http } = setup();
    service.search({ search: '    ', specializationId: null, page: 1 }).subscribe();

    expect(http.expectOne((r) => r.url === '/api/v1/doctors').request.params.has('search')).toBe(
      false,
    );
  });

  it('passes API errors to the caller', () => {
    const { service, http } = setup();
    let status = 0;
    service
      .search({ search: '', specializationId: null, page: 1 })
      .subscribe({ error: (e: { status: number }) => (status = e.status) });

    http
      .expectOne((r) => r.url === '/api/v1/doctors')
      .flush({ error: { code: 'X', message: 'x' } }, { status: 500, statusText: 'Error' });

    expect(status).toBe(500);
  });
});

describe('criteriaFromParams (URL -> search)', () => {
  const read = (params: Record<string, string>) => criteriaFromParams(convertToParamMap(params));

  it('reads all values', () => {
    expect(read({ q: 'rao', specializationId: '2', page: '3' })).toEqual({
      search: 'rao',
      specializationId: 2,
      page: 3,
    });
  });

  it('uses defaults when nothing is in the URL', () => {
    expect(read({})).toEqual({ search: '', specializationId: null, page: 1 });
  });

  it('trims the search and cuts it to 100 characters', () => {
    expect(read({ q: `  ${'a'.repeat(150)}  ` }).search).toHaveLength(100);
    expect(read({ q: '   ' }).search).toBe('');
  });

  it.each(['abc', '0', '-1', '1.5', '2abc', '', '99999999999999999999'])(
    'ignores an invalid specializationId %j',
    (value) => {
      expect(read({ specializationId: value }).specializationId).toBeNull();
    },
  );

  it.each(['abc', '0', '-2', '2.5', ''])('falls back to page 1 for %j', (value) => {
    expect(read({ page: value }).page).toBe(1);
  });
});

describe('paramsFromCriteria (search -> URL)', () => {
  it('writes only non-default values', () => {
    expect(paramsFromCriteria({ search: '', specializationId: null, page: 1 })).toEqual({
      q: null,
      specializationId: null,
      page: null,
    });
  });

  it('writes search, specialization and page', () => {
    expect(paramsFromCriteria({ search: ' rao ', specializationId: 2, page: 4 })).toEqual({
      q: 'rao',
      specializationId: '2',
      page: '4',
    });
  });

  it('round-trips through the URL', () => {
    const criteria = { search: 'meera', specializationId: 1, page: 2 };
    const params = paramsFromCriteria(criteria) as Record<string, string>;

    expect(criteriaFromParams(convertToParamMap(params))).toEqual(criteria);
  });
});
