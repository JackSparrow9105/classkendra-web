import { Injectable, signal } from '@angular/core';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * "Install app" support. Chrome/Edge on Android and desktop fire `beforeinstallprompt`; we keep it
 * and show our own button. iPhones don't support that, so we show "Share › Add to Home Screen" instead.
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private deferred: InstallPromptEvent | null = null;
  readonly canPrompt = signal(false);
  readonly installed = signal(
    typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true),
  );
  readonly isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferred = e as InstallPromptEvent;
      this.canPrompt.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.installed.set(true);
      this.canPrompt.set(false);
    });
  }

  async install(): Promise<boolean> {
    if (!this.deferred) return false;
    await this.deferred.prompt();
    const { outcome } = await this.deferred.userChoice;
    this.deferred = null;
    this.canPrompt.set(false);
    return outcome === 'accepted';
  }
}
