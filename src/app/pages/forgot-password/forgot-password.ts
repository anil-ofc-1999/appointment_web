import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { parseApiError } from '../../core/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { emailValidator, errorMessage, requiredTrimmed } from '../../core/auth/validators';

/** D-37: ask for a password reset link by email. */
@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <section class="auth-card">
      <h1>Forgot password</h1>

      @if (sent()) {
        <p class="alert alert-success" role="status" data-testid="reset-sent">
          If an account exists for {{ sent() }}, we have sent it a link to choose a new password.
          The link works once, for 30 minutes. Check your spam folder too.
        </p>
        <p class="switch"><a routerLink="/login">Back to log in</a></p>
      } @else {
        <p class="hint">Type the email you log in with. We will send you a link.</p>

        @if (formError()) {
          <p class="alert alert-error" role="alert" data-testid="form-error">{{ formError() }}</p>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label for="forgot-email">Email</label>
            <input
              id="forgot-email"
              type="email"
              formControlName="email"
              autocomplete="email"
              [attr.aria-invalid]="!!fieldError()"
              [attr.aria-describedby]="fieldError() ? 'forgot-email-error' : null"
            />
            @if (fieldError(); as message) {
              <p id="forgot-email-error" class="field-error">{{ message }}</p>
            }
          </div>

          <button type="submit" class="btn btn-primary" [disabled]="submitting()">
            {{ submitting() ? 'Sending…' : 'Send reset link' }}
          </button>
        </form>

        <p class="switch"><a routerLink="/login">Back to log in</a></p>
      }
    </section>
  `,
})
export class ForgotPassword {
  private readonly auth = inject(AuthService);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [requiredTrimmed, emailValidator]],
  });
  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly formError = signal<string | null>(null);
  /** The email the link was requested for (shown in the confirmation). */
  protected readonly sent = signal<string | null>(null);

  protected fieldError(): string | null {
    const control = this.form.controls.email;
    if (!control.touched && !this.submitted()) return null;
    return control.invalid ? errorMessage(control.errors) : null;
  }

  protected submit(): void {
    this.submitted.set(true);
    this.formError.set(null);
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    const email = this.form.getRawValue().email.trim();
    this.submitting.set(true);
    this.auth
      .forgotPassword(email)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => this.sent.set(email),
        error: (err: unknown) => {
          const parsed = parseApiError(err);
          this.formError.set(
            parsed.code === 'TOO_MANY_REQUESTS'
              ? 'Too many requests. Please wait a minute and try again.'
              : parsed.message,
          );
        },
      });
  }
}
