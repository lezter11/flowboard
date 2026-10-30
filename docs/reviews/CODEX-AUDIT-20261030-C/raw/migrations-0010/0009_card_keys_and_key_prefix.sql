-- Additive: human-readable card keys (e.g. WEB-101) and project key prefixes.
-- Keys use one global sequence as the column default: nextval() takes no row lock, so card
-- creation does not add a lock upgrade, and a number is never reused. Numbers are not
-- contiguous per project. Existing cards are numbered by creation order (created_at, id).

CREATE SEQUENCE card_key_seq;

ALTER TABLE projects ADD COLUMN key_prefix TEXT;
UPDATE projects
SET key_prefix = COALESCE(NULLIF(UPPER(LEFT(REGEXP_REPLACE(name, '[^A-Za-z0-9]', '', 'g'), 3)), ''), 'PRJ');
ALTER TABLE projects ALTER COLUMN key_prefix SET NOT NULL;
ALTER TABLE projects ALTER COLUMN key_prefix SET DEFAULT 'PRJ';

ALTER TABLE cards ADD COLUMN card_number BIGINT;
UPDATE cards c
SET card_number = numbered.rn
FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn FROM cards) numbered
WHERE c.id = numbered.id;
SELECT setval('card_key_seq', COALESCE((SELECT MAX(card_number) FROM cards), 0) + 1, false);
ALTER TABLE cards ALTER COLUMN card_number SET DEFAULT nextval('card_key_seq');
ALTER TABLE cards ALTER COLUMN card_number SET NOT NULL;
CREATE UNIQUE INDEX cards_card_number_key ON cards (card_number);
