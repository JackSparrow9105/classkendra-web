import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { PushNotificationsService } from '../core/services/push-notifications.service';
import { ToastService } from './toast';

/** "Get notified about leave": asked once, inside the app. */
@Component({
  selector: 'app-push-prompt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (push.shouldAsk()) {
      <section class="card push-card" aria-labelledby="push-title">
        <strong id="push-title">{{ title() }}</strong>
        <span class="muted">{{ text() }}</span>
        <div class="row" style="gap: 8px">
          <button type="button" class="btn btn-outline sm" style="flex: 1" (click)="push.dismiss()">Not now</button>
          <button type="button" class="btn btn-primary sm" style="flex: 1" (click)="allow()">Allow</button>
        </div>
      </section>
    }
  `,
  styles: `
    .push-card { display: flex; flex-direction: column; gap: 8px; border-color: var(--accent); }
    .push-card .muted { font-size: 13px; line-height: 1.45; }
  `,
})
export class PushPrompt {
  protected readonly push = inject(PushNotificationsService);
  private readonly toast = inject(ToastService);
  readonly title = input('Get notified about leave');
  readonly text = input('Know as soon as your leave is approved. You can turn this off any time.');

  protected async allow(): Promise<void> {
    const ok = await this.push.enable();
    if (ok) this.toast.show('Notifications are on');
    else if (this.push.permission() === 'denied') this.toast.show('Notifications are blocked. Allow them in your browser settings.');
    else this.toast.show("Couldn't turn on notifications on this phone");
  }
}
