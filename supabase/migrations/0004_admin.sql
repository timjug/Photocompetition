-- Organiser flag. The admin gets no separate password: their existing personal
-- link grants the ⚙️ Admin tab, and admin_* API actions check is_admin server-side.
alter table players add column if not exists is_admin boolean not null default false;

-- Make the organiser an admin (adjust the name if needed).
update players set is_admin = true where name = 'Tim';
