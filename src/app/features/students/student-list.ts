import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Batch, Student } from '../../core/models/models';
import { LabelService } from '../../core/labels';
import { AuthService } from '../../core/services/auth.service';
import { BatchService } from '../../core/services/batch.service';
import { FeeService } from '../../core/services/fee.service';
import { StudentService } from '../../core/services/student.service';
import { initials } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { TPipe } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-student-list',
  imports: [RouterLink, Icon, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './student-list.html',
  styleUrl: './students.scss',
})
export class StudentList {
  private readonly students = inject(StudentService);
  private readonly batchService = inject(BatchService);
  private readonly fees = inject(FeeService);
  protected readonly labels = inject(LabelService);
  protected readonly auth = inject(AuthService);

  protected readonly batches = signal<Batch[]>([]);
  protected readonly list = signal<Student[]>([]);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly batchId = signal<string>('');
  /** New admissions (this session) or existing students. */
  protected readonly kind = signal<'all' | 'new' | 'existing'>('all');
  protected readonly kinds: { id: 'all' | 'new' | 'existing'; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'new', label: 'New admissions' },
    { id: 'existing', label: 'Existing' },
  ];
  protected readonly newCount = computed(() => this.list().filter((s) => this.isNewThisSession(s)).length);
  protected readonly shown = computed(() => {
    const k = this.kind();
    if (k === 'all') return this.list();
    return this.list().filter((s) => (k === 'new' ? this.isNewThisSession(s) : !s.isNewAdmission));
  });
  protected readonly initials = initials;

  private readonly batchNames = computed(() => new Map(this.batches().map((b) => [b.id, b.name])));
  private searchTimer?: ReturnType<typeof setTimeout>;

  private readonly sessionStart = signal(4);

  constructor() {
    this.batchService.list().subscribe((b) => this.batches.set(b));
    if (!this.auth.isTeacher())
      this.fees.getSetup().subscribe({ next: (s) => this.sessionStart.set(s.settings?.sessionStartMonth ?? 4), error: () => undefined });
    this.load();
  }

  /** Admitted through ClassKendra in the current session (April–March unless the centre set another start). */
  protected isNewThisSession(s: Student): boolean {
    if (!s.isNewAdmission) return false;
    const start = this.sessionStart();
    const now = new Date();
    const y = now.getMonth() + 1 >= start ? now.getFullYear() : now.getFullYear() - 1;
    return s.joinedOn >= `${y}-${String(start).padStart(2, '0')}-01`;
  }

  protected batchName(id: string): string {
    return this.batchNames().get(id) ?? '';
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 300);
  }

  protected pickBatch(id: string): void {
    this.batchId.set(id);
    this.load();
  }

  protected formatPhone(p: string): string {
    return p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p;
  }

  private load(): void {
    this.students.list({ batchId: this.batchId() || undefined, search: this.search() }).subscribe((rows) => {
      this.list.set(rows);
      this.loading.set(false);
    });
  }
}
