-- Add a second (and future) competition alongside "Best Photo": "Best Tail End".
-- Same players, same schedule, same rules; data separated by a `competition` slug.
-- A person can enter BOTH each day (one photo + one vote per competition per day).

create table if not exists competitions (
  slug    text primary key,
  name    text not null,
  emoji   text not null,
  sort    int not null default 0,
  active  boolean not null default true
);
insert into competitions (slug, name, emoji, sort) values
  ('photo',   'Best Photo of the Day', '📷', 1),
  ('tailend', 'Best Tail End',         '🐾', 2)
on conflict (slug) do nothing;
alter table competitions enable row level security;

-- Discriminator column; existing rows become 'photo'.
alter table submissions add column if not exists competition text not null default 'photo' references competitions(slug);
alter table votes       add column if not exists competition text not null default 'photo' references competitions(slug);
alter table winners     add column if not exists competition text not null default 'photo' references competitions(slug);

-- Per-competition uniqueness (replaces the old per-date constraints).
alter table submissions drop constraint if exists submissions_contest_date_player_id_key;
alter table submissions add  constraint submissions_comp_date_player_key unique (competition, contest_date, player_id);

alter table votes drop constraint if exists votes_contest_date_voter_player_id_key;
alter table votes add  constraint votes_comp_date_voter_key unique (competition, contest_date, voter_player_id);

alter table winners drop constraint if exists winners_contest_date_submission_id_key;
alter table winners add  constraint winners_comp_date_submission_key unique (competition, contest_date, submission_id);

create index if not exists submissions_by_comp_date on submissions (competition, contest_date);
create index if not exists votes_by_comp_date on votes (competition, contest_date);

-- Tally one competition's contest (idempotent). Co-winners on a tie.
drop function if exists finalize_contest(date);
create or replace function finalize_contest(p_comp text, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare v_max int; v_tied int;
begin
  if exists (select 1 from winners where competition = p_comp and contest_date = p_date) then
    return;
  end if;

  select max(c) into v_max from (
    select count(v.id) c
    from submissions s
    left join votes v on v.submission_id = s.id and v.competition = p_comp and v.contest_date = p_date
    where s.competition = p_comp and s.contest_date = p_date
    group by s.id
  ) m;

  if v_max is null or v_max <= 0 then return; end if;

  select count(*) into v_tied from (
    select s.id
    from submissions s
    left join votes v on v.submission_id = s.id and v.competition = p_comp and v.contest_date = p_date
    where s.competition = p_comp and s.contest_date = p_date
    group by s.id having count(v.id) = v_max
  ) t;

  insert into winners (competition, contest_date, submission_id, player_id, photo_path, caption, vote_count, is_cowinner)
  select p_comp, p_date, c.submission_id, c.player_id, c.photo_path, c.caption, c.vote_count, (v_tied > 1)
  from (
    select s.id as submission_id, s.player_id, s.photo_path, s.caption, count(v.id)::int as vote_count
    from submissions s
    left join votes v on v.submission_id = s.id and v.competition = p_comp and v.contest_date = p_date
    where s.competition = p_comp and s.contest_date = p_date
    group by s.id, s.player_id, s.photo_path, s.caption
  ) c
  where c.vote_count = v_max
  on conflict (competition, contest_date, submission_id) do nothing;
end; $$;

-- Cron entrypoint: tally every active competition for today (SAST).
create or replace function finalize_today()
returns void language plpgsql security definer set search_path = public as $$
declare r record; d date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  for r in select slug from competitions where active loop
    perform finalize_contest(r.slug, d);
  end loop;
end; $$;
