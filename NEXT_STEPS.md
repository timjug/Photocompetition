# 📷 Best Photo of the Day — Your Next Steps

Everything is built and deployed. The backend (database, photo storage, scheduled
tally, and API) is **live and verified**. There is **one required step left** — turning
on the website hosting — plus a few things to do once, and a short reference for
running it day-to-day.

---

## ✅ Already done (no action needed)

- Supabase project **`best-photo-of-the-day`** created (free tier, **$0/month**).
- Database tables, the winner-tally function, and the **daily 12:50 SAST** auto-tally job.
- Private **`photos`** storage bucket.
- The **`api`** function (handles submit / vote / results and keeps voting anonymous).
- All **15 family members** added, each with a personal secret link.
- The website code is committed to the branch `claude/family-photo-competition-fe5ukd`
  and already points at the live project.

---

## ① REQUIRED — Turn on the website (GitHub Pages)

This is the only thing blocking go-live. It takes about a minute.

1. Go to the repository on GitHub → **Settings** (top menu).
2. In the left sidebar, click **Pages**.
3. Under **Build and deployment → Source**, choose **“Deploy from a branch.”**
4. Set:
   - **Branch:** `claude/family-photo-competition-fe5ukd`
   - **Folder:** `/docs`
5. Click **Save.**
6. Wait ~1–2 minutes. The page will show:
   **“Your site is live at https://timjug.github.io/Photocompetition/”**

> If you later merge this branch into `main`, switch the Pages **Branch** to `main`
> so it keeps serving the latest version.

---

## ② Test it yourself (5 minutes)

1. Open **your own** personal link (from the list of links — see step ③).
2. You should see the **Submit** screen (during 2pm–11am SAST). Upload any photo.
3. Tap **🏆 Hall of Fame** at the bottom — it’ll be empty until the first winner. That’s expected.
4. (Optional full test) Open a second link in a private/incognito window, submit a
   different photo, then during **11:05am–12:50pm SAST** both can vote. Winner appears at **1:00pm**.

If a link shows “Unknown or inactive link,” you copied the token wrong — compare with the table below.

---

## ③ Share the personal links

Send each person **their own** link once (WhatsApp, SMS, email — whatever reaches them).
Tell them to **bookmark it / add to home screen**. The link is their identity, so they
shouldn’t share or forward it. The app hides the token from the address bar after first load.

> ⚠️ **The links are secrets — they are deliberately NOT stored in this repo.**
> Get the current list any time from **Supabase → SQL Editor** by running
> [`scripts/list_links.sql`](scripts/list_links.sql), i.e.:
>
> ```sql
> select name, 'https://timjug.github.io/Photocompetition/?t=' || token as link
> from players where active order by name;
> ```
>
> (Claude also gave you the full list of 15 links in the chat message accompanying this document.)

---

## How the daily cycle runs (no admin needed)

All times **South Africa (SAST)**:

| Time | What happens |
|---|---|
| **2:00pm** | New round opens — everyone can submit/replace one photo |
| **11:00am** (next day) | Submissions close |
| **11:05am – 12:50pm** | Anonymous voting (photos shuffled, no names, can’t vote your own) |
| **1:00pm** | Winner(s) announced and added to the Hall of Fame automatically |

Ties → **co-winners** (all tied photos win and are archived).

---

## Occasional admin tasks

These are run in **Supabase → your project → SQL Editor** (paste and Run). You don’t
need these for normal use.

**Re-print everyone’s links** (e.g. you lost the table above):
```sql
select name, 'https://timjug.github.io/Photocompetition/?t=' || token as link
from players where active order by name;
```

**Add a new family member** (creates their link):
```sql
insert into players (name, token) values ('NewName', encode(gen_random_bytes(12),'hex'));
select 'https://timjug.github.io/Photocompetition/?t=' || token as link
from players where name = 'NewName';
```

**Remove / pause someone** (keeps their past results in the archive):
```sql
update players set active = false where name = 'SomeName';
```

**Remove an inappropriate photo for today’s round** (SAST date = the voting day):
```sql
delete from submissions
where contest_date = (now() at time zone 'Africa/Johannesburg')::date
  and player_id = (select id from players where name = 'SomeName');
```

---

## Good to know

- **Cost:** Supabase free tier and GitHub Pages are both **free** at this size. Nothing to pay.
- **Privacy:** during voting, no one — not even via the browser — can see who submitted which
  photo; names only appear after 1:00pm. Photos are stored privately and shown via temporary links.
- **Photos:** automatically shrunk on the phone before upload, so it’s fast even on mobile data.
- **Where the data lives:** Supabase project `best-photo-of-the-day` (organisation “Jugmans Family”).
- **The winners document is now automatic** — the in-app 🏆 Hall of Fame is the permanent record.

---

## Optional extras I can add later (just ask)

- A **private organiser dashboard** for you (see today’s submissions, remove an entry,
  re-print links, add/remove people) — no SQL needed.
- A **monthly/all-time leaderboard** (“most wins”).
- A nicer **domain name** instead of the github.io address.

---

## If something’s not working

- **“Your site is live” never appears / 404:** double-check Pages is set to branch
  `claude/family-photo-competition-fe5ukd` and folder **`/docs`**.
- **“Unknown or inactive link”:** the token was mistyped, or that person was set inactive.
- **A photo won’t upload:** very large images can fail — retry; the app already compresses them.
- **No winner showed at 1pm:** it finalises the moment anyone opens the app after 1:00pm, and the
  scheduled job also runs at 12:50pm — so it self-heals. A round with zero votes has no winner.
