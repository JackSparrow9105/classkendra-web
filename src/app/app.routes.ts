import { Routes } from '@angular/router';
import { authGuard, centreGuard, guestGuard, lockedGuard, officeGuard, ownerGuard, signedInGuard, staffMemberGuard, teacherGuard } from './core/guards/guards';

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
      // Teachers get a read-only profile (details and attendance, no fees) for students of their own classes.
      { path: 'students/:id', loadComponent: () => import('./features/students/student-detail').then((m) => m.StudentDetail) },
      { path: 'students/:id/slip/:kind', canActivate: [officeGuard], loadComponent: () => import('./features/students/student-slip').then((m) => m.StudentSlip) },
      { path: 'students/:id/admission', canActivate: [officeGuard], loadComponent: () => import('./features/students/admission').then((m) => m.Admission) },
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
      { path: 'me/attendance', canActivate: [staffMemberGuard], loadComponent: () => import('./features/staff-attendance/my-attendance').then((m) => m.MyAttendance) },
      { path: 'me/leave', canActivate: [staffMemberGuard], loadComponent: () => import('./features/staff-attendance/my-leave').then((m) => m.MyLeave) },
      { path: 'staff-attendance', canActivate: [ownerGuard], loadComponent: () => import('./features/staff-attendance/staff-today').then((m) => m.StaffToday) },
      { path: 'staff-attendance/leaves', canActivate: [ownerGuard], loadComponent: () => import('./features/staff-attendance/staff-leaves').then((m) => m.StaffLeaves) },
      { path: 'staff-attendance/report', canActivate: [ownerGuard], loadComponent: () => import('./features/staff-attendance/staff-report').then((m) => m.StaffReportPage) },
      { path: 'staff-attendance/settings', canActivate: [ownerGuard], loadComponent: () => import('./features/staff-attendance/staff-settings').then((m) => m.StaffSettings) },
      // One holiday list for the whole centre (owner edits, office sees) and the owner's activity log
      { path: 'holidays', canActivate: [officeGuard], loadComponent: () => import('./features/holidays/holidays').then((m) => m.Holidays) },
      { path: 'downloads', canActivate: [officeGuard], loadComponent: () => import('./features/downloads/downloads').then((m) => m.Downloads) },
      { path: 'activity', canActivate: [ownerGuard], loadComponent: () => import('./features/activity/activity').then((m) => m.Activity) },
      { path: 'settings', loadComponent: () => import('./features/settings/settings').then((m) => m.Settings) },
    ],
  },

  { path: '**', redirectTo: 'dashboard' },
];
