/**
 * Own-projects limits (B-17, B-18; edge-case review section 2). Every number is a constant with an
 * environment override. A missing, empty or invalid override means the default, never "no limit"
 * (fail closed). There is no per-user allowlist, header, query parameter or admin API.
 */
export interface Limits {
  ownedProjects: number;
  boardsPerProject: number;
  membersPerProject: number;
  pendingInvitesPerProject: number;
  ownedProjectsTotal: number;
  boardsPerProjectTotal: number;
}

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  ownedProjects: 3,
  boardsPerProject: 5,
  membersPerProject: 50,
  pendingInvitesPerProject: 50,
  ownedProjectsTotal: 20,
  boardsPerProjectTotal: 25,
});

export const LIMIT_ENV_NAMES: Readonly<Record<keyof Limits, string>> = Object.freeze({
  ownedProjects: 'FB_LIMIT_OWNED_PROJECTS',
  boardsPerProject: 'FB_LIMIT_BOARDS_PER_PROJECT',
  membersPerProject: 'FB_LIMIT_MEMBERS_PER_PROJECT',
  pendingInvitesPerProject: 'FB_LIMIT_PENDING_INVITES_PER_PROJECT',
  ownedProjectsTotal: 'FB_LIMIT_OWNED_PROJECTS_TOTAL',
  boardsPerProjectTotal: 'FB_LIMIT_BOARDS_PER_PROJECT_TOTAL',
});

/** A whole number from 1 to 1000. Anything else is the fallback. */
export function parseLimit(raw: unknown, fallback: number): number {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return fallback;
  const value = Number(trimmed);
  return value >= 1 && value <= 1000 ? value : fallback;
}

export function limitsFromEnv(env: Record<string, unknown> | undefined): Limits {
  const source = env ?? {};
  const limits = {} as Limits;
  for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof Limits>) {
    limits[key] = parseLimit(source[LIMIT_ENV_NAMES[key]], DEFAULT_LIMITS[key]);
  }
  return limits;
}

/** The limits the request was built with. Falls back to the defaults for an app built without them. */
export function limitsOf(c: { get(key: 'limits'): Limits | undefined }): Limits {
  return c.get('limits') ?? { ...DEFAULT_LIMITS };
}
