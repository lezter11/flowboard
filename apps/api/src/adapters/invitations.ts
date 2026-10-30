import crypto from 'node:crypto';
import type pg from 'pg';
import type { Invitation, InvitationStatus, ProjectRole } from '@flowboard/contracts';
import { HttpError } from '../http/errors.ts';
import { saveReceipt } from './idempotency.ts';
import { recordActivity } from './activity.ts';

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
): Promise<AcceptInvitationResult> {
  // 1. Compute SHA-256 of rawToken
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

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
    await client.query('COMMIT').catch(() => {});
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
     SET status = 'failed', settled_at = NOW(), payload = '{"superseded":true}'::jsonb
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

/**
 * Lists all invitations for a project, with past-due pending invitations mapped to expired.
 * Never exposes token_hash.
 */
export async function listInvitations(
  client: pg.ClientBase | pg.Pool,
  actor: { id: string },
  projectId: string,
): Promise<Invitation[]> {
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
      'Only workspace owners and project managers can view project invitations.',
      'FORBIDDEN',
    );
  }

  // 3. Query invitations (never select token_hash)
  const invRes = await client.query<{
    id: string;
    project_id: string;
    email: string;
    role: string;
    invited_by: string;
    status: string;
    expires_at: Date;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, project_id, email, role, invited_by, status, expires_at, created_at, updated_at
     FROM project_invitations
     WHERE project_id = $1
     ORDER BY created_at DESC, id DESC`,
    [projectId],
  );

  const now = Date.now();
  return invRes.rows.map((row) => {
    const isPastDue = new Date(row.expires_at).getTime() <= now;
    const computedStatus: InvitationStatus =
      row.status === 'pending' && isPastDue ? 'expired' : (row.status as InvitationStatus);

    return {
      id: row.id,
      projectId: row.project_id,
      email: row.email,
      role: row.role as ProjectRole,
      status: computedStatus,
      invitedBy: row.invited_by,
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  });
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

