-- Low-res thumbnails alongside the full photo, so grids/lists load fast on
-- weak wifi. The client now uploads a small thumbnail next to the full-size
-- image; thumb_path is nullable so older rows without one simply fall back
-- to the full image on the client.
alter table submissions add column if not exists thumb_path text;
alter table winners      add column if not exists thumb_path text;

-- Carry thumb_path through when a submission is copied into winners.
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

  insert into winners (competition, contest_date, submission_id, player_id, photo_path, thumb_path, caption, vote_count, is_cowinner)
  select p_comp, p_date, c.submission_id, c.player_id, c.photo_path, c.thumb_path, c.caption, c.vote_count, (v_tied > 1)
  from (
    select s.id as submission_id, s.player_id, s.photo_path, s.thumb_path, s.caption, count(v.id)::int as vote_count
    from submissions s
    left join votes v on v.submission_id = s.id and v.competition = p_comp and v.contest_date = p_date
    where s.competition = p_comp and s.contest_date = p_date
    group by s.id, s.player_id, s.photo_path, s.thumb_path, s.caption
  ) c
  where c.vote_count = v_max
  on conflict (competition, contest_date, submission_id) do nothing;
end; $$;
