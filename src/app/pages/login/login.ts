import { Component, OnInit, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { parseApiError } from '../../core/api-error';
import { safeReturnUrl } from '../../core/auth/auth.guards';
import { AuthService } from '../../core/auth/auth.service';
import { emailValidator, errorMessage, requiredTrimmed } from '../../core/auth/validators';
import { PasswordToggle } from '../../shared/password-toggle';

type LoginField = 'email' | 'password';

/** Screen 1 (REQUIREMENTS §8): Login — FR-1.5. */
@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, PasswordToggle],
  templateUrl: './login.html',
})
export class Login implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Query params, bound by withComponentInputBinding(). */
  readonly returnUrl = input<string>();
  readonly reason = input<string>();
  readonly registered = input<string>();
  readonly email = input<string>();

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [requiredTrimmed, emailValidator]],
    password: ['', [requiredTrimmed]],
  });

  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly showPassword = signal(false);

  ngOnInit(): void {
    // Pre-fill the email after registering (?email=...).
    const email = this.email();
    if (email) this.form.controls.email.setValue(email);
  }

  protected fieldError(name: LoginField): string | null {
    const control = this.form.controls[name];
    return control.invalid && (control.touched || this.submitted())
      ? errorMessage(control.errors)
      : null;
  }

  protected submit(): void {
    this.submitted.set(true);
    this.formError.set(null);
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const { email, password } = this.form.getRawValue();
    this.submitting.set(true);
    this.auth
      .login({ email: email.trim(), password })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => void this.router.navigateByUrl(safeReturnUrl(this.returnUrl())),
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
