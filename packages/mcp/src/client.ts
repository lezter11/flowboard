import crypto from 'node:crypto';

export interface FlowboardConfig {
  apiUrl: string;
  apiToken: string;
}

export interface BoardColumn {
  id: string;
  name: string;
  category: string;
  position: number;
}

export interface BoardSnapshot {
  id: string;
  name: string;
  version: number;
  columns: BoardColumn[];
}

export interface CreateCardInput {
  boardId: string;
  column: string; // Column ID or Column Name (case-insensitive)
  title: string;
  description?: string;
  priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string; // YYYY-MM-DD
}

export class FlowboardClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config?: Partial<FlowboardConfig>) {
    const rawUrl = config?.apiUrl || process.env['FLOWBOARD_API_URL'] || 'https://flowboard-app-uat.pages.dev';
    this.baseUrl = rawUrl.replace(/\/+$/, '');
    this.token = config?.apiToken || process.env['FLOWBOARD_API_TOKEN'] || '';

    if (!this.token) {
      console.warn('[Flowboard MCP] Warning: FLOWBOARD_API_TOKEN is not set.');
    }
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    headers.set('Accept', 'application/json');

    if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { ...options, headers });

    if (!res.ok) {
      let errorBody: any;
      try {
        errorBody = await res.json();
      } catch {
        errorBody = await res.text();
      }
      const message = typeof errorBody === 'object' && errorBody?.error?.message
        ? errorBody.error.message
        : `HTTP ${res.status}: ${res.statusText}`;
      const err = new Error(message) as Error & { status: number; body: any };
      err.status = res.status;
      err.body = errorBody;
      throw err;
    }

    if (res.status === 204) {
      return null as T;
    }

    return (await res.json()) as T;
  }

  async listProjects(): Promise<Array<{ id: string; name: string; description: string | null }>> {
    const res = await this.request<{ data: Array<{ id: string; name: string; description: string | null }> }>('/api/v1/projects');
    return res.data;
  }

  async listBoards(projectId: string): Promise<Array<{ id: string; name: string; structureVersion: number }>> {
    const res = await this.request<{ data: Array<{ id: string; name: string; structureVersion: number }> }>(
      `/api/v1/projects/${projectId}/boards`,
    );
    return res.data;
  }

  async getBoard(boardId: string): Promise<BoardSnapshot> {
    const res = await this.request<{ data: { id: string; name: string; version: number; columns: BoardColumn[] } }>(
      `/api/v1/boards/${boardId}`,
    );
    return {
      id: res.data.id,
      name: res.data.name,
      version: res.data.version,
      columns: res.data.columns || [],
    };
  }

  async createCard(input: CreateCardInput): Promise<{
    id: string;
    title: string;
    columnId: string;
    columnName: string;
    boardId: string;
    boardName: string;
    priority: string;
  }> {
    // 1. Fetch board to locate column and obtain current expectedBoardVersion
    const board = await this.getBoard(input.boardId);

    const targetColumn = board.columns.find(
      (c) =>
        c.id === input.column ||
        c.name.trim().toLowerCase() === input.column.trim().toLowerCase(),
    );

    if (!targetColumn) {
      const validNames = board.columns.map((c) => `"${c.name}" (id: ${c.id})`).join(', ');
      throw new Error(
        `Column "${input.column}" not found on board "${board.name}". Available columns are: ${validNames}`,
      );
    }

    const payload = {
      title: input.title.trim(),
      columnId: targetColumn.id,
      description: input.description || '',
      priority: input.priority || 'none',
      dueDate: input.dueDate || null,
      expectedBoardVersion: board.version,
    };

    const idempotencyKey = `pat_${crypto.randomUUID()}`;

    try {
      const res = await this.request<{ data: { id: string; title: string; priority: string } }>(
        `/api/v1/boards/${input.boardId}/cards`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify(payload),
        },
      );

      return {
        id: res.data.id,
        title: res.data.title,
        columnId: targetColumn.id,
        columnName: targetColumn.name,
        boardId: board.id,
        boardName: board.name,
        priority: res.data.priority,
      };
    } catch (err: any) {
      // Automatic retry once on version conflict
      if (err.status === 409) {
        const freshBoard = await this.getBoard(input.boardId);
        payload.expectedBoardVersion = freshBoard.version;
        const retryRes = await this.request<{ data: { id: string; title: string; priority: string } }>(
          `/api/v1/boards/${input.boardId}/cards`,
          {
            method: 'POST',
            headers: {
              'Idempotency-Key': `pat_retry_${crypto.randomUUID()}`,
            },
            body: JSON.stringify(payload),
          },
        );
        return {
          id: retryRes.data.id,
          title: retryRes.data.title,
          columnId: targetColumn.id,
          columnName: targetColumn.name,
          boardId: freshBoard.id,
          boardName: freshBoard.name,
          priority: retryRes.data.priority,
        };
      }
      throw err;
    }
  }

  async searchCards(projectId: string, query: string): Promise<Array<{ id: string; title: string; boardId: string; columnId: string }>> {
    const res = await this.request<{ data: Array<{ id: string; title: string; boardId: string; columnId: string }> }>(
      `/api/v1/projects/${projectId}/cards/search?q=${encodeURIComponent(query)}`,
    );
    return res.data;
  }
}
