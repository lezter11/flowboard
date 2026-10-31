-- B-16: first and last name. Additive and idempotent. No backfill: existing users keep their
-- display_name and have name_confirmed_at NULL, so they are asked for a name once.
--
-- first_name and last_name hold Google's suggestion (given and family name) until the user saves
-- their own names; name_confirmed_at is the only confirmation marker. display_name is the shown
-- name and becomes "First Last" when the names are saved.

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name_confirmed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_first_name_length' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_first_name_length
      CHECK (first_name IS NULL OR char_length(first_name) BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_last_name_length' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_last_name_length
      CHECK (last_name IS NULL OR char_length(last_name) BETWEEN 1 AND 60);
  END IF;
END
$$;
