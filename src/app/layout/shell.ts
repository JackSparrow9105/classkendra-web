import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { CentreService } from '../core/services/centre.service';
import { Icon, IconName } from '../shared/icon';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly centre = inject(CentreService);
  protected readonly auth = inject(AuthService);

  /** Teachers only mark attendance and see their students; owner and office staff get everything. */
  protected readonly nav = computed<NavItem[]>(() =>
    this.auth.isTeacher()
      ? [
          { path: '/attendance', label: 'Attendance', icon: 'calendar-check' },
          { path: '/students', label: 'Students', icon: 'users' },
          { path: '/settings', label: 'Account', icon: 'settings' },
        ]
      : [
          { path: '/dashboard', label: 'Home', icon: 'home' },
          { path: '/fees', label: 'Fees', icon: 'wallet' },
          { path: '/attendance', label: 'Attendance', icon: 'calendar-check' },
          { path: '/students', label: 'Students', icon: 'users' },
        ],
  );

  constructor() {
    this.centre.load().subscribe();
  }
}
