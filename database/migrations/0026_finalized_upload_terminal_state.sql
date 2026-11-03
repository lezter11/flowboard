-- Prior orphan cleanup changed finalized uploads to expired when their staging
-- lifetime elapsed. Repair only existing, correctly scoped attachment references.
-- Missing/removed images have NULL references and must never be resurrected.
UPDATE card_image_uploads u
SET state = 'finalized', version = u.version + 1, updated_at = NOW()
WHERE u.state <> 'finalized'
  AND u.finalized_image_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM card_images i
    WHERE i.id = u.finalized_image_id AND i.card_id = u.card_id
      AND i.project_id = u.project_id AND i.workspace_id = u.workspace_id
  );
