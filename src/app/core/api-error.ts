import { HttpErrorResponse } from '@angular/common/http';

/** Standard API error body: { error: { code, message, details? } }. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { field: string; message: string }[];
  };
}

export interface ParsedApiError {
  /** API error code, or NETWORK_ERROR / UNKNOWN_ERROR when there is no API body. */
  code: string;
  /** Message safe to show to the user. */
  message: string;
  /** Field name -> first message, from VALIDATION_ERROR details. */
  fieldErrors: Record<string, string>;
}

/** Friendlier text for codes the user can act on (REQUIREMENTS §8: clear messages). */
const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  WRONG_PASSWORD: 'Your current password is incorrect.',
  USER_NOT_FOUND: 'No account with this email.',
  INVALID_RESET_LINK: 'This reset link has expired or was already used. Please ask for a new one.',
  ACCOUNT_DISABLED: 'This account is disabled. Please contact the clinic.',
  EMAIL_TAKEN: 'An account with this email already exists. Try logging in instead.',
  TOO_MANY_REQUESTS: 'Too many attempts. Please wait a minute and try again.',
  TOKEN_EXPIRED: 'Your session has expired. Please log in again.',
  UNAUTHORIZED: 'Please log in to continue.',
  FORBIDDEN: 'You do not have permission to do this.',
  VALIDATION_ERROR: 'Please fix the highlighted fields.',
  // Booking (FR-4) and appointment changes (FR-5)
  DOCTOR_NOT_FOUND: 'This doctor is not taking appointments.',
  SLOT_ALREADY_BOOKED: 'Sorry, someone has just booked this slot. Please choose another time.',
  DAILY_LIMIT_REACHED:
    'You already have a booking with this doctor on this day. Only one per day is allowed.',
  SLOT_IN_PAST: 'This time has already passed. Please choose a later slot.',
  BEYOND_BOOKING_WINDOW: 'Appointments can be booked at most 30 days ahead.',
  DOCTOR_ON_LEAVE: 'The doctor is on leave on this day. Please choose another date.',
  OUTSIDE_SCHEDULE: 'The doctor does not work at this time. Please choose a slot from the list.',
  CHANGE_WINDOW_PASSED:
    'Appointments can be changed or cancelled only up to 2 hours before they start.',
  INVALID_STATUS_TRANSITION: 'This appointment can no longer be changed.',
  SAME_SLOT: 'This is already your appointment time. Please choose a different slot.',
  APPOINTMENT_NOT_STARTED: 'You can mark this only after the appointment has started.',
  NOT_FOUND: 'This item was not found. It may have been removed.',
};

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  const error = (value as ApiErrorBody | null)?.error;
  return typeof error?.code === 'string' && typeof error?.message === 'string';
}

export function parseApiError(err: unknown): ParsedApiError {
  if (err instanceof HttpErrorResponse && err.status === 0) {
    return {
      code: 'NETWORK_ERROR',
      message: 'Cannot reach the server. Check your connection and try again.',
      fieldErrors: {},
    };
  }

  const body = err instanceof HttpErrorResponse ? err.error : undefined;
  if (!isApiErrorBody(body)) {
    return {
      code: 'UNKNOWN_ERROR',
      message: 'Something went wrong. Please try again.',
      fieldErrors: {},
    };
  }

  const fieldErrors: Record<string, string> = {};
  for (const detail of body.error.details ?? []) {
    fieldErrors[detail.field] ??= detail.message;
  }

  return {
    code: body.error.code,
    message: MESSAGES[body.error.code] ?? body.error.message,
    fieldErrors,
  };
}
