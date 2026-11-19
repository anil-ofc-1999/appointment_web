import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Client-side copies of the API rules (appointment_node_API src/auth/fields.js).
 * The API is still the source of truth — these only give faster feedback.
 */

export const NAME_MIN = 2;
export const NAME_MAX = 100;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
export const EMAIL_MAX = 255;
const PHONE_PATTERN = /^\+?[0-9 -]{7,20}$/;
// Same idea as zod's email check: something@something.tld, no spaces.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const trimmed = (control: AbstractControl): string =>
  typeof control.value === 'string' ? control.value.trim() : '';

/** Required after trimming, so "   " is treated as empty. */
export const requiredTrimmed: ValidatorFn = (control) =>
  trimmed(control) ? null : { required: true };

export const nameValidator: ValidatorFn = (control) => {
  const value = trimmed(control);
  if (!value) return null; // requiredTrimmed reports empty
  if (value.length < NAME_MIN) return { nameTooShort: true };
  if (value.length > NAME_MAX) return { nameTooLong: true };
  return null;
};

export const emailValidator: ValidatorFn = (control) => {
  const value = trimmed(control);
  if (!value) return null;
  if (value.length > EMAIL_MAX || !EMAIL_PATTERN.test(value)) return { email: true };
  return null;
};

/** FR-1.1: phone is optional; when given it must look like a phone number. */
export const phoneValidator: ValidatorFn = (control) => {
  const value = trimmed(control);
  return !value || PHONE_PATTERN.test(value) ? null : { phone: true };
};

/** FR-1.3: 8–72 characters, at least one letter and one number. Not trimmed. */
export const passwordValidator: ValidatorFn = (control) => {
  const value = typeof control.value === 'string' ? control.value : '';
  if (!value) return null;
  const errors: ValidationErrors = {};
  if (value.length < PASSWORD_MIN) errors['passwordTooShort'] = true;
  if (value.length > PASSWORD_MAX) errors['passwordTooLong'] = true;
  if (!/[A-Za-z]/.test(value)) errors['passwordNeedsLetter'] = true;
  if (!/[0-9]/.test(value)) errors['passwordNeedsNumber'] = true;
  return Object.keys(errors).length ? errors : null;
};

/** Form-level check that `confirmPassword` equals `password`. */
export const passwordsMatch: ValidatorFn = (group) => {
  const password = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  return confirm && password !== confirm ? { passwordMismatch: true } : null;
};

/** Text for the first error on a control, in a fixed priority order. */
export function errorMessage(errors: ValidationErrors | null | undefined): string | null {
  if (!errors) return null;
  if (errors['required']) return 'This field is required.';
  if (errors['server']) return errors['server'] as string;
  if (errors['nameTooShort']) return `Name must be at least ${NAME_MIN} characters.`;
  if (errors['nameTooLong']) return `Name must be at most ${NAME_MAX} characters.`;
  if (errors['email']) return 'Enter a valid email address.';
  if (errors['phone']) return 'Enter a valid phone number (7–20 digits, may start with +).';
  if (errors['passwordTooShort']) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (errors['passwordTooLong']) return `Password must be at most ${PASSWORD_MAX} characters.`;
  if (errors['passwordNeedsLetter']) return 'Password must contain at least one letter.';
  if (errors['passwordNeedsNumber']) return 'Password must contain at least one number.';
  return 'This value is not valid.';
}
