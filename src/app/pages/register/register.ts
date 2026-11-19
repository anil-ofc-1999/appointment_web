import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { parseApiError } from '../../core/api-error';
import { RegisterRequest } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import {
  PASSWORD_MIN,
  emailValidator,
  errorMessage,
  nameValidator,
  passwordValidator,
  passwordsMatch,
  phoneValidator,
  requiredTrimmed,
} from '../../core/auth/validators';

type RegisterField = 'name' | 'email' | 'phone' | 'password' | 'confirmPassword';

/** Screen 1 (REQUIREMENTS §8): Register — FR-1.1 to FR-1.3. Patients only (FR-1.8). */
@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.html',
})
export class Register {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly passwordMin = PASSWORD_MIN;

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      name: ['', [requiredTrimmed, nameValidator]],
      email: ['', [requiredTrimmed, emailValidator]],
      phone: ['', [phoneValidator]],
      password: ['', [requiredTrimmed, passwordValidator]],
      confirmPassword: ['', [requiredTrimmed]],
    },
    { validators: [passwordsMatch] },
  );

  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected fieldError(name: RegisterField): string | null {
    const control = this.form.controls[name];
    const visible = control.touched || this.submitted();
    if (!visible) return null;
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

    const value = this.form.getRawValue();
    const request: RegisterRequest = {
      name: value.name.trim(),
      email: value.email.trim(),
      password: value.password,
    };
    if (value.phone.trim()) request.phone = value.phone.trim();

    this.submitting.set(true);
    this.auth
      .register(request)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (user) =>
          void this.router.navigate(['/login'], {
            queryParams: { registered: 1, email: user.email },
          }),
        error: (err: unknown) => {
          const parsed = parseApiError(err);
          for (const [field, message] of Object.entries(parsed.fieldErrors)) {
            const control = this.form.get(field);
            control?.setErrors({ ...control.errors, server: message });
          }
          if (parsed.code === 'EMAIL_TAKEN') {
            this.form.controls.email.setErrors({ server: 'This email is already registered.' });
          }
          this.formError.set(parsed.message);
        },
      });
  }
}
