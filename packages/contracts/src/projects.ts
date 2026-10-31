import { REFUSED_NAME_CHARACTERS, REFUSED_NAME_MESSAGE } from './common.ts';
import { z } from 'zod';
import {
  createDataEnvelopeSchema,
  createPaginatedEnvelopeSchema,
  dateOnlySchema,
  personDisplaySchema,
  projectRoleSchema,
  roleSchema,
  utcIsoTimestampSchema,
} from './common.ts';

export const PROJECT_BRIEF_MAX = 5000;
export const PROJECT_LINKS_MAX = 10;
export const PROJECT_LINK_URL_MAX = 2000;

/**
 * A project link must be an https URL with no credentials. Plain http, other schemes such as
 * javascript:, and user:password@ forms are refused. Whitespace is refused so a link cannot
 * hide a second address.
 */
export function isSafeHttpsUrl(value: string): boolean {
  if (value.length > PROJECT_LINK_URL_MAX || /\s/.test(value)) return false;
  // A plain https:// prefix with a host right after it. This refuses the 'https:///host' form.
  if (!/^https:\/\/[^/]/i.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.hostname !== '';
}

export const projectLinkInputSchema = z.object({
  title: z.string().trim().min(1, 'Link title cannot be empty').max(100, 'Link title cannot exceed 100 characters'),
  url: z
    .string()
    .trim()
    .max(PROJECT_LINK_URL_MAX, 'Link URL cannot exceed 2000 characters')
    .refine(isSafeHttpsUrl, { message: 'Links must be https URLs without a username or password' }),
});
export type ProjectLinkInput = z.infer<typeof projectLinkInputSchema>;

export const projectLinkSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(100),
  url: z.string().min(1).max(PROJECT_LINK_URL_MAX),
  position: z.number().int().nonnegative(),
});
export type ProjectLink = z.infer<typeof projectLinkSchema>;

export const createProjectInputSchema = z.object({
  name: z.string()
    .refine((v) => !REFUSED_NAME_CHARACTERS.test(v), { message: REFUSED_NAME_MESSAGE })
    .trim().min(1, 'Project name cannot be empty').max(100, 'Project name cannot exceed 100 characters'),
  description: z.string().max(2000, 'Description cannot exceed 2000 characters').optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

// defaultBoardId is Owner only; name and description keep the Owner and Manager rule.
// Owner and Manager edit name, description, brief and links. defaultBoardId is Owner only.
// links replaces the whole list (at most 10); send [] to remove them all.
export const updateProjectInputSchema = z
  .object({
    name: z.string()
      .refine((v) => !REFUSED_NAME_CHARACTERS.test(v), { message: REFUSED_NAME_MESSAGE })
      .trim().min(1).max(100).optional(),
    description: z.string().max(2000, 'Description cannot exceed 2000 characters').nullable().optional(),
    brief: z.string().max(PROJECT_BRIEF_MAX, 'Brief cannot exceed 5000 characters').nullable().optional(),
    links: z.array(projectLinkInputSchema).max(PROJECT_LINKS_MAX, 'A project can have at most 10 links').optional(),
    defaultBoardId: z.string().min(1).max(200).nullable().optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.brief !== undefined ||
      data.links !== undefined ||
      data.defaultBoardId !== undefined,
    { message: 'At least one field (name, description, brief, links or defaultBoardId) must be provided to update' },
  );
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
  // Optional, additive. The landing board id only when the caller can read that board; otherwise null.
  defaultBoardId: z.string().min(1).nullable().optional(),
  // Optional, additive. Returned by the single-project read and the PATCH response only.
  brief: z.string().max(PROJECT_BRIEF_MAX).nullable().optional(),
  links: z.array(projectLinkSchema).max(PROJECT_LINKS_MAX).optional(),
  isArchived: z.boolean(),
  version: z.number().int().nonnegative(),
  createdAt: utcIsoTimestampSchema,
  updatedAt: utcIsoTimestampSchema,
});
export type Project = z.infer<typeof projectSchema>;

// GET /projects/:pid/overview: real counts over the boards the caller can read. Owner sees all
// boards; anyone else sees boards they hold a grant for. Archived boards are excluded for everyone.
export const projectOverviewSchema = z.object({
  projectId: z.string().min(1),
  asOfDate: dateOnlySchema,
  readableBoardCount: z.number().int().nonnegative(),
  cards: z.object({
    active: z.number().int().nonnegative(),
    byCategory: z.object({
      todo: z.number().int().nonnegative(),
      active: z.number().int().nonnegative(),
      done: z.number().int().nonnegative(),
    }),
    // Open means the card's column is not in the done category.
    overdue: z.number().int().nonnegative(),
    dueSoon: z.number().int().nonnegative(),
    unassignedOpen: z.number().int().nonnegative(),
  }),
  // Open cards per assignee, highest first, at most 50 people.
  assignees: z.array(z.object({
    userId: z.string().min(1),
    displayName: z.string().min(1),
    avatarUrl: z.string().nullable(),
    openCount: z.number().int().nonnegative(),
  })).max(50),
  // Last 10 activity rows: board rows on readable boards; project-scope rows for owner and managers only (B-6). cardId is null for non-card rows.
  recentActivity: z.array(z.object({
    id: z.string().min(1),
    action: z.string().min(1),
    cardId: z.string().min(1).nullable(),
    createdAt: utcIsoTimestampSchema,
    actor: z.object({ id: z.string().min(1), displayName: z.string().min(1) }),
  })).max(10),
});
export type ProjectOverview = z.infer<typeof projectOverviewSchema>;

export const projectOverviewResponseSchema = createDataEnvelopeSchema(projectOverviewSchema);
export type ProjectOverviewResponse = z.infer<typeof projectOverviewResponseSchema>;

export const projectResponseSchema = createDataEnvelopeSchema(projectSchema);
export type ProjectResponse = z.infer<typeof projectResponseSchema>;

export const projectListResponseSchema = createPaginatedEnvelopeSchema(projectSchema);
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

export const projectMemberListResponseSchema = createPaginatedEnvelopeSchema(projectMemberSchema);
export type ProjectMemberListResponse = z.infer<typeof projectMemberListResponseSchema>;

export const projectDirectoryMemberSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1).optional(),
  name: z.string().min(1),
  displayName: z.string().min(1).optional(),
  email: z.string().email(),
  avatarUrl: z.string().nullable().optional(),
  role: roleSchema,
  status: projectMemberStatusSchema,
  version: z.number().int().nonnegative(),
  membershipId: z.string().optional(),
});
export type ProjectDirectoryMember = z.infer<typeof projectDirectoryMemberSchema>;

export const projectDirectoryResponseSchema = createPaginatedEnvelopeSchema(projectDirectoryMemberSchema);
export type ProjectDirectoryResponse = z.infer<typeof projectDirectoryResponseSchema>;

export const projectPeoplePurposeSchema = z.enum(['display', 'assignee', 'mention']);
export type ProjectPeoplePurpose = z.infer<typeof projectPeoplePurposeSchema>;

// purpose=mention (B-11): pass cardId (preferred) or boardId. The caller must read that board; the
// answer is the owner plus active members holding a board grant. With neither, mention returns [].
export const projectPeopleQuerySchema = z.object({
  purpose: projectPeoplePurposeSchema.default('display').optional(),
  boardId: z.string().min(1).max(200).optional(),
  cardId: z.string().min(1).max(200).optional(),
  query: z.string().trim().max(100).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
});
export type ProjectPeopleQuery = z.infer<typeof projectPeopleQuerySchema>;

export const projectPeopleResponseSchema = createPaginatedEnvelopeSchema(personDisplaySchema);
export type ProjectPeopleResponse = z.infer<typeof projectPeopleResponseSchema>;

export const projectAccessSummarySchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  workspaceOwner: z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    avatarUrl: z.string().url().nullable(),
    role: z.literal('owner'),
    inherited: z.literal(true),
    disclosure: z.string().min(1),
  }),
  actor: z.object({
    id: z.string().min(1),
    role: projectRoleSchema.or(z.literal('owner')),
    inheritedFrom: z.enum(['workspace_owner', 'project_membership']),
  }),
  boardInheritance: z.object({
    model: z.literal('explicit_board_grants'),
    allBoardsInherit: z.literal(false),
    hasBoardOnlyExceptions: z.literal(true),
    boardCount: z.number().int().nonnegative(),
    disclosure: z.string().min(1),
  }),
  memberSummary: z.object({
    activeManagers: z.number().int().nonnegative(),
    activeMembers: z.number().int().nonnegative(),
    activeViewers: z.number().int().nonnegative(),
    totalActiveMembers: z.number().int().nonnegative(),
  }),
});
export type ProjectAccessSummary = z.infer<typeof projectAccessSummarySchema>;

export const projectAccessSummaryResponseSchema = createDataEnvelopeSchema(projectAccessSummarySchema);
export type ProjectAccessSummaryResponse = z.infer<typeof projectAccessSummaryResponseSchema>;

// POST /api/v1/projects (B-17): create a project in the caller's own personal workspace. The caller
// never names a workspace: a workspaceId in the body is refused with 422 (strict). Idempotency-Key is
// required (scope: actor). Returns 201 { data: Project }, or 200 with replayed: true on a replay.
export const createOwnProjectInputSchema = createProjectInputSchema.strict();
export type CreateOwnProjectInput = z.infer<typeof createOwnProjectInputSchema>;
export const createOwnProjectResponseSchema = z.object({
  data: projectSchema,
  replayed: z.boolean().optional(),
});
export type CreateOwnProjectResponse = z.infer<typeof createOwnProjectResponseSchema>;
