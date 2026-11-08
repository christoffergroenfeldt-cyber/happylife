# Happy Life 💛

A family web app (installable on iPhone from Safari) for daily tasks, plans for the
children, family tasks anyone can take, vacations and anniversaries, and "moments"
between husband and wife with reminders when it's time again.

Danish, English and French – switch on the login screen or under **Family → Language**.

## How it works

| Area | What it does |
|---|---|
| **Roles** | Each person has one or more roles: child, mother, father, husband, wife. Everything is assigned to roles or people, and the database only returns what your roles may see. |
| **Plans** | Mother/father create plans (e.g. "Morning routine") with tasks assigned to specific children – daily, weekly, monthly, yearly, once, or every X days. Each child ticks off their own; parents see ✓/○ per child. |
| **Family tasks** | Open to everyone (or chosen roles), with "people needed". Anyone takes it for the current period; it's full when enough have taken it, and done when a taker ticks it. Like HØBK activities. |
| **Points** | A parent can give a task points (0–1000). Whoever ticks it off earns them; undo takes them back. Each child sees their own ⭐ counter on Home and Tasks, parents see every child's, with this week's points too. Points are kept even if the task is later deleted. |
| **Role tasks** | E.g. a husband-only task – invisible to the wife and children. |
| **Moments** | "When did I last …" – each with its own reminder interval in days. When the days have passed it appears on Home under *Time for something special* with an idea. Defaults on a new family: flowers + surprise (husband), surprise (wife), out together + trip together (both). |
| **Calendar** | Vacations, anniversaries, birthdays. Yearly events show how many years; each shows on Home a chosen number of days before. |
| **Family** | Invite code, members and roles. Only the admin (whoever created the family) can change roles, so a child can't make themself "wife". |

Privacy is enforced in the database (Row Level Security), not just hidden in the app.

## Setup (once, ~10 minutes)

### 1. Supabase
1. Create a free project at <https://supabase.com> (region: Frankfurt/EU).
2. **SQL Editor → New query** → paste all of `schema.sql` → **Run**.
3. **Sign-in emails** – the app signs people in with a one-time code sent by email (no
   passwords; same as the Friends app). New addresses get an account automatically.
   - **Authentication → Emails → Templates**: in both **Magic Link** and **Confirm signup**,
     make sure the body contains the code, e.g.
     `<h2>Your Happy Life code</h2><p>Enter this code in the app: <b>{{ .Token }}</b></p>`
   - **Authentication → Emails → SMTP Settings**: Supabase's built-in email only sends to
     members of your Supabase team, so add your own SMTP (the same settings as the Friends
     project work): Gmail with an app password (`smtp.gmail.com`, port `587`) or Brevo.
4. **Authentication → URL Configuration**: set **Site URL** to
   `https://christoffergroenfeldt-cyber.github.io/happylife/`.
5. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

### 2. Config
Put the two values into `config.js` and commit it. The anon key is meant to be public –
Row Level Security protects the data.

### 3. GitHub Pages
Repo **Settings → Pages** → Source: *Deploy from a branch* → `main` / root → Save.
After a minute the app is at `https://christoffergroenfeldt-cyber.github.io/happylife/`.

### 4. Reminders (push notifications)
A task can have a reminder: a time of day and how many days before the deadline. The
deadline is the last day of the task's period (daily: that day, weekly: Sunday, monthly:
last day of the month, yearly: 31 Dec, once: the due date). Every 5 minutes the `remind`
Edge Function sends due reminders once, to the people who still have to do the task.

1. **Edge Functions → Secrets** – add:
   | Name | Value |
   |---|---|
   | `VAPID_PUBLIC_KEY` | the key in `config.js` |
   | `VAPID_PRIVATE_KEY` | the private key that goes with it (never commit it) |
   | `VAPID_SUBJECT` | `mailto:` + your email |
   | `APP_URL` | `https://christoffergroenfeldt-cyber.github.io/happylife/` |
2. **Edge Functions → Deploy a new function → Via editor**: name `remind`, paste
   `supabase/functions/remind/index.ts`, deploy (keep **Verify JWT** on).
3. **SQL Editor**: run `cron.sql` once (runs the function every 5 minutes).

Each person turns notifications on in the app under **Family → Notifications**. On iPhone this
only works when the app is added to the Home Screen and opened from there (iOS 16.4+).

To make new VAPID keys: `npx web-push generate-vapid-keys`, put the public key in
`config.js` and both keys in the secrets.

### 5. The family
1. Open the link in Safari → enter your email → enter the code from the email →
   **Create family** → pick your roles (e.g. father + husband).
2. **Family** tab shows the invite code. Each family member signs in the same way and
   chooses **Join family** with the code.
3. Safari → Share → **Add to Home Screen** to get the app icon.

Children need their own login: any email address works as long as someone can read the
code (e.g. a parent's address with `+` – `mum+anna@gmail.com` – on Gmail).

## Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | Page and design (light/dark mode) |
| `app.js` | The app |
| `i18n.js` | Danish/English/French texts and moment ideas |
| `dates.js` | Period and reminder calculations |
| `config.js` | Your Supabase URL and anon key |
| `schema.sql` | Database, security rules and functions – safe to re-run |
| `sw.js`, `manifest.json`, icons | Home-screen app, offline shell, showing notifications |
| `supabase/functions/remind/index.ts` | Edge Function that sends task reminders |
| `cron.sql` | Runs the reminder function every 5 minutes |
| `tests/remind.test.mjs` | Tests for the reminder rules: `node --test tests/remind.test.mjs` |

## Ideas for later
- Push notifications when a moment is due (the `remind` function can do this the same way)
- Rewards to spend points on
- Shared shopping list
