import {
  type GetSessionResponse,
  type LogoutResponse,
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
  type InvitationStatus,
  type RevokeInvitationResponse,
  type UpdateColumnInput,
  type ReorderColumnsInput,
  type DeleteColumnInput,
  type BoardResponse,
  type CreateOwnProjectInput,
  type CreateOwnProjectResponse,
  type CreateBoardInput,
  type AcceptInvitationResponse,
  type ImportStatusResponse,
  type CommitImportInput,
  type UpdateImportMappingsInput,
  type UpdateProjectMemberInput,
  type UpdateProjectInput,
  type UpdateProfileInput,
  type UpdateWorkspaceInput,
  type WorkspaceResponse,
  type SaveNameInput,
  type SaveNameResponse,
  type UpdateBoardInput,
  type BoardSnapshotResponse,
  type BoardSnapshotQuery,
  type CardsQuery,
  type MyTasksQuery,
  type CardListResponse,
  type PlacementInput,
  type PlacementResponse,
  type CardResponse,
  type CardSummary,
  type CreateCardInput,
  type UpdateCardInput,
  type MoveCardInput,
  type SoftDeleteCardInput,
  type MutationResponse,
  type CommentListResponse,
  type PostCommentInput,
  type EditCommentInput,
  type DeleteCommentInput,
  type CommentResponse,
  type ActivityListResponse,
  type NotificationListResponse,
  type TrashListResponse,
  type RestoreCardInput,
  type CreateImageUploadInput,
  type ImageUploadResponse,
  type FinalizedImageResponse,
  type FinalizedImageListResponse,
  type ImageGalleryResponse,
  type ActivityFeedQuery,
} from '@flowboard/contracts';

import { isNetworkFailure, NETWORK_MESSAGE } from './error-codes.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly retryAfter?: number | null;
  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    /** Server request id, shown only as a support reference on server faults. */
    requestId?: string,
    /** Seconds from the Retry-After header, when present. */
    retryAfter?: number | null
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

function generateIdempotencyKey(): string {
  return `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

/** Retry-After as whole seconds; HTTP dates are not used by this API. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : null;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path;
  const headers = new Headers(options.headers || {});
  
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  } catch (error) {
    // "Failed to fetch" / "Load failed" are not sentences for people: one friendly line, status 0 so callers can tell it from a server answer.
    if (isNetworkFailure(error)) throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
    throw error;
  }

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const errorDetail = data?.error;
    throw new ApiError(
      response.status,
      errorDetail?.code || 'HTTP_ERROR',
      errorDetail?.message || `HTTP request failed with status ${response.status}`,
      errorDetail?.details,
      typeof errorDetail?.requestId === 'string' ? errorDetail.requestId : undefined,
      parseRetryAfter(response.headers.get('retry-after')),
    );
  }

  return data as T;
}

/** Raw-bytes PUT with upload progress and cancel. fetch cannot report upload progress, so this one call uses XMLHttpRequest. */
function putBytes(path: string, blob: Blob, opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal }): Promise<ImageUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', path);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) opts.onProgress?.(event.loaded / event.total); };
    xhr.onload = () => {
      let data: { error?: { code?: string; message?: string; details?: unknown } } | null = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(data as unknown as ImageUploadResponse); return; }
      reject(new ApiError(xhr.status, data?.error?.code || 'HTTP_ERROR', data?.error?.message || `HTTP request failed with status ${xhr.status}`, data?.error?.details));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    if (opts.signal) { if (opts.signal.aborted) { reject(new DOMException('Upload cancelled', 'AbortError')); return; } opts.signal.addEventListener('abort', () => xhr.abort(), { once: true }); }
    xhr.send(blob);
  });
}

export const api = {
  /** First and last name (B-16). Setting a value is idempotent, so no Idempotency-Key. */
  async saveName(input: SaveNameInput): Promise<SaveNameResponse> {
    return request<SaveNameResponse>('/api/v1/session/name', { method: 'PATCH', body: JSON.stringify(input) });
  },
  /** Own display name only. Setting a value is idempotent, so no Idempotency-Key. */
  async updateProfile(input: UpdateProfileInput): Promise<void> {
    await request<unknown>('/api/v1/session/profile', { method: 'PATCH', body: JSON.stringify(input) });
  },
  async updateWorkspace(workspaceId:string,input:UpdateWorkspaceInput):Promise<WorkspaceResponse> {
    return request(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}`,{method:'PATCH',body:JSON.stringify(input)});
  },
  // Card images (private; bytes only ever travel through these authenticated calls)
  async createImageUpload(cardId: string, input: CreateImageUploadInput, idempotencyKey?: string): Promise<ImageUploadResponse> {
    return request<ImageUploadResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}/image-uploads`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() }, body: JSON.stringify(input) });
  },
  putImageContent(uploadId: string, blob: Blob, opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<ImageUploadResponse> {
    return putBytes(`/api/v1/image-uploads/${encodeURIComponent(uploadId)}/content`, blob, opts);
  },
  async finalizeImageUpload(uploadId: string, idempotencyKey?: string): Promise<FinalizedImageResponse> {
    return request<FinalizedImageResponse>(`/api/v1/image-uploads/${encodeURIComponent(uploadId)}/finalize`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() }, body: '{}' });
  },
  async cancelImageUpload(uploadId: string): Promise<ImageUploadResponse> {
    return request<ImageUploadResponse>(`/api/v1/image-uploads/${encodeURIComponent(uploadId)}`, { method: 'DELETE' });
  },
  async listCardImages(cardId: string): Promise<ImageGalleryResponse> {
    return request<ImageGalleryResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}/images`);
  },
  /** Image bytes as a Blob. The caller turns it into an object URL and revokes it; no image URL is ever put on the page. */
  async fetchImageBlob(imageId: string, kind: 'content' | 'thumbnail' = 'content'): Promise<Blob> {
    const response = await fetch(`/api/v1/images/${encodeURIComponent(imageId)}/${kind}`, { credentials: 'same-origin' }).catch((error: unknown) => { throw isNetworkFailure(error) ? new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE) : error; });
    if (!response.ok) {
      let body: { error?: { code?: string; message?: string } } | null = null;
      try { body = await response.json(); } catch { /* not JSON */ }
      throw new ApiError(response.status, body?.error?.code || 'HTTP_ERROR', body?.error?.message || `HTTP request failed with status ${response.status}`);
    }
    return response.blob();
  },
  async deleteImage(imageId: string, expectedVersion: number, idempotencyKey?: string): Promise<void> {
    await request<unknown>(`/api/v1/images/${encodeURIComponent(imageId)}`, { method: 'DELETE', headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() }, body: JSON.stringify({ expectedVersion }) });
  },
  /** Leave a project you joined. One Idempotency-Key per confirmed attempt. */
  async leaveProject(projectId: string, idempotencyKey: string): Promise<void> {
    await request<unknown>(`/api/v1/projects/${encodeURIComponent(projectId)}/leave`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: '{}' });
  },
  async archiveProject(projectId: string, expectedVersion: number, idempotencyKey?: string): Promise<void> {
    await request<unknown>(`/api/v1/projects/${encodeURIComponent(projectId)}/archive`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() }, body: JSON.stringify({ expectedVersion }) });
  },
  async reopenProject(projectId: string, expectedVersion: number, idempotencyKey?: string): Promise<void> {
    await request<unknown>(`/api/v1/projects/${encodeURIComponent(projectId)}/reopen`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() }, body: JSON.stringify({ expectedVersion }) });
  },


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

  // Projects
  async listAccessibleProjects(options:{cursor?:string;limit?:number;signal?:AbortSignal}={}):Promise<ProjectListResponse> {
    const query=new URLSearchParams({limit:String(options.limit??50)});if(options.cursor)query.set('cursor',options.cursor);
    return request(`/api/v1/projects?${query}`,{signal:options.signal});
  },
  async listProjects(workspaceId: string): Promise<ProjectListResponse> {
    return request<ProjectListResponse>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects`);
  },

  /** Creates a project the caller owns. The server picks the container; the caller never names one. One Idempotency-Key per attempt. */
  async createOwnProject(input: CreateOwnProjectInput, idempotencyKey: string): Promise<CreateOwnProjectResponse> {
    return request<CreateOwnProjectResponse>('/api/v1/projects', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
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
  async listInvitations(projectId: string, options: { cursor?: string; limit?: number; status?: InvitationStatus; signal?: AbortSignal } = {}): Promise<InvitationListResponse> {
    const query = new URLSearchParams({ limit: String(options.limit ?? 50) });
    if (options.cursor) query.set('cursor', options.cursor);
    if (options.status) query.set('status', options.status);
    return request<InvitationListResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/invitations?${query}`, { signal: options.signal });
  },
  async resendInvitation(projectId: string, invitationId: string, idempotencyKey?: string): Promise<InvitationResponse> {
    return request<InvitationResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/invitations/${encodeURIComponent(invitationId)}/resend`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() }, body: '{}' });
  },
  async revokeInvitation(projectId: string, invitationId: string, idempotencyKey?: string): Promise<RevokeInvitationResponse> {
    return request<RevokeInvitationResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/invitations/${encodeURIComponent(invitationId)}/revoke`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() }, body: '{}' });
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

  async getImportStatus(importId:string, options:{limit?:number;cursor?:string;signal?:AbortSignal}={}):Promise<ImportStatusResponse> {
    const query=new URLSearchParams({limit:String(options.limit??50)});
    if(options.cursor) query.set('cursor',options.cursor);
    return request(`/api/v1/imports/${encodeURIComponent(importId)}?${query}`,{signal:options.signal});
  },
  async updateImportMappings(importId:string,input:UpdateImportMappingsInput):Promise<ImportStatusResponse> {
    const mappingEntries=[...Object.entries(input.mappings).map(([sourceStatus,columnId])=>({sourceStatus,columnId})),...(input.mappingEntries??[])];
    return request(`/api/v1/imports/${encodeURIComponent(importId)}/mappings`,{method:'POST',body:JSON.stringify({mappings:{},mappingEntries,expectedVersion:input.expectedVersion})});
  },
  async getImportReport(importId:string):Promise<Blob> {
    let response:Response;
    try {response=await fetch(`/api/v1/imports/${encodeURIComponent(importId)}/report`,{credentials:'same-origin'});}
    catch(error){if(isNetworkFailure(error)) throw new ApiError(0,'NETWORK_ERROR',NETWORK_MESSAGE);throw error;}
    if(!response.ok){const payload=await response.json().catch(()=>null);throw new ApiError(response.status,payload?.error?.code??'HTTP_ERROR','Could not download the import report.');}
    if(!response.headers.get('content-type')?.toLowerCase().startsWith('text/csv')) throw new ApiError(502,'INVALID_RESPONSE','The import report was not a CSV file.');
    return response.blob();
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

  /** Mentions need cardId (or boardId): the server answers an empty list without one, because mentions are limited to people who can read that board. */
  async listProjectPeople(projectId: string, purpose?: 'display' | 'assignee' | 'mention', opts: { cardId?: string; boardId?: string } = {}): Promise<ProjectPeopleResponse> {
    const q = new URLSearchParams();
    if (purpose) q.set('purpose', purpose);
    if (opts.cardId) q.set('cardId', opts.cardId);
    if (opts.boardId) q.set('boardId', opts.boardId);
    const qs = q.toString();
    return request<ProjectPeopleResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/people${qs ? `?${qs}` : ''}`);
  },

  // Boards
  async listBoardCards(boardId: string, query: CardsQuery, signal?: AbortSignal): Promise<CardListResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
    return request(`/api/v1/boards/${encodeURIComponent(boardId)}/cards?${params}`, { signal });
  },

  async getCardPlacement(boardId: string, columnId: string, input: PlacementInput): Promise<PlacementResponse> {
    const params = new URLSearchParams({ movingCardId: input.movingCardId, at: input.at });
    if (input.anchorCardId) params.set('anchorCardId', input.anchorCardId);
    return request(`/api/v1/boards/${encodeURIComponent(boardId)}/columns/${encodeURIComponent(columnId)}/placement?${params}`);
  },

  async changeBoardLifecycle(boardId: string, archived: boolean, expectedVersion: number, idempotencyKey: string): Promise<BoardResponse> {
    return request(`/api/v1/boards/${encodeURIComponent(boardId)}/${archived ? 'archive' : 'reopen'}`, {
      method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ expectedVersion }),
    });
  },

  async listProjectBoards(projectId: string, options: { includeArchived?: boolean } = {}): Promise<BoardListResponse> {
    return request<BoardListResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/boards${options.includeArchived ? '?includeArchived=true' : ''}`);
  },

  async getBoardSnapshot(boardId: string, query?: BoardSnapshotQuery, signal?: AbortSignal): Promise<BoardSnapshotResponse> {
    const params = new URLSearchParams();
    if (query?.titleQuery) params.set('titleQuery', query.titleQuery);
    if (query?.priority) params.set('priority', query.priority);
    if (query?.assigneeId) params.set('assigneeId', query.assigneeId);
    if (query?.due) params.set('due', query.due);
    if (query?.cardLimitPerColumn) params.set('cardLimitPerColumn', String(query.cardLimitPerColumn));

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return request<BoardSnapshotResponse>(`/api/v1/boards/${encodeURIComponent(boardId)}${queryString}`, { signal });
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

  async getCard(cardId: string, signal?:AbortSignal): Promise<CardResponse> {
    return request<CardResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}`,{signal});
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

  async undoCardMove(cardId:string,input:{expectedVersion:number;expectedBoardVersion:number},idempotencyKey:string):Promise<MutationResponse> {
    return request(`/api/v1/cards/${encodeURIComponent(cardId)}/move-undo`,{method:'POST',headers:{'Idempotency-Key':idempotencyKey},body:JSON.stringify(input)});
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
  async listCardComments(cardId: string, options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<CommentListResponse> {
    const query = new URLSearchParams({ limit: String(options.limit ?? 50) });
    if (options.cursor) query.set('cursor', options.cursor);
    return request<CommentListResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}/comments?${query}`, { signal: options.signal });
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

  async editComment(commentId: string, input: EditCommentInput, idempotencyKey: string): Promise<CommentResponse> {
    return request<CommentResponse>(`/api/v1/comments/${encodeURIComponent(commentId)}`, {
      method: 'PATCH', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input),
    });
  },

  async deleteComment(commentId: string, input: DeleteCommentInput, idempotencyKey: string): Promise<{ data: { success: boolean; id: string; version: number } }> {
    return request(`/api/v1/comments/${encodeURIComponent(commentId)}`, {
      method: 'DELETE', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input),
    });
  },

  // Activity & Notifications
  async listProjectActivity(projectId: string, limit = 50, cursor?: string, signal?: AbortSignal, filters:Omit<ActivityFeedQuery,'projectId'|'limit'|'cursor'>={}): Promise<ActivityListResponse> {
    const query = new URLSearchParams({limit:String(limit)});
    for(const [key,value]of Object.entries(filters))if(value)query.set(key,value);
    if(cursor) query.set('cursor',cursor);
    return request<ActivityListResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/activity?${query}`,{signal});
  },

  async listWorkspaceActivity(workspaceId:string,options:Partial<ActivityFeedQuery>&{signal?:AbortSignal}={}):Promise<ActivityListResponse>{
    const query=new URLSearchParams({limit:String(options.limit??50)});for(const field of ['projectId','cardId','actorId','action','fromDate','toDate','cursor']as const)if(options[field])query.set(field,options[field]!);
    return request(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/activity?${query}`,{signal:options.signal});
  },
  async listCardActivity(cardId: string, limit = 50, cursor?: string, signal?: AbortSignal): Promise<ActivityListResponse> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return request<ActivityListResponse>(`/api/v1/cards/${encodeURIComponent(cardId)}/activity?${query}`, { signal });
  },

  async listMyTasks(projectId: string, options: Partial<Pick<MyTasksQuery,'due'|'priority'|'cursor'|'limit'>> & {signal?:AbortSignal} = {}): Promise<{ data: Array<CardSummary & { projectName?: string; boardName?: string; columnTitle?: string }>; nextCursor:string|null; asOfDate:string; timezone:string }> {
    const query = new URLSearchParams({projectId,limit:String(options.limit??50)});
    for(const field of ['due','priority','cursor'] as const) if(options[field]) query.set(field,options[field]!);
    return request(`/api/v1/me/tasks?${query}`,{signal:options.signal});
  },

  async listNotifications(options:{cursor?:string;limit?:number;signal?:AbortSignal} = {}): Promise<NotificationListResponse> {
    const query = new URLSearchParams({limit:String(options.limit??50)});
    if(options.cursor) query.set('cursor',options.cursor);
    return request<NotificationListResponse>(`/api/v1/notifications?${query}`,{signal:options.signal});
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

  async listProjectTrash(projectId: string, options:{cursor?:string;limit?:number;signal?:AbortSignal} = {}): Promise<TrashListResponse> {
    const query = new URLSearchParams({limit:String(options.limit??50)});
    if(options.cursor) query.set('cursor',options.cursor);
    return request<TrashListResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/trash?${query}`,{signal:options.signal});
  },
};
