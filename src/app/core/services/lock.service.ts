import { Injectable, NgZone, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { rememberReturnUrl } from '../../features/auth/after-login';

/** Lock the app after this long without use (tab hidden, phone locked, or nobody touching it). */
export const LOCK_AFTER_MS = 10 * 60_000;
/** Users with a PIN renew their 30-day login by unlocking; do it when less than this is left. */
const RENEW_WITHIN_S = 7 * 24 * 3600;
const LAST_ACTIVE_KEY = 'ck-last-active';
const LAST_REFRESH_KEY = 'ck-last-refresh';

/**
 * Asks for the PIN after time away, and keeps regular users logged in.
 * - With a PIN: after 10 minutes away the token is dropped and the PIN screen is shown.
 * - Without a PIN (teachers who skipped): the login is renewed once a day while they use the app.
 */
@Injectable({ providedIn: 'root' })
export class LockService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private started = false;
  private lastWrite = 0;

  /** Runs once at app start, before the first page is chosen. */
  start(): void {
    if (this.started || typeof document === 'undefined') return;
    this.started = true;

    // Opening the app after being away counts as time away.
    this.checkNow({ navigate: false });
    if (this.auth.isLoggedIn()) {
      this.markActive(true);
      this.auth.reloadUser().subscribe({ error: () => undefined });
      this.renewIfDue();
    }

    this.zone.runOutsideAngular(() => {
      const active = () => this.markActive();
      for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
        window.addEventListener(ev, active, { passive: true });
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.markActive(true);
        else this.zone.run(() => this.checkNow({ navigate: true }));
      });
      window.setInterval(() => this.zone.run(() => this.checkNow({ navigate: true })), 30_000);
    });
  }

  /** Remember that the app is in use now (written at most every 15 s). */
  markActive(force = false): void {
    if (!this.auth.isLoggedIn()) return;
    const now = Date.now();
    if (!force && now - this.lastWrite < 15_000) return;
    this.lastWrite = now;
    try {
      localStorage.setItem(LAST_ACTIVE_KEY, String(now));
    } catch {
      /* ignore */
    }
  }

  private checkNow(opts: { navigate: boolean }): void {
    if (!this.auth.isLoggedIn() || !this.auth.hasPin()) return;
    const away = Date.now() - this.lastActive();
    const left = this.auth.tokenSecondsLeft();
    if (away > LOCK_AFTER_MS || (left !== null && left < RENEW_WITHIN_S)) {
      this.auth.lock();
      if (opts.navigate) {
        rememberReturnUrl(this.router.url);
        this.router.navigateByUrl('/unlock');
      } else {
        // At start-up the router hasn't read the address yet; take it from the browser, minus the
        // site's base path (e.g. "/classkendra-web/" on GitHub Pages).
        const base = new URL(document.baseURI).pathname;
        const path = location.pathname.startsWith(base)
          ? '/' + location.pathname.slice(base.length)
          : location.pathname;
        rememberReturnUrl(path + location.search);
      }
    }
  }

  /** No PIN: renew the 30-day login quietly, at most once a day. */
  private renewIfDue(): void {
    if (this.auth.hasPin() || !this.auth.device()) return;
    const last = Number(this.readRaw(LAST_REFRESH_KEY) ?? 0);
    if (Date.now() - last < 24 * 3600_000) return;
    this.auth.refresh().subscribe({
      next: () => this.writeRaw(LAST_REFRESH_KEY, String(Date.now())),
      error: () => undefined, // keep the current token; it still works until it expires
    });
  }

  private lastActive(): number {
    return Number(this.readRaw(LAST_ACTIVE_KEY) ?? Date.now());
  }

  private readRaw(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeRaw(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }
}
