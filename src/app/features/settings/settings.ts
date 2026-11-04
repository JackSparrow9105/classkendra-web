import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { MockDb } from '../../core/mock/mock-db';
import { AuthService } from '../../core/services/auth.service';
import { CentreService } from '../../core/services/centre.service';
import { errorMessage } from '../../core/interceptors/auth.interceptor';
import { BottomSheet } from '../../shared/bottom-sheet';
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
  imports: [ReactiveFormsModule, RouterLink, Icon, BottomSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly mock = inject(MockDb);
  protected readonly centre = inject(CentreService);

  protected readonly user = this.auth.user;
  protected readonly isDemo = environment.useMock;
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly links: SettingLink[] = [
    { path: '/batches', icon: 'cap', title: 'Batches', sub: 'Add, rename or change timings' },
    { path: '/fees/setup', icon: 'wallet', title: 'Fees and reminders', sub: 'Monthly fees, due date, reminder rules' },
    { path: '/plans', icon: 'crown', title: 'Plan and billing', sub: 'Trial, plans and message usage' },
    { path: '/students/import', icon: 'upload', title: 'Import students', sub: 'Upload a list or send us your register' },
  ];

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    ownerName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    city: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    this.centre.load().subscribe();
  }

  protected edit(): void {
    const c = this.centre.centre();
    if (!c) return;
    this.form.reset({ name: c.name, ownerName: c.ownerName, city: c.city });
    this.error.set('');
    this.editing.set(true);
  }

  protected save(): void {
    const c = this.centre.centre();
    if (!c || this.form.invalid) return;
    this.busy.set(true);
    this.centre.save({ ...this.form.getRawValue(), subjects: c.subjects, sizeBand: c.sizeBand }).subscribe({
      next: () => {
        this.busy.set(false);
        this.editing.set(false);
        this.toast.show('Centre details saved');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  protected inviteStaff(): void {
    this.toast.show('Staff invites come in the next version');
  }

  protected resetDemo(): void {
    if (!confirm('Delete all demo data and start setup again?')) return;
    this.mock.clearAll();
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  protected logout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
