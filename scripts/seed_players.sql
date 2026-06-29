-- Seed the family members and generate their personal secret links.
-- 1) Put one name per row below.
-- 2) Run this whole file once against the database.
-- 3) Run scripts/list_links.sql (or the SELECT at the bottom) to get each person's link.
--
-- Tokens are random 24-char hex strings, URL-safe and effectively unguessable.

insert into players (name, token)
select name, encode(gen_random_bytes(12), 'hex')
from (values
  ('Name 1'),
  ('Name 2'),
  ('Name 3'),
  ('Name 4'),
  ('Name 5'),
  ('Name 6'),
  ('Name 7'),
  ('Name 8'),
  ('Name 9'),
  ('Name 10'),
  ('Name 11'),
  ('Name 12'),
  ('Name 13'),
  ('Name 14'),
  ('Name 15'),
  ('Name 16')
) as t(name)
on conflict do nothing;

-- Each person's link (replace the base URL with your deployed site):
select name,
       'https://YOURNAME.github.io/Photocompetition/?t=' || token as personal_link
from players
order by created_at;
