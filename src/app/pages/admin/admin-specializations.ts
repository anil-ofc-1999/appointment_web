import { Component, OnInit, inject, signal } from '@angular/core';

import { AdminService } from '../../core/admin/admin.service';
import { parseApiError } from '../../core/api-error';
import { Specialization } from '../../core/doctors/doctor.models';

const NAME_MIN = 2;
const NAME_MAX = 100;

/** Same rule as the API: 2–100 characters after trimming. */
function nameProblem(name: string): string | null {
  const value = name.trim();
  if (!value) return 'Enter a name.';
  if (value.length < NAME_MIN) return `At least ${NAME_MIN} characters.`;
  if (value.length > NAME_MAX) return `At most ${NAME_MAX} characters.`;
  return null;
}

/** FR-2.1: create, rename, activate / deactivate specializations. */
@Component({
  selector: 'app-admin-specializations',
  template: `
    <h2>Specializations</h2>

    <form class="inline-form" (submit)="add($event)">
      <div class="field">
        <label for="new-specialization-name">New specialization</label>
        <input
          id="new-specialization-name"
          [value]="newName()"
          (input)="newName.set($any($event.target).value)"
          maxlength="100"
        />
      </div>
      <button type="submit" class="btn btn-primary inline" [disabled]="saving()">Add</button>
    </form>

    @if (notice(); as n) {
      <p
        class="alert"
        [class.alert-success]="n.kind === 'success'"
        [class.alert-error]="n.kind === 'error'"
        role="status"
        data-testid="specializations-notice"
      >
        {{ n.text }}
      </p>
    }

    @switch (state()) {
      @case ('loading') {
        <p class="muted" role="status">Loading specializations…</p>
      }
      @case ('error') {
        <div class="alert alert-error" role="alert" data-testid="admin-specializations-error">
          <p>Could not load specializations.</p>
          <button type="button" class="btn btn-secondary" (click)="load()">Try again</button>
        </div>
      }
      @case ('loaded') {
        @if (items().length === 0) {
          <p class="empty" data-testid="no-specializations">No specializations yet.</p>
        } @else {
          <ul class="spec-list">
            @for (s of items(); track s.id) {
              <li data-testid="admin-specialization" [attr.data-id]="s.id">
                @if (renamingId() === s.id) {
                  <form class="inline-form" (submit)="saveRename($event, s)">
                    <div class="field">
                      <label [for]="'rename-' + s.id">Name</label>
                      <input
                        [id]="'rename-' + s.id"
                        [value]="renameValue()"
                        (input)="renameValue.set($any($event.target).value)"
                        maxlength="100"
                      />
                    </div>
                    <button
                      type="submit"
                      class="btn btn-primary inline"
                      [disabled]="busyId() === s.id"
                    >
                      Save
                    </button>
                    <button type="button" class="btn btn-secondary" (click)="renamingId.set(null)">
                      Cancel
                    </button>
                  </form>
                } @else {
                  <span class="name">{{ s.name }}</span>
                  <span
                    class="status"
                    [attr.data-status]="s.isActive ? 'ACTIVE' : 'INACTIVE'"
                    data-testid="specialization-state"
                    >{{ s.isActive ? 'Active' : 'Inactive' }}</span
                  >
                  <span class="row-actions">
                    <button type="button" class="btn btn-secondary" (click)="startRename(s)">
                      Rename
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="busyId() === s.id"
                      (click)="toggleActive(s)"
                    >
                      {{ s.isActive ? 'Deactivate' : 'Activate' }}
                    </button>
                  </span>
                }
              </li>
            }
          </ul>
        }
      }
    }
  `,
  styleUrl: './admin.scss',
})
export class AdminSpecializations implements OnInit {
  private readonly admin = inject(AdminService);

  protected readonly items = signal<Specialization[]>([]);
  protected readonly state = signal<'loading' | 'loaded' | 'error'>('loading');
  protected readonly notice = signal<{ kind: 'success' | 'error'; text: string } | null>(null);
  protected readonly newName = signal('');
  protected readonly saving = signal(false);
  protected readonly renamingId = signal<number | null>(null);
  protected readonly renameValue = signal('');
  protected readonly busyId = signal<number | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.admin.specializations().subscribe({
      next: (items) => {
        this.items.set(items);
        this.state.set('loaded');
      },
      error: () => this.state.set('error'),
    });
  }

  protected add(event: Event): void {
    event.preventDefault();
    const problem = nameProblem(this.newName());
    if (problem) {
      this.notice.set({ kind: 'error', text: problem });
      return;
    }
    if (this.saving()) return;
    this.saving.set(true);
    this.notice.set(null);
    this.admin.createSpecialization(this.newName().trim()).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.newName.set('');
        this.notice.set({ kind: 'success', text: `${created.name} was added.` });
        this.load();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.notice.set({ kind: 'error', text: this.message(err) });
      },
    });
  }

  protected startRename(s: Specialization): void {
    this.notice.set(null);
    this.renameValue.set(s.name);
    this.renamingId.set(s.id);
  }

  protected saveRename(event: Event, s: Specialization): void {
    event.preventDefault();
    const name = this.renameValue().trim();
    const problem = nameProblem(name);
    if (problem) {
      this.notice.set({ kind: 'error', text: problem });
      return;
    }
    if (name === s.name) {
      this.renamingId.set(null);
      return;
    }
    this.change(s, { name }, `Renamed to ${name}.`, () => this.renamingId.set(null));
  }

  /** Deactivating hides the specialization and its doctors from patients. */
  protected toggleActive(s: Specialization): void {
    this.change(
      s,
      { isActive: !s.isActive },
      s.isActive
        ? `${s.name} is now inactive: it and its doctors are hidden from patients.`
        : `${s.name} is active again.`,
    );
  }

  private change(
    s: Specialization,
    changes: Partial<Pick<Specialization, 'name' | 'isActive'>>,
    success: string,
    done?: () => void,
  ): void {
    if (this.busyId() !== null) return;
    this.busyId.set(s.id);
    this.notice.set(null);
    this.admin.updateSpecialization(s.id, changes).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.items.update((list) =>
          list
            .map((x) => (x.id === updated.id ? updated : x))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        this.notice.set({ kind: 'success', text: success });
        done?.();
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.notice.set({ kind: 'error', text: this.message(err) });
      },
    });
  }

  private message(err: unknown): string {
    const parsed = parseApiError(err);
    return parsed.code === 'SPECIALIZATION_EXISTS'
      ? 'A specialization with this name already exists.'
      : parsed.message;
  }
}
