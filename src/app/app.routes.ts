import { Routes } from '@angular/router';

import { guestGuard } from './core/auth/auth.guards';
import { Home } from './pages/home/home';

export const routes: Routes = [
  { path: '', component: Home, title: 'Doctor Appointments' },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
    title: 'Log in · Doctor Appointments',
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/register/register').then((m) => m.Register),
    title: 'Create account · Doctor Appointments',
  },
  { path: '**', redirectTo: '' },
];
