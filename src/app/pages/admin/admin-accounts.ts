import { Component, effect, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, ValidatorFn } from '@angular/forms';
import { finalize } from 'rxjs';

import { AdminService } from '../../core/admin/admin.service';
import { parseApiError } from '../../core/api-error';
import {
  PASSWORD_MIN,
  emailValidator,
  errorMessage,
  passwordValidator,
  requiredTrimmed,
} from '../../core/auth/validators';
import { PasswordToggle } from '../../shared/password-toggle';

type Field = 'email' | 'newPassword' | 'confirmPassword';

const confirmMatches: ValidatorFn = (group) => {
  const next = group.get('newPassword')?.value as string;
  const confirm = group.get('confirmPassword')?.value as string;
  return confirm && next !== confirm ? { passwordMismatch: true } : null;
};

/** D-35: admin sets a new password for a doctor or patient who forgot theirs. */
@Component({
  selector: 'app-admin-accounts',
  imports: [ReactiveFormsModule, PasswordToggle],
  template: `
    <h2>Reset a password</h2>
    <p class="muted">
      For a doctor or patient who forgot their password. They are logged out everywhere; tell them
      the new password and ask them to change it after logging in. Admins change their own password
      on the Change password page.
    </p>

    @if (done(); as who) {
      <p class="alert alert-success" role="status" data-testid="reset-done">
        New password set for {{ who.name }} ({{ who.role.toLowerCase() }}).
      </p>
    }
    @if (formError()) {
      <p class="alert alert-error" role="alert" data-testid="form-error">{{ formError() }}</p>
    }

    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="account-form">
      <div class="field">
        <label for="reset-email">Account email</label>
        <input
          id="reset-email"
          type="email"
          formControlName="email"
          autocomplete="off"
          [attr.aria-invalid]="!!fieldError('email')"
          [attr.aria-describedby]="fieldError('email') ? 'reset-email-error' : null"
        />
        @if (fieldError('email'); as message) {
          <p id="reset-email-error" class="field-error">{{ message }}</p>
        }
      </div>

      <div class="field">
        <label for="reset-password">New password</label>
        <div class="password-field">
          <input
            id="reset-password"
            [type]="showNew() ? 'text' : 'password'"
            formControlName="newPassword"
            autocomplete="new-password"
            [attr.aria-invalid]="!!fieldError('newPassword')"
            [attr.aria-describedby]="
              fieldError('newPassword')
                ? 'reset-password-hint reset-password-error'
                : 'reset-password-hint'
            "
          />
          <app-password-toggle [(visible)]="showNew" controls="reset-password" />
        </div>
        <p id="reset-password-hint" class="hint">
          At least {{ passwordMin }} characters, with a letter and a number.
        </p>
        @if (fieldError('newPassword'); as message) {
          <p id="reset-password-error" class="field-error">{{ message }}</p>
        }
      </div>

      <div class="field">
        <label for="reset-confirm">Confirm new password</label>
        <div class="password-field">
          <input
            id="reset-confirm"
            [type]="showConfirm() ? 'text' : 'password'"
            formControlName="confirmPassword"
            autocomplete="new-password"
            [attr.aria-invalid]="!!fieldError('confirmPassword')"
            [attr.aria-describedby]="fieldError('confirmPassword') ? 'reset-confirm-error' : null"
          />
          <app-password-toggle [(visible)]="showConfirm" controls="reset-confirm" />
        </div>
        @if (fieldError('confirmPassword'); as message) {
          <p id="reset-confirm-error" class="field-error">{{ message }}</p>
        }
      </div>

      <button type="submit" class="btn btn-primary inline" [disabled]="submitting()">
        {{ submitting() ? 'Saving…' : 'Set new password' }}
      </button>
    </form>
  `,
  styleUrl: './admin.scss',
})
export class AdminAccounts {
  private readonly admin = inject(AdminService);

  /** Pre-filled from the doctor list ("Reset password"). */
  readonly email = input('');

  protected readonly passwordMin = PASSWORD_MIN;
  protected readonly showNew = signal(false);
  protected readonly showConfirm = signal(false);
  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly done = signal<{ name: string; role: string } | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      email: ['', [requiredTrimmed, emailValidator]],
      newPassword: ['', [requiredTrimmed, passwordValidator]],
      confirmPassword: ['', [requiredTrimmed]],
    },
    { validators: [confirmMatches] },
  );

  constructor() {
    effect(() => {
      const email = this.email();
      if (email) this.form.controls.email.setValue(email);
    });
  }

  protected fieldError(name: Field): string | null {
    const control = this.form.controls[name];
    if (!control.touched && !this.submitted()) return null;
    if (control.invalid) return errorMessage(control.errors);
    if (name === 'confirmPassword' && this.form.hasError('passwordMismatch')) {
      return 'Passwords do not match.';
    }
    return null;
  }

  protected submit(): void {
    this.submitted.set(true);
    this.formError.set(null);
    this.done.set(null);
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const { email, newPassword } = this.form.getRawValue();
    this.submitting.set(true);
    this.admin
      .resetPassword(email.trim(), newPassword)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (user) => {
          this.done.set({ name: user.name, role: user.role });
          this.submitted.set(false);
          this.form.reset();
          this.showNew.set(false);
          this.showConfirm.set(false);
        },
        error: (err: unknown) => {
          const parsed = parseApiError(err);
          for (const [field, message] of Object.entries(parsed.fieldErrors)) {
            const control = this.form.get(field);
            control?.setErrors({ ...control.errors, server: message });
          }
          this.formError.set(
            parsed.code === 'FORBIDDEN'
              ? 'Admin passwords cannot be reset here. Admins use the Change password page.'
              : parsed.message,
          );
        },
      });
  }
}
