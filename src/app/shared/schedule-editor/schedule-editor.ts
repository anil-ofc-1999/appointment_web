import { Component, OnInit, computed, input, signal } from '@angular/core';
import { Observable } from 'rxjs';

import { parseApiError } from '../../core/api-error';
import { ScheduleBlock, WEEKDAYS } from '../../core/doctors/doctor-self.service';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Where the editor loads from and saves to (the doctor's own hours, or an admin's view). */
export interface ScheduleSource {
  load(): Observable<ScheduleBlock[]>;
  save(blocks: ScheduleBlock[]): Observable<ScheduleBlock[]>;
}

/**
 * Weekly schedule editor (FR-3.1, FR-3.2, FR-3.6): add / remove blocks locally, then save
 * everything at once. Used by the doctor dashboard and by Admin → Doctors (D-36).
 */
@Component({
  selector: 'app-schedule-editor',
  templateUrl: './schedule-editor.html',
  styleUrl: './schedule-editor.scss',
})
export class ScheduleEditor implements OnInit {
  readonly source = input.required<ScheduleSource>();
  /** "your" for the doctor, "this doctor's" for the admin (used in messages). */
  readonly whose = input('your');

  protected readonly weekdays = WEEKDAYS;
  /** Times in 15-minute steps (dropdowns work better on phones). */
  protected readonly times = Array.from({ length: 96 }, (_, i) => {
    const minutes = i * 15;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  });

  protected readonly blocks = signal<ScheduleBlock[]>([]);
  protected readonly state = signal<'loading' | 'loaded' | 'error'>('loading');
  protected readonly message = signal<{ kind: 'success' | 'error'; text: string } | null>(null);
  protected readonly saving = signal(false);
  protected readonly dirty = signal(false);
  protected readonly newBlock = signal<ScheduleBlock>({
    dayOfWeek: 1,
    startTime: '10:00',
    endTime: '13:00',
  });
  protected readonly newBlockError = signal<string | null>(null);
  protected readonly blocksByDay = computed(() =>
    WEEKDAYS.map((name, dayOfWeek) => ({
      name,
      dayOfWeek,
      blocks: this.blocks()
        .map((b, index) => ({ ...b, index }))
        .filter((b) => b.dayOfWeek === dayOfWeek)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    })),
  );

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.source()
      .load()
      .subscribe({
        next: (blocks) => {
          this.blocks.set(blocks);
          this.dirty.set(false);
          this.state.set('loaded');
        },
        error: () => this.state.set('error'),
      });
  }

  protected setNewBlock(field: keyof ScheduleBlock, value: string): void {
    this.newBlock.update((b) => ({ ...b, [field]: field === 'dayOfWeek' ? Number(value) : value }));
    this.newBlockError.set(null);
  }

  /** Adds the block locally after checking it; "Save schedule" sends everything. */
  protected addBlock(): void {
    const block = this.newBlock();
    if (!TIME.test(block.startTime) || !TIME.test(block.endTime)) {
      this.newBlockError.set('Use times like 09:30 (24-hour).');
      return;
    }
    if (block.endTime <= block.startTime) {
      this.newBlockError.set('End time must be after start time.');
      return;
    }
    const overlaps = this.blocks().some(
      (b) =>
        b.dayOfWeek === block.dayOfWeek &&
        block.startTime < b.endTime &&
        b.startTime < block.endTime,
    );
    if (overlaps) {
      this.newBlockError.set(`This overlaps another block on ${WEEKDAYS[block.dayOfWeek]}.`);
      return;
    }
    this.blocks.update((list) => [...list, { ...block }]);
    this.dirty.set(true);
    this.message.set(null);
  }

  protected removeBlock(index: number): void {
    this.blocks.update((list) => list.filter((_, i) => i !== index));
    this.dirty.set(true);
    this.message.set(null);
  }

  protected save(): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.message.set(null);
    this.source()
      .save(this.blocks())
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.blocks.set(saved);
          this.dirty.set(false);
          this.message.set({
            kind: 'success',
            text: 'Schedule saved. Existing bookings are kept.',
          });
        },
        error: (err: unknown) => {
          this.saving.set(false);
          const parsed = parseApiError(err);
          this.message.set({
            kind: 'error',
            text:
              parsed.code === 'SCHEDULE_OVERLAP'
                ? 'Some blocks on the same day overlap. Please fix them and save again.'
                : parsed.message,
          });
        },
      });
  }

  protected discard(): void {
    this.message.set(null);
    this.load();
  }
}
