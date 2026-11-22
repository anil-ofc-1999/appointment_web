import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AdminService } from './admin.service';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { service: TestBed.inject(AdminService), http: TestBed.inject(HttpTestingController) };
}

afterEach(() => TestBed.inject(HttpTestingController).verify());

describe('AdminService', () => {
  it('doctors() asks for inactive ones too, 50 per page', () => {
    const { service, http } = setup();
    service.doctors().subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/doctors');
    expect(req.request.params.get('includeInactive')).toBe('true');
    expect(req.request.params.get('pageSize')).toBe('50');
    req.flush({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 0 });
  });

  it('createDoctor() posts the form', () => {
    const { service, http } = setup();
    const body = {
      name: 'Dr. X',
      email: 'x@example.com',
      password: 'Password123',
      specializationId: 1,
      fee: 500,
      slotMinutes: 30 as const,
    };
    service.createDoctor(body).subscribe();

    const req = http.expectOne('/api/v1/doctors');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({ doctor: {} });
  });

  it('updateDoctor() sends only the changes with PATCH', () => {
    const { service, http } = setup();
    service.updateDoctor(3, { isActive: false }).subscribe();

    const req = http.expectOne('/api/v1/doctors/3');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ isActive: false });
    req.flush({ doctor: {} });
  });

  it('specializations() includes inactive ones', () => {
    const { service, http } = setup();
    let items;
    service.specializations().subscribe((s) => (items = s));

    const req = http.expectOne((r) => r.url === '/api/v1/specializations');
    expect(req.request.params.get('includeInactive')).toBe('true');
    req.flush({ items: [{ id: 1, name: 'A', isActive: false }] });
    expect(items).toHaveLength(1);
  });

  it('create / update specialization', () => {
    const { service, http } = setup();
    service.createSpecialization('Neurology').subscribe();
    service.updateSpecialization(2, { name: 'Neuro' }).subscribe();

    expect(http.expectOne((r) => r.method === 'POST').request.body).toEqual({ name: 'Neurology' });
    const patch = http.expectOne('/api/v1/specializations/2');
    expect(patch.request.method).toBe('PATCH');
    http.match(() => true).forEach((r) => r.flush({ specialization: {} }));
    patch.flush({ specialization: {} });
  });

  it('appointments() sends only the filters that are set', () => {
    const { service, http } = setup();
    service
      .appointments({ doctorId: 4, status: 'BOOKED', from: '2030-01-01', to: null, page: 2 })
      .subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/appointments');
    expect(req.request.params.keys().sort()).toEqual([
      'doctorId',
      'from',
      'page',
      'pageSize',
      'status',
    ]);
    expect(req.request.params.get('doctorId')).toBe('4');
    req.flush({ items: [], page: 2, pageSize: 20, total: 0, totalPages: 0 });
  });
});
