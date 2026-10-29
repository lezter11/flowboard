import {
  type GetSessionResponse,
  type LogoutResponse,
  type WorkspaceListResponse,
  type ProjectResponse,
  type ProjectOverviewResponse,
  type ProjectListResponse,
  type ProjectPeopleResponse,
  type ProjectDirectoryResponse,
  type BoardListResponse,
  type CreateColumnInput,
  type CreateInvitationInput,
  type InvitationResponse,
  type InvitationListResponse,
  type UpdateColumnInput,
  type ReorderColumnsInput,
  type DeleteColumnInput,
  type BoardResponse,
  type CreateProjectInput,
  type CreateBoardInput,
  type AcceptInvitationResponse,
  type ImportStatusResponse,
  type CommitImportInput,
  type UpdateProjectMemberInput,
  type UpdateProjectInput,
  type UpdateBoardInput,
  type BoardSnapshotResponse,
  type BoardSnapshotQuery,
  type CardResponse,
  type CardSummary,
  type CreateCardInput,
  type UpdateCardInput,
  type MoveCardInput,
  type SoftDeleteCardInput,
  type MutationResponse,
  type CommentListResponse,
  type PostCommentInput,
  type CommentResponse,
  type ActivityListResponse,
  type NotificationListResponse,
  type TrashListResponse,
  type RestoreCardInput,
} from '@flowboard/contracts';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function generateIdempotencyKey(): string {
  return `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path;
  const headers = new Headers(options.headers || {});
  
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const errorDetail = data?.error;
    throw new ApiError(
      response.status,
      errorDetail?.code || 'HTTP_ERROR',
      errorDetail?.message || `HTTP request failed with status ${response.status}`,
      errorDetail?.details
    );
  }

  return data as T;
}

export const api = {
  // Session & Auth
  async getSession(): Promise<GetSessionResponse> {
    return request<GetSessionResponse>('/api/v1/session');
  },

  /** Remembers where the user was. PUT last-location needs no Idempotency-Key; callers ignore failures. */
  async putLastLocation(projectId: string, boardId: string | null): Promise<void> {
    await request<unknown>('/api/v1/session/last-location', {
      method: 'PUT',
      body: JSON.stringify({ projectId, boardId }),
    });
  },

  async logout(): Promise<LogoutResponse> {
    return request<LogoutResponse>('/api/v1/session/logout', {
      method: 'POST',
    });
  },

  // Workspaces
  async listWorkspaces(): Promise<WorkspaceListResponse> {
    return request<WorkspaceListResponse>('/api/v1/workspaces');
  },

  // Projects
  async listProjects(workspaceId: string): Promise<ProjectListResponse> {
    return request<ProjectListResponse>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects`);
  },

  async createProject(workspaceId: string, input: CreateProjectInput, idempotencyKey?: string): Promise<ProjectResponse> {
    return request<ProjectResponse>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() },
      body: JSON.stringify(input),
    });
  },

  async createBoard(projectId: string, input: CreateBoardInput, idempotencyKey?: string): Promise<BoardResponse> {
    return request<BoardResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/boards`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() },
      body: JSON.stringify(input),
    });
  },

  async getProjectOverview(projectId: string): Promise<ProjectOverviewResponse> {
    return request<ProjectOverviewResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/overview`);
  },

  async updateProject(projectId: string, input: UpdateProjectInput, idempotencyKey?: string): Promise<ProjectResponse> {
    return request<ProjectResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() },
      body: JSON.stringify(input),
    });
  },

  async createColumn(boardId: string, input: CreateColumnInput, idempotencyKey?: string): Promise<unknown> {
    return request(`/api/v1/boards/${encodeURIComponent(boardId)}/columns`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() }, body: JSON.stringify(input) });
  },
  async updateColumn(boardId: string, columnId: string, input: UpdateColumnInput, idempotencyKey?: string): Promise<unknown> {
    return request(`/api/v1/boards/${encodeURIComponent(boardId)}/columns/${encodeURIComponent(columnId)}`, { method: 'PATCH', headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() }, body: JSON.stringify(input) });
  },
  async reorderColumns(boardId: string, input: ReorderColumnsInput, idempotencyKey?: string): Promise<unknown> {
    return request(`/api/v1/boards/${encodeURIComponent(boardId)}/columns/reorder`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() }, body: JSON.stringify(input) });
  },
  async deleteColumn(boardId: string, columnId: string, input: DeleteColumnInput, idempotencyKey?: string): Promise<unknown> {
    return request(`/api/v1/boards/${encodeURIComponent(boardId)}/columns/${encodeURIComponent(columnId)}`, { method: 'DELETE', headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() }, body: JSON.stringify(input) });
  },

  async updateBoard(boardId: string, input: UpdateBoardInput, idempotencyKey?: string): Promise<BoardResponse> {
    return request<BoardResponse>(`/api/v1/boards/${encodeURIComponent(boardId)}`, {
      method: 'PATCH',
      headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() },
      body: JSON.stringify(input),
    });
  },

  async getProject(projectId: string): Promise<ProjectResponse> {
    return request<ProjectResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}`);
  },

  async createInvitation(projectId: string, input: CreateInvitationInput, idempotencyKey?: string): Promise<InvitationResponse> {
    return request<InvitationResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/invitations`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() }, body: JSON.stringify(input) });
  },
  async listInvitations(projectId: string): Promise<InvitationListResponse> {
    return request<InvitationListResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/invitations`);
  },
  async resendInvitation(projectId: string, invitationId: string, idempotencyKey?: string): Promise<InvitationResponse> {
    return request<InvitationResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/invitations/${encodeURIComponent(invitationId)}/resend`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() }, body: '{}' });
  },
  async revokeInvitation(projectId: string, invitationId: string, idempotencyKey?: string): Promise<unknown> {
    return request<unknown>(`/api/v1/projects/${encodeURIComponent(projectId)}/invitations/${encodeURIComponent(invitationId)}/revoke`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() }, body: '{}' });
  },

  async acceptInvitation(token: string, idempotencyKey?: string): Promise<AcceptInvitationResponse> {
    return request<AcceptInvitationResponse>('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() },
      body: JSON.stringify({ token }),
    });
  },

  async createImport(boardId: string, file: File, defaultColumnId: string): Promise<ImportStatusResponse> {
    const form = new FormData();
    form.set('file', file);
    form.set('defaultColumnId', defaultColumnId);
    return request<ImportStatusResponse>(`/api/v1/boards/${encodeURIComponent(boardId)}/imports`, { method: 'POST', body: form });
  },

  async commitImport(importId: string, input: CommitImportInput, idempotencyKey?: string): Promise<ImportStatusResponse> {
    return request<ImportStatusResponse>(`/api/v1/imports/${encodeURIComponent(importId)}/commit`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() },
      body: JSON.stringify(input),
    });
  },

  async cancelImport(importId: string): Promise<void> {
    await request<unknown>(`/api/v1/imports/${encodeURIComponent(importId)}`, { method: 'DELETE' });
  },

  async updateProjectMember(projectId: string, userId: string, input: UpdateProjectMemberInput, idempotencyKey?: string): Promise<void> {
    await request<unknown>(`/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() },
      body: JSON.stringify(input),
    });
  },

  async removeProjectMember(projectId: string, userId: string, idempotencyKey?: string): Promise<void> {
    await request<unknown>(`/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() },
    });
  },

  async getBoardAccess(boardId: string): Promise<{ data: { grants: Array<{ userId: string }>; accessRevision: string | number; nextCursor: string | null } }> {
    return request(`/api/v1/boards/${encodeURIComponent(boardId)}/access`);
  },

  async setBoardGrant(boardId: string, userId: string, allow: boolean, expectedAccessRevision: string | number): Promise<void> {
    await request<unknown>(`/api/v1/boards/${encodeURIComponent(boardId)}/grants/${encodeURIComponent(userId)}`, {
      method: allow ? 'PUT' : 'DELETE',
      body: JSON.stringify({ expectedAccessRevision }),
    });
  },

  async listProjectMembers(projectId: string): Promise<ProjectDirectoryResponse> {
    return request<ProjectDirectoryResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/members?limit=100`);
  },

  async listProjectPeople(projectId: string): Promise<ProjectPeopleResponse> {
    return request<ProjectPeopleResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/people`);
  },

  // Boards
  async listProjectBoards(projectId: string): Promise<BoardListResponse> {
    return request<BoardListResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/boards`);
  },

  async getBoardSnapshot(boardId: string, query?: BoardSnapshotQuery): Promise<BoardSnapshotResponse> {
    const params = new URLSearchParams();
    if (query?.titleQuery) params.set('titleQuery', query.titleQuery);
    if (query?.priority) params.set('priority', query.priority);
    if (query?.assigneeId) params.set('assigneeId', query.assigneeId);
    if (query?.due) params.set('due', query.due);
    if (query?.cardLimitPerColumn) params.set('cardLimitPerColumn', String(query.cardLimitPerColumn));

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return request<BoardSnapshotResponse>(`/api/v1/boards/${encodeURIComponent(boardId)}${queryString}`);
  },

  // Cards
  async createCard(boardId: string, input: CreateCardInput, idempotencyKey?: string): Promise<MutationResponse> {
    return request<MutationResponse>(`/api/v1/boards/${encodeURIComponent(boardId)}/cards`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey || generateIdempotencyKey(),
      },
      body: JSON.stringify(input),
    });
  },

  async getCard(cardId: string): Promise<CardResponse> {
    return request<CardResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}`);
  },

  async updateCard(cardId: string, input: UpdateCardInput, idempotencyKey?: string): Promise<MutationResponse> {
    return request<MutationResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}`, {
      method: 'PATCH',
      headers: {
        'Idempotency-Key': idempotencyKey || generateIdempotencyKey(),
      },
      body: JSON.stringify(input),
    });
  },

  async moveCard(cardId: string, input: MoveCardInput, idempotencyKey?: string): Promise<MutationResponse> {
    return request<MutationResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}/move`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey || generateIdempotencyKey(),
      },
      body: JSON.stringify(input),
    });
  },

  async softDeleteCard(cardId: string, input: SoftDeleteCardInput, idempotencyKey?: string): Promise<MutationResponse> {
    return request<MutationResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}/delete`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey || generateIdempotencyKey(),
      },
      body: JSON.stringify(input),
    });
  },

  // Comments
  async listCardComments(cardId: string): Promise<CommentListResponse> {
    return request<CommentListResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}/comments`);
  },

  async postCardComment(cardId: string, input: PostCommentInput, idempotencyKey?: string): Promise<CommentResponse> {
    return request<CommentResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}/comments`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey || generateIdempotencyKey(),
      },
      body: JSON.stringify(input),
    });
  },

  // Activity & Notifications
  async listProjectActivity(projectId: string, limit = 100): Promise<ActivityListResponse> {
    return request<ActivityListResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/activity?limit=${limit}`);
  },

  async listCardActivity(cardId: string, limit = 50): Promise<ActivityListResponse> {
    return request<ActivityListResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}/activity?limit=${limit}`);
  },

  async listMyTasks(projectId: string): Promise<{ data: Array<CardSummary & { projectName?: string; boardName?: string; columnTitle?: string }> }> {
    return request(`/api/v1/me/tasks?projectId=${encodeURIComponent(projectId)}&limit=100`);
  },

  async listNotifications(): Promise<NotificationListResponse> {
    return request<NotificationListResponse>('/api/v1/notifications?limit=100');
  },

  async markNotificationRead(id: string): Promise<void> {
    await request<unknown>(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
  },

  async markAllNotificationsRead(): Promise<void> {
    await request<unknown>('/api/v1/notifications/mark-all-read', { method: 'POST' });
  },

  // Trash
  async restoreCard(cardId: string, input: RestoreCardInput, idempotencyKey?: string): Promise<MutationResponse> {
    return request<MutationResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}/restore`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() },
      body: JSON.stringify(input),
    });
  },

  async listProjectTrash(projectId: string): Promise<TrashListResponse> {
    return request<TrashListResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/trash`);
  },
};
