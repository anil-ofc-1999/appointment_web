import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApiStatus, HealthService } from '../../core/health.service';
import { Home } from './home';

async function statusTextFor(status: ApiStatus) {
  TestBed.configureTestingModule({
    imports: [Home],
    providers: [{ provide: HealthService, useValue: { status: () => of(status) } }],
  });
  const fixture = TestBed.createComponent(Home);
  await fixture.whenStable();
  return (fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent;
}

describe('Home', () => {
  it('shows connected when the API is up', async () => {
    expect(await statusTextFor('ok')).toContain('connected');
  });

  it('tells the user how to start the API when it is unreachable', async () => {
    expect(await statusTextFor('unreachable')).toContain('npm run dev');
  });
});
