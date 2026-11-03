import { z } from 'zod';
import {
  createCardInputSchema,
  cursorSchema,
  idSchema,
  paginationInputSchema,
  searchInputSchema,
} from './schemas.ts';

export interface FlowboardConfig {
  apiUrl: string;
  apiToken: string;
  requestTimeoutMs: number;
}

export interface BoardColumn {
  id: string;
  name: string;
  category: string;
  position: number;
}

export interface BoardMetadata {
  id: string;
  name: string;
  version: number;
  columns: BoardColumn[];
}

export interface CreateCardInput {
  /** Preserve this identifier and all semantic input when retrying the same action. */
  operationId: string;
  boardId: string;
  column: string;
  title: string;
  description?: string | undefined;
  priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent' | undefined;
  dueDate?: string | undefined;
}

export interface PageInput {
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

const projectSchema = z.object({
  id: idSchema,
  name: z.string().max(200),
  description: z.string().max(20000).nullable(),
});
const boardSchema = z.object({
  id: idSchema,
  name: z.string().max(200),
  structureVersion: z.number().int().nonnegative(),
});
const columnSchema = z.object({
  id: idSchema,
  name: z.string().max(200),
  category: z.string().max(32),
  position: z.number().nonnegative(),
});
const metadataSchema = z.object({
  data: boardSchema.extend({ columns: z.array(columnSchema).max(100) }),
});
const searchCardSchema = z.object({
  id: idSchema,
  title: z.string().max(200),
  boardId: idSchema,
  columnId: idSchema,
});
const pageSchema = <T extends z.ZodType>(item: T) => z.object({
  data: z.array(item).max(100),
  nextCursor: cursorSchema.nullish(),
});

export class FlowboardApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code?: string) {
    // Server messages/bodies are deliberately excluded: an upstream proxy must
    // not be able to echo a bearer value into a tool response or host log.
    super(`Flowboard API request failed (HTTP ${status}${code ? `, ${code}` : ''}).`);
    this.name = 'FlowboardApiError';
    this.status = status;
    this.code = code;
  }
}

const MAX_RESPONSE_BYTES = 1024 * 1024;

async function readBoundedBody(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error('Flowboard API response exceeded the size limit.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Flowboard API response exceeded the size limit.');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseBaseUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('FLOWBOARD_API_URL must be an absolute HTTPS origin (HTTP is allowed only on loopback).');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
      parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('FLOWBOARD_API_URL must be an HTTPS origin without credentials, path, query or fragment (loopback HTTP is allowed).');
  }
  return parsed.origin;
}

function pageQuery(input: PageInput): URLSearchParams {
  const parsed = paginationInputSchema.parse(input);
  const query = new URLSearchParams({ limit: String(parsed.limit) });
  if (parsed.cursor) query.set('cursor', parsed.cursor);
  return query;
}

export class FlowboardClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config?: Partial<FlowboardConfig>) {
    this.baseUrl = parseBaseUrl(config?.apiUrl ?? process.env['FLOWBOARD_API_URL'] ?? 'https://flowboard-app-uat.pages.dev');
    this.token = config?.apiToken ?? process.env['FLOWBOARD_API_TOKEN'] ?? '';
    if (!/^flw_pat_[a-f0-9]{64}$/.test(this.token)) {
      throw new Error('FLOWBOARD_API_TOKEN must contain a valid Flowboard personal access token.');
    }
    this.timeoutMs = config?.requestTimeoutMs ?? 10000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30000) {
      throw new Error('requestTimeoutMs must be an integer between 1 and 30000.');
    }
  }

  private async request(path: string, options: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    headers.set('Accept', 'application/json');
    if (options.body) headers.set('Content-Type', 'application/json');
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;

    let response: Response;
    let text: string;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...options, headers, signal, redirect: 'error' });
      text = await readBoundedBody(response);
    } catch {
      // A POST may already have committed. Do not retry or generate a new key.
      throw new Error('Flowboard request failed or timed out. If a create outcome is unknown, retry with the same operationId and input.');
    }
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new FlowboardApiError(response.status);
    }
    if (!response.ok) {
      const code = z.object({ error: z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/) }) }).safeParse(body);
      throw new FlowboardApiError(response.status, code.success ? code.data.error.code : undefined);
    }
    return body;
  }

  async listProjects(input: PageInput = {}) {
    const response = pageSchema(projectSchema).parse(await this.request(`/api/v1/projects?${pageQuery(input)}`));
    return { data: response.data, nextCursor: response.nextCursor ?? null };
  }

  async listBoards(projectId: string) {
    const id = idSchema.parse(projectId);
    const response = z.object({ data: z.array(boardSchema).max(100) }).parse(
      await this.request(`/api/v1/projects/${encodeURIComponent(id)}/boards`),
    );
    return response.data;
  }

  async getBoard(boardId: string): Promise<BoardMetadata> {
    const id = idSchema.parse(boardId);
    const { data } = metadataSchema.parse(await this.request(`/api/v1/boards/${encodeURIComponent(id)}/metadata`));
    if (data.id !== id) throw new Error('Flowboard returned metadata for an unexpected board.');
    // Construct the serialized object explicitly. Types alone do not discard
    // accidental runtime card properties added by another endpoint/version.
    return {
      id: data.id,
      name: data.name,
      version: data.structureVersion,
      columns: data.columns.map((column) => ({
        id: column.id, name: column.name, category: column.category, position: column.position,
      })),
    };
  }

  async createCard(rawInput: CreateCardInput) {
    const input = createCardInputSchema.parse(rawInput);
    let board = await this.getBoard(input.boardId);
    const exactId = board.columns.find((column) => column.id === input.column);
    const candidates = exactId ? [exactId] : board.columns.filter((column) =>
      column.name.trim().toLowerCase() === input.column.trim().toLowerCase());
    if (candidates.length !== 1) {
      throw new Error('Target column is missing or ambiguous. Use the exact column ID from flowboard_get_board_columns.');
    }
    const targetColumn = candidates[0]!;
    const payload = {
      title: input.title,
      columnId: targetColumn.id,
      description: input.description,
      priority: input.priority,
      dueDate: input.dueDate ?? null,
      expectedBoardVersion: board.version,
    };
    const post = () => this.request(`/api/v1/boards/${encodeURIComponent(input.boardId)}/cards`, {
      method: 'POST',
      headers: { 'Idempotency-Key': input.operationId },
      body: JSON.stringify(payload),
    });
    let response: unknown;
    try {
      response = await post();
    } catch (error) {
      if (!(error instanceof FlowboardApiError) || error.status !== 409 || error.code !== 'STALE_BOARD_VERSION') {
        throw error;
      }
      board = await this.getBoard(input.boardId);
      if (!board.columns.some((column) => column.id === targetColumn.id)) {
        throw new Error('The selected column no longer exists. Inspect the board before creating a new operation.');
      }
      payload.expectedBoardVersion = board.version;
      response = await post(); // At most one retry; same key and semantic input.
    }
    const result = z.object({
      data: z.object({ id: idSchema }),
      replayed: z.boolean().optional().default(false),
    }).parse(response);
    return {
      id: result.data.id,
      operationId: input.operationId,
      replayed: result.replayed,
      submittedTitle: input.title,
      columnId: targetColumn.id,
      columnName: targetColumn.name,
      boardId: board.id,
      boardName: board.name,
      submittedPriority: input.priority,
    };
  }

  async searchCards(projectId: string, query: string, pagination: PageInput = {}) {
    const input = searchInputSchema.parse({ projectId, query, ...pagination });
    const params = pageQuery(input);
    params.set('query', input.query);
    const response = pageSchema(searchCardSchema).parse(await this.request(
      `/api/v1/projects/${encodeURIComponent(input.projectId)}/cards/search?${params}`,
    ));
    return { data: response.data, nextCursor: response.nextCursor ?? null };
  }
}
