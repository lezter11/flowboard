-- Independent of the reserved private binary document migration 0028.
ALTER TABLE cards
  ADD COLUMN document_links JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD CONSTRAINT cards_document_links_bounded CHECK (
    CASE
      WHEN jsonb_typeof(document_links) = 'array' THEN jsonb_array_length(document_links) <= 10
      ELSE FALSE
    END
  ),
  ADD CONSTRAINT cards_purged_without_document_links CHECK (
    state <> 'purged' OR document_links = '[]'::JSONB
  );

-- Apply the same retention rule during a rollback to a Worker that predates this field.
CREATE FUNCTION clear_purged_card_document_links() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.document_links := '[]'::JSONB;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clear_purged_card_document_links
BEFORE UPDATE OF state ON cards
FOR EACH ROW
WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.state = 'purged')
EXECUTE FUNCTION clear_purged_card_document_links();
