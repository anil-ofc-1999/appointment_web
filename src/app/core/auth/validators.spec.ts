import { FormControl, FormGroup, ValidatorFn } from '@angular/forms';

import {
  emailValidator,
  errorMessage,
  nameValidator,
  passwordValidator,
  passwordsMatch,
  phoneValidator,
  requiredTrimmed,
} from './validators';

const run = (validator: ValidatorFn, value: unknown) => validator(new FormControl(value));

describe('requiredTrimmed', () => {
  it.each(['Asha', ' a '])('accepts %j', (value) => {
    expect(run(requiredTrimmed, value)).toBeNull();
  });

  it.each(['', '   ', null, undefined])('rejects %j', (value) => {
    expect(run(requiredTrimmed, value)).toEqual({ required: true });
  });
});

describe('nameValidator (2–100 characters after trimming)', () => {
  it.each(['Al', 'Asha Reddy', 'a'.repeat(100), '  Al  '])('accepts %j', (value) => {
    expect(run(nameValidator, value)).toBeNull();
  });

  it('rejects 1 character', () => {
    expect(run(nameValidator, ' A ')).toEqual({ nameTooShort: true });
  });

  it('rejects 101 characters', () => {
    expect(run(nameValidator, 'a'.repeat(101))).toEqual({ nameTooLong: true });
  });

  it('leaves an empty value to requiredTrimmed', () => {
    expect(run(nameValidator, '')).toBeNull();
  });
});

describe('emailValidator', () => {
  it.each(['asha@example.com', 'A.B+tag@sub.example.co.in', '  asha@example.com  '])(
    'accepts %j',
    (value) => {
      expect(run(emailValidator, value)).toBeNull();
    },
  );

  it.each([
    'asha',
    'asha@',
    '@example.com',
    'asha@example',
    'asha reddy@example.com',
    `${'a'.repeat(250)}@example.com`,
  ])('rejects %j', (value) => {
    expect(run(emailValidator, value)).toEqual({ email: true });
  });
});

describe('phoneValidator (optional)', () => {
  it.each(['', '   ', '9876543', '+91 98765-43210', '1'.repeat(20)])('accepts %j', (value) => {
    expect(run(phoneValidator, value)).toBeNull();
  });

  it.each(['123456', '1'.repeat(21), 'phone-no', '98765 4321x', '++919876543'])(
    'rejects %j',
    (value) => {
      expect(run(phoneValidator, value)).toEqual({ phone: true });
    },
  );
});

describe('passwordValidator (FR-1.3)', () => {
  it.each(['abcdefg1', 'Password123', `${'a'.repeat(71)}1`, 'P@ss w0rd!'])(
    'accepts %j',
    (value) => {
      expect(run(passwordValidator, value)).toBeNull();
    },
  );

  it('rejects 7 characters', () => {
    expect(run(passwordValidator, 'abcdef1')).toEqual({ passwordTooShort: true });
  });

  it('rejects 73 characters', () => {
    expect(run(passwordValidator, `${'a'.repeat(72)}1`)).toEqual({ passwordTooLong: true });
  });

  it('rejects a password without a number', () => {
    expect(run(passwordValidator, 'Passwordonly')).toEqual({ passwordNeedsNumber: true });
  });

  it('rejects a password without a letter', () => {
    expect(run(passwordValidator, '12345678')).toEqual({ passwordNeedsLetter: true });
  });

  it('reports every broken rule at once', () => {
    expect(run(passwordValidator, '!!!')).toEqual({
      passwordTooShort: true,
      passwordNeedsLetter: true,
      passwordNeedsNumber: true,
    });
  });

  it('does not trim (spaces count as characters)', () => {
    expect(run(passwordValidator, ' abcde1 ')).toBeNull();
  });
});

describe('passwordsMatch', () => {
  const group = (password: string, confirmPassword: string) =>
    new FormGroup({
      password: new FormControl(password),
      confirmPassword: new FormControl(confirmPassword),
    });

  it('passes when both are equal', () => {
    expect(passwordsMatch(group('Password123', 'Password123'))).toBeNull();
  });

  it('fails when they differ (case matters)', () => {
    expect(passwordsMatch(group('Password123', 'password123'))).toEqual({
      passwordMismatch: true,
    });
  });

  it('waits until confirm is filled in', () => {
    expect(passwordsMatch(group('Password123', ''))).toBeNull();
  });
});

describe('errorMessage', () => {
  it('returns null when there are no errors', () => {
    expect(errorMessage(null)).toBeNull();
  });

  it('shows "required" before anything else', () => {
    expect(errorMessage({ required: true, email: true })).toBe('This field is required.');
  });

  it('shows the server message as given', () => {
    expect(errorMessage({ server: 'This email is already registered.' })).toBe(
      'This email is already registered.',
    );
  });

  it.each([
    [{ nameTooShort: true }, 'at least 2'],
    [{ email: true }, 'valid email'],
    [{ phone: true }, 'valid phone'],
    [{ passwordTooShort: true }, 'at least 8'],
    [{ passwordTooLong: true }, 'at most 72'],
    [{ passwordNeedsLetter: true }, 'one letter'],
    [{ passwordNeedsNumber: true }, 'one number'],
    [{ somethingElse: true }, 'not valid'],
  ])('maps %j', (errors, text) => {
    expect(errorMessage(errors)).toContain(text);
  });
});
