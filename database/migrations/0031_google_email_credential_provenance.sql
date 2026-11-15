-- Only the optional confirmation release can issue credentials from email-only sessions.
ALTER TABLE personal_access_tokens
  ADD COLUMN issued_from_google_email_session BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE mcp_oauth_connections
  ADD COLUMN issued_from_google_email_session BOOLEAN NOT NULL DEFAULT FALSE;

-- Cover both browser confirmation and operator recovery. Keep the revocation in
-- the same transaction and use existing revocation fields understood by older builds.
CREATE FUNCTION revoke_google_email_credentials() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  EXECUTE format('UPDATE %I.personal_access_tokens
    SET revoked_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE user_id = $1 AND issued_from_google_email_session AND revoked_at IS NULL', TG_TABLE_SCHEMA)
    USING NEW.id;
  EXECUTE format('UPDATE %I.mcp_oauth_connections
    SET revoked_at = clock_timestamp(), revocation_reason = $2
    WHERE user_id = $1 AND issued_from_google_email_session AND revoked_at IS NULL', TG_TABLE_SCHEMA)
    USING NEW.id, 'google_identity_confirmed';
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_revoke_google_email_credentials
AFTER UPDATE OF google_subject ON users
FOR EACH ROW WHEN (OLD.google_subject IS NULL AND NEW.google_subject IS NOT NULL)
EXECUTE FUNCTION revoke_google_email_credentials();
