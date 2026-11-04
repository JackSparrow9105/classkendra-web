import { Routes } from '@angular/router';
import { authGuard, centreGuard, guestGuard, officeGuard, ownerGuard } from './core/guards/guards';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },

  // Sign up / sign in (owners, office staff and teachers all use mobile + OTP)
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login').then((m) => m.Login) },
  { path: 'otp', canActivate: [guestGuard], loadComponent: () => import('./features/auth/otp').then((m) => m.Otp) },

  // Short first-time setup: centre or school details, then batches or classes
  { path: 'setup/centre', canActivate: [authGuard], loadComponent: () => import('./features/setup/setup-centre').then((m) => m.SetupCentre) },
  { path: 'setup/batches', canActivate: [centreGuard, ownerGuard], loadComponent: () => import('./features/setup/setup-batches').then((m) => m.SetupBatches) },

  // Main app inside the shell (bottom nav on phone, side nav on desktop)
  {
    path: '',
    canActivate: [centreGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: 'dashboard', canActivate: [officeGuard], loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard) },
      { path: 'students', loadComponent: () => import('./features/students/student-list').then((m) => m.StudentList) },
      { path: 'students/new', canActivate: [officeGuard], loadComponent: () => import('./features/students/student-form').then((m) => m.StudentForm) },
      { path: 'students/import', canActivate: [officeGuard], loadComponent: () => import('./features/students/student-import').then((m) => m.StudentImport) },
      { path: 'students/:id', canActivate: [officeGuard], loadComponent: () => import('./features/students/student-detail').then((m) => m.StudentDetail) },
      { path: 'students/:id/edit', canActivate: [officeGuard], loadComponent: () => import('./features/students/student-form').then((m) => m.StudentForm) },
      { path: 'receipts/:id', canActivate: [officeGuard], loadComponent: () => import('./features/receipts/receipt').then((m) => m.Receipt) },
      { path: 'reports', canActivate: [officeGuard], loadComponent: () => import('./features/reports/reports').then((m) => m.Reports) },
      { path: 'fees', canActivate: [officeGuard], loadComponent: () => import('./features/fees/fee-list').then((m) => m.FeeList) },
      { path: 'fees/setup', canActivate: [officeGuard], loadComponent: () => import('./features/fees/fee-setup').then((m) => m.FeeSetup) },
      { path: 'attendance', loadComponent: () => import('./features/attendance/attendance').then((m) => m.Attendance) },
      { path: 'batches', canActivate: [officeGuard], loadComponent: () => import('./features/setup/setup-batches').then((m) => m.SetupBatches), data: { mode: 'manage' } },
      { path: 'staff', canActivate: [ownerGuard], loadComponent: () => import('./features/staff/staff').then((m) => m.Staff) },
      { path: 'plans', canActivate: [ownerGuard], loadComponent: () => import('./features/plans/plans').then((m) => m.Plans) },
      { path: 'settings', loadComponent: () => import('./features/settings/settings').then((m) => m.Settings) },
    ],
  },

  { path: '**', redirectTo: 'dashboard' },
];
