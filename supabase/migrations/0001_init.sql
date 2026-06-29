-- Best Photo of the Day — schema
-- Timezone for all scheduling is Africa/Johannesburg (SAST, UTC+2, no DST).
-- A contest is keyed by its VOTING DAY (the 11am day) = `contest_date`:
--   submit:  (contest_date - 1) 14:00  ->  contest_date 11:00
--   voting:  contest_date 11:05         ->  contest_date 12:50
--   tally:   contest_date 12:50         ->  contest_date 13:00
--   results: contest_date 13:00         ->  onward
-- All client reads/writes go through the `api` edge function (service role).
-- RLS is enabled with NO public policies => anon/auth roles get nothing.

create table if not exists players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  token       text not null unique,          -- the per-person secret in the link
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- One photo per player per contest day, replaceable until submissions close.
create table if not exists submissions (
  id            uuid primary key default gen_random_uuid(),
  contest_date  date not null,
  player_id     uuid not null references players(id) on delete cascade,
  photo_path    text not null,
  caption       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (contest_date, player_id)
);
create index if not exists submissions_by_date on submissions (contest_date);

-- One vote per player per contest day. App rejects voting for your own submission.
create table if not exists votes (
  id               uuid primary key default gen_random_uuid(),
  contest_date     date not null,
  voter_player_id  uuid not null references players(id) on delete cascade,
  submission_id    uuid not null references submissions(id) on delete cascade,
  created_at       timestamptz not null default now(),
  unique (contest_date, voter_player_id)
);
create index if not exists votes_by_date on votes (contest_date);

-- Durable archive / gallery. Denormalised so it survives even if a submission is removed.
-- One row per winning submission (multiple rows for the same date => co-winners).
create table if not exists winners (
  id            uuid primary key default gen_random_uuid(),
  contest_date  date not null,
  submission_id uuid references submissions(id) on delete set null,
  player_id     uuid references players(id) on delete set null,
  photo_path    text not null,
  caption       text,
  vote_count    integer not null,
  is_cowinner   boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (contest_date, submission_id)
);

-- Tally one contest and write its winner(s). Idempotent: safe to call repeatedly.
-- Called by pg_cron at 12:50 SAST and lazily by the edge function when results are viewed.
create or replace function finalize_contest(p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max   integer;
  v_tied  integer;
begin
  -- Already finalized?
  if exists (select 1 from winners where contest_date = p_date) then
    return;
  end if;

  -- Vote count per submission for this contest.
  with counts as (
    select s.id as submission_id,
           s.player_id,
           s.photo_path,
           s.caption,
           count(v.id)::int as vote_count
    from submissions s
    left join votes v
      on v.submission_id = s.id and v.contest_date = p_date
    where s.contest_date = p_date
    group by s.id, s.player_id, s.photo_path, s.caption
  )
  select max(vote_count) into v_max from counts;

  if v_max is null or v_max <= 0 then
    return;  -- no submissions, or nobody voted yet
  end if;

  select count(*) into v_tied
  from (
    select s.id, count(v.id) c
    from submissions s
    left join votes v on v.submission_id = s.id and v.contest_date = p_date
    where s.contest_date = p_date
    group by s.id
    having count(v.id) = v_max
  ) t;

  insert into winners (contest_date, submission_id, player_id, photo_path, caption, vote_count, is_cowinner)
  select p_date, c.submission_id, c.player_id, c.photo_path, c.caption, c.vote_count, (v_tied > 1)
  from (
    select s.id as submission_id, s.player_id, s.photo_path, s.caption, count(v.id)::int as vote_count
    from submissions s
    left join votes v on v.submission_id = s.id and v.contest_date = p_date
    where s.contest_date = p_date
    group by s.id, s.player_id, s.photo_path, s.caption
  ) c
  where c.vote_count = v_max
  on conflict (contest_date, submission_id) do nothing;
end;
$$;

-- Lock down all direct client access; service role + security-definer fn bypass RLS.
alter table players     enable row level security;
alter table submissions enable row level security;
alter table votes       enable row level security;
alter table winners     enable row level security;
