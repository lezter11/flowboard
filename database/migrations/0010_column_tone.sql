-- Additive: optional named tone for a column (prototype pastel set). NULL means not set; the
-- client keeps deriving a tone from name/category. Existing rows are unchanged.
ALTER TABLE columns ADD COLUMN tone TEXT
  CHECK (tone IN ('lavender', 'ice', 'grey', 'green', 'coral', 'rose', 'mint', 'peach', 'butter', 'lilac'));
