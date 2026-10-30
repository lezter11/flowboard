import { z } from 'zod';
import {
  createDataEnvelopeSchema,
  createPaginatedEnvelopeSchema,
  projectRoleSchema,
  utcIsoTimestampSchema,
} from './common.ts';

// Invitation email rules (B-7). One plain address only: ASCII letters, digits and RFC 5322 atext
// in the local part, a dotted hostname with a letter TLD. Refused: control characters (CR, LF, tab),
// spaces, non-ASCII, display-name forms such as "Name <a@b.c>", quoted parts, empty or over-long
// parts, and leading, trailing or doubled dots. The header-injection risk is why CR and LF are named.
const EMAIL_LOCAL_ATOM = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+$/;
const EMAIL_DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_TLD = /^[a-z]{2,63}$/;
const EMAIL_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const EMAIL_REFUSED_CHARACTERS = /[\u0000-\u0020\u007f-\uffff<>"(),;:[\]\\]/;

export function isValidInvitationEmail(value: string): boolean {
  if (value.length > 254 || EMAIL_REFUSED_CHARACTERS.test(value)) return false;
  const at = value.indexOf('@');
  if (at === -1 || value.indexOf('@', at + 1) !== -1) return false;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length === 0 || local.length > 64 || domain.length === 0 || domain.length > 255) return false;

  // An empty label means a leading, trailing or doubled dot, and fails the label pattern here.
  if (!local.split('.').every((atom) => EMAIL_LOCAL_ATOM.test(atom))) return false;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((label) => EMAIL_DOMAIN_LABEL.test(label))) return false;
  return EMAIL_TLD.test(labels[labels.length - 1]!);
}

export const createInvitationInputSchema = z.object({
  email: z
    .string()
    // Checked before trim: trim would otherwise quietly drop a trailing CR or LF.
    .refine((value) => !EMAIL_CONTROL_CHARACTERS.test(value), { message: 'Invalid email address format' })
    .trim()
    .max(254, 'Email must not exceed 254 characters')
    .toLowerCase()
    .refine(isValidInvitationEmail, { message: 'Invalid email address format' }),
  role: projectRoleSchema,
});
export type CreateInvitationInput = z.infer<typeof createInvitationInputSchema>;

export const acceptInvitationInputSchema = z.object({
  token: z.string().trim().min(16, 'Invitation token is too short').max(128, 'Invitation token is too long'),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInputSchema>;

export const invitationStatusSchema = z.enum(['pending', 'accepted', 'revoked', 'expired']);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

export const invitationSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  email: z.string().email(),
  role: projectRoleSchema,
  status: invitationStatusSchema,
  invitedBy: z.string().min(1),
  expiresAt: utcIsoTimestampSchema,
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
  token: z.string().optional(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const invitationResponseSchema = createDataEnvelopeSchema(invitationSchema);
export type InvitationResponse = z.infer<typeof invitationResponseSchema>;

export const invitationListResponseSchema = createPaginatedEnvelopeSchema(invitationSchema);
export type InvitationListResponse = z.infer<typeof invitationListResponseSchema>;

export const acceptInvitationResultSchema = z.object({
  success: z.boolean().optional(),
  projectId: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  role: projectRoleSchema,
  membershipId: z.string().min(1).optional(),
});
export type AcceptInvitationResult = z.infer<typeof acceptInvitationResultSchema>;

export const acceptInvitationResponseSchema = createDataEnvelopeSchema(acceptInvitationResultSchema);
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;

export const revokeInvitationResultSchema = z.object({
  success: z.boolean(),
  id: z.string().min(1),
  status: z.literal('revoked'),
});
export type RevokeInvitationResult = z.infer<typeof revokeInvitationResultSchema>;

export const revokeInvitationResponseSchema = createDataEnvelopeSchema(revokeInvitationResultSchema);
export type RevokeInvitationResponse = z.infer<typeof revokeInvitationResponseSchema>;

export const leaveProjectResultSchema = z.object({
  success: z.boolean(),
});
export type LeaveProjectResult = z.infer<typeof leaveProjectResultSchema>;

export const leaveProjectResponseSchema = createDataEnvelopeSchema(leaveProjectResultSchema);
export type LeaveProjectResponse = z.infer<typeof leaveProjectResponseSchema>;

