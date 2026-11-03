import { lockProjectQuota, countActiveMembers, countPendingInvitations, quotaExceeded } from './quotas.ts';
import { DEFAULT_LIMITS, type Limits } from '../services/limits.ts';
import crypto from 'node:crypto';
import type pg from 'pg';
import type { Invitation, InvitationStatus, ProjectRole, InvitationListQuery, InvitationDelivery } from '@flowboard/contracts';
import { HttpError } from '../http/errors.ts';
import { saveReceipt } from './idempotency.ts';
import { recordActivity } from './activity.ts';
import { acquireWritableProjectContextLock } from './rbac.ts';

/**
 * The outbox payload for an invitation email: the link token, the project name and the inviter's
 * display name, read now so the email can be built later without a session.
 */
async function invitationEmailPayload(
  client: pg.ClientBase,
  input: {
    invitationId: string; email: string; role: string; projectId: string; workspaceId: string;
    inviterId: string; expiresAt: string; rawToken: string;
  },
): Promise<Record<string, unknown>> {
  const res = await client.query<{ project_name: string; inviter_name: string }>(
    `SELECT p.name AS project_name, u.display_name AS inviter_name
     FROM projects p, users u
     WHERE p.id = $1 AND u.id = $2`,
    [input.projectId, input.inviterId],
  );
  return {
    invitationId: input.invitationId,
    email: input.email,
    role: input.role,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    projectName: res.rows[0]?.project_name ?? '',
    inviterName: res.rows[0]?.inviter_name ?? '',
    expiresAt: input.expiresAt,
    token: input.rawToken,
  };
}

export interface CreateInvitationResult {
  invitation: Invitation;
  rawToken: string;
  /** The outbox row that will send the email. The route starts an immediate send from it (B-10). */
  outboxId: string;
}

export interface AcceptInvitationResult {
  success: true;
  projectId: string;
  workspaceId: string;
  role: ProjectRole;
  membershipId: string;
}

/**
 * Creates a project invitation within an active database transaction.
 */
export async function createInvitation(
  client: pg.ClientBase,
  actor: { id: string; email?: string },
  projectId: string,
  email: string,
  role: ProjectRole,
  idempotencyKey: string,
): Promise<CreateInvitationResult> {
  const normalizedEmail = email.trim().toLowerCase();

  // 1. Resolve project existence, workspace ownership, and archive status
  const prjRes = await client.query<{
    id: string;
    workspace_id: string;
    archived: boolean;
    owner_id: string;
  }>(
    `SELECT p.id, p.workspace_id, p.archived, w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1
     FOR SHARE OF w`,
    [projectId],
  );

  if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
    throw HttpError.notFound('Project not found or unauthorized.', 'NOT_FOUND');
  }

  const project = prjRes.rows[0];
  if (project.archived) {
    throw HttpError.conflict('Project is archived and read-only.', 'READ_ONLY_CONTEXT');
  }

  const workspaceId = project.workspace_id;

  // 2. Resolve actor role (Owner vs Manager vs Member/Viewer)
  let actorRole: 'owner' | 'manager' | 'member' | 'viewer' | null = null;
  if (project.owner_id === actor.id) {
    actorRole = 'owner';
  } else {
    const memberRes = await client.query<{ role: 'manager' | 'member' | 'viewer'; status: string }>(
      `SELECT role, status
       FROM project_memberships
       WHERE project_id = $1 AND user_id = $2`,
      [projectId, actor.id],
    );
    if (memberRes.rows.length > 0 && memberRes.rows[0]?.status === 'active') {
      actorRole = memberRes.rows[0].role;
    }
  }

  if (!actorRole) {
    throw HttpError.notFound('Project not found or unauthorized.', 'NOT_FOUND');
  }

  if (actorRole !== 'owner' && actorRole !== 'manager') {
    throw HttpError.forbidden(
      'Only workspace owners and project managers can invite members.',
      'FORBIDDEN',
    );
  }

  // Role restriction: Workspace Owner can invite manager, member, or viewer.
  // Project Manager can invite member or viewer only.
  if (actorRole === 'manager' && role === 'manager') {
    throw HttpError.forbidden('Only workspace owners can invite managers.', 'FORBIDDEN');
  }

  // 3. Fencing: Ensure recipient email is not workspace owner or an active project member
  const ownerUserRes = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE id = $1 AND LOWER(email) = LOWER($2)`,
    [project.owner_id, normalizedEmail],
  );
  if (ownerUserRes.rows.length > 0) {
    throw HttpError.badRequest(
      'User is already an active member of this project.',
      'ALREADY_MEMBER',
    );
  }

  const activeMemberRes = await client.query<{ id: string }>(
    `SELECT pm.id
     FROM project_memberships pm
     JOIN users u ON pm.user_id = u.id
     WHERE pm.project_id = $1 AND LOWER(u.email) = LOWER($2) AND pm.status = 'active'`,
    [projectId, normalizedEmail],
  );

  if (activeMemberRes.rows.length > 0) {
    throw HttpError.badRequest(
      'User is already an active member of this project.',
      'ALREADY_MEMBER',
    );
  }

  // 4. Check for active pending invitation for this email in this project
  const pendingInvRes = await client.query<{ id: string }>(
    `SELECT id
     FROM project_invitations
     WHERE project_id = $1 AND LOWER(email) = LOWER($2) AND status = 'pending' AND expires_at > NOW()`,
    [projectId, normalizedEmail],
  );

  if (pendingInvRes.rows.length > 0) {
    throw HttpError.badRequest(
      'An active invitation already exists for this email. Resend the existing invitation instead of creating a duplicate.',
      'INVITATION_ALREADY_EXISTS',
    );
  }

  // 5. Generate 32-byte cryptographically secure random token and its SHA-256 hash
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const invId = 'inv_' + crypto.randomUUID();

  // 4. Insert into project_invitations with expires_at = NOW() + INTERVAL '7 days'
  const invRes = await client.query<{
    id: string;
    project_id: string;
    workspace_id: string;
    email: string;
    role: string;
    token_hash: string;
    invited_by: string;
    status: string;
    expires_at: Date;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO project_invitations (
       id, project_id, workspace_id, email, role, token_hash, invited_by, status, expires_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, 'pending', NOW() + INTERVAL '7 days', NOW(), NOW()
     )
     RETURNING id, project_id, workspace_id, email, role, token_hash, invited_by, status, expires_at, created_at, updated_at`,
    [invId, projectId, workspaceId, normalizedEmail, role, tokenHash, actor.id],
  );

  const invRow = invRes.rows[0];
  if (!invRow) {
    throw new Error('Failed to create invitation record');
  }

  // 5. Insert outbox record for asynchronous email delivery. The raw token is needed to build the
  // accept link at send time; it leaves the payload when the row settles (invitation-delivery.ts).
  const outboxId = 'out_' + crypto.randomUUID();
  const outboxPayload = await invitationEmailPayload(client, {
    invitationId: invRow.id,
    email: invRow.email,
    role: invRow.role,
    projectId: invRow.project_id,
    workspaceId,
    inviterId: actor.id,
    expiresAt: new Date(invRow.expires_at).toISOString(),
    rawToken,
  });

  await client.query(
    `INSERT INTO outbox (
       id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at
     ) VALUES (
       $1, $2, $3, 'invitation.created', $4, 'pending', 0, NOW(), NOW()
     )`,
    [outboxId, workspaceId, projectId, JSON.stringify(outboxPayload)],
  );

  const invitation: Invitation = {
    id: invRow.id,
    projectId: invRow.project_id,
    email: invRow.email,
    role: invRow.role as ProjectRole,
    status: invRow.status as InvitationStatus,
    invitedBy: invRow.invited_by,
    expiresAt: new Date(invRow.expires_at).toISOString(),
    createdAt: new Date(invRow.created_at).toISOString(),
    updatedAt: new Date(invRow.updated_at).toISOString(),
    token: rawToken,
  };

  // Project-scope event. The token and the invitee email are never written to the log: only the
  // invitation id and the role.
  await recordActivity(client, {
    workspaceId,
    projectId,
    visibilityScope: 'project',
    actorId: actor.id,
    action: 'invitation_sent',
    safeChanges: { invitationId: invRow.id, role: invRow.role },
  });

  // 6. Save idempotency receipt
  const methodPath = `/api/v1/projects/${projectId}/invitations`;
  const responsePayload = {
    data: {
      id: invitation.id,
      projectId: invitation.projectId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      invitedBy: invitation.invitedBy,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
      token: rawToken,
    },
  };

  await saveReceipt(
    client,
    actor.id,
    'project',
    projectId,
    idempotencyKey,
    methodPath,
    { email: normalizedEmail, role },
    201,
    responsePayload,
  );

  return { invitation, rawToken, outboxId };
}

/**
 * Accepts a matching project invitation using a raw single-use token.
 */
export async function acceptInvitation(
  client: pg.ClientBase,
  actor: { id: string; email?: string },
  rawToken: string,
  limits: Limits = { ...DEFAULT_LIMITS },
): Promise<AcceptInvitationResult> {
  // 1. Compute SHA-256 of rawToken
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // F-04: the project quota lock comes before the invitation row lock, the order create and resend use.
  const owning = await client.query<{ project_id: string }>('SELECT project_id FROM project_invitations WHERE token_hash = $1', [tokenHash]);
  if (owning.rows[0]) {
    await lockProjectQuota(client, owning.rows[0].project_id);
    await acquireWritableProjectContextLock(client, owning.rows[0].project_id);
  }

  // 2. Query project_invitations locking the row for update
  const invRes = await client.query<{
    id: string;
    project_id: string;
    workspace_id: string;
    email: string;
    role: string;
    status: string;
    expires_at: Date;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, project_id, workspace_id, email, role, status, expires_at, created_at, updated_at
     FROM project_invitations
     WHERE token_hash = $1
     FOR UPDATE`,
    [tokenHash],
  );

  if (invRes.rows.length === 0 || !invRes.rows[0]) {
    throw HttpError.badRequest('Invitation not found or no longer pending.', 'INVALID_INVITATION');
  }

  const invitation = invRes.rows[0];
  if (invitation.status !== 'pending') {
    throw HttpError.badRequest('Invitation not found or no longer pending.', 'INVALID_INVITATION');
  }

  // 3. Expiry verification
  const now = new Date();
  const expiresAt = new Date(invitation.expires_at);
  if (expiresAt.getTime() <= now.getTime()) {
    await client.query(
      `UPDATE project_invitations SET status = 'expired', updated_at = NOW() WHERE id = $1`,
      [invitation.id],
    );
    throw HttpError.badRequest('Invitation has expired.', 'INVITATION_EXPIRED');
  }

  // 4. Email verification
  let actorEmail = actor.email;
  if (!actorEmail) {
    const userRes = await client.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [
      actor.id,
    ]);
    actorEmail = userRes.rows[0]?.email;
  }

  if (!actorEmail || invitation.email.toLowerCase() !== actorEmail.toLowerCase()) {
    throw HttpError.forbidden(
      'Authenticated email does not match invitation recipient.',
      'EMAIL_MISMATCH',
    );
  }

  // 4b. Verify workspace owner cannot accept project invitations
  const wsRes = await client.query<{ owner_id: string }>(
    `SELECT owner_id FROM workspaces WHERE id = $1`,
    [invitation.workspace_id],
  );
  if (wsRes.rows[0]?.owner_id === actor.id) {
    throw HttpError.badRequest(
      'User is already an active member of this project.',
      'ALREADY_MEMBER',
    );
  }

  // 4c. Verify existing project membership status and revocation timestamp fence
  const existingMemberRes = await client.query<{
    id: string;
    status: string;
    updated_at: Date;
  }>(
    `SELECT id, status, updated_at
     FROM project_memberships
     WHERE project_id = $1 AND user_id = $2
     FOR UPDATE`,
    [invitation.project_id, actor.id],
  );

  if (existingMemberRes.rows.length > 0) {
    const existingMember = existingMemberRes.rows[0]!;
    if (existingMember.status === 'active') {
      throw HttpError.badRequest(
        'User is already an active member of this project.',
        'ALREADY_MEMBER',
      );
    }
    if (existingMember.status === 'removed') {
      if (new Date(invitation.created_at).getTime() <= new Date(existingMember.updated_at).getTime()) {
        throw HttpError.badRequest(
          'This invitation was issued before project access was revoked. A fresh invitation from a project administrator is required.',
          'INVITATION_SUPERSEDED',
        );
      }
    }
  }

  // F-11: an accept needs a free active seat. The Owner is not counted, and an active member never reaches here.
  if ((await countActiveMembers(client, invitation.project_id)) >= limits.membersPerProject) {
    throw quotaExceeded('members', limits.membersPerProject, 'remove_member');
  }

  // 5. Transactional state transition and membership upsert
  await client.query(
    `UPDATE project_invitations
     SET status = 'accepted', updated_at = NOW()
     WHERE id = $1`,
    [invitation.id],
  );

  const memberId = 'pm_' + crypto.randomUUID();
  const membershipRes = await client.query<{ id: string }>(
    `INSERT INTO project_memberships (
       id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'active', 1, NOW(), NOW()
     )
     ON CONFLICT (project_id, user_id)
     DO UPDATE SET
       role = EXCLUDED.role,
       status = 'active',
       version = project_memberships.version + 1,
       updated_at = NOW()
     RETURNING id`,
    [memberId, invitation.project_id, invitation.workspace_id, actor.id, invitation.role],
  );

  await recordActivity(client, {
    workspaceId: invitation.workspace_id,
    projectId: invitation.project_id,
    visibilityScope: 'project',
    actorId: actor.id,
    action: 'invitation_accepted',
    safeChanges: { invitationId: invitation.id, role: invitation.role },
  });

  const finalMemberId = membershipRes.rows[0]?.id ?? memberId;

  return {
    success: true,
    projectId: invitation.project_id,
    workspaceId: invitation.workspace_id,
    role: invitation.role as ProjectRole,
    membershipId: finalMemberId,
  };
}

export interface ResendInvitationResult {
  invitation: Invitation;
  rawToken: string;
  outboxId: string;
}

/**
 * Resends an existing pending or expired invitation, rotating its token and extending expiry.
 */
export async function resendInvitation(
  client: pg.ClientBase,
  actor: { id: string; email?: string },
  projectId: string,
  invitationId: string,
  idempotencyKey: string,
): Promise<ResendInvitationResult> {
  // 1. Resolve project existence, workspace ownership, and archive status
  const prjRes = await client.query<{
    id: string;
    workspace_id: string;
    archived: boolean;
    owner_id: string;
  }>(
    `SELECT p.id, p.workspace_id, p.archived, w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1
     FOR SHARE OF w`,
    [projectId],
  );

  if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
    throw HttpError.notFound('Project not found or unauthorized.', 'NOT_FOUND');
  }

  const project = prjRes.rows[0];
  if (project.archived) {
    throw HttpError.conflict('Project is archived and read-only.', 'READ_ONLY_CONTEXT');
  }

  // 2. Resolve actor role (Owner vs Manager vs Member/Viewer)
  let actorRole: 'owner' | 'manager' | 'member' | 'viewer' | null = null;
  if (project.owner_id === actor.id) {
    actorRole = 'owner';
  } else {
    const memberRes = await client.query<{ role: 'manager' | 'member' | 'viewer'; status: string }>(
      `SELECT role, status
       FROM project_memberships
       WHERE project_id = $1 AND user_id = $2`,
      [projectId, actor.id],
    );
    if (memberRes.rows.length > 0 && memberRes.rows[0]?.status === 'active') {
      actorRole = memberRes.rows[0].role;
    }
  }

  if (!actorRole) {
    throw HttpError.notFound('Project not found or unauthorized.', 'NOT_FOUND');
  }

  if (actorRole !== 'owner' && actorRole !== 'manager') {
    throw HttpError.forbidden(
      'Only workspace owners and project managers can resend invitations.',
      'FORBIDDEN',
    );
  }

  // 3. Query target invitation FOR UPDATE
  const invRes = await client.query<{
    id: string;
    project_id: string;
    workspace_id: string;
    email: string;
    role: string;
    token_hash: string;
    invited_by: string;
    status: string;
    expires_at: Date;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, project_id, workspace_id, email, role, token_hash, invited_by, status, expires_at, created_at, updated_at
     FROM project_invitations
     WHERE id = $1 AND project_id = $2
     FOR UPDATE`,
    [invitationId, projectId],
  );

  if (invRes.rows.length === 0 || !invRes.rows[0]) {
    throw HttpError.notFound('Invitation not found.', 'NOT_FOUND');
  }

  const invitationRow = invRes.rows[0];

  // Role restriction:
  // Workspace Owner can resend any invitation.
  // Project Manager can resend member/viewer invitations only.
  if (actorRole === 'manager' && invitationRow.role === 'manager') {
    throw HttpError.forbidden('Only workspace owners can resend invitations for managers.', 'FORBIDDEN');
  }

  // F-07: an expired invitation is not revived by resend. The inviter sends a new one.
  if (invitationRow.status === 'expired' || new Date(invitationRow.expires_at).getTime() <= Date.now()) {
    throw HttpError.conflict('This invitation has expired. Send a new invitation.', 'INVITATION_EXPIRED');
  }

  // Target invitation must be pending or expired. If accepted or revoked, return 400 INVALID_INVITATION
  if (invitationRow.status === 'accepted') {
    throw HttpError.badRequest('Cannot resend an invitation that has already been accepted.', 'INVALID_INVITATION');
  }
  if (invitationRow.status === 'revoked') {
    throw HttpError.badRequest('Cannot resend an invitation that has been revoked.', 'INVALID_INVITATION');
  }

  // 4. Generate fresh 32-byte cryptographically secure random token and its SHA-256 hash
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // 5. Update project_invitations with token_hash, status='pending', expires_at = NOW() + INTERVAL '7 days'
  const updateRes = await client.query<{
    id: string;
    project_id: string;
    workspace_id: string;
    email: string;
    role: string;
    token_hash: string;
    invited_by: string;
    status: string;
    expires_at: Date;
    created_at: Date;
    updated_at: Date;
  }>(
    `UPDATE project_invitations
     SET token_hash = $1,
         expires_at = NOW() + INTERVAL '7 days',
         status = 'pending',
         updated_at = NOW()
     WHERE id = $2
     RETURNING id, project_id, workspace_id, email, role, token_hash, invited_by, status, expires_at, created_at, updated_at`,
    [tokenHash, invitationId],
  );

  const updatedRow = updateRes.rows[0];
  if (!updatedRow) {
    throw new Error('Failed to update invitation record');
  }

  await recordActivity(client, {
    workspaceId: updatedRow.workspace_id,
    projectId: updatedRow.project_id,
    visibilityScope: 'project',
    actorId: actor.id,
    action: 'invitation_resent',
    safeChanges: { invitationId: updatedRow.id, role: updatedRow.role },
  });

  // 6. Insert outbox record for asynchronous email delivery. Older pending emails for this
  // invitation carry the previous token, so they are settled without sending and the token is dropped.
  await client.query(
    `UPDATE outbox
     SET status = 'failed', settled_at = NOW(), payload = jsonb_build_object('invitationId', $1::text)
     WHERE event_type = 'invitation.created' AND status IN ('pending', 'processing')
       AND payload->>'invitationId' = $1`,
    [updatedRow.id],
  );
  const outboxId = 'out_' + crypto.randomUUID();
  const outboxPayload = await invitationEmailPayload(client, {
    invitationId: updatedRow.id,
    email: updatedRow.email,
    role: updatedRow.role,
    projectId: updatedRow.project_id,
    workspaceId: updatedRow.workspace_id,
    inviterId: actor.id,
    expiresAt: new Date(updatedRow.expires_at).toISOString(),
    rawToken,
  });

  await client.query(
    `INSERT INTO outbox (
       id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at
     ) VALUES (
       $1, $2, $3, 'invitation.created', $4, 'pending', 0, NOW(), NOW()
     )`,
    [outboxId, updatedRow.workspace_id, updatedRow.project_id, JSON.stringify(outboxPayload)],
  );

  const invitation: Invitation = {
    id: updatedRow.id,
    projectId: updatedRow.project_id,
    email: updatedRow.email,
    role: updatedRow.role as ProjectRole,
    status: updatedRow.status as InvitationStatus,
    invitedBy: updatedRow.invited_by,
    expiresAt: new Date(updatedRow.expires_at).toISOString(),
    createdAt: new Date(updatedRow.created_at).toISOString(),
    updatedAt: new Date(updatedRow.updated_at).toISOString(),
    token: rawToken,
  };

  // 7. Save idempotency receipt
  const methodPath = `/api/v1/projects/${projectId}/invitations/${invitationId}/resend`;
  const responsePayload = {
    data: {
      id: invitation.id,
      projectId: invitation.projectId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      invitedBy: invitation.invitedBy,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
      token: rawToken,
    },
  };

  await saveReceipt(
    client,
    actor.id,
    'project',
    projectId,
    idempotencyKey,
    methodPath,
    { invitationId },
    200,
    responsePayload,
  );

  return { invitation, rawToken, outboxId };
}

export interface RevokeInvitationResult {
  success: true;
  id: string;
  status: 'revoked';
}

/**
 * Revokes a pending project invitation.
 */
export async function revokeInvitation(
  client: pg.ClientBase,
  actor: { id: string; email?: string },
  projectId: string,
  invitationId: string,
  idempotencyKey: string,
): Promise<RevokeInvitationResult> {
  // 1. Resolve project existence, workspace ownership, and archive status
  const prjRes = await client.query<{
    id: string;
    workspace_id: string;
    archived: boolean;
    owner_id: string;
  }>(
    `SELECT p.id, p.workspace_id, p.archived, w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1
     FOR SHARE OF w`,
    [projectId],
  );

  if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
    throw HttpError.notFound('Project not found or unauthorized.', 'NOT_FOUND');
  }

  const project = prjRes.rows[0];
  if (project.archived) {
    throw HttpError.conflict('Project is archived and read-only.', 'READ_ONLY_CONTEXT');
  }

  // 2. Resolve actor role
  let actorRole: 'owner' | 'manager' | 'member' | 'viewer' | null = null;
  if (project.owner_id === actor.id) {
    actorRole = 'owner';
  } else {
    const memberRes = await client.query<{ role: 'manager' | 'member' | 'viewer'; status: string }>(
      `SELECT role, status
       FROM project_memberships
       WHERE project_id = $1 AND user_id = $2`,
      [projectId, actor.id],
    );
    if (memberRes.rows.length > 0 && memberRes.rows[0]?.status === 'active') {
      actorRole = memberRes.rows[0].role;
    }
  }

  if (!actorRole) {
    throw HttpError.notFound('Project not found or unauthorized.', 'NOT_FOUND');
  }

  if (actorRole !== 'owner' && actorRole !== 'manager') {
    throw HttpError.forbidden(
      'Only workspace owners and project managers can revoke invitations.',
      'FORBIDDEN',
    );
  }

  // 3. Query target invitation FOR UPDATE
  const invRes = await client.query<{
    id: string;
    project_id: string;
    role: string;
    status: string;
  }>(
    `SELECT id, project_id, role, status
     FROM project_invitations
     WHERE id = $1 AND project_id = $2
     FOR UPDATE`,
    [invitationId, projectId],
  );

  if (invRes.rows.length === 0 || !invRes.rows[0]) {
    throw HttpError.notFound('Invitation not found.', 'NOT_FOUND');
  }

  const invitationRow = invRes.rows[0];

  if (actorRole === 'manager' && invitationRow.role === 'manager') {
    throw HttpError.forbidden('Only workspace owners can revoke invitations for managers.', 'FORBIDDEN');
  }

  if (invitationRow.status === 'accepted') {
    throw HttpError.badRequest('Cannot revoke an invitation that has already been accepted.', 'INVALID_INVITATION');
  }
  if (invitationRow.status === 'revoked') {
    throw HttpError.badRequest('Cannot revoke an invitation that has already been revoked.', 'INVALID_INVITATION');
  }
  if (invitationRow.status !== 'pending') {
    throw HttpError.badRequest('Invitation is no longer pending.', 'INVALID_INVITATION');
  }

  // 4. Update status to 'revoked'
  await client.query(
    `UPDATE project_invitations
     SET status = 'revoked', updated_at = NOW()
     WHERE id = $1`,
    [invitationId],
  );

  await recordActivity(client, {
    workspaceId: project.workspace_id,
    projectId,
    visibilityScope: 'project',
    actorId: actor.id,
    action: 'invitation_revoked',
    safeChanges: { invitationId, role: invitationRow.role },
  });

  // 5. Save idempotency receipt
  const methodPath = `/api/v1/projects/${projectId}/invitations/${invitationId}/revoke`;
  const responsePayload = {
    data: {
      success: true,
      id: invitationId,
      status: 'revoked' as const,
    },
  };

  await saveReceipt(
    client,
    actor.id,
    'project',
    projectId,
    idempotencyKey,
    methodPath,
    { invitationId },
    200,
    responsePayload,
  );

  return {
    success: true,
    id: invitationId,
    status: 'revoked',
  };
}

interface InvitationCursor {
  v: 1;
  scope: string;
  snapshotAt: string;
  createdAt: string;
  id: string;
}

export interface ListInvitationsOptions extends Partial<InvitationListQuery> {
  cursorSecret?: string | undefined;
}

function cursorKey(secret: string | undefined): string {
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new HttpError(503, 'CONFIG_ERROR', 'Invitation history is temporarily unavailable.');
  }
  return secret;
}

function signInvitationCursor(cursor: InvitationCursor, secret: string | undefined): string {
  const body = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', cursorKey(secret)).update(body).digest('base64url')}`;
}

function readInvitationCursor(token: string, scope: string, secret: string | undefined): InvitationCursor {
  const key = cursorKey(secret);
  try {
    if (token.length > 4096) throw new Error('cursor too long');
    const parts = token.split('.');
    const body = parts[0], signature = parts[1];
    if (parts.length !== 2 || !body || !signature || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(signature)) throw new Error('invalid encoding');
    const expected = crypto.createHmac('sha256', key).update(body).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.toString('base64url') !== signature || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw new Error('invalid signature');
    const decoded = Buffer.from(body, 'base64url');
    if (decoded.toString('base64url') !== body) throw new Error('invalid encoding');
    const value = JSON.parse(decoded.toString('utf8')) as Partial<InvitationCursor>;
    if (value.v !== 1 || value.scope !== scope || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value.id) ||
        typeof value.snapshotAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.snapshotAt) || !Number.isFinite(Date.parse(value.snapshotAt)) ||
        typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('wrong cursor scope');
    return value as InvitationCursor;
  } catch {
    throw HttpError.conflict('STALE_CURSOR', 'Invitation history changed or the cursor is invalid. Refresh the list.');
  }
}

/** Bounded invitation history; no raw token/hash or outbox payload leaves this projection. */
export async function listInvitations(
  client: pg.ClientBase | pg.Pool,
  actor: { id: string },
  projectId: string,
  options: ListInvitationsOptions = {},
): Promise<{ data: Invitation[]; nextCursor: string | null }> {
  const context = await client.query<{
    owner_id: string; project_version: number; archived: boolean; workspace_version: number;
  }>(`SELECT w.owner_id,p.version AS project_version,p.archived,w.version AS workspace_version
      FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=$1 FOR SHARE OF w`, [projectId]);
  const project = context.rows[0];
  if (!project) throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  let role: string = 'owner';
  let memberVersion = 0;
  if (project.owner_id !== actor.id) {
    const membership = await client.query<{ role: string; status: string; version: number }>(
      'SELECT role,status,version FROM project_memberships WHERE project_id=$1 AND user_id=$2 FOR SHARE', [projectId, actor.id]);
    const member = membership.rows[0];
    if (!member || member.status !== 'active') throw HttpError.notFound('Project not found.', 'NOT_FOUND');
    if (member.role !== 'manager') throw HttpError.forbidden('Only workspace owners and project managers can view project invitations.', 'FORBIDDEN');
    role = member.role; memberVersion = member.version;
  }
  // Match write authorization order: workspace, membership, then project lifecycle.
  const lifecycle = await client.query<{ version: number; archived: boolean }>(
    'SELECT version,archived FROM projects WHERE id=$1 FOR SHARE', [projectId]);
  const currentProject = lifecycle.rows[0]!;
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw HttpError.badRequest('Invalid invitation page limit.', 'INVALID_LIMIT');
  const scope = crypto.createHash('sha256').update(JSON.stringify({ projectId, actorId: actor.id,
    status: options.status ?? null, role, memberVersion, ownerId: project.owner_id,
    projectVersion: currentProject.version, workspaceVersion: project.workspace_version, archived: currentProject.archived })).digest('hex');
  const secret = options.cursorSecret ?? (typeof process === 'undefined' ? undefined : process.env['CURSOR_SECRET']);
  const cursor = options.cursor ? readInvitationCursor(options.cursor, scope, secret) : null;
  const snapshotAt = cursor?.snapshotAt ?? new Date().toISOString();
  const result = await client.query<{
    id: string; project_id: string; email: string; role: ProjectRole; status: InvitationStatus;
    invited_by: string; expires_at: Date; created_at: Date; updated_at: Date; cursor_created_at: string;
    delivery_status: string | null; delivery_retries: number | null;
  }>(`WITH page AS (
      SELECT i.id,i.project_id,i.email,i.role,i.invited_by,i.expires_at,i.created_at,i.updated_at,
        CASE WHEN i.status='pending' AND i.expires_at<=$2::timestamptz THEN 'expired' ELSE i.status END AS status,
        to_char(i.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
      FROM project_invitations i WHERE i.project_id=$1 AND i.created_at<=$2::timestamptz
        AND ($3::text IS NULL OR (CASE WHEN i.status='pending' AND i.expires_at<=$2::timestamptz THEN 'expired' ELSE i.status END)=$3)
        AND ($4::timestamptz IS NULL OR (i.created_at,i.id)<($4::timestamptz,$5::text))
      ORDER BY i.created_at DESC,i.id DESC LIMIT $6
    ) SELECT page.*,delivery.status AS delivery_status,delivery.retry_count AS delivery_retries
      FROM page LEFT JOIN LATERAL (
        SELECT o.status,o.retry_count FROM outbox o WHERE o.project_id=page.project_id
          AND o.event_type='invitation.created' AND o.payload->>'invitationId'=page.id
        ORDER BY o.created_at DESC,o.id DESC LIMIT 1
      ) delivery ON TRUE ORDER BY page.created_at DESC,page.id DESC`,
    [projectId, snapshotAt, options.status ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1]);
  const visible = result.rows.slice(0, limit);
  const data: Invitation[] = visible.map((row) => {
    let deliveryStatus: InvitationDelivery['status'] = 'unknown';
    if (row.delivery_status === 'delivered' || row.delivery_status === 'failed') deliveryStatus = row.delivery_status;
    else if (row.delivery_status === 'pending' || row.delivery_status === 'processing') deliveryStatus = (row.delivery_retries ?? 0) > 0 ? 'retrying' : 'pending';
    return { id: row.id, projectId: row.project_id, email: row.email, role: row.role, status: row.status,
      invitedBy: row.invited_by, expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
      delivery: { status: deliveryStatus, canRetry: deliveryStatus === 'failed' && row.status === 'pending' &&
        new Date(row.expires_at).getTime() > Date.now() && !currentProject.archived && (role === 'owner' || row.role !== 'manager') } };
  });
  const last = visible.at(-1);
  const nextCursor = result.rows.length > limit && last
    ? signInvitationCursor({ v: 1, scope, snapshotAt, createdAt: last.cursor_created_at, id: last.id }, secret) : null;
  return { data, nextCursor };
}

export interface LeaveProjectResult {
  success: true;
}

/**
 * Allows an active project member (Manager, Member, Viewer) to leave a project.
 * Workspace owners cannot leave their project.
 */
export async function leaveProject(
  client: pg.ClientBase,
  actor: { id: string },
  projectId: string,
  idempotencyKey: string,
): Promise<LeaveProjectResult> {
  await lockProjectQuota(client, projectId);
  // 1. Resolve project existence and workspace ownership
  const prjRes = await client.query<{
    id: string;
    workspace_id: string;
    owner_id: string;
  }>(
    `SELECT p.id, p.workspace_id, w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1
     FOR SHARE OF w`,
    [projectId],
  );

  if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
    throw HttpError.notFound('Project not found or unauthorized.', 'NOT_FOUND');
  }

  const project = prjRes.rows[0];

  // Workspace owner CANNOT leave their own project
  if (project.owner_id === actor.id) {
    throw HttpError.forbidden(
      'Workspace owners cannot leave their project. Transfer workspace ownership instead.',
      'FORBIDDEN',
    );
  }

  // 2. Query actor's active membership
  const memberRes = await client.query<{
    id: string;
    role: string;
    status: string;
    version: number;
  }>(
    `SELECT id, role, status, version
     FROM project_memberships
     WHERE project_id = $1 AND user_id = $2
     FOR UPDATE`,
    [projectId, actor.id],
  );

  if (memberRes.rows.length === 0 || memberRes.rows[0]?.status !== 'active') {
    throw HttpError.notFound('Project not found or not an active member.', 'NOT_FOUND');
  }

  const membership = memberRes.rows[0];

  // 3. Transition status = 'removed', version = version + 1, updated_at = NOW()
  await client.query(
    `UPDATE project_memberships
     SET status = 'removed', version = version + 1, updated_at = NOW()
     WHERE id = $1`,
    [membership.id],
  );

  await recordActivity(client, {
    workspaceId: project.workspace_id,
    projectId,
    visibilityScope: 'project',
    actorId: actor.id,
    action: 'member_left',
    safeChanges: { userId: actor.id, role: membership.role },
  });

  // 3b. Look up user's email and atomically revoke pending invitations for that email in this project
  const userRes = await client.query<{ email: string }>(
    'SELECT email FROM users WHERE id = $1',
    [actor.id],
  );
  const actorEmail = userRes.rows[0]?.email;
  if (actorEmail) {
    const revoked = await client.query<{ id: string; role: string }>(
      `UPDATE project_invitations
       SET status = 'revoked', updated_at = NOW()
       WHERE project_id = $1 AND LOWER(email) = LOWER($2) AND status = 'pending'
       RETURNING id, role`,
      [projectId, actorEmail],
    );
    for (const inv of revoked.rows) {
      await recordActivity(client, {
        workspaceId: project.workspace_id,
        projectId,
        visibilityScope: 'project',
        actorId: actor.id,
        action: 'invitation_revoked',
        safeChanges: { invitationId: inv.id, role: inv.role, reason: 'member_left' },
      });
    }
  }

  // 4. Save idempotency receipt
  const methodPath = `/api/v1/projects/${projectId}/leave`;
  const responsePayload = {
    data: { success: true },
  };

  await saveReceipt(
    client,
    actor.id,
    'project',
    projectId,
    idempotencyKey,
    methodPath,
    {},
    200,
    responsePayload,
  );

  return { success: true };
}


/**
 * Seat reservation (edge-case review rule 6): an invitation or resend is refused when the project already
 * has the pending limit, or when active members plus pending invitations reach the member limit. Callers
 * are Owners and Managers, who can already list members and invitations, so the counts are shown.
 */
export async function assertInvitationSeats(client: pg.ClientBase, projectId: string, limits: Limits): Promise<void> {
  const pending = await countPendingInvitations(client, projectId);
  if (pending >= limits.pendingInvitesPerProject) {
    throw quotaExceeded('pending_invitations', limits.pendingInvitesPerProject, 'revoke_invitation', pending);
  }
  const active = await countActiveMembers(client, projectId);
  if (active + pending >= limits.membersPerProject) {
    throw quotaExceeded('members', limits.membersPerProject, pending > 0 ? 'revoke_invitation' : 'remove_member', active);
  }
}
