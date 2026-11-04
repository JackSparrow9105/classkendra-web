import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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

  protected readonly nav: NavItem[] = [
    { path: '/dashboard', label: 'Home', icon: 'home' },
    { path: '/fees', label: 'Fees', icon: 'wallet' },
    { path: '/attendance', label: 'Attendance', icon: 'calendar-check' },
    { path: '/students', label: 'Students', icon: 'users' },
  ];

  constructor() {
    this.centre.load().subscribe();
  }
}
