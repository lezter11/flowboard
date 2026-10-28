-- Receipts are retry metadata, not durable copies of private resource bodies.
-- Retain only identifiers/version markers needed for a client refetch.
UPDATE idempotency_receipts
SET response_body = CASE
  WHEN jsonb_typeof(response_body -> 'data') = 'object' THEN
    jsonb_build_object(
      'data',
      COALESCE(
        (
          SELECT jsonb_object_agg(entry.key, entry.value)
          FROM jsonb_each(response_body -> 'data') AS entry
          WHERE entry.key IN ('id', 'version', 'structureVersion', 'snapshotVersion', 'operationId', 'success', 'role', 'projectId', 'workspaceId', 'state', 'status')
        ),
        '{}'::jsonb
      )
    )
  WHEN jsonb_typeof(response_body -> 'data') = 'array' THEN
    jsonb_build_object(
      'data',
      COALESCE(
        (
          SELECT jsonb_agg(
            CASE WHEN jsonb_typeof(item.value) = 'object' THEN
              COALESCE(
                (
                  SELECT jsonb_object_agg(entry.key, entry.value)
                  FROM jsonb_each(item.value) AS entry
                  WHERE entry.key IN ('id', 'version', 'structureVersion', 'snapshotVersion', 'operationId', 'success', 'role', 'projectId', 'workspaceId', 'state', 'status')
                ),
                '{}'::jsonb
              )
            ELSE '{}'::jsonb END
          )
          FROM jsonb_array_elements(response_body -> 'data') AS item(value)
        ),
        '[]'::jsonb
      )
    )
  ELSE '{}'::jsonb
END;
