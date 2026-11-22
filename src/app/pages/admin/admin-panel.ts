import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { AdminAppointments } from './admin-appointments';
import { AdminDoctors } from './admin-doctors';
import { AdminSpecializations } from './admin-specializations';

type Tab = 'appointments' | 'doctors' | 'specializations';

/** Screen 7 (REQUIREMENTS §8): Admin panel — doctors, specializations, all appointments. */
@Component({
  selector: 'app-admin-panel',
  imports: [AdminAppointments, AdminDoctors, AdminSpecializations],
  template: `
    <section class="admin">
      <h1>Admin panel</h1>
      <div class="tabs" role="tablist" aria-label="Admin">
        @for (t of tabs; track t.id) {
          <button
            type="button"
            role="tab"
            [id]="'tab-' + t.id"
            [attr.aria-selected]="activeTab() === t.id"
            [class.active]="activeTab() === t.id"
            (click)="show(t.id)"
          >
            {{ t.label }}
          </button>
        }
      </div>
      <div role="tabpanel" [attr.aria-labelledby]="'tab-' + activeTab()">
        @switch (activeTab()) {
          @case ('doctors') {
            <app-admin-doctors />
          }
          @case ('specializations') {
            <app-admin-specializations />
          }
          @default {
            <app-admin-appointments />
          }
        }
      </div>
    </section>
  `,
  styleUrl: './admin.scss',
})
export class AdminPanel {
  private readonly router = inject(Router);

  /** Query param ?tab=. */
  readonly tab = input<string>();

  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'appointments', label: 'Appointments' },
    { id: 'doctors', label: 'Doctors' },
    { id: 'specializations', label: 'Specializations' },
  ];

  protected readonly activeTab = computed<Tab>(() =>
    this.tab() === 'doctors' || this.tab() === 'specializations'
      ? (this.tab() as Tab)
      : 'appointments',
  );

  protected show(tab: Tab): void {
    // Each tab keeps its own filters only while open: start clean when switching.
    void this.router.navigate([], { queryParams: { tab: tab === 'appointments' ? null : tab } });
  }
}
