import { Routes } from '@angular/router';

import { authGuard, guestGuard, roleGuard } from './core/auth/auth.guards';
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
  {
    // The API needs a login to list doctors.
    path: 'doctors',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/doctor-search/doctor-search').then((m) => m.DoctorSearch),
    title: 'Find a doctor · Doctor Appointments',
  },
  {
    path: 'doctors/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/doctor-detail/doctor-detail').then((m) => m.DoctorDetail),
    title: 'Doctor · Doctor Appointments',
  },
  {
    path: 'doctors/:id/book',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/booking-confirm/booking-confirm').then((m) => m.BookingConfirm),
    title: 'Confirm booking · Doctor Appointments',
  },
  {
    path: 'appointments',
    canActivate: [authGuard, roleGuard('PATIENT')],
    loadComponent: () =>
      import('./pages/my-appointments/my-appointments').then((m) => m.MyAppointments),
    title: 'My appointments · Doctor Appointments',
  },
  {
    path: 'appointments/:id/reschedule',
    canActivate: [authGuard, roleGuard('PATIENT')],
    loadComponent: () => import('./pages/reschedule/reschedule').then((m) => m.Reschedule),
    title: 'Reschedule · Doctor Appointments',
  },
  {
    path: 'dashboard',
    canActivate: [authGuard, roleGuard('DOCTOR')],
    loadComponent: () =>
      import('./pages/doctor-dashboard/doctor-dashboard').then((m) => m.DoctorDashboard),
    title: 'Doctor dashboard · Doctor Appointments',
  },
  { path: '**', redirectTo: '' },
];
