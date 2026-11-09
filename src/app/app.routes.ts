import { Routes } from '@angular/router';
import { authGuard, centreGuard, guestGuard, lockedGuard, officeGuard, ownerGuard, signedInGuard, teacherGuard } from './core/guards/guards';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },

  // Sign up / sign in (owners, office staff and teachers all use mobile + OTP)
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login').then((m) => m.Login) },
  { path: 'otp', canActivate: [guestGuard], loadComponent: () => import('./features/auth/otp').then((m) => m.Otp) },
  // App PIN: chosen after the first OTP login, asked again after 10 minutes away
  { path: 'set-pin', canActivate: [signedInGuard], loadComponent: () => import('./features/auth/set-pin').then((m) => m.SetPin) },
  { path: 'unlock', canActivate: [lockedGuard], loadComponent: () => import('./features/auth/unlock').then((m) => m.Unlock) },

  // Public parent payment page (opened from the WhatsApp reminder; no login)
  { path: 'pay/:token', loadComponent: () => import('./features/parent-pay/parent-pay').then((m) => m.ParentPay) },

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
      { path: 'home', canActivate: [teacherGuard], loadComponent: () => import('./features/dashboard/teacher-home').then((m) => m.TeacherHome) },
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
      { path: 'messages', canActivate: [officeGuard], loadComponent: () => import('./features/messages/messages').then((m) => m.Messages) },
      { path: 'promote', canActivate: [ownerGuard], loadComponent: () => import('./features/promote/promote').then((m) => m.Promote) },
      { path: 'staff', canActivate: [ownerGuard], loadComponent: () => import('./features/staff/staff').then((m) => m.Staff) },
      { path: 'plans', canActivate: [ownerGuard], loadComponent: () => import('./features/plans/plans').then((m) => m.Plans) },
      { path: 'settings', loadComponent: () => import('./features/settings/settings').then((m) => m.Settings) },
    ],
  },

  { path: '**', redirectTo: 'dashboard' },
];
