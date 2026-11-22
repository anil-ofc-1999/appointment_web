import { User } from '../app/core/auth/auth.models';

/** Test-only helpers. A fake (unsigned) JWT is enough: the browser never verifies signatures. */

const base64Url = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** JWT that expires `secondsFromNow` seconds from now (negative = already expired). */
export function fakeJwt(secondsFromNow = 3600, claims: object = {}): string {
  const exp = Math.floor(Date.now() / 1000) + secondsFromNow;
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({ sub: '7', role: 'PATIENT', exp, ...claims })}.signature`;
}

export const testUser: User = {
  id: 7,
  name: 'Asha Reddy',
  email: 'asha.reddy@example.com',
  phone: null,
  role: 'PATIENT',
};

export function loginResponse(token = fakeJwt(), user: User = testUser) {
  return { accessToken: token, tokenType: 'Bearer' as const, expiresIn: '1h', user };
}

/** API error body in the standard shape. */
export function apiError(
  code: string,
  message: string,
  details?: { field: string; message: string }[],
) {
  return { error: { code, message, ...(details ? { details } : {}) } };
}
