import type pg from 'pg';

/**
 * Same-name disambiguation (B-23). When two or more active members of one project (the Owner counts) share
 * a full name, the later joiners get a number: "Shubham Singh", "Shubham Singh (2)", "(3)". Emails are never
 * shown for this, and no other field is added.
 *
 * Rules, all enforced here so every screen, mention and notification agrees:
 * - Name equality: trim, collapse whitespace, Unicode NFKC, case-insensitive, accent-insensitive.
 *   So "José" and "Jose" collide, because they are confusable.
 * - Scope: every active member of the project, not the rows of one response or page. The numbers do
 *   not change with filters or pagination.
 * - Order: the Owner first, then membership created_at ascending, then user id.
 * - Computed on read. Nothing is stored. A member who leaves or is removed stops counting, so a remaining
 *   duplicate becomes unique again and its number disappears. A rename that makes two names collide
 *   numbers the later member, and a rename away removes the number.
 * - The stored display name is never changed; the number is an addition, not part of the name.
 */

/** The comparison key for a full name. Two names with the same key are the same name for numbering. */
export function nameKey(name: string): string {
  return name
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

/** Maps each member id that needs a number (2 or more) to that number. Unique names are absent. */
export async function projectNameSuffixes(db: pg.Pool | pg.ClientBase, projectId: string): Promise<Map<string, number>> {
  const res = await db.query<{ user_id: string; display_name: string; is_owner: boolean; joined_at: Date }>(
    `SELECT u.id AS user_id, u.display_name, TRUE AS is_owner, w.created_at AS joined_at, u.id AS tiebreak
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     JOIN users u ON u.id = w.owner_id
     WHERE p.id = $1
     UNION ALL
     SELECT u.id AS user_id, u.display_name, FALSE AS is_owner, pm.created_at AS joined_at, u.id AS tiebreak
     FROM project_memberships pm
     JOIN projects p ON p.id = pm.project_id
     JOIN workspaces w ON w.id = p.workspace_id
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = $1 AND pm.status = 'active' AND pm.user_id <> w.owner_id`,
    [projectId],
  );
  const ordered = [...res.rows].sort((a, b) => {
    if (a.is_owner !== b.is_owner) return a.is_owner ? -1 : 1;
    const byTime = new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
    if (byTime !== 0) return byTime;
    return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0;
  });
  const groups = new Map<string, string[]>();
  for (const row of ordered) {
    const key = nameKey(row.display_name);
    const list = groups.get(key) ?? [];
    list.push(row.user_id);
    groups.set(key, list);
  }
  const suffixes = new Map<string, number>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    ids.forEach((id, index) => {
      if (index >= 1) suffixes.set(id, index + 1);
    });
  }
  return suffixes;
}

/** Adds nameSuffix to a person object when the member has a number. Absent otherwise. */
export function withNameSuffix<T extends { id: string }>(person: T, suffixes: Map<string, number>): T & { nameSuffix?: number } {
  const suffix = suffixes.get(person.id);
  return suffix === undefined ? person : { ...person, nameSuffix: suffix };
}
