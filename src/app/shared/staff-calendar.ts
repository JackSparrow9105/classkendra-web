import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { StaffDay } from '../core/models/models';

/** A month of staff attendance days, coloured by status, with a legend. */
@Component({
  selector: 'app-staff-calendar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cal" role="grid" aria-label="Attendance calendar">
      @for (w of week; track $index) { <span class="wd" aria-hidden="true">{{ w }}</span> }
      @for (c of cells(); track $index) {
        @if (c) {
          <span class="day" [class]="'day ' + c.cls" [class.today]="c.date === today" [attr.title]="c.title" role="gridcell" [attr.aria-label]="c.title">{{ c.n }}</span>
        } @else {
          <span aria-hidden="true"></span>
        }
      }
    </div>
    <div class="legend">
      <span><i class="present"></i>On time</span>
      <span><i class="late"></i>Late</span>
      <span><i class="leave"></i>Leave</span>
      <span><i class="absent"></i>Absent</span>
      <span><i class="holiday"></i>Holiday</span>
      <span><i class="off"></i>Weekly off</span>
    </div>
  `,
  styles: `
    .cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
    .wd { text-align: center; font-size: 11.5px; font-weight: 700; color: var(--muted); }
    .day { height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; }
    .day.today { outline: 2px solid var(--accent); outline-offset: 1px; }
    .present { background: var(--ok-tint); color: var(--ok-dark); }
    .late { background: var(--warn-tint); color: var(--warn-dark); }
    .leave { background: var(--accent-tint); color: var(--accent-dark); }
    .absent { background: #fdecec; color: #9b1c1c; }
    .holiday { background: #fbf0d9; color: #7a4a00; }
    .off { background: var(--neutral-bg); color: var(--ink-2); }
    .empty { color: #8a90a3; border: 1px dashed var(--border); font-weight: 500; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 14px; padding-top: 10px; font-size: 12px; color: var(--ink-2); }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .legend i { width: 12px; height: 12px; border-radius: 4px; display: inline-block; }
  `,
})
export class StaffCalendar {
  readonly days = input.required<StaffDay[]>();
  protected readonly week = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  protected readonly today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  protected readonly cells = computed(() => {
    const days = this.days();
    if (days.length === 0) return [];
    const first = new Date(`${days[0]!.date}T00:00:00`).getDay();
    const blanks: null[] = Array.from({ length: first }, () => null);
    const label: Record<string, string> = {
      Present: 'On time', Late: 'Late', Leave: 'Leave', Absent: 'Absent', Holiday: 'Holiday', WeeklyOff: 'Weekly off',
      NotYet: 'Today', Upcoming: '', None: '',
    };
    const cls: Record<string, string> = {
      Present: 'present', Late: 'late', Leave: 'leave', Absent: 'absent', Holiday: 'holiday', WeeklyOff: 'off',
      NotYet: 'empty', Upcoming: 'empty', None: 'empty',
    };
    return [
      ...blanks,
      ...days.map((d) => ({
        n: Number(d.date.slice(8)),
        date: d.date,
        cls: cls[d.status] ?? 'empty',
        title: `${d.date.slice(8)}: ${label[d.status] ?? ''}${d.status === 'Late' ? ` (${d.lateMinutes} min)` : ''}${d.note ? ` · ${d.note}` : ''}`,
      })),
    ];
  });
}
