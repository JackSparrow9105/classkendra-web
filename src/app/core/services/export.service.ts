import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ExportKind } from '../models/models';
import { ApiService } from './api.service';

/** Excel downloads. Every download is written to the activity log by the API. */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly api = inject(ApiService);

  /** GET /exports/{kind}?from=&to=&status= → saves an .xlsx file. */
  download(kind: ExportKind, opts: { from?: string; to?: string; status?: string } = {}): Observable<void> {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts)) if (v) params[k] = v;
    const name = kind === 'students' ? `classkendra-students.xlsx` : `classkendra-${kind}-${opts.from ?? ''}-to-${opts.to ?? ''}.xlsx`;
    return this.api.getBlob(`exports/${kind}`, params).pipe(map((blob) => save(blob, name)));
  }

  /** GET /exports/all → a .zip of Excel files with all of the centre's data (owner only). */
  downloadAll(): Observable<void> {
    const today = new Date().toISOString().slice(0, 10);
    return this.api.getBlob('exports/all').pipe(map((blob) => save(blob, `classkendra-all-data-${today}.zip`)));
  }
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
