import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
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
}
