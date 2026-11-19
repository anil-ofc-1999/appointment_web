import { CurrencyPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { Subject, catchError, combineLatest, map, of, startWith, switchMap, tap } from 'rxjs';

import { parseApiError } from '../../core/api-error';
import {
  addDays,
  bookableDateOrToday,
  bookableRange,
  formatLongDate,
  formatShortDate,
  isValidDate,
  partOfDay,
} from '../../core/clinic-date';
import { Doctor, Slot, SlotsResponse } from '../../core/doctors/doctor.models';
import { DoctorService } from '../../core/doctors/doctor.service';

type DoctorState = 'loading' | 'loaded' | 'not-found' | 'error';
type SlotsState = 'loading' | 'loaded' | 'error';

/** How many quick-pick day buttons to show (any date up to 30 days via the date input). */
const QUICK_DAYS = 7;

/** Screen 3 (REQUIREMENTS §8): Doctor detail + date picker + slot grid — FR-3.3 to FR-3.5. */
@Component({
  selector: 'app-doctor-detail',
  imports: [RouterLink, CurrencyPipe],
  templateUrl: './doctor-detail.html',
  styleUrl: './doctor-detail.scss',
})
export class DoctorDetail {
  private readonly doctors = inject(DoctorService);
  private readonly router = inject(Router);

  /** Route param :id and query param ?date=, bound by withComponentInputBinding(). */
  readonly id = input<string>();
  readonly date = input<string>();

  private readonly retrySlots$ = new Subject<void>();
  private readonly retryDoctor$ = new Subject<void>();

  protected readonly range = bookableRange();
  protected readonly doctorId = computed(() => {
    const raw = this.id() ?? '';
    const n = Number(raw);
    return /^\d+$/.test(raw) && Number.isSafeInteger(n) && n > 0 ? n : null;
  });
  /** Invalid or out-of-range ?date= falls back to today. */
  protected readonly selectedDate = computed(() => bookableDateOrToday(this.date()));
  protected readonly quickDays = computed(() =>
    Array.from({ length: QUICK_DAYS }, (_, i) => {
      const value = addDays(this.range.min, i);
      return { value, label: i === 0 ? 'Today' : formatShortDate(value) };
    }),
  );
  protected readonly selectedDateLabel = computed(() => formatLongDate(this.selectedDate()));

  protected readonly doctorState = signal<DoctorState>('loading');
  protected readonly doctor = signal<Doctor | null>(null);
  protected readonly doctorError = signal<string | null>(null);

  protected readonly slotsState = signal<SlotsState>('loading');
  protected readonly slotsResult = signal<SlotsResponse | null>(null);
  protected readonly slotsError = signal<string | null>(null);
  protected readonly selectedSlot = signal<Slot | null>(null);

  protected readonly availableCount = computed(
    () => this.slotsResult()?.slots.filter((s) => s.status === 'AVAILABLE').length ?? 0,
  );
  protected readonly slotGroups = computed(() => {
    const groups = new Map<string, Slot[]>();
    for (const slot of this.slotsResult()?.slots ?? []) {
      const name = partOfDay(slot.time);
      groups.set(name, [...(groups.get(name) ?? []), slot]);
    }
    return [...groups].map(([name, slots]) => ({ name, slots }));
  });

  constructor() {
    combineLatest([toObservable(this.doctorId), this.retryDoctor$.pipe(startWith(undefined))])
      .pipe(
        map(([id]) => id),
        switchMap((id) => this.loadDoctor(id)),
        takeUntilDestroyed(),
      )
      .subscribe();

    combineLatest([
      toObservable(this.doctorId),
      toObservable(this.selectedDate),
      this.retrySlots$.pipe(startWith(undefined)),
    ])
      .pipe(
        switchMap(([id, date]) => this.loadSlots(id, date)),
        takeUntilDestroyed(),
      )
      .subscribe();

    // A new date clears the chosen slot.
    effect(() => {
      this.selectedDate();
      this.selectedSlot.set(null);
    });
  }

  protected chooseDate(value: string): void {
    if (!isValidDate(value) || value < this.range.min || value > this.range.max) return;
    void this.router.navigate([], {
      queryParams: { date: value === this.range.min ? null : value },
      queryParamsHandling: 'merge',
    });
  }

  protected chooseSlot(slot: Slot): void {
    if (slot.status !== 'AVAILABLE') return;
    this.selectedSlot.set(slot);
  }

  protected continueToBooking(): void {
    const slot = this.selectedSlot();
    const id = this.doctorId();
    if (!slot || !id) return;
    void this.router.navigate(['/doctors', id, 'book'], { queryParams: { startAt: slot.startAt } });
  }

  protected retrySlots(): void {
    this.retrySlots$.next();
  }

  protected retryDoctor(): void {
    this.retryDoctor$.next();
  }

  private loadDoctor(id: number | null) {
    this.doctor.set(null);
    this.doctorError.set(null);
    if (id === null) {
      this.doctorState.set('not-found');
      return of(null);
    }
    this.doctorState.set('loading');
    return this.doctors.doctor(id).pipe(
      tap((doctor) => {
        this.doctor.set(doctor);
        this.doctorState.set('loaded');
      }),
      catchError((err: unknown) => {
        const parsed = parseApiError(err);
        if (parsed.code === 'DOCTOR_NOT_FOUND' || parsed.code === 'VALIDATION_ERROR') {
          this.doctorState.set('not-found');
        } else {
          this.doctorError.set(parsed.message);
          this.doctorState.set('error');
        }
        return of(null);
      }),
    );
  }

  private loadSlots(id: number | null, date: string) {
    this.slotsResult.set(null);
    this.slotsError.set(null);
    if (id === null) return of(null);
    this.slotsState.set('loading');
    return this.doctors.slots(id, date).pipe(
      tap((result) => {
        this.slotsResult.set(result);
        this.slotsState.set('loaded');
      }),
      catchError((err: unknown) => {
        this.slotsError.set(parseApiError(err).message);
        this.slotsState.set('error');
        return of(null);
      }),
    );
  }
}
