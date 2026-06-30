# 📷 Best Photo of the Day

A tiny web app for a daily family photo competition (~16 players, all in **South Africa / SAST, UTC+2**).
Replaces the manual WhatsApp + poll + record-keeping process. No app install, no passwords —
each person just opens their **personal link**.

## What it does

- **Submit** one photo per day (2:00pm → 11:00am next morning), replaceable until the deadline.
- **Vote** anonymously (11:05am → 12:50pm) — photos shown with no names, randomised, can't vote your own.
- **Winner** auto-tallied and announced at 1:00pm (co-winners on a tie).
- **Hall of Fame** — every winner archived automatically. No more separate document.

The right screen shows at the right time, derived purely from the clock — there's no daily admin.

### Two competitions in one app
Two parallel daily competitions share the same links, schedule, players, and rules:
**📷 Best Photo of the Day** and **🐾 Best Tail End** (best animal-butt photo). A switcher at the
top flips between them; each person can enter (and vote in) both every day, and each has its own
winner and Hall of Fame. They're separated by a `competition` slug in the data — adding a third
later is a single row in the `competitions` table.

## How it's built

| Piece | Tech |
|---|---|
| Data + photo storage | **Supabase** (Postgres + Storage) |
| Daily tally | **pg_cron** at 12:50 SAST (with a lazy fallback in the API) |
| Anonymity & all rules | One **Supabase Edge Function** (`api`) using the service role — names are never sent before results |
| Identity | A per-person secret `token` in the URL (no accounts) |
| Frontend | One static page (`docs/`), hosted on **GitHub Pages** |

```
docs/                     static single-page app (served by GitHub Pages)
  index.html, app.js, styles.css, config.js
supabase/
  migrations/0001_init.sql   tables + finalize_contest()
  migrations/0002_cron.sql   pg_cron daily tally
  functions/api/index.ts     the API / anonymity gateway
scripts/
  seed_players.sql           add the 16 people + make their links
  list_links.sql             reprint everyone's link
```

## Status — backend is live

The Supabase project `best-photo-of-the-day` is provisioned and configured:
schema + `finalize_contest()`, the `pg_cron` tally (12:50 SAST), a private `photos`
bucket, the `api` edge function (`verify_jwt = false`), the 15 players seeded, and
`docs/config.js` filled in with the project URL + publishable key.

**The one remaining manual step is turning on GitHub Pages** (the app's hosting):

1. Repo **Settings → Pages**.
2. **Source: Deploy from a branch.**
3. **Branch:** `claude/family-photo-competition-fe5ukd`, **Folder:** `/docs`. Save.
4. After a minute the site is live at `https://timjug.github.io/Photocompetition/`.
5. **Share** each person their personal link (`…/?t=<token>`) once; they bookmark it. Done.

### Re-running setup from scratch
1. Apply both migrations in `supabase/migrations/`.
2. Create a **private** Storage bucket named `photos`.
3. Deploy `supabase/functions/api` with **`verify_jwt = false`** (uses the built-in `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`).
4. Edit names into `scripts/seed_players.sql`, run it, then `scripts/list_links.sql` for the links.
5. Put `SUPABASE_URL` + the publishable/anon key in `docs/config.js` (both public-safe).

## Design notes

- **Contest key** = the **voting day** (the 11am day): submit `(date-1) 14:00 → date 11:00`, vote `date 11:05 → 12:50`, results `date 13:00`.
- **Anonymity** lives in the edge function — clients never receive a `player_id`/name during submit or voting; the ballot is shuffled per request and your own photo is flagged only so the UI can disable it.
- **Photos** are resized client-side to ≤1600px / JPEG ~0.8 before upload, and served via short-lived signed URLs.
- **Out of scope (v1):** accounts, comments, push notifications, multiple photos, live vote counts, leaderboards.
