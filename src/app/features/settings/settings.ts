import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { MockDb } from '../../core/mock/mock-db';
import { LabelService } from '../../core/labels';
import { I18nService, TPipe } from '../../core/i18n/i18n.service';
import { InstallService } from '../../core/install.service';
import { Lang } from '../../core/models/models';
import { AuthService } from '../../core/services/auth.service';
import { CentreService, logoUrl } from '../../core/services/centre.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { BottomSheet } from '../../shared/bottom-sheet';
import { shrinkImage } from '../../shared/image';
import { BackupEmail } from './backup-email';
import { Icon, IconName } from '../../shared/icon';
import { ToastService } from '../../shared/toast';

interface SettingLink {
  path: string;
  icon: IconName;
  title: string;
  sub: string;
}

@Component({
  selector: 'app-settings',
  imports: [ReactiveFormsModule, RouterLink, Icon, BottomSheet, TPipe, BackupEmail],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly mock = inject(MockDb);
  protected readonly auth = inject(AuthService);
  protected readonly centre = inject(CentreService);
  protected readonly labels = inject(LabelService);
  protected readonly i18n = inject(I18nService);
  protected readonly installer = inject(InstallService);

  protected readonly user = this.auth.user;
  protected readonly isDemo = environment.useMock;
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly showIosHelp = signal(false);
  protected readonly logoBusy = signal(false);
  protected readonly logoSrc = computed(() => logoUrl(this.centre.centre()?.logoId));

  /** What each role can open from Settings. Teachers only get their account. */
  protected readonly links = computed<SettingLink[]>(() => {
    if (this.auth.isTeacher()) return [];
    const l = this.labels.l();
    const school = this.labels.isSchool();
    const office: SettingLink[] = [
      { path: '/reports', icon: 'chart', title: 'Collection report', sub: 'Monthly collection by class and mode, Excel download' },
      { path: '/messages', icon: 'whatsapp', title: 'WhatsApp messages', sub: 'Every reminder, alert and receipt, and whether it was delivered' },
      { path: '/batches', icon: 'cap', title: l.groups, sub: school ? 'Add classes and sections' : 'Add, rename or change timings' },
      { path: '/fees/setup', icon: 'wallet', title: 'Fees and reminders', sub: 'Fee types, amounts, due date, reminder rules' },
      { path: '/students/import', icon: 'upload', title: 'Import students', sub: 'Upload a list or send us your register' },
    ];
    if (!this.auth.isOwner()) return office;
    return [
      ...office,
      {
        path: '/promote',
        icon: 'chevron-right',
        title: school ? 'Promote to next class' : 'Move students between batches',
        sub: school ? 'At the start of the new session' : 'Move a whole batch or mark it finished',
      },
      { path: '/staff', icon: 'user-plus', title: 'Staff and teachers', sub: 'Who can sign in and what they can do' },
      { path: '/plans', icon: 'crown', title: 'Plan and billing', sub: 'Trial, plans and message usage' },
    ];
  });

  protected readonly roleText = computed(() => {
    const r = this.auth.role();
    return r === 'Owner' ? 'Owner' : r === 'Teacher' ? 'Teacher' : 'Office staff';
  });

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    ownerName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    city: new FormControl('', { nonNullable: true }),
    address: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(300)] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.pattern(/^\s*\+?[0-9 ()-]{6,20}\s*$/)] }),
  });

  constructor() {
    this.centre.load().subscribe();
  }

  protected setAppLang(l: Lang): void {
    this.i18n.set(l);
  }

  protected setMessageLang(l: Lang): void {
    this.centre.setMessageLanguage(l).subscribe(() =>
      this.toast.show(l === 'hi' ? 'Parents will get WhatsApp messages in Hindi' : 'Parents will get WhatsApp messages in English'),
    );
  }

  protected async install(): Promise<void> {
    if (this.installer.canPrompt()) {
      const ok = await this.installer.install();
      if (ok) this.toast.show('ClassKendra added to your home screen');
    } else {
      this.showIosHelp.set(true);
    }
  }

  protected edit(): void {
    const c = this.centre.centre();
    if (!c) return;
    this.form.reset({ name: c.name, ownerName: c.ownerName, city: c.city, address: c.address ?? '', phone: c.phone ?? '' });
    this.error.set('');
    this.editing.set(true);
  }

  protected save(): void {
    const c = this.centre.centre();
    if (!c || this.form.invalid) return;
    this.busy.set(true);
    this.centre
      .save({ ...this.form.getRawValue(), subjects: c.subjects, sizeBand: c.sizeBand, institutionType: c.institutionType })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.editing.set(false);
          this.toast.show(`${this.labels.l().org} details saved`);
        },
        error: (e) => {
          this.busy.set(false);
          this.error.set(errorMessage(e));
        },
      });
  }

  protected async pickLogo(event: Event): Promise<void> {
    const picker = event.target as HTMLInputElement;
    const file = picker.files?.[0];
    picker.value = ''; // so picking the same file again still works
    if (!file) return;
    this.error.set('');
    this.logoBusy.set(true);
    try {
      const image = await shrinkImage(file);
      this.centre.uploadLogo(image).subscribe({
        next: () => {
          this.logoBusy.set(false);
          this.toast.show('Logo saved. New receipts will show it.');
        },
        error: (e) => {
          this.logoBusy.set(false);
          this.error.set(errorMessage(e));
        },
      });
    } catch (e) {
      this.logoBusy.set(false);
      this.error.set(e instanceof Error ? e.message : "The logo couldn't be saved.");
    }
  }

  protected removeLogo(): void {
    if (!confirm('Remove the logo from new receipts? Old receipts keep it.')) return;
    this.logoBusy.set(true);
    this.centre.removeLogo().subscribe({
      next: () => {
        this.logoBusy.set(false);
        this.toast.show('Logo removed');
      },
      error: (e) => {
        this.logoBusy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  protected resetDemo(): void {
    if (!confirm('Delete all demo data and start setup again?')) return;
    this.mock.clearAll();
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  /** Teachers only (owner and staff must keep a PIN). */
  protected removePin(): void {
    if (!confirm(this.i18n.t('Turn off the app PIN on your account?'))) return;
    this.auth.removePin().subscribe({
      next: () => this.toast.show(this.i18n.t('App PIN turned off')),
      error: (e) => this.toast.show(errorMessage(e)),
    });
  }

  protected logout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
