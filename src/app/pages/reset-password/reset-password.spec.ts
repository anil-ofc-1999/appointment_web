import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { apiError } from '../../../testing/fake-jwt';
import { ResetPassword } from './reset-password';

const TOKEN = 'a'.repeat(43);

interface Page {
  fixture: ComponentFixture<ResetPassword>;
  http: HttpTestingController;
  el: HTMLElement;
  navigate: ReturnType<typeof vi.spyOn>;
  fill(next: string, confirm?: string): Promise<void>;
  submit(): Promise<void>;
  error(id: string): string | undefined;
  text(testId: string): string | undefined;
}

/** `null` = the URL has no ?token= at all. */
async function render(token: string | null = TOKEN): Promise<Page> {
  TestBed.configureTestingModule({
    imports: [ResetPassword],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(ResetPassword);
  if (token !== null) fixture.componentRef.setInput('token', token);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const type = (id: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
  };
  return {
    fixture,
    el,
    navigate,
    http: TestBed.inject(HttpTestingController),
    async fill(next, confirm = next) {
      type('reset-new', next);
      type('reset-confirm-new', confirm);
      await fixture.whenStable();
    },
    async submit() {
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    },
    error: (id) => el.querySelector(`#${id}-error`)?.textContent?.trim(),
    text: (testId) => el.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim(),
  };
}

afterEach(() => TestBed.inject(HttpTestingController).verify());

describe('Reset password page (D-37) — positive', () => {
  it('two labelled password fields with eye buttons', async () => {
    const page = await render();

    for (const id of ['reset-new', 'reset-confirm-new']) {
      expect(page.el.querySelector(`label[for="${id}"]`), id).not.toBeNull();
    }
    expect(page.el.querySelectorAll('.password-toggle')).toHaveLength(2);
  });

  it('sends the token + new password and goes to login with a success note', async () => {
    const page = await render();
    await page.fill('FreshPass2030');
    await page.submit();

    const req = page.http.expectOne('/api/v1/auth/reset-password');
    expect(req.request.body).toEqual({ token: TOKEN, newPassword: 'FreshPass2030' });
    req.flush({ message: 'ok' });
    await page.fixture.whenStable();

    expect(page.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { reason: 'password-reset' },
    });
  });
});

describe('Reset password page — negative', () => {
  it.each([null, '', 'too-short'])(
    'a missing or broken token (%j) shows "ask for a new link" and no form',
    async (token) => {
      const page = await render(token);

      expect(page.text('invalid-link')).toContain('expired or was already used');
      expect(page.el.querySelector('a[href="/forgot-password"]')).not.toBeNull();
      expect(page.el.querySelector('form')).toBeNull();
    },
  );

  it('an expired / used link from the API switches to "ask for a new link"', async () => {
    const page = await render();
    await page.fill('FreshPass2030');
    await page.submit();
    page.http
      .expectOne('/api/v1/auth/reset-password')
      .flush(apiError('INVALID_RESET_LINK', 'x'), { status: 400, statusText: 'Bad Request' });
    await page.fixture.whenStable();

    expect(page.text('invalid-link')).toBeDefined();
    expect(page.el.querySelector('form')).toBeNull();
    expect(page.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ['short1', 'short1', 'reset-new', 'Password must be at least 8 characters.'],
    ['OnlyLetters', 'OnlyLetters', 'reset-new', 'Password must contain at least one number.'],
    ['FreshPass2030', 'FreshPass2031', 'reset-confirm-new', 'Passwords do not match.'],
  ])('%s / %s -> %s: %s, nothing sent', async (next, confirm, id, message) => {
    const page = await render();
    await page.fill(next, confirm);
    await page.submit();

    expect(page.error(id)).toBe(message);
    page.http.expectNone('/api/v1/auth/reset-password');
  });

  it('a double submit sends one request', async () => {
    const page = await render();
    await page.fill('FreshPass2030');
    await page.submit();
    await page.submit();

    const reqs = page.http.match('/api/v1/auth/reset-password');
    expect(reqs).toHaveLength(1);
    reqs[0].flush({ message: 'ok' });
  });
});
