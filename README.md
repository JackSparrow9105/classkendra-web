# ClassKendra — Angular web app

Mobile-first front end for ClassKendra (coaching centre fees, attendance and parent reminders).
Angular 22 · standalone components · signals · reactive forms · SCSS · no UI library.

It runs fully on its own today using an in-memory mock of the API, so every screen works before the .NET backend exists.

## Run it

```bash
npm install
npm start          # http://localhost:4200
```

Demo login: any 10-digit mobile number starting 6–9, then OTP **123456**.
On the empty dashboard, tap **"Just exploring? Fill with sample data"** to see a busy centre.
Settings › **Reset demo data** starts again from sign-up.

Production build: `npm run build` (output in `dist/classkendra-web/browser`).

## What's in it

| Screen | Route | Notes |
|---|---|---|
| Sign in | `/login`, `/otp` | Mobile number + OTP, no password |
| Setup (2 steps) | `/setup/centre`, `/setup/batches` | Centre details, then batches; lands on dashboard |
| Dashboard | `/dashboard` | "Finish setting up" checklist until students and fees exist, then collected / pending / late fees; trial badge |
| Students | `/students`, `/students/new`, `/students/:id` | Search, batch filter, "Save and add another", contact picker on Android |
| Add students other ways | `/students/import` | One by one (default), CSV upload, or "send us your register" on WhatsApp |
| Fee setup | `/fees/setup` | Monthly fee per batch, due day, reminder rules, live WhatsApp message preview |
| Fees | `/fees` | Pending / Paid / All, month picker, tap a row to record cash/UPI or remind, "Remind all" |
| Attendance | `/attendance` | Everyone present by default, tap absentees, save alerts parents |
| Plans | `/plans` | Trial status, message usage, monthly/yearly plans |
| Settings | `/settings` | Centre details, batches, fees, plans, sign out |

Phone: bottom navigation. 960px and wider: side navigation.

## Folder structure

```
src/app/
  core/
    models/models.ts        ← the API contract (mirror these as DTOs in .NET)
    services/               ← one service per API area; each method documents its endpoint
    mock/mock-db.ts         ← in-memory API stand-in (delete when the backend is done)
    guards/guards.ts        ← signed in, has a centre, owner-only
    interceptors/           ← adds the JWT, handles 401, readable error messages
  layout/shell.*            ← bottom nav (phone) / side nav (desktop)
  features/                 ← one folder per area: auth, setup, dashboard, students, fees, attendance, plans, settings
  shared/                   ← icon, toast, bottom sheet, formatting helpers
src/styles.scss             ← the theme: colours, type, buttons, inputs, cards
src/environments/environment.ts  ← useMock + apiUrl
```

## Connecting the .NET API

1. In `src/environments/environment.ts` set `apiUrl` to your API (e.g. `https://localhost:7001/api/v1`) and `useMock: false`.
2. Every service already has the real call next to the mock, for example:

   ```ts
   /** GET /students?batchId=&search= */
   list(filter) {
     if (!environment.useMock) return this.api.get<Student[]>('students', filter);
     ...mock...
   }
   ```
   You can switch one area at a time by changing the condition in that service while the rest stays on the mock.
3. Return JSON in the shapes from `core/models/models.ts` (camelCase, dates as `yyyy-MM-dd`, months as `yyyy-MM`, money in whole rupees).
4. Errors: return `{ "message": "..." }` with a 4xx status; the app shows that sentence to the user.
5. Enable CORS for `http://localhost:4200` in the API during development.

### Endpoints the app calls

| Method | Path | Used by |
|---|---|---|
| POST | `/auth/otp` | login — send OTP |
| POST | `/auth/verify` | OTP — returns `{ token, user }` (user.tenantId is null for a new owner) |
| GET / POST / PUT | `/centre` | setup step 1, settings |
| PUT | `/centre/setup-complete` | end of setup |
| GET / POST | `/batches` · PUT / DELETE `/batches/{id}` | batches |
| GET / POST | `/students` · GET / PUT / DELETE `/students/{id}` | students (DELETE = soft delete) |
| POST | `/students/import` | import (server should accept .xlsx as multipart) |
| GET | `/fees/settings` · PUT `/fees/setup` | fee setup |
| GET | `/fees?month=&status=&search=` | fees list (Pending includes older unpaid months) |
| POST | `/fees/{id}/remind` · `/fees/remind-all?month=` | reminders → Notifications outbox |
| POST | `/fees/{id}/payments` | record cash/UPI payment |
| GET / POST | `/attendance/{batchId}?date=` | attendance (save alerts only newly absent students) |
| GET | `/dashboard` | dashboard summary |
| GET | `/billing/plans` · POST `/billing/checkout` | plans |

## Before going live

- Remove `core/mock` and the demo-only bits (sample data button, reset demo data, OTP hint).
- Replace `SUPPORT_WHATSAPP` in `features/students/student-import.ts` with your number.
- Add the Angular service worker (`ng add @angular/pwa`) so owners can install it on their phone.
