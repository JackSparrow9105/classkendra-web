import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Batch, Student } from '../../core/models/models';
import { LabelService } from '../../core/labels';
import { AuthService } from '../../core/services/auth.service';
import { BatchService } from '../../core/services/batch.service';
import { FeeService } from '../../core/services/fee.service';
import { StudentService } from '../../core/services/student.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { initials, niceDate } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';
import { TPipe } from '../../core/i18n/i18n.service';

type Kind = 'all' | 'new' | 'existing' | 'left';

/**
 * Students, 50 at a time ("Show more" loads the next 50). Search and the filters run on the server,
 * so a school with thousands of students opens as fast as a small coaching centre.
 */
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
  private readonly toast = inject(ToastService);
  protected readonly labels = inject(LabelService);
  protected readonly auth = inject(AuthService);

  private static readonly PageSize = 50;

  protected readonly batches = signal<Batch[]>([]);
  protected readonly list = signal<Student[]>([]);
  /** Students matching the search and filters (all pages). */
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly search = signal('');
  protected readonly batchId = signal<string>('');
  /** New admissions (this session), existing students, or students who left. */
  protected readonly kind = signal<Kind>('all');
  protected readonly kinds: { id: Kind; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'new', label: 'New admissions' },
    { id: 'existing', label: 'Existing' },
    { id: 'left', label: 'Left' },
  ];
  protected readonly newCount = signal(0);
  protected readonly hasMore = computed(() => this.list().length < this.total());
  protected readonly initials = initials;
  protected readonly niceDate = niceDate;

  private readonly batchNames = computed(() => new Map(this.batches().map((b) => [b.id, b.name])));
  private searchTimer?: ReturnType<typeof setTimeout>;
  private page = 1;
  /** Goes up with every new search, so a slow old reply can't overwrite a newer one. */
  private request = 0;

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

  protected leftText(s: Student): string {
    const why = { Left: 'Left', Transferred: 'Transferred', PassedOut: 'Passed out', Removed: 'Removed' }[s.leftReason ?? 'Left'];
    return s.leftOn ? `${why} · ${niceDate(s.leftOn)}` : why;
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

  protected pickKind(k: Kind): void {
    this.kind.set(k);
    this.load();
  }

  protected formatPhone(p: string): string {
    return p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p;
  }

  /** Next 50, added below the ones already shown. */
  protected more(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    this.fetch(this.page + 1, this.request);
  }

  /** First page for the current search and filters. */
  private load(): void {
    this.fetch(1, ++this.request);
  }

  private fetch(page: number, request: number): void {
    const k = this.kind();
    this.students
      .page({
        batchId: this.batchId() || undefined,
        search: this.search(),
        kind: k === 'new' || k === 'existing' ? k : '',
        status: k === 'left' ? 'Left' : 'Active',
        page,
        pageSize: StudentList.PageSize,
      })
      .subscribe({
        next: (res) => {
          if (request !== this.request) return; // the filters changed while this was loading
          this.page = res.page;
          this.total.set(res.total);
          if (k !== 'left') this.newCount.set(res.newCount);
          this.list.update((rows) => {
            if (page === 1) return res.items;
            const seen = new Set(rows.map((r) => r.id));
            return [...rows, ...res.items.filter((r) => !seen.has(r.id))];
          });
          this.loading.set(false);
          this.loadingMore.set(false);
        },
        error: (e) => {
          this.loading.set(false);
          this.loadingMore.set(false);
          this.toast.show(errorMessage(e));
        },
      });
  }
}
