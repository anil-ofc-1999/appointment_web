import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { HealthService } from '../../core/health.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  protected readonly apiStatus = toSignal(inject(HealthService).status());
}
