import { HttpErrorResponse } from '@angular/common/http';

import { apiError } from '../../testing/fake-jwt';
import { parseApiError } from './api-error';

const httpError = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

describe('parseApiError', () => {
  it('explains a network failure (status 0)', () => {
    const parsed = parseApiError(httpError(0, new ProgressEvent('error')));

    expect(parsed.code).toBe('NETWORK_ERROR');
    expect(parsed.message).toContain('Cannot reach the server');
  });

  it.each([
    ['INVALID_CREDENTIALS', 401, 'Email or password is incorrect.'],
    ['ACCOUNT_DISABLED', 403, 'This account is disabled'],
    ['EMAIL_TAKEN', 409, 'already exists'],
    ['TOO_MANY_REQUESTS', 429, 'wait a minute'],
    ['TOKEN_EXPIRED', 401, 'session has expired'],
  ])('gives a clear message for %s', (code, status, text) => {
    const parsed = parseApiError(httpError(status, apiError(code, 'raw message')));

    expect(parsed.code).toBe(code);
    expect(parsed.message).toContain(text);
  });

  it('falls back to the API message for an unknown code', () => {
    const parsed = parseApiError(httpError(400, apiError('SOMETHING_NEW', 'From the API.')));

    expect(parsed).toEqual({ code: 'SOMETHING_NEW', message: 'From the API.', fieldErrors: {} });
  });

  it('collects field errors (first message per field)', () => {
    const body = apiError('VALIDATION_ERROR', 'Some fields are invalid.', [
      { field: 'email', message: 'Enter a valid email address.' },
      { field: 'password', message: 'Password must be at least 8 characters.' },
      { field: 'password', message: 'Password must contain at least one number.' },
    ]);

    const parsed = parseApiError(httpError(400, body));

    expect(parsed.fieldErrors).toEqual({
      email: 'Enter a valid email address.',
      password: 'Password must be at least 8 characters.',
    });
    expect(parsed.message).toBe('Please fix the highlighted fields.');
  });

  it.each([
    ['an HTML error page', '<html>502 Bad Gateway</html>'],
    ['an empty body', null],
    ['a body with the wrong shape', { message: 'oops' }],
  ])('handles %s without crashing', (_label, body) => {
    expect(parseApiError(httpError(502, body)).code).toBe('UNKNOWN_ERROR');
  });

  it('handles a non-HTTP error', () => {
    expect(parseApiError(new Error('boom')).message).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
