import { CurrencyPipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationStart, Router, RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, filter, map, merge, of, switchMap, tap, timer } from 'rxjs';

import { parseApiError } from '../../core/api-error';
import {
  Doctor,
  DoctorSearchCriteria,
  Page,
  Specialization,
} from '../../core/doctors/doctor.models';
import {
  DoctorService,
  SEARCH_MAX_LENGTH,
  criteriaFromParams,
  paramsFromCriteria,
} from '../../core/doctors/doctor.service';

type LoadState = 'loading' | 'loaded' | 'error';

/** Screen 2 (REQUIREMENTS §8): Doctor search — FR-2.4, FR-2.5. */
@Component({
  selector: 'app-doctor-search',
  imports: [RouterLink, CurrencyPipe],
  templateUrl: './doctor-search.html',
  styleUrl: './doctor-search.scss',
})
export class DoctorSearch implements OnInit {
  private readonly doctors = inject(DoctorService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Typing in the search box; debounced before it reaches the URL. */
  private readonly typed$ = new Subject<string | null>();
  /** Bumped by "Try again" to reload the same criteria. */
  private readonly retry$ = new Subject<void>();

  protected readonly searchMaxLength = SEARCH_MAX_LENGTH;
  protected readonly criteria = signal<DoctorSearchCriteria>({
    search: '',
    specializationId: null,
    page: 1,
  });
  protected readonly searchText = signal('');
  protected readonly specializations = signal<Specialization[]>([]);
  protected readonly specializationsError = signal(false);
  protected readonly state = signal<LoadState>('loading');
  protected readonly result = signal<Page<Doctor> | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly hasFilters = computed(
    () => !!this.criteria().search || this.criteria().specializationId !== null,
  );
  protected readonly selectedSpecializationName = computed(
    () =>
      this.specializations().find((s) => s.id === this.criteria().specializationId)?.name ?? null,
  );

  ngOnInit(): void {
    // Leaving this page (e.g. clicking a doctor) drops pending typed text: a late timer
    // would otherwise navigate back to /doctors?q=... and cancel the user's navigation.
    this.router.events
      .pipe(
        filter((e): e is NavigationStart => e instanceof NavigationStart),
        filter((e) => e.url.split('?')[0] !== '/doctors'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.typed$.next(null));

    this.doctors
      .specializations()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => this.specializations.set(items),
        error: () => this.specializationsError.set(true),
      });

    this.typed$
      .pipe(
        // null = an explicit action (Enter, Clear filters, specialization, page) happened:
        // drop any pending typed text so it cannot fire later and undo that action.
        switchMap((text) => (text === null ? EMPTY : timer(300).pipe(map(() => text.trim())))),
        // Compare with the search that is ACTIVE now, not the last typed value:
        // - after Enter the same search is already done -> no extra navigation
        //   (an extra one could cancel a redirect to /login after a 401);
        // - after "Clear filters", typing the same text again must search again.
        filter((search) => search !== this.criteria().search),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((search) => this.navigate({ search, page: 1 }));

    // The URL is the single source of truth: reload / back / shared links all work.
    const fromUrl$ = this.route.queryParamMap.pipe(
      map(criteriaFromParams),
      tap((criteria) => {
        this.criteria.set(criteria);
        if (this.searchText().trim() !== criteria.search) this.searchText.set(criteria.search);
      }),
    );
    const fromRetry$ = this.retry$.pipe(map(() => this.criteria()));

    // switchMap cancels an older request, so a slow old answer never overwrites a new one.
    merge(fromUrl$, fromRetry$)
      .pipe(
        switchMap((criteria) => this.load(criteria)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  protected onType(value: string): void {
    this.searchText.set(value);
    this.typed$.next(value);
  }

  /** Enter in the search box: search now, without waiting for the debounce. */
  protected submitSearch(event: Event): void {
    event.preventDefault();
    this.update({ search: this.searchText().trim(), page: 1 });
  }

  protected onSpecializationChange(value: string): void {
    this.update({ specializationId: value ? Number(value) : null, page: 1 });
  }

  protected clearFilters(): void {
    this.searchText.set('');
    this.update({ search: '', specializationId: null, page: 1 });
  }

  protected goToPage(page: number): void {
    this.update({ page });
  }

  protected retry(): void {
    this.retry$.next();
  }

  /** An explicit user action: cancel pending typing, then navigate. */
  private update(change: Partial<DoctorSearchCriteria>): void {
    this.typed$.next(null);
    this.navigate(change);
  }

  private navigate(change: Partial<DoctorSearchCriteria>): void {
    const next = { ...this.criteria(), ...change };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: paramsFromCriteria(next),
    });
  }

  private load(criteria: DoctorSearchCriteria) {
    this.state.set('loading');
    this.errorMessage.set(null);
    return this.doctors.search(criteria).pipe(
      tap((page) => {
        this.result.set(page);
        this.state.set('loaded');
      }),
      catchError((err: unknown) => {
        this.result.set(null);
        this.errorMessage.set(parseApiError(err).message);
        this.state.set('error');
        return of(null);
      }),
    );
  }
}
