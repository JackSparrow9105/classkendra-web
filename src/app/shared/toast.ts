import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { Icon } from './icon';

/** Small confirmation messages ("Reminder sent", "Saved"). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly message = signal<string | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  show(message: string): void {
    clearTimeout(this.timer);
    this.message.set(message);
    this.timer = setTimeout(() => this.message.set(null), 2600);
  }
}

@Component({
  selector: 'app-toast',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (toast.message(); as msg) {
      <div class="toast" role="status">
        <app-icon name="check" [size]="18" [stroke]="2.2" />
        <span>{{ msg }}</span>
      </div>
    }
  `,
  styles: `
    .toast {
      position: fixed;
      left: 50%;
      bottom: calc(var(--nav-h) + 92px + env(safe-area-inset-bottom));
      transform: translateX(-50%);
      z-index: 60;
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: calc(100vw - 40px);
      padding: 12px 16px;
      border-radius: 14px;
      background: var(--ink);
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 8px 24px rgba(14, 19, 37, 0.2);
      animation: rise 0.2s ease-out;
    }
    @keyframes rise {
      from { opacity: 0; transform: translate(-50%, 8px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }
  `,
})
export class Toast {
  protected readonly toast = inject(ToastService);
}
