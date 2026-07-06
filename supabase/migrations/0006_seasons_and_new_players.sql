-- Hall of Fame "seasons": split history into named eras (e.g. when new
-- players join) without losing any data. Each winner's contest_date falls
-- into exactly one season by date range; the season with a null ends_on is
-- the current/ongoing one.
create table if not exists hof_seasons (
  id        int generated always as identity primary key,
  label     text not null,
  starts_on date not null,
  ends_on   date,   -- null = ongoing (the current season)
  sort      int not null
);
alter table hof_seasons enable row level security;

do $$
begin
  if not exists (select 1 from hof_seasons) then
    insert into hof_seasons (label, starts_on, ends_on, sort) values
      ('Part One', date '2000-01-01', (now() at time zone 'Africa/Johannesburg')::date, 1),
      ('Part Two', (now() at time zone 'Africa/Johannesburg')::date + 1, null, 2);
  end if;
end $$;

-- New players joining as of Part Two.
create extension if not exists pgcrypto;
insert into players (name, token)
select v.name, encode(gen_random_bytes(12), 'hex')
from (values ('Sam'), ('Matt'), ('Eliza'), ('Arthur')) as v(name)
where not exists (select 1 from players p where p.name = v.name);
