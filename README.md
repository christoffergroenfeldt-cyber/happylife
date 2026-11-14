# Happy Life 💛

A family web app (installable on iPhone from Safari) for daily tasks, plans for the
children, family tasks anyone can take, house chores per room, vacations and anniversaries, and "moments"
between husband and wife with reminders when it's time again.

Danish, English and French – switch on the login screen or under **Setup → Language**.

## How it works

| Area | What it does |
|---|---|
| **Roles** | Each person has one or more roles: child, mother, father, husband, wife. Everything is assigned to roles or people, and the database only returns what your roles may see. |
| **Today** ☀️ | The husband's morning page (shown to anyone with the *husband* role, and where the app opens for him). **In the bag** – what each child must bring that day (fixed weekdays like PE kit on Tuesday, one date, or tied to a calendar event such as a costume for the school show), ticked off as packed and shared with the other parent; from 15:00 it shows tomorrow. Then the day's plan with times, his own tasks, and the next 30 days **for the kids** and **for his wife**, plus birthdays and anniversaries. An event belongs to a person through **Who is it about?** on the event, or by default from its phone calendar (Setup → Calendar from iPhone → 👤, e.g. *AULA – Victor* → Victor). School/sport/show events show under the kids even without a name; the sync guesses those types from titles like *forældremøde*, *kamp* or *forestilling*. |
| **Pages** | **I dag** – everyone's own day and the family overview in one: points strip, my tasks (picked or given; tick = done), the packing list (parents), today's program with Skema and family day, then foldable *Who does what today*, *Snart* (next 30 days, filtered by Kids / wife / Family / Special days / each calendar) and *Time for something special* (top 2). **Opgaver** – the picker; the circle *picks* a task. **Planlæg** (parents) – tasks and plans, the house (rooms × chores grid) and what was done. A task for the children defaults to 10 points. |
| **Look** 🌈 | “Sunrise in the garden”: fresh greens, low hills and trees above the tab bar. Each page has its own drawing at the top (art.js): a school bag (Today), a clipboard (Tasks), the house (House), the family hand in hand (Moments), a calendar page (Calendar), a cog with a plant (Setup); the front page has a rainbow from hill to hill under the sun. |
| **Skema** 📚 | Calendar → Skema: the children's school timetable as a week grid, one child at a time. Lessons come from phone calendars with the 📚 Skema switch on (Setup → Calendar from iPhone; on by default for names with *Skema* or *AULA*): timed one-day events that are a weekly series or a short subject code (DAN, MAT, FRA1). Lessons are left out of every other list; the Today page shows one 📚 line linking here. Subjects the family doesn't need (e.g. RESS) are hidden by tapping them under Setup → Skema. |
| **Family day** 🎲 | One outing a week on a day picked each week. Family members take turns choosing (order set under Moments → Family day ⚙️; *my wife* works before she joins). The chooser picks from an idea list – filter ☀️ outdoor / 🌧️ indoor / ⏱ short, each showing when you last did it – or types something new, plus day and time. Shown on Moments always, and on Home and Today from Thursday until it's chosen and in the week it happens. *Let X choose* passes the turn; *None this week* keeps it. |
| **Plans** | Mother/father create plans (e.g. "Morning routine") with tasks assigned to specific children – daily, weekly, monthly, yearly, once, or every X days. Each child ticks off their own; parents see ✓/○ per child. |
| **Family tasks** | Open to everyone (or chosen roles), with "people needed". Anyone takes it for the current period; it's full when enough have taken it, and done when a taker ticks it. Like HØBK activities. |
| **Points** | A parent can give a task points (0–1000). Whoever ticks it off earns them; undo takes them back. Each child sees their own ⭐ counter on Home and Tasks, parents see every child's, with this week's points too. Points are kept even if the task is later deleted. |
| **House** 🧹 | Three sections: **Dagligt** (everyday chores without a room – dishwasher, cat, table, dinner – on every day from the start), plus rooms/areas indoor and outdoor × chore types (Støvsug, Vask gulv, Slå græs …). Parents choose per room how often each chore is due (and optional points); children see the free chores grouped by room and tap **Done!**, or **I'll do it** to claim one first. Every chore shows when it was last done and by whom. Parents also get a 30-day log of who did what. Rooms and chore types are added, renamed, moved or deleted under **House → Setup**. |
| **Role tasks** | E.g. a husband-only task – invisible to the wife and children. |
| **Moments** | "When did I last …" – each with its own reminder interval in days. When the days have passed it appears on Home under *Time for something special* with an idea. Defaults on a new family: flowers + surprise (husband), surprise (wife), out together + trip together (both). |
| **Family moments** | Moments for the whole family: vacation, takeaway, restaurant, movie, weekend trip, theme park (plus your own). Each shows when you last did it, nudges when it's time again, and can be **planned** with a date and a note (e.g. *Legoland*) – planned ones show on Home in the last 14 days before. Everyone can log one; only parents add, change or plan them. Logging on the planned date clears the plan. |
| **Calendar** | Vacations, anniversaries, birthdays – typed in, or brought in from the parents' iPhone calendars with a Shortcut (guide: `kalender-guide.html`, opened from Setup → Calendar from iPhone). Yearly events show how many years; each shows on Home a chosen number of days before. |
| **Find events** 🔍 | Busy feeds like Aula, ForældreIntra or a timetable (subscribed on the iPhone) are set to **Pick** under Setup → Calendar from iPhone instead of **All**. Their events then wait under **Calendar → Find events**: a list grouped by day with a HØBK-style **Filter** sheet (calendars, period, new/followed/hidden, weekly series on/off; active choices as removable chips, remembered on the phone) and a search box. **Follow** puts an event in the calendar and opens it for tasks; **✕** hides it. If the school moves a followed event or renames it, the event and its tasks follow at the next sync; if it's cancelled, they go. |
| **Event tasks** | Parents tap an event and add tasks with quick suggestions – e.g. *Buy a present* 7 days before Anna's birthday, *Book a restaurant* 14 days before the anniversary. They repeat every year for yearly events, show on Home 14 days before they're due, and work with reminders and points like other tasks. A child can be given an event task without seeing the event. |
| **Login codes** | Signed in on one device? Setup → *Sign in on another device* makes an 8-character code (valid 10 minutes, works once). On the new device: *Have a login code…?* – no email needed. |
| **Price watch** 🏷️ | Anyone registers a product they want to buy (I dag → *Prisjagt*): name, model/size/colour, optional link, optional target price, used OK or not, who can see it (whole family / mum and dad / only me – for a secret present 🔒). Every morning a scheduled Claude task searches PriceRunner, Prisjagt and the shops (Danish shops or shipping to Denmark, DKK incl. VAT and shipping, in stock), saves every offer in `price_points` and the day's best in `price_watches`, plus a short 💡 tip (e.g. wait for Black Friday). At 08:00 the `remind` function sends each follower (🔔) one push with today's best price(s), the change since last time, 🎯 when under the target, and a link that opens the product. *Only when the price drops* sends fewer messages. Each product shows a price curve, the lowest price so far and the price history per day with links to the offers. A **comment** tells the price checker what matters (e.g. *only the lowest price*, *only products with good reviews from others*). **🔄 Tjek nu** (per product, *Tjek alle nu*, and offered after adding or changing a product) checks within minutes and sends whoever asked a push with the result. The checks run in the `price-check` GitHub Action (see below). |
| **School direct** 🏫 | Setup → *Skole direkte*: Aula and ForældreIntra straight from the school, without the phone. Enter the MitID username and/or iCal links (e.g. ForældreIntra), tap **Log in with MitID** and approve in the MitID app (the app shows MitID's QR code or code). A GitHub Action (`school/school_sync.py`, every 5 minutes it checks if anything is due; a sync every ~2 hours) brings Aula's calendar and the feeds in through `sync_calendar` as calendars *Aula – Victor* etc. – set them under *Calendar from iPhone* like the others – and Aula messages (latest per thread) and posts into `school_messages`, shown on **I dag** under 📬. Unofficial Aula access (the `aula` Python library); if Aula changes, it may stop until the library is updated. The job never opens unread Aula threads, so nothing is marked as read. |
| **Setup** (was Family) | Invite code, members and roles. Only the admin (whoever created the family) can change roles, so a child can't make themself "wife". |

Privacy is enforced in the database (Row Level Security), not just hidden in the app.

### House chores – default list
A new family starts with this list (an existing family without rooms can load it with
**House → Load the default list**). No chore is switched on until a parent sets how often.

- **Indoor rooms:** Carl, Victor, Elizabeth, Repo 1. sal, Køkken, Spisestue, Stue, Kontor, Mor & Far,
  Badeværelse Mor & Far, Badeværelse 1. sal, Badeværelse v. Kontor, Bryggers, Kælder, Fyrrum, Carport, Udekøkken
- **Indoor chores:** Støvsug, Vask gulv, Tør støv af, Vand planter, Ryd op
- **Outdoor areas:** Terasse Øst, Terasse Syd, Terasse Vest, Græsplane, Terasse Hjørne, Foran hus
- **Outdoor chores:** Slå græs, Fej blade, Fjern ukrudt, Rens, Giv olie
- **Daily (on every day):** Tøm opvaskemaskine, Giv kat mad, Giv kat vand, Tøm kattebakke, Dæk bord, Lav aftensmad

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

Each person turns notifications on in the app under **Setup → Notifications**. On iPhone this
only works when the app is added to the Home Screen and opened from there (iOS 16.4+).

To make new VAPID keys: `npx web-push generate-vapid-keys`, put the public key in
`config.js` and both keys in the secrets.

### Calendar from iPhone (Shortcut)
Each parent can bring birthdays and anniversaries in from their iPhone calendars. In the
app: **Setup → Calendar from iPhone → Get started** gives a personal sync code.
Only events from calendars switched on under Setup are saved; for all other calendars only
the calendar *name* is kept (so it can be switched on) – their event titles are discarded
on arrival. Calendars with names like *Birthdays / Fødselsdage* are on (and yearly) by default.
Imported events are visible to the parents only, until you change *Visible to*.

Build the Shortcut once in **Shortcuts → +** (then share it with the other parent):

1. **Text** – paste your sync code. **Set Variable** `Token`.
2. **Find Calendar Events** – *All Calendar Events*, **Start Date** *is in the next* **365 days**, *Limit* off.
3. **Text** – *Calendar Events* → **Title**. **Set Variable** `Titles`.
4. **Text** – *Calendar Events* → **Start Date**, **Date Format: ISO 8601** with time. **Set Variable** `Starts`.
5. **Text** – *Calendar Events* → **End Date**, same format. **Set Variable** `Ends`.
6. **Text** – *Calendar Events* → **Is All Day**. **Set Variable** `AllDay`.
7. **Text** – *Calendar Events* → **Calendar**. **Set Variable** `Calendars`.
8. **Get Contents of URL**
   - URL `https://ddafsqnpbplblfjovqpf.supabase.co/rest/v1/rpc/sync_calendar`
   - Method **POST**, Header `apikey` = the anon key from `config.js`
   - Request Body **JSON**, six Text fields: `p_token` = *Token*, `p_titles` = *Titles*,
     `p_starts` = *Starts*, `p_ends` = *Ends*, `p_allday` = *AllDay*, `p_calendars` = *Calendars*
9. **Show Notification** – *Contents of URL*. Name the shortcut **Happy Life Sync**.

Run it once (allow calendar access, *Always Allow* supabase.co). The notification says e.g.
*Happy Life: 14 begivenheder fra 1 af 5 kalendere.* Then pick calendars in the app under
Family and run it again. Add a daily **Personal Automation** (e.g. 07:00 → Run Shortcut
*Happy Life Sync*) to keep it up to date; events removed from the phone disappear (with
their tasks) at the next sync. A calendar that sends nothing keeps its events.

To share it: in the shortcut's settings → **Import Questions → Add Question** for the Text in
step 1 (*"Paste your sync code from Happy Life"*), then **Share → Copy iCloud Link**.

If something is wrong (e.g. a title with a line break), nothing is saved and the notification
says why. Also switch on **Settings → Apps → Shortcuts → Advanced → Allow Sharing Large
Amounts of Data**.

> Danish iPhone: *Find kalenderbegivenheder*, *Hent indholdet af URL*, *Er heldags*. Ja/Nej works.

### 5. The family
1. Open the link in Safari → enter your email → enter the code from the email →
   **Create family** → pick your roles (e.g. father + husband).
2. **Family** tab shows the invite code. Each family member signs in the same way and
   chooses **Join family** with the code.
3. Safari → Share → **Add to Home Screen** to get the app icon.

Children need their own login: any email address works as long as someone can read the
code (e.g. a parent's address with `+` – `mum+anna@gmail.com` – on Gmail).

### 6. School direct (Aula + ForældreIntra without the phone)
1. Make a random server key, e.g. `python3 -c "import secrets;print(secrets.token_urlsafe(32))"`.
2. Repo **Settings → Secrets and variables → Actions → New repository secret**: `HL_SCHOOL_KEY` = the key.
3. **SQL Editor**: `insert into server_keys values ('school', encode(sha256(convert_to('THE-KEY','UTF8')),'hex')) on conflict (name) do update set key_hash = excluded.key_hash;`
4. In the app: Setup → *Skole direkte* → MitID username / calendar links → **Save** → **Log in with MitID**.
   The workflow *School sync* picks it up within ~5–10 minutes (or run it at once under **Actions → School sync → Run workflow**).
   The MitID QR code changes every second, so show the app on another screen (e.g. an iPad) and scan with the phone – or type the code if MitID shows one.
5. When *Aula – …* calendars appear under *Calendar from iPhone*, switch the old phone *AULA …* calendars off to avoid doubles.

The repo is public, so the Action's log shows counts only. The Aula session is stored encrypted with the server key; the app can't read it.
GitHub pauses scheduled workflows in a public repo after 60 days without commits – re-enable it under Actions if that happens.

### Price watch – the price-check Action
`.github/workflows/price-check.yml` runs every 5 minutes. A quick step asks the database (`price_jobs()`, with the
server key) whether anything is due: products someone tapped **Tjek nu** on, or – from 02:30, so its 5-hour Claude usage window has ended before the family wakes – the daily check of
every product not checked yet today (max 10 per run). Only then Claude Code searches for prices with your Claude
subscription (`scripts/price-check-prompt.md`; tools: web search/fetch only, it never sees a key) and writes
`work/offers.json`; `scripts/price-check.mjs save` sends each product to `price_save()`, which checks every offer
again (shop, DKK price, https link) before saving. The log shows counts only.

Repository secrets (**Settings → Secrets and variables → Actions**):
| Name | Value |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | output of `claude setup-token` on a computer with Claude Code (Pro/Max subscription) |
| `HL_SCHOOL_KEY` | the server key (already there for School direct) |

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
| `supabase/functions/login-code/index.ts` | Edge Function that redeems login codes |
| `tests/remind.test.mjs` | Tests for the reminder and price-push rules: `node --test tests/remind.test.mjs` |
| `tests/price-watch.test.mjs` | Database tests for the price watch (PGlite) |

## Ideas for later
- Push notifications when a moment is due (the `remind` function can do this the same way)
- Rewards to spend points on
- Shared shopping list
