import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createFlowboardMcpServer, type FlowboardMcpOperations } from '@flowboard/mcp/server';

const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_JSON_DEPTH = 32;

function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Vary', 'Accept, Origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.delete('set-cookie');
  headers.delete('mcp-session-id');
  return new Response(response.body, { status: response.status, headers });
}

function protocolError(status: number, code: number, message: string): Response {
  return privateResponse(Response.json({ jsonrpc: '2.0', error: { code, message }, id: null }, { status }));
}

function acceptsJsonAndEvents(value: string | null): boolean {
  const accepted = new Set<string>();
  for (const entry of (value ?? '').split(',')) {
    const [type, ...parameters] = entry.trim().toLowerCase().split(';');
    let quality = 1;
    for (const parameter of parameters) {
      const [name, raw] = parameter.trim().split('=');
      if (name !== 'q') continue;
      quality = raw !== undefined && /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw.trim()) ? Number(raw) : 0;
    }
    if (quality > 0 && type) accepted.add(type.trim());
  }
  return accepted.has('application/json') && accepted.has('text/event-stream');
}

function withinJsonDepth(value: unknown): boolean {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const item = pending.pop()!;
    if (item.depth > MAX_JSON_DEPTH) return false;
    if (item.value !== null && typeof item.value === 'object') {
      for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  return true;
}

async function readMessage(request: Request): Promise<{ message: unknown } | { response: Response }> {
  if (request.signal.aborted) {
    void request.body?.cancel().catch(() => {});
    return { response: protocolError(400, -32700, 'MCP request was cancelled.') };
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > MAX_REQUEST_BYTES) {
    // Refusal must not wait for an underlying source's cancellation promise.
    void request.body?.cancel().catch(() => {});
    return { response: protocolError(413, -32000, 'MCP request exceeded the size limit.') };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body?.getReader();
  const abort = () => { void reader?.cancel().catch(() => {}); };
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  try {
    if (reader) while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        return { response: protocolError(413, -32000, 'MCP request exceeded the size limit.') };
      }
      chunks.push(chunk.value);
    }
  } catch {
    return { response: protocolError(400, -32700, 'Invalid MCP request body.') };
  } finally { request.signal.removeEventListener('abort', abort); reader?.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let message: unknown;
  try { message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return { response: protocolError(400, -32700, 'Invalid JSON.') }; }
  if (Array.isArray(message) || !withinJsonDepth(message)) {
    return { response: protocolError(400, -32600, 'Send one bounded JSON-RPC message per request.') };
  }
  return { message };
}

/**
 * Called only after the outer route verifies canonical host/origin and OAuth.
 * The supplied operations carry that private authority; SDK metadata never does.
 */
export async function handleHostedMcpTransport(request: Request, operations: FlowboardMcpOperations): Promise<Response> {
  if (request.method !== 'POST') {
    const response = protocolError(405, -32000, 'Method not allowed.');
    response.headers.set('Allow', 'POST, OPTIONS');
    return response;
  }
  if (!acceptsJsonAndEvents(request.headers.get('accept'))) {
    return protocolError(406, -32000, 'Accept application/json and text/event-stream.');
  }
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    return protocolError(415, -32000, 'Content-Type must be application/json.');
  }
  const parsed = await readMessage(request);
  if ('response' in parsed) return parsed.response;
  if (request.signal.aborted) return protocolError(400, -32700, 'MCP request was cancelled.');

  // Forward only protocol headers, never Authorization, cookies, forwarded host
  // or caller identity headers. Body was already bounded before parsedBody use.
  const headers = new Headers({ accept: 'application/json, text/event-stream', 'content-type': 'application/json' });
  const protocol = request.headers.get('mcp-protocol-version');
  if (protocol !== null) headers.set('mcp-protocol-version', protocol);
  const sanitized = new Request(request.url, { method: 'POST', headers, signal: request.signal });
  const server = createFlowboardMcpServer(operations);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true, maxRequestBodySize: MAX_REQUEST_BYTES,
  });
  try {
    await server.connect(transport);
    if (request.signal.aborted) return protocolError(400, -32700, 'MCP request was cancelled.');
    const response = await transport.handleRequest(sanitized, { parsedBody: parsed.message });
    // JSON mode resolves only after tool work finishes. Materialize before
    // close, so cleanup never tears down an active stream or transaction.
    const body = response.body === null ? null : await response.arrayBuffer();
    return privateResponse(new Response(body, { status: response.status, headers: response.headers }));
  } catch {
    return protocolError(500, -32603, 'MCP request failed. Retry a create only with the same operationId and input.');
  } finally { await server.close(); }
}
