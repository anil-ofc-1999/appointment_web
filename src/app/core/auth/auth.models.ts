/** Types that mirror the appointment_node_API auth endpoints (FR-1). */

export type Role = 'PATIENT' | 'DOCTOR' | 'ADMIN';

export interface User {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
}

export interface RegisterRequest {
  name: string;
  email: string;
  phone?: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: User;
}

/** What we keep in the browser after a successful login. */
export interface Session {
  accessToken: string;
  /** Token expiry in epoch milliseconds (read from the JWT `exp` claim). */
  expiresAt: number;
  user: User;
}
