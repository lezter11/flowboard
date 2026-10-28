export type Role = 'owner' | 'manager' | 'member' | 'viewer';

export const ROLE_META: Record<Role, { label: string; description: string }> = {
  owner: { label: 'Owner', description: 'Full workspace and project access' },
  manager: { label: 'Manager', description: 'Runs this project; cannot grant managers' },
  member: { label: 'Member', description: 'Works on cards; no board settings or trash' },
  viewer: { label: 'Viewer', description: 'Read-only, including comments and images' },
};

const PERMISSIONS = {
  owner: { edit: true, move: true, manageBoard: true, invite: true },
  manager: { edit: true, move: true, manageBoard: true, invite: true },
  member: { edit: true, move: true, manageBoard: false, invite: false },
  viewer: { edit: false, move: false, manageBoard: false, invite: false },
} as const;

export type Action = keyof (typeof PERMISSIONS)['owner'];

export function normalizeRole(value: string | null | undefined): Role {
  return value === 'owner' || value === 'manager' || value === 'member' || value === 'viewer' ? value : 'viewer';
}

/** Mirrors the prototype's permission matrix; the server remains the authority. */
export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[role][action];
}
