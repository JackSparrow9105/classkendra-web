import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MyStaffToday } from '../core/models/models';
import { PushNotificationsService } from '../core/services/push-notifications.service';
import { StaffAttendanceService, clockLabel, distance, timeLabel } from '../core/services/staff-attendance.service';
import { errorMessage } from '../core/interceptors/auth.interceptor';
import { Icon } from './icon';
import { PushPrompt } from './push-prompt';
import { ToastService } from './toast';

/**
 * Teacher / office staff home: check in at school (within the radius), check out, this month so far,
 * links to My attendance and Apply for leave. Shows only for schools with staff attendance.
 */
@Component({
  selector: 'app-staff-checkin-card',
  imports: [RouterLink, Icon, PushPrompt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './staff-checkin-card.html',
  styleUrl: './staff-checkin-card.scss',
})
export class StaffCheckinCard {
  private readonly svc = inject(StaffAttendanceService);
  private readonly toast = inject(ToastService);
  private readonly push = inject(PushNotificationsService);

  protected readonly enabled = signal(false);
  protected readonly data = signal<MyStaffToday | null>(null);
  protected readonly busy = signal(false);
  /** Metres from school, when the phone already allows location. */
  protected readonly away = signal<number | null>(null);
  protected readonly locError = signal('');
  protected readonly timeLabel = timeLabel;
  protected readonly clockLabel = clockLabel;

  protected readonly working = computed(() => {
    const s = this.data()?.status;
    return s !== 'Holiday' && s !== 'WeeklyOff' && s !== 'Leave';
  });
  protected readonly checkedIn = computed(() => !!this.data()?.checkInAt);
  protected readonly tooFar = computed(() => {
    const d = this.data();
    const a = this.away();
    return d != null && a != null && a > d.radius;
  });

  constructor() {
    this.svc.status().subscribe({
      next: (a) => {
        this.enabled.set(a.enabled);
        if (a.enabled) {
          this.load();
          void this.push.sync();
        }
      },
      error: () => undefined,
    });
  }

  private load(): void {
    this.svc.myToday().subscribe({
      next: (d) => {
        this.data.set(d);
        if (!d.checkInAt) void this.peekDistance();
      },
      error: () => this.enabled.set(false),
    });
  }

  /** Shows "You're at school · 60 m" before tapping, if the phone already allows location (no prompt here). */
  private async peekDistance(): Promise<void> {
    const d = this.data();
    if (!d || d.schoolLat == null || d.schoolLng == null || !('permissions' in navigator)) return;
    try {
      const state = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      if (state.state !== 'granted') return;
      const pos = await this.position();
      this.away.set(Math.round(distance(pos.coords.latitude, pos.coords.longitude, d.schoolLat, d.schoolLng!)));
    } catch {
      /* shown when they tap Check in */
    }
  }

  protected async checkIn(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.locError.set('');
    try {
      const pos = await this.position();
      const d = this.data();
      if (d?.schoolLat != null && d.schoolLng != null)
        this.away.set(Math.round(distance(pos.coords.latitude, pos.coords.longitude, d.schoolLat, d.schoolLng)));
      this.svc.checkIn(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null).subscribe({
        next: (r) => {
          this.busy.set(false);
          this.data.set(r);
          this.toast.show(r.status === 'Late' ? `Checked in · ${r.lateMinutes} min late` : 'Checked in · on time');
        },
        error: (e) => {
          this.busy.set(false);
          this.locError.set(errorMessage(e));
        },
      });
    } catch (e) {
      this.busy.set(false);
      const code = (e as GeolocationPositionError)?.code;
      this.locError.set(
        code === 1
          ? 'Location is blocked for ClassKendra. Allow location in your browser settings and try again.'
          : "Couldn't find your location. Turn on location (GPS) and try again.",
      );
    }
  }

  protected checkOut(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.svc.checkOut().subscribe({
      next: (r) => {
        this.busy.set(false);
        this.data.set(r);
        this.toast.show('Checked out');
      },
      error: (e) => {
        this.busy.set(false);
        this.toast.show(errorMessage(e));
      },
    });
  }

  private position(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject({ code: 2 });
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }
}
