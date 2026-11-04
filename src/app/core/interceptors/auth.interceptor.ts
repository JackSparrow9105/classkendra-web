import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/** Adds the JWT to every API call and sends the user to login when it expires. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();
  const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authed).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        auth.logout();
        router.navigateByUrl('/login');
      }
      return throwError(() => err);
    }),
  );
};

/** Turns any API error into one readable sentence. The API returns { message } on errors. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    return (err.error && typeof err.error === 'object' && 'message' in err.error)
      ? String(err.error.message)
      : 'Something went wrong. Please try again.';
  }
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}
