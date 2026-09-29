<div align="center">

<img src="docs/hero.png" alt="Gastos: the Log screen in dark mode with money left this month, the color theme picker with eight themes, and History with spending and income rings" width="100%" />

# Gastos

**Know where your money went, in two taps a day.**

A phone-first expense tracker built for how people in the Philippines actually pay:
cash, cards, GCash, Maya and digital banks. It opens and works offline, syncs when you're back
online, and locks with one 4-digit MPIN that works on all your phones.

**[Open the live app →](https://gastos-six-phi.vercel.app)** · **[Download for Android (APK) →](https://github.com/MarkBasa96/gastos/releases/latest/download/Gastos-3.0.0.apk)**

<sub>iPhone: open the live app in Safari → Share → Add to Home Screen.</sub>

</div>

---

## Why it exists

Gastos started as a favour for someone who had never tracked her spending. One rule decided
every design choice: **if logging is inconvenient, she won't keep it up.** So logging is amount,
one category tile, Save, done. The keyboard only opens when you tap the amount, "Paid with"
remembers your usual wallet, and Save sits right under your thumb.

## What's new in 3.2

- **A calm "Gastos is updating" screen.** When the database is being updated, the app says so plainly: *Gastos is updating · Back around 9:15 PM*, with one button, **Keep logging offline**. Tap it and you're back on Log: everything you save waits on your phone and syncs by itself the moment the update ends. It shows once per update, only when you're online. Losing signal never shows it; that's still just *Offline*.
- **"Sync paused."** While an update runs, the status at the top says *Sync paused* with an amber dot. Tap it for a plain explanation. Settings says the same, and renaming a name across past entries waits until it's done.
- **Entries never get stuck when the database is busy.** Before 3.1.1, an upload that timed out while the database was busy could be mistaken for bad data and quietly stop trying. Now only genuinely invalid entries are set aside; everything else waits and retries, like being offline.
- **A calmer note box** on Log: still easy to spot, no longer glowing.

## What's new in 3.1

- **Color themes.** Eight to pick from in Settings: Gastos green, Baby pink, Lavender, Ocean blue, Mint teal, Sunset coral, Sunflower and Latte. Light and dark both follow it, and when you're signed in it follows your account onto every phone.
- **FAQ in Settings.** Quick answers, searchable, that work offline: where entries are saved, how safe your data is, backups, the MPIN, and more.
- **Your own categories live behind "Other".** Tap Other and a pop-up asks what it was ("Haircut"): pick one from your list, search it, or type a new one. Pin favourites to the top; the rest are sorted by most used. The pencil renames one (and, if you like, your past entries with it) or removes it. The main grid always keeps its 8 tiles.
- **A bigger top card** with a bar of how much of this month's income is spent. It sizes itself so the Log screen fills the phone with Save just above the tab bar.
- **A note you can't miss.** The note is now a full-width box above Save, and the save pop-up shows it on its own line.
- **Tap an entry in History to see everything about it** (amount, date, wallet, note, when it was added), with an Edit button at the top.
- **Pop-ups blur the screen behind them.**
- **The phone's Back button works again on Android.** 3.0's version was skipped by newer Chrome, so Back closed the app. 3.1 uses Chrome's built-in way to catch Back for pop-ups (CloseWatcher), with the old approach as a fallback.

## What's new in 3.0

- **Money left this month.** The top card shows income minus spending, with *In* and *Out* underneath. It counts up each time you open the tab.
- **A quicker Log screen.** Amount, what it was for, then Save, with wallet, date and note as small chips above it. No keyboard popping up on its own.
- **A piggy bank beside Save.** The coin drops in with a clink when you save. Tap the pig for a shower of gold coins.
- **Check before it happens.** A short Save / Delete / Sign out confirmation shows exactly what's about to change.
- **History that answers questions.** Pick any date range, filter All / Expense / Income, and the chart follows: spending, income, or both rings side by side. The list shows a screenful, then *See more*.
- **One MPIN for all your phones.** Set it once; a new phone asks for the same one. Turning it off or changing it asks for the current MPIN first.
- **Works offline from a cold start.** The app keeps a copy of itself on the phone, so it opens and logs with no signal and syncs later.
- **The phone's Back button works like you'd expect.** It closes the open sheet or pop-up (never saving or deleting anything), goes from History or Settings back to Log, and on Log asks before closing the app.
- **Edit your cards and e-wallets,** send feedback from Settings, a smaller loading screen with skeletons, sounds you can switch off, tap feedback on every button, and a circular light/dark switch.

## Features

- **Log an expense or income in seconds.** Filipino-first categories: Food, Transport, Load, Bills, *Padala*, Shopping, Health, plus your own list behind *Other* (search, pin, rename, remove).
- **Paid with:** cash, cards, e-wallets and digital banks (GCash, Maya, GoTyme, SeaBank…). Names only, never account numbers. Rename or remove them any time.
- **History:** week, month, year or any dates you pick; spending and income charts; entries grouped by day; search. Tap an entry to see all its details, with Edit at the top.
- **Offline-first sync:** every save lands on the phone first, then syncs. A small status dot shows *Synced / Saving / Offline / N waiting*, or *Sync paused* while the database is being updated.
- **MPIN lock:** asked when the app opens fresh or after 30 minutes away, not every time you switch apps.
- **Currency conversion** at today's rate. The original amounts are always kept, so switching back is exact.
- **Eight color themes, light, dark or automatic.** Your theme follows your account onto every phone.
- **FAQ in Settings,** searchable and available offline.
- **Installs to the home screen** like an app, and an Android app on the Releases page.
- **Backup and restore** to a file, with a safe "add what's missing" merge.
- **Feedback from Settings** goes straight to the developer.

## Screenshots

| Log | Log (dark) | Before saving | Tap the pig |
|---|---|---|---|
| <img src="docs/screenshots/log-light.png" width="200"/> | <img src="docs/screenshots/log-dark.png" width="200"/> | <img src="docs/screenshots/confirm-save.png" width="200"/> | <img src="docs/screenshots/coin-shower.png" width="200"/> |

| History | Pick dates | Entry details | Edit |
|---|---|---|---|
| <img src="docs/screenshots/history.png" width="200"/> | <img src="docs/screenshots/pick-dates.png" width="200"/> | <img src="docs/screenshots/entry-details.png" width="200"/> | <img src="docs/screenshots/edit.png" width="200"/> |

| Settings | Color themes | Your list behind Other | FAQ |
|---|---|---|---|
| <img src="docs/screenshots/settings.png" width="200"/> | <img src="docs/screenshots/color-themes.png" width="200"/> | <img src="docs/screenshots/your-list.png" width="200"/> | <img src="docs/screenshots/faq.png" width="200"/> |

| Cards and e-wallets | MPIN | MPIN keypad | Gastos is updating |
|---|---|---|---|
| <img src="docs/screenshots/cards-and-wallets.png" width="200"/> | <img src="docs/screenshots/mpin-login.png" width="200"/> | <img src="docs/screenshots/mpin-keypad.png" width="200"/> | <img src="docs/screenshots/updating.png" width="200"/> |

<sub>Screenshots use sample data.</sub>

## How it was built

The design process came before the code, and every version goes through the same loop:

1. **Research.** A sourced study of mobile UI rules (UX laws, button states, login and OTP
   patterns, dark-mode pitfalls, colour, accessibility) and of how well-regarded trackers work.
2. **Mockups first.** Still phone-size mockups in both themes, reviewed and approved before any
   code was written. Version 3 went through three rounds of mockups.
3. **Security design before the build.** The shared MPIN, the feedback email and offline mode were
   designed with a security review before the first line of code, then audited again after.
4. **Build and test.** Expo and React Native Web on a Supabase backend. An automated tap-through
   test in a phone-size browser checks exact values (one tap = one saved row, the right total),
   including an offline cold start and database tests that run against the real server and roll back.
5. **Real-phone rounds.** Two rounds on an Android phone and an iPhone before going live.

Version 3.2's updating switch went through the same loop, with one more step: before going live it was
flipped for real on the live server while both a 3.2 preview and the older 3.1.1 app were in use, and the
server logs confirmed the old app was refused once, kept its entry, and synced it when the switch went off.

## Tech stack

| | |
|---|---|
| App | [Expo](https://expo.dev) (SDK 57), React Native, React Native Web, TypeScript |
| Backend | [Supabase](https://supabase.com): Postgres with Row Level Security, email one-time-code sign-in, Vault |
| UI | Hand-built components, [Lucide](https://lucide.dev) icons, `react-native-svg`, Inter and Poppins, sounds synthesised with Web Audio (no audio files) |
| Offline | A small service worker that caches only the app's own files, one set per build |
| Exchange rates | [Frankfurter](https://frankfurter.dev) (ECB and central-bank data), with [open.er-api.com](https://open.er-api.com) as fallback |
| Email | [Brevo](https://www.brevo.com) for sign-in codes and feedback |
| Hosting | Vercel (static web export, installable PWA); Android app as a Trusted Web Activity |

## Security notes

- **Row Level Security** on every table: each account can only read and write its own rows (`supabase/schema.sql`, tests in `supabase/rls-test.sql`, `supabase/test-v3.sql` and `supabase/test-v4-status.sql`).
- **Database constraints back the app's validation.** For example, a "Paid with" value that looks like a card number is rejected.
- **The account MPIN is kept where the app can't read it.** It lives in a private schema with no API access, hashed with an HMAC keyed by a secret in Supabase Vault and then bcrypt. It's only checked through database functions that work on the signed-in account alone and never return the hash. Wrong tries are counted on the server, **5 across all phones**, then an email code is required; the functions can't be rolled back or raced to get more guesses. Changing or turning off the MPIN checks the current one in the same call. A forgotten MPIN is reset only with a fresh email code.
- **Offline unlock** uses a PBKDF2 copy on each phone (100k iterations, random salt). It's replaced whenever the MPIN changes on another phone and needs an online check at least every 30 days.
- **What the MPIN is and isn't:** a lock on the app for a phone that's already unlocked. It keeps casual eyes out. Anyone who controls the account's email can reset it, and it's no substitute for the phone's own lock.
- **Feedback** goes through one database function: limited per account and per day, stored as plain text, emailed to a fixed address with a key that never leaves the database.
- **The service worker never caches API traffic,** sign-in, or anything with a query string: only the app's own files.
- **Bot check on sign-in:** Cloudflare Turnstile, enforced by Supabase Auth on "send me a code".
- **Merge-restore is insert-only,** so an old backup can never overwrite newer data or bring deleted entries back.
- **The "updating" switch is enforced by the database, not just the app.** It lives in a private one-row table no client can read or write; apps only see it through one read-only function. While it's on, a database trigger refuses every app write with a special "updating" answer (HTTP 503) that every app version, old or new, treats as "try again later", so nothing is lost and nothing half-written lands mid-update. Database changes themselves still go through.

## Run it yourself

```bash
npm install
cp .env.example .env.local        # add your Supabase project URL and publishable key
npx expo start --web
```

Set up the database by running, in the Supabase SQL editor: `supabase/schema.sql`, then
`supabase/migration-v2.sql`, then `supabase/migration-v3.sql` (it creates its own MPIN secret in
Vault), then `supabase/migration-v3.1.sql` (the color theme on the settings row), then
`supabase/migration-v4-status.sql` (the "updating" switch; the SQL to turn it on and off is at the top of that file).
Feedback emails are optional: add a Brevo API key to Vault as `gastos_brevo_feedback_key`
and change the addresses in `send_feedback`. Without a key, feedback is still saved.

For a web build, run `npx expo export -p web` and then `node scripts/write-sw.mjs dist`, which
writes the offline file list for that build. The app also works with no backend at all (it stays on
the phone only).

## Licence

MIT © 2026 Joemark Basa
