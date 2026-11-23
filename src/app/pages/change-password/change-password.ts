import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, ValidatorFn } from '@angular/forms';
import { finalize } from 'rxjs';

import { parseApiError } from '../../core/api-error';
import { AuthService } from '../../core/auth/auth.service';
import {
  PASSWORD_MIN,
  errorMessage,
  passwordValidator,
  requiredTrimmed,
} from '../../core/auth/validators';
import { PasswordToggle } from '../../shared/password-toggle';

type Field = 'currentPassword' | 'newPassword' | 'confirmPassword';

/** New password must equal its confirmation and differ from the current one. */
const newPasswordChecks: ValidatorFn = (group) => {
  const current = group.get('currentPassword')?.value as string;
  const next = group.get('newPassword')?.value as string;
  const confirm = group.get('confirmPassword')?.value as string;
  const errors: Record<string, true> = {};
  if (next && current && next === current) errors['samePassword'] = true;
  if (confirm && next !== confirm) errors['passwordMismatch'] = true;
  return Object.keys(errors).length ? errors : null;
};

/** D-32: any logged-in user changes their own password. Other sessions are signed out. */
@Component({
  selector: 'app-change-password',
  imports: [ReactiveFormsModule, PasswordToggle],
  templateUrl: './change-password.html',
})
export class ChangePassword {
  private readonly auth = inject(AuthService);

  protected readonly passwordMin = PASSWORD_MIN;
  protected readonly showCurrent = signal(false);
  protected readonly showNew = signal(false);
  protected readonly showConfirm = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      currentPassword: ['', [requiredTrimmed]],
      newPassword: ['', [requiredTrimmed, passwordValidator]],
      confirmPassword: ['', [requiredTrimmed]],
    },
    { validators: [newPasswordChecks] },
  );

  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly done = signal(false);

  protected fieldError(name: Field): string | null {
    const control = this.form.controls[name];
    if (!control.touched && !this.submitted()) return null;
    if (control.invalid) return errorMessage(control.errors);
    if (name === 'newPassword' && this.form.hasError('samePassword')) {
      return 'The new password must be different from the current one.';
    }
    if (name === 'confirmPassword' && this.form.hasError('passwordMismatch')) {
      return 'Passwords do not match.';
    }
    return null;
  }

  protected submit(): void {
    this.submitted.set(true);
    this.formError.set(null);
    this.done.set(false);
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const { currentPassword, newPassword } = this.form.getRawValue();
    this.submitting.set(true);
    this.auth
      .changePassword({ currentPassword, newPassword })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => {
          this.done.set(true);
          this.submitted.set(false);
          this.form.reset();
          this.showCurrent.set(false);
          this.showNew.set(false);
          this.showConfirm.set(false);
        },
        error: (err: unknown) => {
          const parsed = parseApiError(err);
          for (const [field, message] of Object.entries(parsed.fieldErrors)) {
            const control = this.form.get(field);
            control?.setErrors({ ...control.errors, server: message });
          }
          this.formError.set(parsed.message);
        },
      });
  }
}
