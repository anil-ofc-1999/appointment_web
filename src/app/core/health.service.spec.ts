import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ApiStatus, HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HealthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function statusFor(respond: (req: TestRequest) => void): ApiStatus | undefined {
    let result: ApiStatus | undefined;
    service.status().subscribe((s) => (result = s));
    respond(http.expectOne('/health'));
    return result;
  }

  it('returns ok when API and database are up', () => {
    expect(statusFor((req) => req.flush({ status: 'ok', database: 'up' }))).toBe('ok');
  });

  it('returns degraded when the API answers 503 (database down)', () => {
    const result = statusFor((req) =>
      req.flush(
        { status: 'degraded', database: 'down' },
        { status: 503, statusText: 'Service Unavailable' },
      ),
    );
    expect(result).toBe('degraded');
  });

  it('returns unreachable when the API is not running', () => {
    expect(statusFor((req) => req.error(new ProgressEvent('error')))).toBe('unreachable');
  });
});
