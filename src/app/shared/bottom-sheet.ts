import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Icon } from './icon';

/** Mobile bottom sheet; shows as a centred dialog on desktop. */
@Component({
  selector: 'app-bottom-sheet',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="backdrop" (click)="closed.emit()"></div>
    <section class="sheet" role="dialog" aria-modal="true" [attr.aria-label]="title()">
      <header class="sheet-head">
        <h2>{{ title() }}</h2>
        <button type="button" class="icon-btn plain" aria-label="Close" (click)="closed.emit()">
          <app-icon name="x" />
        </button>
      </header>
      <ng-content />
    </section>
  `,
  styles: `
    :host { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-end; justify-content: center; }
    .backdrop { position: absolute; inset: 0; background: rgba(14, 19, 37, 0.45); animation: fade 0.15s; }
    .sheet {
      position: relative; width: 100%; max-width: 560px; max-height: 90dvh; overflow: auto;
      background: var(--surface); border-radius: 24px 24px 0 0;
      padding: 8px 20px calc(24px + env(safe-area-inset-bottom));
      display: flex; flex-direction: column; gap: 16px; animation: up 0.2s ease-out;
    }
    .sheet-head { display: flex; align-items: center; justify-content: space-between; padding-top: 8px; }
    h2 { font-size: 18px; font-weight: 700; }
    @media (min-width: 960px) {
      :host { align-items: center; }
      .sheet { border-radius: 24px; max-width: 460px; }
    }
    @keyframes fade { from { opacity: 0; } }
    @keyframes up { from { transform: translateY(24px); opacity: 0; } }
  `,
})
export class BottomSheet {
  readonly title = input.required<string>();
  readonly closed = output<void>();
}
