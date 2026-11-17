import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Batch, Student } from '../core/models/models';
import { AuthService } from '../core/services/auth.service';
import { BatchService } from '../core/services/batch.service';
import { StudentService } from '../core/services/student.service';
import { TPipe } from '../core/i18n/i18n.service';
import { Icon } from './icon';

/**
 * Find a student from any page: name, parent phone or admission number. Press "/" or Ctrl+K to jump here.
 * Office: students studying here and those who left. Teachers: students of their own classes.
 * Enter or a tap opens the student's profile.
 */
@Component({
  selector: 'app-student-search',
  imports: [Icon, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKey($event)',
    '(document:click)': 'onDocClick($event)',
  },
  template: `
    <div class="search-box" [class.open]="open()">
      <app-icon name="search" [size]="18" />
      <label for="global-search" class="sr-only">{{ 'Find a student' | t }}</label>
      <input #box id="global-search" type="search" autocomplete="off" role="combobox"
             [attr.aria-expanded]="open()" aria-controls="global-search-list"
             [attr.aria-activedescendant]="open() && results().length ? 'gs-' + active() : null"
             [placeholder]="'Find a student: name, phone or admission no.' | t"
             [value]="q()" (input)="onInput($any($event.target).value)" (focus)="q().length >= 2 && open.set(true)"
             (keydown)="onBoxKey($event)">
      <kbd class="hint desktop-only">/</kbd>
    </div>
    @if (open()) {
      <ul id="global-search-list" class="results" role="listbox">
        @if (loading() && !results().length) {
          <li class="empty">{{ 'Searching…' | t }}</li>
        } @else if (!results().length) {
          <li class="empty">{{ 'No student found' | t }}</li>
        }
        @for (s of results(); track s.id; let i = $index) {
          <li [id]="'gs-' + i" role="option" [attr.aria-selected]="i === active()" [class.active]="i === active()"
              (mousedown)="$event.preventDefault()" (click)="go(s)" (mouseenter)="active.set(i)">
            <span class="avatar">{{ initials(s.name) }}</span>
            <span class="main">
              <strong>{{ s.name }}@if (!s.active) { <span class="left">{{ 'Left' | t }}</span> }</strong>
              <span>{{ batchName(s.batchId) }}@if (s.admissionNo) { · {{ s.admissionNo }} } · {{ s.parentPhone }}</span>
            </span>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { position: relative; display: block; }
    .search-box {
      display: flex; align-items: center; gap: 8px; height: 42px; padding: 0 12px;
      border: 1.5px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--muted);
    }
    .search-box:focus-within { border-color: var(--accent); }
    input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font: inherit; font-size: 14.5px; color: var(--ink); }
    .hint { font: inherit; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; padding: 0 6px; }
    .results {
      position: absolute; z-index: 40; left: 0; right: 0; top: 46px; margin: 0; padding: 6px; list-style: none;
      background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
      box-shadow: 0 12px 32px rgba(14, 19, 37, 0.14); max-height: 60dvh; overflow: auto;
    }
    li { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 10px; cursor: pointer; }
    li.active { background: var(--neutral-bg); }
    li.empty { cursor: default; color: var(--muted); font-size: 14px; }
    .avatar { width: 34px; height: 34px; font-size: 13px; flex-shrink: 0; }
    .main { display: flex; flex-direction: column; min-width: 0; }
    .main strong { font-size: 14.5px; }
    .main span { font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .left { margin-left: 6px; font-size: 11px; font-weight: 600; color: var(--warn-dark); }
  `,
})
export class StudentSearch {
  private readonly students = inject(StudentService);
  private readonly batchService = inject(BatchService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  protected readonly q = signal('');
  protected readonly results = signal<Student[]>([]);
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly active = signal(0);
  private readonly batches = signal<Batch[]>([]);
  private readonly names = computed(() => new Map(this.batches().map((b) => [b.id, b.name])));
  private timer?: ReturnType<typeof setTimeout>;
  private request = 0;
  private batchesLoaded = false;

  protected initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
  }

  protected batchName(id: string): string {
    return this.names().get(id) ?? '';
  }

  protected onInput(v: string): void {
    this.q.set(v);
    clearTimeout(this.timer);
    if (v.trim().length < 2) {
      this.open.set(false);
      this.results.set([]);
      return;
    }
    if (!this.batchesLoaded) {
      this.batchesLoaded = true;
      this.batchService.list().subscribe({ next: (b) => this.batches.set(b), error: () => undefined });
    }
    this.loading.set(true);
    this.open.set(true);
    this.timer = setTimeout(() => this.search(v.trim()), 250);
  }

  private search(term: string): void {
    const req = ++this.request;
    this.students
      .page({ search: term, status: this.auth.isTeacher() ? 'Active' : 'All', page: 1, pageSize: 8 })
      .subscribe({
        next: (res) => {
          if (req !== this.request) return;
          this.results.set(res.items);
          this.active.set(0);
          this.loading.set(false);
        },
        error: () => {
          if (req !== this.request) return;
          this.results.set([]);
          this.loading.set(false);
        },
      });
  }

  protected go(s: Student): void {
    this.open.set(false);
    this.q.set('');
    this.results.set([]);
    this.box().nativeElement.blur();
    this.router.navigate(['/students', s.id]);
  }

  protected onBoxKey(e: KeyboardEvent): void {
    const n = this.results().length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      this.active.update((i) => (i + 1) % n);
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      this.active.update((i) => (i - 1 + n) % n);
    } else if (e.key === 'Enter' && n) {
      e.preventDefault();
      this.go(this.results()[this.active()]!);
    } else if (e.key === 'Escape') {
      this.open.set(false);
      this.box().nativeElement.blur();
    }
  }

  /** "/" or Ctrl+K (Cmd+K) jumps to the search box, unless you're typing somewhere else. */
  protected onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
      e.preventDefault();
      this.box().nativeElement.focus();
      this.box().nativeElement.select();
    }
  }

  protected onDocClick(e: MouseEvent): void {
    if (!this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }
}
