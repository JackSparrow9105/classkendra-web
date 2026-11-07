import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** Must be signed in. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? true : inject(Router).parseUrl('/login');
};

/** Signed-in owners skip the login screens. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (!auth.isLoggedIn()) return true;
  return inject(Router).parseUrl(
    !auth.hasCentre() ? '/setup/centre' : auth.isTeacher() ? '/home' : '/dashboard',
  );
};

/** The main app needs a centre; new owners are sent to setup first. */
export const centreGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (!auth.isLoggedIn()) return inject(Router).parseUrl('/login');
  return auth.hasCentre() ? true : inject(Router).parseUrl('/setup/centre');
};

/** Owner-only pages (billing, staff). Others are sent to their home screen. */
export const ownerGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (auth.isOwner()) return true;
  return inject(Router).parseUrl(auth.isTeacher() ? '/home' : '/dashboard');
};

/** Money and setup pages are for the owner and office staff. Teachers only mark attendance and see their students. */
export const officeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isTeacher() ? inject(Router).parseUrl('/home') : true;
};

/** The teacher's Home. Owner and office staff have the full dashboard instead. */
export const teacherGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isTeacher() ? true : inject(Router).parseUrl('/dashboard');
};
