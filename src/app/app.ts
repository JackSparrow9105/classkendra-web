import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NavigationStart, Router, RouterOutlet } from '@angular/router';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, take } from 'rxjs';
import { Toast } from './shared/toast';
import { InstallService } from './core/install.service';
import { I18nService } from './core/i18n/i18n.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toast],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    <app-toast />
  `,
})
export class App {
  // Created at start-up so the browser's install prompt and the saved language are picked up early.
  private readonly install = inject(InstallService);
  private readonly i18n = inject(I18nService);

  constructor() {
    const sw = inject(SwUpdate);
    const router = inject(Router);
    if (!sw.isEnabled) return;

    // Look for a new version when the app opens, when it comes back to the screen, and every 5 minutes.
    const check = () => sw.checkForUpdate().catch(() => undefined);
    check();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    setInterval(check, 5 * 60_000);

    // New version downloaded: switch to it on the next page change, so nobody loses what they're typing.
    sw.versionUpdates
      .pipe(
        filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'),
        take(1),
      )
      .subscribe(() => {
        router.events
          .pipe(
            filter((e): e is NavigationStart => e instanceof NavigationStart),
            take(1),
          )
          .subscribe((e) => location.assign(document.baseURI + e.url.replace(/^\//, '')));
      });
  }
}