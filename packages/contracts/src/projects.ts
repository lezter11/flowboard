import { z } from 'zod';
import {
  createDataEnvelopeSchema,
  createPaginatedEnvelopeSchema,
  personDisplaySchema,
  projectRoleSchema,
  utcIsoTimestampSchema,
} from './common.ts';

export const createProjectInputSchema = z.object({
  name: z.string().trim().min(1, 'Project name cannot be empty').max(100, 'Project name cannot exceed 100 characters'),
  description: z.string().max(2000, 'Description cannot exceed 2000 characters').optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const updateProjectInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(2000, 'Description cannot exceed 2000 characters').nullable().optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: 'At least one field (name or description) must be provided to update',
  });
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

export const projectLifecycleInputSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});
export type ProjectLifecycleInput = z.infer<typeof projectLifecycleInputSchema>;

export const projectMemberStatusSchema = z.enum(['active', 'removed']);
export type ProjectMemberStatus = z.infer<typeof projectMemberStatusSchema>;

export const updateProjectMemberInputSchema = z.object({
  role: projectRoleSchema,
  status: projectMemberStatusSchema,
  expectedVersion: z.number().int().nonnegative(),
});
export type UpdateProjectMemberInput = z.infer<typeof updateProjectMemberInputSchema>;

export const projectMemberSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  userId: z.string().min(1),
  role: projectRoleSchema,
  status: projectMemberStatusSchema,
  version: z.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
  user: personDisplaySchema.optional(),
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;

export const projectSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).nullable(),
  isArchived: z.boolean(),
  version: z.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
});
export type Project = z.infer<typeof projectSchema>;

export const projectResponseSchema = createDataEnvelopeSchema(projectSchema);
export type ProjectResponse = z.infer<typeof projectResponseSchema>;

export const projectListResponseSchema = createPaginatedEnvelopeSchema(projectSchema);
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

export const projectMemberListResponseSchema = createPaginatedEnvelopeSchema(projectMemberSchema);
export type ProjectMemberListResponse = z.infer<typeof projectMemberListResponseSchema>;

export const projectPeoplePurposeSchema = z.enum(['display', 'assignee', 'mention']);
export type ProjectPeoplePurpose = z.infer<typeof projectPeoplePurposeSchema>;

export const projectPeopleQuerySchema = z.object({
  purpose: projectPeoplePurposeSchema.default('display').optional(),
  query: z.string().trim().max(100).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
});
export type ProjectPeopleQuery = z.infer<typeof projectPeopleQuerySchema>;

export const projectPeopleResponseSchema = createPaginatedEnvelopeSchema(personDisplaySchema);
export type ProjectPeopleResponse = z.infer<typeof projectPeopleResponseSchema>;
