import { Injectable, inject, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiService } from './api.service';

const DISMISS_KEY = 'ck-push-prompt-dismissed';

/**
 * App notifications (Web Push) through Angular's service worker: free, and they arrive when the app is closed.
 * Android and computers: in the browser or installed. iPhone/iPad: only when the app is added to the Home Screen.
 */
@Injectable({ providedIn: 'root' })
export class PushNotificationsService {
  private readonly swPush = inject(SwPush);
  private readonly api = inject(ApiService);

  /** 'default' (not asked yet), 'granted', 'denied', or 'unsupported'. */
  readonly permission = signal<NotificationPermission | 'unsupported'>(this.readPermission());
  readonly dismissed = signal(this.readDismissed());

  /** Can this phone show app notifications at all? (Demo mode: shown so the prompt can be tried.) */
  get supported(): boolean {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    return environment.useMock || this.swPush.isEnabled;
  }

  /** Show the "Get notified" card: supported, not asked yet, not dismissed. */
  shouldAsk(): boolean {
    return this.supported && this.permission() === 'default' && !this.dismissed();
  }

  /** Asks the phone for permission and saves its subscription for the signed-in person. */
  async enable(): Promise<boolean> {
    if (!this.supported) return false;
    if (environment.useMock) {
      const p = await Notification.requestPermission();
      this.permission.set(p);
      return p === 'granted';
    }
    try {
      const { publicKey } = await firstValueFrom(this.api.get<{ publicKey: string | null }>('push/key'));
      if (!publicKey) return false;
      const sub = await this.swPush.requestSubscription({ serverPublicKey: publicKey });
      await firstValueFrom(this.api.post('push/subscriptions', sub.toJSON()));
      this.permission.set('granted');
      return true;
    } catch {
      this.permission.set(this.readPermission());
      return false;
    }
  }

  /**
   * Phones that already allowed notifications: send the subscription again so it belongs to whoever is signed in now
   * (the same phone may be shared, or the person signed in again).
   */
  async sync(): Promise<void> {
    if (environment.useMock || !this.swPush.isEnabled || this.readPermission() !== 'granted') return;
    try {
      const sub = await firstValueFrom(this.swPush.subscription);
      if (sub) await firstValueFrom(this.api.post('push/subscriptions', sub.toJSON()));
    } catch {
      /* best effort */
    }
  }

  dismiss(): void {
    this.dismissed.set(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode */
    }
  }

  private readPermission(): NotificationPermission | 'unsupported' {
    return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported';
  }

  private readDismissed(): boolean {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  }
}
