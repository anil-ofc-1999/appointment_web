import { Component, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, ValidatorFn } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
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

type Field = 'newPassword' | 'confirmPassword';

const confirmMatches: ValidatorFn = (group) => {
  const next = group.get('newPassword')?.value as string;
  const confirm = group.get('confirmPassword')?.value as string;
  return confirm && next !== confirm ? { passwordMismatch: true } : null;
};

/** D-37: the page the emailed link opens: /reset-password?token=... */
@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink, PasswordToggle],
  template: `
    <section class="auth-card">
      <h1>Set a new password</h1>

      @if (!hasToken() || linkInvalid()) {
        <p class="alert alert-error" role="alert" data-testid="invalid-link">
          This reset link has expired or was already used. Please ask for a new one.
        </p>
        <p class="switch"><a routerLink="/forgot-password">Ask for a new link</a></p>
      } @else {
        @if (formError()) {
          <p class="alert alert-error" role="alert" data-testid="form-error">{{ formError() }}</p>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label for="reset-new">New password</label>
            <div class="password-field">
              <input
                id="reset-new"
                [type]="showNew() ? 'text' : 'password'"
                formControlName="newPassword"
                autocomplete="new-password"
                [attr.aria-invalid]="!!fieldError('newPassword')"
                [attr.aria-describedby]="
                  fieldError('newPassword') ? 'reset-new-hint reset-new-error' : 'reset-new-hint'
                "
              />
              <app-password-toggle [(visible)]="showNew" controls="reset-new" />
            </div>
            <p id="reset-new-hint" class="hint">
              At least {{ passwordMin }} characters, with a letter and a number.
            </p>
            @if (fieldError('newPassword'); as message) {
              <p id="reset-new-error" class="field-error">{{ message }}</p>
            }
          </div>

          <div class="field">
            <label for="reset-confirm-new">Confirm new password</label>
            <div class="password-field">
              <input
                id="reset-confirm-new"
                [type]="showConfirm() ? 'text' : 'password'"
                formControlName="confirmPassword"
                autocomplete="new-password"
                [attr.aria-invalid]="!!fieldError('confirmPassword')"
                [attr.aria-describedby]="
                  fieldError('confirmPassword') ? 'reset-confirm-new-error' : null
                "
              />
              <app-password-toggle [(visible)]="showConfirm" controls="reset-confirm-new" />
            </div>
            @if (fieldError('confirmPassword'); as message) {
              <p id="reset-confirm-new-error" class="field-error">{{ message }}</p>
            }
          </div>

          <button type="submit" class="btn btn-primary" [disabled]="submitting()">
            {{ submitting() ? 'Saving…' : 'Save new password' }}
          </button>
        </form>
      }
    </section>
  `,
})
export class ResetPassword {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Query param ?token= from the emailed link. */
  readonly token = input<string>();

  protected readonly passwordMin = PASSWORD_MIN;
  protected readonly hasToken = computed(() => (this.token() ?? '').length >= 20);
  protected readonly linkInvalid = signal(false);
  protected readonly showNew = signal(false);
  protected readonly showConfirm = signal(false);
  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      newPassword: ['', [requiredTrimmed, passwordValidator]],
      confirmPassword: ['', [requiredTrimmed]],
    },
    { validators: [confirmMatches] },
  );

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
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.auth
      .resetPassword(this.token()!, this.form.getRawValue().newPassword)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () =>
          void this.router.navigate(['/login'], { queryParams: { reason: 'password-reset' } }),
        error: (err: unknown) => {
          const parsed = parseApiError(err);
          if (parsed.code === 'INVALID_RESET_LINK') {
            this.linkInvalid.set(true);
            return;
          }
          for (const [field, message] of Object.entries(parsed.fieldErrors)) {
            const control = this.form.get(field);
            control?.setErrors({ ...control.errors, server: message });
          }
          this.formError.set(parsed.message);
        },
      });
  }
}
