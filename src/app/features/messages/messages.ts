import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MessageLog, MessageStatus, MessageSummary, MessageType } from '../../core/models/models';
import { MessageService } from '../../core/services/message.service';
import { Icon, IconName } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

@Component({
  selector: 'app-messages',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './messages.html',
  styleUrl: './messages.scss',
})
export class Messages {
  private readonly messages = inject(MessageService);
  private readonly toast = inject(ToastService);

  /** Optional ?studentId= to show one family's messages (linked from the student page). */
  readonly studentId = input<string>();

  protected readonly types: { id: MessageType | ''; label: string }[] = [
    { id: '', label: 'All' },
    { id: 'FeeReminder', label: 'Fee reminders' },
    { id: 'AbsentAlert', label: 'Absent alerts' },
    { id: 'Receipt', label: 'Receipts' },
    { id: 'StaffInvite', label: 'Staff invites' },
  ];
  protected readonly statuses: MessageStatus[] = ['Queued', 'Sent', 'Delivered', 'Read', 'Failed'];
  protected readonly typeIcon: Record<MessageType, IconName> = {
    FeeReminder: 'wallet',
    AbsentAlert: 'calendar-check',
    Receipt: 'file',
    StaffInvite: 'user-plus',
  };

  protected readonly type = signal<MessageType | ''>('');
  protected readonly status = signal<MessageStatus | ''>('');
  protected readonly search = signal('');
  protected readonly rows = signal<MessageLog[]>([]);
  protected readonly summary = signal<MessageSummary | null>(null);
  protected readonly loaded = signal(false);

  protected readonly deliveredPct = computed(() => {
    const s = this.summary();
    if (!s || !s.total) return null;
    const done = s.byStatus.Delivered + s.byStatus.Read;
    const settled = done + s.byStatus.Failed;
    return settled ? Math.round((done / settled) * 100) : null;
  });

  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      this.studentId();
      this.load();
    });
    // Delivery updates arrive over time (provider webhook), so refresh while the page is open.
    const timer = setInterval(() => this.load(), 5000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected setType(t: MessageType | ''): void {
    this.type.set(t);
    this.load();
  }

  protected setStatus(s: MessageStatus | ''): void {
    this.status.set(s);
    this.load();
  }

  protected onSearch(v: string): void {
    this.search.set(v);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 300);
  }

  protected retry(m: MessageLog): void {
    this.messages.retry(m.id).subscribe(() => {
      this.toast.show('Message queued again');
      this.load();
    });
  }

  protected badgeClass(s: MessageStatus): string {
    return s === 'Failed' ? 'warn' : s === 'Read' || s === 'Delivered' ? 'ok' : '';
  }

  protected when(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    return sameDay ? time : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
  }

  private load(): void {
    this.messages
      .list({ type: this.type(), status: this.status(), search: this.search(), studentId: this.studentId() })
      .subscribe((rows) => {
        this.rows.set(rows);
        this.loaded.set(true);
      });
    this.messages.summary().subscribe((s) => this.summary.set(s));
  }
}
