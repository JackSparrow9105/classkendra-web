import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Batch, FeeFrequency, FeeHead, FeeSettings } from '../../core/models/models';
import { FREQUENCY_LABELS } from '../../core/fees/schedule';
import { LabelService } from '../../core/labels';
import { BatchService } from '../../core/services/batch.service';
import { CentreService } from '../../core/services/centre.service';
import { FeeService } from '../../core/services/fee.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { monthKey, monthName, rupees } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

type ReminderKey = 'remindBefore' | 'remindOnDue' | 'remindAfter';

/** A row of amount inputs: one per coaching batch, or one per school class (shared by its sections). */
interface AmountGroup {
  key: string;
  label: string;
  batchIds: string[];
}

/** Editable copy of a fee head. Amounts are strings so fields can be empty while typing. */
interface HeadDraft {
  key: string;
  id: string;
  name: string;
  frequency: FeeFrequency;
  optional: boolean;
  sameForAll: boolean;
  amount: string;
  amounts: Record<string, string>;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

@Component({
  selector: 'app-fee-setup',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fee-setup.html',
  styleUrl: './fees.scss',
})
export class FeeSetup {
  private readonly batchService = inject(BatchService);
  private readonly fees = inject(FeeService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly centre = inject(CentreService);
  protected readonly labels = inject(LabelService);

  protected readonly frequencies = Object.entries(FREQUENCY_LABELS) as [FeeFrequency, string][];
  protected readonly months = MONTHS.map((name, i) => ({ value: i + 1, name }));
  protected readonly dueDays = Array.from({ length: 28 }, (_, i) => i + 1);
  protected readonly reminderRules: { key: ReminderKey; label: string }[] = [
    { key: 'remindBefore', label: '3 days before the due date' },
    { key: 'remindOnDue', label: 'On the due date' },
    { key: 'remindAfter', label: 'Every 3 days until paid' },
  ];

  protected readonly batches = signal<Batch[]>([]);
  protected readonly heads = signal<HeadDraft[]>([]);
  protected readonly settings = signal<FeeSettings>({
    dueDay: 5, sessionStartMonth: 4, remindBefore: true, remindOnDue: true, remindAfter: true,
  });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly loaded = signal(false);

  protected readonly groups = computed<AmountGroup[]>(() => {
    const list = this.batches();
    if (!this.labels.isSchool()) return list.map((b) => ({ key: b.id, label: b.name, batchIds: [b.id] }));
    const byClass = new Map<string, AmountGroup>();
    for (const b of list) {
      const cls = b.className ?? b.name;
      const label = /^\d+$/.test(cls) ? `Class ${cls}` : cls;
      const g = byClass.get(cls) ?? { key: cls, label, batchIds: [] };
      g.batchIds.push(b.id);
      byClass.set(cls, g);
    }
    return [...byClass.values()];
  });

  protected readonly preview = computed(() => {
    const name = this.centre.centre()?.name ?? 'your ' + this.labels.l().orgLower;
    const month = monthName(monthKey());
    const firstGroup = this.groups()[0];
    const lines = this.heads()
      .filter((h) => h.name.trim() && !h.optional)
      .slice(0, 2)
      .map((h) => {
        const amt = Number(h.sameForAll ? h.amount : firstGroup ? h.amounts[firstGroup.key] : 0) || 0;
        return `${h.name} ${rupees(amt)}`;
      });
    const body = lines.length ? lines.join(', ') : 'Tuition fee ₹2,500';
    return `Namaste! Aarav's ${month} fees at ${name}: ${body}. Due on ${this.settings().dueDay} ${month.slice(0, 3)}. Pay here:`;
  });

  private keySeq = 0;

  constructor() {
    if (!this.centre.centre()) this.centre.load().subscribe();
    forkJoin([this.batchService.list(), this.fees.getSetup()]).subscribe(([batches, setup]) => {
      this.batches.set(batches);
      if (setup.settings) this.settings.set(setup.settings);
      this.heads.set(setup.heads.length ? setup.heads.map((h) => this.toDraft(h)) : this.presets());
      this.loaded.set(true);
    });
  }

  protected updateHead(key: string, patch: Partial<HeadDraft>): void {
    this.heads.update((list) => list.map((h) => (h.key === key ? { ...h, ...patch } : h)));
  }

  protected setAmount(head: HeadDraft, groupKey: string | null, value: string): void {
    const digits = String(value ?? '').replace(/\D/g, '').slice(0, 6);
    if (groupKey === null) this.updateHead(head.key, { amount: digits });
    else this.updateHead(head.key, { amounts: { ...head.amounts, [groupKey]: digits } });
  }

  protected addHead(): void {
    this.heads.update((list) => [...list, this.blank('', 'Monthly', false, true)]);
  }

  protected removeHead(head: HeadDraft): void {
    if (head.id && !confirm(`Remove "${head.name}"? Unpaid ${head.name} fees will be cancelled.`)) return;
    this.heads.update((list) => list.filter((h) => h.key !== head.key));
  }

  protected toggle(key: ReminderKey): void {
    this.settings.update((s) => ({ ...s, [key]: !s[key] }));
  }

  protected setSetting(key: 'dueDay' | 'sessionStartMonth', value: number): void {
    this.settings.update((s) => ({ ...s, [key]: Number(value) }));
  }

  protected save(): void {
    const heads = this.heads()
      .filter((h) => h.name.trim())
      .map((h) => this.fromDraft(h));
    const charged = heads.filter((h) => Object.values(h.amounts).some((a) => a > 0));
    if (this.heads().some((h) => !h.name.trim())) {
      this.error.set('Give every fee a name, or remove the empty one.');
      return;
    }
    if (charged.length === 0) {
      this.error.set('Enter an amount for at least one fee.');
      return;
    }
    this.error.set('');
    this.busy.set(true);
    this.fees.saveSetup({ settings: this.settings(), heads }).subscribe({
      next: () => {
        this.toast.show('Fees saved. Reminders are on.');
        this.router.navigateByUrl('/dashboard');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  private presets(): HeadDraft[] {
    if (!this.labels.isSchool()) return [this.blank('Tuition fee', 'Monthly', false, false)];
    return [
      this.blank('Tuition fee', 'Monthly', false, false),
      this.blank('Transport', 'Monthly', true, true),
      this.blank('Annual fee', 'Yearly', false, false),
    ];
  }

  private blank(name: string, frequency: FeeFrequency, optional: boolean, sameForAll: boolean): HeadDraft {
    return { key: `k${this.keySeq++}`, id: '', name, frequency, optional, sameForAll, amount: '', amounts: {} };
  }

  private toDraft(h: FeeHead): HeadDraft {
    const amounts: Record<string, string> = {};
    for (const g of this.groups()) {
      const a = h.amounts[g.batchIds[0]!];
      if (a) amounts[g.key] = String(a);
    }
    const values = Object.values(h.amounts).filter((a) => a > 0);
    const same = values.length > 0 && values.every((a) => a === values[0]) && values.length === this.batches().length;
    return {
      key: `k${this.keySeq++}`,
      id: h.id,
      name: h.name,
      frequency: h.frequency,
      optional: h.optional,
      sameForAll: same && this.groups().length > 1,
      amount: same ? String(values[0]) : '',
      amounts,
    };
  }

  private fromDraft(h: HeadDraft): FeeHead {
    const amounts: Record<string, number> = {};
    for (const g of this.groups()) {
      const n = Number(h.sameForAll ? h.amount : h.amounts[g.key]) || 0;
      if (n > 0) g.batchIds.forEach((id) => (amounts[id] = n));
    }
    return { id: h.id, name: h.name.trim(), frequency: h.frequency, optional: h.optional, amounts };
  }
}
