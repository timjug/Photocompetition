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

## How it's built

| Piece | Tech |
|---|---|
| Data + photo storage | **Supabase** (Postgres + Storage) |
| Daily tally | **pg_cron** at 12:50 SAST (with a lazy fallback in the API) |
| Anonymity & all rules | One **Supabase Edge Function** (`api`) using the service role — names are never sent before results |
| Identity | A per-person secret `token` in the URL (no accounts) |
| Frontend | One static page (`web/`), hosted on **GitHub Pages** |

```
web/                      static single-page app (deploy to GitHub Pages)
  index.html, app.js, styles.css, config.js
supabase/
  migrations/0001_init.sql   tables + finalize_contest()
  migrations/0002_cron.sql   pg_cron daily tally
  functions/api/index.ts     the API / anonymity gateway
scripts/
  seed_players.sql           add the 16 people + make their links
  list_links.sql             reprint everyone's link
```

## Deploy (one-time)

1. **Supabase project** — create one, then apply both migrations in `supabase/migrations/`.
2. **Storage** — create a **private** bucket named `photos`.
3. **Edge function** — deploy `supabase/functions/api` with **`verify_jwt = false`** (it does its own token auth). It uses the built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars.
4. **Players** — edit names into `scripts/seed_players.sql`, run it, then run `scripts/list_links.sql` to get each person's link.
5. **Frontend config** — set `SUPABASE_URL` and `ANON_KEY` in `web/config.js` (both are public-safe).
6. **Host** — enable **GitHub Pages** for this repo, serving the `web/` folder. Each personal link is
   `https://<you>.github.io/Photocompetition/?t=<token>`.
7. **Share** — send each person their link once; they bookmark it. Done.

## Design notes

- **Contest key** = the **voting day** (the 11am day): submit `(date-1) 14:00 → date 11:00`, vote `date 11:05 → 12:50`, results `date 13:00`.
- **Anonymity** lives in the edge function — clients never receive a `player_id`/name during submit or voting; the ballot is shuffled per request and your own photo is flagged only so the UI can disable it.
- **Photos** are resized client-side to ≤1600px / JPEG ~0.8 before upload, and served via short-lived signed URLs.
- **Out of scope (v1):** accounts, comments, push notifications, multiple photos, live vote counts, leaderboards.
