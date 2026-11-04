import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Batch, StudentImportRow } from '../../core/models/models';
import { LabelService } from '../../core/labels';
import { BatchService } from '../../core/services/batch.service';
import { ImportResult, StudentService } from '../../core/services/student.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { Icon, IconName } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

type Method = 'manual' | 'file' | 'whatsapp';

/** Your support WhatsApp number for the "send us your register" option. */
const SUPPORT_WHATSAPP = '919999999999';

@Component({
  selector: 'app-student-import',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './student-import.html',
  styleUrl: './students.scss',
})
export class StudentImport {
  private readonly students = inject(StudentService);
  private readonly batchService = inject(BatchService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly labels = inject(LabelService);

  protected readonly options: { id: Method; icon: IconName; title: string; desc: string }[] = [
    { id: 'manual', icon: 'user-plus', title: 'Add one by one', desc: 'Name, parent number and class or batch. About 15 seconds each.' },
    { id: 'file', icon: 'upload', title: 'Upload a list', desc: 'Already have your students in Excel? Save it as CSV and upload.' },
    { id: 'whatsapp', icon: 'whatsapp', title: 'Send us your register', desc: 'Share photos of your register on WhatsApp. We enter it within 24 hours.' },
  ];

  protected readonly method = signal<Method>('manual');
  protected readonly batches = signal<Batch[]>([]);
  protected readonly rows = signal<StudentImportRow[]>([]);
  protected readonly fileName = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly result = signal<ImportResult | null>(null);

  constructor() {
    this.batchService.list().subscribe((b) => this.batches.set(b));
  }

  protected next(): void {
    const m = this.method();
    if (m === 'manual') this.router.navigateByUrl('/students/new');
    if (m === 'whatsapp') {
      const text = encodeURIComponent('Hi, please add my students to ClassKendra. Sending photos of my register.');
      window.open(`https://wa.me/${SUPPORT_WHATSAPP}?text=${text}`, '_blank', 'noopener');
    }
  }

  protected async onFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.error.set('');
    this.result.set(null);
    this.fileName.set(file.name);
    if (!file.name.toLowerCase().endsWith('.csv')) {
      // The .NET API will read .xlsx directly (e.g. with ClosedXML). Until then, CSV is parsed here.
      this.error.set('For now please save the sheet as CSV (File › Save as › CSV) and upload that.');
      this.rows.set([]);
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) this.error.set('No students found. Check the file has Name, Parent phone and Batch columns.');
    this.rows.set(parsed);
  }

  protected upload(): void {
    this.busy.set(true);
    this.students.import(this.rows()).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.result.set(r);
        this.rows.set([]);
        if (r.added) this.toast.show(`${r.added} students added`);
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  protected downloadSample(): void {
    const batch = this.batches()[0]?.name ?? 'Class 10 · Maths';
    const col = this.labels.l().group;
    const csv = `Name,Parent phone,${col}\nAarav Gupta,9876543210,${batch}\nAnanya Rao,9812345678,${batch}\n`;
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'classkendra-students-sample.csv' });
    a.click();
    URL.revokeObjectURL(url);
  }
}

/** Reads "Name, Parent phone, Batch" rows. Handles quoted cells and a header row in any column order. */
function parseCsv(text: string): StudentImportRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const iName = header.findIndex((h) => h.includes('name') && !h.includes('parent'));
  const iPhone = header.findIndex((h) => /phone|mobile|whatsapp/.test(h));
  const iBatch = header.findIndex((h) => /batch|class/.test(h));
  if (iName < 0 || iPhone < 0 || iBatch < 0) return [];
  return lines.slice(1).map((line) => {
    const c = splitCsvLine(line);
    return { name: c[iName] ?? '', parentPhone: c[iPhone] ?? '', batchName: c[iBatch] ?? '' };
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}
