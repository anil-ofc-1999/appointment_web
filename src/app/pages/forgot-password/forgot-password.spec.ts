import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { apiError } from '../../../testing/fake-jwt';
import { ForgotPassword } from './forgot-password';

interface Page {
  fixture: ComponentFixture<ForgotPassword>;
  http: HttpTestingController;
  el: HTMLElement;
  type(value: string): Promise<void>;
  submit(): Promise<void>;
  text(testId: string): string | undefined;
}

async function render(): Promise<Page> {
  TestBed.configureTestingModule({
    imports: [ForgotPassword],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(ForgotPassword);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    el,
    http: TestBed.inject(HttpTestingController),
    async type(value) {
      const input = el.querySelector<HTMLInputElement>('#forgot-email')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('blur'));
      await fixture.whenStable();
    },
    async submit() {
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    },
    text: (testId) => el.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim(),
  };
}

afterEach(() => TestBed.inject(HttpTestingController).verify());

describe('Forgot password page (D-37) — positive', () => {
  it('has a labelled email input and a link back to login', async () => {
    const page = await render();

    expect(page.el.querySelector('label[for="forgot-email"]')).not.toBeNull();
    expect(page.el.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('sends the trimmed email and shows the same neutral confirmation', async () => {
    const page = await render();
    await page.type('  asha.reddy@example.com ');
    await page.submit();

    const req = page.http.expectOne('/api/v1/auth/forgot-password');
    expect(req.request.body).toEqual({ email: 'asha.reddy@example.com' });
    req.flush({ message: 'x' });
    await page.fixture.whenStable();

    expect(page.text('reset-sent')).toContain('If an account exists for asha.reddy@example.com');
    expect(page.text('reset-sent')).toContain('30 minutes');
    expect(page.el.querySelector('form')).toBeNull();
  });

  it('disables the button while sending', async () => {
    const page = await render();
    await page.type('asha.reddy@example.com');
    await page.submit();

    const button = page.el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Sending');
    page.http.expectOne('/api/v1/auth/forgot-password').flush({ message: 'x' });
  });
});

describe('Forgot password page — negative', () => {
  it.each([
    ['', 'This field is required.'],
    ['not-an-email', 'Enter a valid email address.'],
  ])('%j -> %s, nothing sent', async (value, message) => {
    const page = await render();
    await page.type(value);
    await page.submit();

    expect(page.el.querySelector('#forgot-email-error')?.textContent?.trim()).toBe(message);
    page.http.expectNone('/api/v1/auth/forgot-password');
  });

  it('too many requests (429): asks to wait', async () => {
    const page = await render();
    await page.type('asha.reddy@example.com');
    await page.submit();
    page.http
      .expectOne('/api/v1/auth/forgot-password')
      .flush(apiError('TOO_MANY_REQUESTS', 'x'), { status: 429, statusText: 'Too Many' });
    await page.fixture.whenStable();

    expect(page.text('form-error')).toContain('wait a minute');
    expect(page.text('reset-sent')).toBeUndefined();
  });

  it('server down: connection message, can try again', async () => {
    const page = await render();
    await page.type('asha.reddy@example.com');
    await page.submit();
    page.http.expectOne('/api/v1/auth/forgot-password').error(new ProgressEvent('error'));
    await page.fixture.whenStable();

    expect(page.text('form-error')).toContain('Cannot reach the server');
    expect(page.el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });
});
