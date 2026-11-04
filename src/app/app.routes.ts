import { Routes } from '@angular/router';
import { authGuard, centreGuard, guestGuard, ownerGuard } from './core/guards/guards';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },

  // Sign up / sign in
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login').then((m) => m.Login) },
  { path: 'otp', canActivate: [guestGuard], loadComponent: () => import('./features/auth/otp').then((m) => m.Otp) },

  // Short first-time setup: centre details, then batches
  { path: 'setup/centre', canActivate: [authGuard], loadComponent: () => import('./features/setup/setup-centre').then((m) => m.SetupCentre) },
  { path: 'setup/batches', canActivate: [centreGuard], loadComponent: () => import('./features/setup/setup-batches').then((m) => m.SetupBatches) },

  // Main app inside the shell (bottom nav on phone, side nav on desktop)
  {
    path: '',
    canActivate: [centreGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: 'dashboard', loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard) },
      { path: 'students', loadComponent: () => import('./features/students/student-list').then((m) => m.StudentList) },
      { path: 'students/new', loadComponent: () => import('./features/students/student-form').then((m) => m.StudentForm) },
      { path: 'students/import', loadComponent: () => import('./features/students/student-import').then((m) => m.StudentImport) },
      { path: 'students/:id', loadComponent: () => import('./features/students/student-form').then((m) => m.StudentForm) },
      { path: 'fees', loadComponent: () => import('./features/fees/fee-list').then((m) => m.FeeList) },
      { path: 'fees/setup', loadComponent: () => import('./features/fees/fee-setup').then((m) => m.FeeSetup) },
      { path: 'attendance', loadComponent: () => import('./features/attendance/attendance').then((m) => m.Attendance) },
      { path: 'batches', loadComponent: () => import('./features/setup/setup-batches').then((m) => m.SetupBatches), data: { mode: 'manage' } },
      { path: 'plans', canActivate: [ownerGuard], loadComponent: () => import('./features/plans/plans').then((m) => m.Plans) },
      { path: 'settings', loadComponent: () => import('./features/settings/settings').then((m) => m.Settings) },
    ],
  },

  { path: '**', redirectTo: 'dashboard' },
];
