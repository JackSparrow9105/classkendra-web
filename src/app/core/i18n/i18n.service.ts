import { Injectable, Pipe, PipeTransform, inject, signal } from '@angular/core';
import { Lang } from '../models/models';
import { HI } from './hi';

const KEY = 'ck-lang';

/**
 * Runtime English/Hindi switch. The English text itself is the key, so templates stay readable:
 *   {{ 'Attendance' | t }}            -> "उपस्थिति"
 *   {{ '{n} days late' | t: { n: 3 } }} -> "3 दिन देर"
 * Anything without a Hindi entry in hi.ts simply shows in English. To translate more screens,
 * wrap their text in the `t` pipe and add the lines to hi.ts.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly lang = signal<Lang>(this.read() ?? 'en');

  constructor() {
    document.documentElement.lang = this.lang();
  }

  /** True once this phone has picked a language; otherwise pages may use the school's default. */
  hasPreference(): boolean {
    return this.read() !== null;
  }

  set(lang: Lang, remember = true): void {
    this.lang.set(lang);
    document.documentElement.lang = lang;
    if (remember) {
      try {
        localStorage.setItem(KEY, lang);
      } catch {
        /* ignore */
      }
    }
  }

  t(text: string, params?: Record<string, string | number>): string {
    let out = this.lang() === 'hi' ? (HI[text] ?? text) : text;
    if (params) for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, String(v));
    return out;
  }

  private read(): Lang | null {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'hi' || v === 'en' ? v : null;
    } catch {
      return null;
    }
  }
}

@Pipe({ name: 't', pure: false })
export class TPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(text: string, params?: Record<string, string | number>): string {
    return this.i18n.t(text, params);
  }
}
