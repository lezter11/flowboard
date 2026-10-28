import {
  type GetSessionResponse,
  type LogoutResponse,
  type WorkspaceListResponse,
  type ProjectResponse,
  type ProjectListResponse,
  type ProjectPeopleResponse,
  type BoardListResponse,
  type BoardSnapshotResponse,
  type BoardSnapshotQuery,
  type CardResponse,
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
} from '@flowboard/contracts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

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
  const url = `${API_BASE}${path}`;
  const headers = new Headers(options.headers || {});
  
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
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

  async devLogin(role: string = 'owner', projectId?: string): Promise<GetSessionResponse> {
    return request<GetSessionResponse>('/api/v1/session/dev-login', {
      method: 'POST',
      body: JSON.stringify({ role, projectId }),
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

  async getProject(projectId: string): Promise<ProjectResponse> {
    return request<ProjectResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}`);
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
    return request<BoardSnapshotResponse>(`/api/v1/boards/${encodeURIComponent(boardId)}/snapshot${queryString}`);
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

  async updateCard(cardId: string, input: UpdateCardInput): Promise<MutationResponse> {
    return request<MutationResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}`, {
      method: 'PATCH',
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
    return request<MutationResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}/trash`, {
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
  async listProjectActivity(projectId: string): Promise<ActivityListResponse> {
    return request<ActivityListResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/activity`);
  },

  async listNotifications(): Promise<NotificationListResponse> {
    return request<NotificationListResponse>('/api/v1/notifications');
  },

  // Trash
  async listProjectTrash(projectId: string): Promise<TrashListResponse> {
    return request<TrashListResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/trash`);
  },
};
