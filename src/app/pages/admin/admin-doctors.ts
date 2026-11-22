import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AdminDoctor, AdminService, DoctorChanges } from '../../core/admin/admin.service';
import { parseApiError } from '../../core/api-error';
import {
  emailValidator,
  errorMessage,
  nameValidator,
  passwordValidator,
  requiredTrimmed,
} from '../../core/auth/validators';
import { Specialization } from '../../core/doctors/doctor.models';
import { PasswordToggle } from '../../shared/password-toggle';

/** Fee: 0 or more, at most 2 decimals (same as the API). */
const FEE = /^\d{1,8}(\.\d{1,2})?$/;

type DoctorField =
  'name' | 'email' | 'password' | 'specializationId' | 'fee' | 'slotMinutes' | 'bio';

/** FR-2.2 create / edit doctors, FR-2.3 activate / deactivate. */
@Component({
  selector: 'app-admin-doctors',
  imports: [ReactiveFormsModule, CurrencyPipe, PasswordToggle],
  templateUrl: './admin-doctors.html',
  styleUrl: './admin.scss',
})
export class AdminDoctors implements OnInit {
  private readonly admin = inject(AdminService);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly doctors = signal<AdminDoctor[]>([]);
  protected readonly specializations = signal<Specialization[]>([]);
  protected readonly activeSpecializations = computed(() =>
    this.specializations().filter((s) => s.isActive),
  );
  protected readonly state = signal<'loading' | 'loaded' | 'error'>('loading');
  protected readonly notice = signal<{ kind: 'success' | 'error'; text: string } | null>(null);
  protected readonly busyId = signal<number | null>(null);

  // ----- add doctor -----
  protected readonly showAdd = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly addSubmitted = signal(false);
  protected readonly adding = signal(false);
  protected readonly addForm = this.fb.group({
    name: ['', [requiredTrimmed, nameValidator]],
    email: ['', [requiredTrimmed, emailValidator]],
    password: ['', [requiredTrimmed, passwordValidator]],
    specializationId: ['', [Validators.required]],
    fee: ['', [requiredTrimmed, Validators.pattern(FEE)]],
    slotMinutes: ['30', [Validators.required]],
    bio: ['', [Validators.maxLength(2000)]],
  });

  // ----- edit doctor -----
  protected readonly editingId = signal<number | null>(null);
  protected readonly editForm = this.fb.group({
    name: ['', [requiredTrimmed, nameValidator]],
    specializationId: ['', [Validators.required]],
    fee: ['', [requiredTrimmed, Validators.pattern(FEE)]],
    slotMinutes: ['30', [Validators.required]],
    bio: ['', [Validators.maxLength(2000)]],
  });
  protected readonly editSubmitted = signal(false);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.admin.specializations().subscribe({
      next: (items) => this.specializations.set(items),
      error: () => this.specializations.set([]),
    });
    this.admin.doctors().subscribe({
      next: (page) => {
        this.doctors.set(page.items);
        this.state.set('loaded');
      },
      error: () => this.state.set('error'),
    });
  }

  protected addError(field: DoctorField): string | null {
    const control = this.addForm.get(field);
    if (!control || !control.invalid || !(control.touched || this.addSubmitted())) return null;
    if (field === 'fee' && control.hasError('pattern'))
      return 'Enter an amount like 500 or 499.50.';
    if (field === 'bio' && control.hasError('maxlength')) return 'At most 2000 characters.';
    return errorMessage(control.errors);
  }

  protected editError(field: Exclude<DoctorField, 'email' | 'password'>): string | null {
    const control = this.editForm.get(field);
    if (!control || !control.invalid || !(control.touched || this.editSubmitted())) return null;
    if (field === 'fee' && control.hasError('pattern'))
      return 'Enter an amount like 500 or 499.50.';
    return errorMessage(control.errors);
  }

  protected toggleAdd(): void {
    this.showAdd.update((v) => !v);
    this.addSubmitted.set(false);
    this.notice.set(null);
  }

  protected addDoctor(): void {
    this.addSubmitted.set(true);
    if (this.addForm.invalid || this.adding()) {
      this.addForm.markAllAsTouched();
      return;
    }
    const v = this.addForm.getRawValue();
    this.adding.set(true);
    this.admin
      .createDoctor({
        name: v.name.trim(),
        email: v.email.trim(),
        password: v.password,
        specializationId: Number(v.specializationId),
        fee: Number(v.fee),
        slotMinutes: v.slotMinutes === '15' ? 15 : 30,
        ...(v.bio.trim() ? { bio: v.bio.trim() } : {}),
      })
      .subscribe({
        next: (doctor) => {
          this.adding.set(false);
          this.showAdd.set(false);
          this.addForm.reset({ slotMinutes: '30' });
          this.addSubmitted.set(false);
          this.notice.set({
            kind: 'success',
            text: `${doctor.name} was added. They can log in with ${doctor.email}.`,
          });
          this.load();
        },
        error: (err: unknown) => {
          this.adding.set(false);
          const parsed = parseApiError(err);
          for (const [field, message] of Object.entries(parsed.fieldErrors)) {
            this.addForm.get(field)?.setErrors({ server: message });
          }
          if (parsed.code === 'EMAIL_TAKEN') {
            this.addForm.controls.email.setErrors({ server: 'This email is already used.' });
          }
          this.notice.set({ kind: 'error', text: parsed.message });
        },
      });
  }

  protected startEdit(d: AdminDoctor): void {
    this.notice.set(null);
    this.editSubmitted.set(false);
    this.editingId.set(d.id);
    this.editForm.reset({
      name: d.name,
      specializationId: String(d.specialization.id),
      fee: String(d.fee),
      slotMinutes: String(d.slotMinutes),
      bio: d.bio ?? '',
    });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
  }

  protected saveEdit(d: AdminDoctor): void {
    this.editSubmitted.set(true);
    if (this.editForm.invalid || this.busyId() !== null) {
      this.editForm.markAllAsTouched();
      return;
    }
    const v = this.editForm.getRawValue();
    const changes: DoctorChanges = {};
    if (v.name.trim() !== d.name) changes.name = v.name.trim();
    if (Number(v.specializationId) !== d.specialization.id) {
      changes.specializationId = Number(v.specializationId);
    }
    if (Number(v.fee) !== d.fee) changes.fee = Number(v.fee);
    if (Number(v.slotMinutes) !== d.slotMinutes)
      changes.slotMinutes = v.slotMinutes === '15' ? 15 : 30;
    if ((v.bio.trim() || null) !== d.bio) changes.bio = v.bio.trim() || null;

    if (Object.keys(changes).length === 0) {
      this.editingId.set(null);
      return;
    }
    this.update(d, changes, `${v.name.trim()} was updated.`, () => this.editingId.set(null));
  }

  /** FR-2.3: inactive doctors are hidden from patients and cannot be booked. */
  protected toggleActive(d: AdminDoctor): void {
    this.update(
      d,
      { isActive: !d.isActive },
      d.isActive
        ? `${d.name} is now inactive: hidden from patients, existing bookings are kept.`
        : `${d.name} is active again.`,
    );
  }

  private update(d: AdminDoctor, changes: DoctorChanges, success: string, done?: () => void): void {
    if (this.busyId() !== null) return;
    this.busyId.set(d.id);
    this.notice.set(null);
    this.admin.updateDoctor(d.id, changes).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.doctors.update((list) => list.map((x) => (x.id === updated.id ? updated : x)));
        this.notice.set({ kind: 'success', text: success });
        done?.();
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.notice.set({ kind: 'error', text: parseApiError(err).message });
      },
    });
  }
}
