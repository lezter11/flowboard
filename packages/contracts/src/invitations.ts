import { z } from 'zod';
import {
  createDataEnvelopeSchema,
  createPaginatedEnvelopeSchema,
  projectRoleSchema,
  utcIsoTimestampSchema,
} from './common.ts';

export const createInvitationInputSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Invalid email address format')
    .max(254, 'Email must not exceed 254 characters')
    .toLowerCase(),
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

