import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Holiday } from '../../core/models/models';
import { LabelService } from '../../core/labels';
import { AuthService } from '../../core/services/auth.service';
import { HolidayService } from '../../core/services/holiday.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { BottomSheet } from '../../shared/bottom-sheet';
import { isoDate, niceDate } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

/**
 * /holidays — one holiday list for the whole school or coaching centre.
 * On a holiday: parents get no absent alerts, fee reminders wait for the next working day,
 * and (schools with staff attendance) staff are not marked absent. The owner adds and removes; office staff can see.
 */
@Component({
  selector: 'app-holidays',
  imports: [FormsModule, RouterLink, Icon, BottomSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div class="row">
          <a routerLink="/settings" class="icon-btn" aria-label="Back to settings"><app-icon name="chevron-left" /></a>
          <h1 class="page-title">Holidays</h1>
        </div>
        @if (auth.isOwner()) {
          <button type="button" class="btn btn-primary sm" (click)="openAdd()"><app-icon name="plus" [size]="16" [stroke]="2" /> Add</button>
        }
      </header>

      <div class="note">
        <app-icon name="info" [size]="18" />
        <span>On a holiday, parents don't get absent alerts and fee reminders wait for the next working day.
          @if (labels.isSchool()) { Staff are not marked absent. }</span>
      </div>

      @if (loaded() && list().length === 0) {
        <div class="card stack" style="align-items: center; text-align: center; padding: 28px">
          <strong>No holidays added</strong>
          <span class="muted">Add Diwali, Holi, summer break and so on.</span>
          @if (auth.isOwner()) { <button type="button" class="btn btn-primary" (click)="openAdd()">Add a holiday</button> }
        </div>
      }

      @if (coming().length) {
        <section class="stack">
          <h2 class="h2">Coming up</h2>
          <div class="card card--list">
            @for (h of coming(); track h.id) {
              <div class="list-row">
                <span class="avatar accent"><app-icon name="calendar-check" [size]="18" /></span>
                <div class="list-main">
                  <span class="list-title">{{ h.name }}@if (isToday(h)) { <span class="badge ok" style="margin-left: 6px">Today</span> }</span>
                  <span class="list-sub">{{ dates(h) }}</span>
                </div>
                @if (auth.isOwner()) {
                  <button type="button" class="icon-btn plain" [attr.aria-label]="'Remove ' + h.name" (click)="remove(h)"><app-icon name="trash" [size]="18" /></button>
                }
              </div>
            }
          </div>
        </section>
      }

      @if (past().length) {
        <section class="stack">
          <h2 class="h2">Last 30 days</h2>
          <div class="card card--list">
            @for (h of past(); track h.id) {
              <div class="list-row">
                <span class="avatar"><app-icon name="calendar-check" [size]="18" /></span>
                <div class="list-main">
                  <span class="list-title">{{ h.name }}</span>
                  <span class="list-sub">{{ dates(h) }}</span>
                </div>
                @if (auth.isOwner()) {
                  <button type="button" class="icon-btn plain" [attr.aria-label]="'Remove ' + h.name" (click)="remove(h)"><app-icon name="trash" [size]="18" /></button>
                }
              </div>
            }
          </div>
        </section>
      }
    </div>

    @if (adding()) {
      <app-bottom-sheet title="Add holiday" (closed)="adding.set(false)">
        <form class="stack" (ngSubmit)="add()" novalidate style="gap: 14px">
          <div class="field">
            <label class="label" for="hd-name">Name</label>
            <input id="hd-name" name="name" class="input" maxlength="60" placeholder="e.g. Diwali break" [ngModel]="name()" (ngModelChange)="name.set($event)">
          </div>
          <div class="row" style="gap: 10px">
            <div class="field" style="flex: 1">
              <label class="label" for="hd-from">From</label>
              <input id="hd-from" name="from" class="input" type="date" [ngModel]="from()" (ngModelChange)="setFrom($event)">
            </div>
            <div class="field" style="flex: 1">
              <label class="label" for="hd-to">To</label>
              <input id="hd-to" name="to" class="input" type="date" [min]="from()" [ngModel]="to()" (ngModelChange)="to.set($event)">
            </div>
          </div>
          <span class="muted" style="font-size: 12.5px">For one day, leave both dates the same.</span>
          @if (error()) { <div class="note warn" role="alert">{{ error() }}</div> }
          <button type="submit" class="btn btn-primary lg block" [disabled]="busy()">Add holiday</button>
        </form>
      </app-bottom-sheet>
    }
  `,
})
export class Holidays {
  private readonly svc = inject(HolidayService);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  protected readonly labels = inject(LabelService);

  protected readonly list = signal<Holiday[]>([]);
  protected readonly loaded = signal(false);
  protected readonly adding = signal(false);
  protected readonly busy = signal(false);
  protected readonly name = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly error = signal('');

  private readonly today = isoDate();
  protected readonly coming = computed(() => this.list().filter((h) => h.to >= this.today));
  protected readonly past = computed(() => this.list().filter((h) => h.to < this.today).reverse());

  constructor() {
    this.load();
  }

  protected isToday(h: Holiday): boolean {
    return h.from <= this.today && this.today <= h.to;
  }

  protected dates(h: Holiday): string {
    return h.from === h.to ? niceDate(h.from) : `${niceDate(h.from)} – ${niceDate(h.to)} · ${h.days} days`;
  }

  protected openAdd(): void {
    this.name.set('');
    this.from.set('');
    this.to.set('');
    this.error.set('');
    this.adding.set(true);
  }

  protected setFrom(v: string): void {
    this.from.set(v);
    if (!this.to() || this.to() < v) this.to.set(v);
  }

  protected add(): void {
    if (!this.name().trim()) return this.error.set('Give the holiday a name.');
    if (!this.from()) return this.error.set('Choose the date.');
    this.busy.set(true);
    this.svc.add(this.name().trim(), this.from(), this.to()).subscribe({
      next: (h) => {
        this.busy.set(false);
        this.adding.set(false);
        this.toast.show(`${h.name} added`);
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  protected remove(h: Holiday): void {
    if (!confirm(`Remove the holiday “${h.name}”?`)) return;
    this.svc.remove(h.id).subscribe({
      next: () => {
        this.toast.show('Holiday removed');
        this.load();
      },
      error: (e) => this.toast.show(errorMessage(e)),
    });
  }

  private load(): void {
    this.svc.list().subscribe({
      next: (rows) => {
        this.list.set(rows);
        this.loaded.set(true);
      },
      error: (e) => {
        this.loaded.set(true);
        this.toast.show(errorMessage(e));
      },
    });
  }
}
