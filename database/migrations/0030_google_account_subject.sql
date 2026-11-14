-- Google identity is an issuer and a permanent subject. Existing accounts are unbound
-- until they prove continuity. Email is still the address used for project invitations.
ALTER TABLE users
  ADD COLUMN google_issuer TEXT,
  ADD COLUMN google_subject TEXT COLLATE "C",
  ADD COLUMN google_email_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT users_google_identity_complete CHECK (
    (google_issuer IS NULL AND google_subject IS NULL AND NOT google_email_conflict)
    OR
    (google_issuer IS NOT NULL AND google_issuer = 'https://accounts.google.com'
      AND google_subject IS NOT NULL AND google_subject ~ '^[!-~]{1,255}$')
  ),
  ADD CONSTRAINT users_google_identity_unique UNIQUE (google_issuer, google_subject);

-- Also finds legacy mixed-case addresses. Existing duplicate case variants stay distinct
-- and are never resolved by picking one on the basis of email.
CREATE INDEX users_normalized_email_idx ON users ((LOWER(BTRIM(email))));
