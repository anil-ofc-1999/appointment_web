import { Component, input, model } from '@angular/core';

/**
 * Eye button that shows / hides a password field.
 * Usage (inside a `.password-field` wrapper, after the input):
 *   <input [type]="show() ? 'text' : 'password'" id="pw" ... />
 *   <app-password-toggle [(visible)]="show" controls="pw" />
 */
@Component({
  selector: 'app-password-toggle',
  template: `
    <button
      type="button"
      class="password-toggle"
      [attr.aria-label]="visible() ? 'Hide password' : 'Show password'"
      [attr.aria-pressed]="visible()"
      [attr.aria-controls]="controls()"
      [title]="visible() ? 'Hide password' : 'Show password'"
      (click)="visible.set(!visible())"
    >
      @if (visible()) {
        <!-- eye with a slash: click to hide -->
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A9.8 9.8 0 0 1 12 5c5 0 8.5 4.3 9.5 7a12 12 0 0 1-2.6 3.8M6.2 6.7C4.3 8 3 9.9 2.5 12c1 2.7 4.5 7 9.5 7a9.6 9.6 0 0 0 4.6-1.2"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      } @else {
        <!-- open eye: click to show -->
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            d="M2.5 12C3.5 9.3 7 5 12 5s8.5 4.3 9.5 7c-1 2.7-4.5 7-9.5 7s-8.5-4.3-9.5-7z"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2" />
        </svg>
      }
    </button>
  `,
})
export class PasswordToggle {
  /** Two-way bound: true = password shown as text. */
  readonly visible = model(false);
  /** id of the input this button controls (for screen readers). */
  readonly controls = input.required<string>();
}
