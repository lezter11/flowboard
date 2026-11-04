#!/usr/bin/env node
/** Build-time only. No backend import, no server, database, network or credential access. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ERROR_CATALOG } from '../packages/contracts/src/index.ts';
import { OPENAPI_ROUTES, OPENAPI_SPEC_METADATA, type OpenApiRouteDefinition } from '../packages/contracts/src/openapi/index.ts';
import { OPENAPI_SCHEMAS } from '../packages/contracts/src/openapi/schemas.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OPENAPI_OUTPUT = 'docs/openapi.json';
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const binary = { type: 'string', format: 'binary' };

export function fullOperationPath(route: OpenApiRouteDefinition): string { return `${route.basePath ?? '/api/v1'}${route.path}`; }

export function generateOpenApiDocument() {
  // Derive known optional envelope flag without broadening resource objects or the public contracts.
  for (const operation of OPENAPI_ROUTES.filter((item) => item.replay)) {
    for (const response of Object.values(operation.responses)) {
      if (!response.schema) continue;
      const binding = OPENAPI_SCHEMAS[response.schema];
      if (!binding || !(binding.schema instanceof z.ZodObject)) throw new Error(`Mutation response must be an object: ${response.schema}`);
      OPENAPI_SCHEMAS[`${response.schema}WithReplayFlag`] = { ...binding, schema: binding.schema.extend({ replayed: z.boolean().optional() }),
        source: `${binding.source}; apps/api/src/http/routes/*:optional replayed envelope flag` };
    }
  }
  const schemas: Record<string, Record<string, unknown>> = {};
  for (const [name, binding] of Object.entries(OPENAPI_SCHEMAS).sort(([a],[b]) => a.localeCompare(b))) {
    // Unsupported conversions throw; never turn a missing schema into an unrestricted placeholder.
    const native = z.toJSONSchema(binding.schema, { io: binding.io, target: 'draft-2020-12' });
    const { $schema: _dialect, ...schema } = native;
    schemas[name] = { ...schema, 'x-zod-source': binding.source,
      ...(binding.notes ? { description: binding.notes } : {}),
      'x-validation-limit': 'JSON Schema preserves structural/native constraints. JavaScript refinements, transforms and database/authorization rules still require the shared Zod validator and mounted handler.' };
  }
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of [...OPENAPI_ROUTES].sort((a,b) => `${fullOperationPath(a)} ${a.method}`.localeCompare(`${fullOperationPath(b)} ${b.method}`))) {
    const operationPath = fullOperationPath(route);
    const method = route.method.toLowerCase();
    const location = paths[operationPath] ??= {};
    if (location[method]) throw new Error(`Duplicate operation ${route.method} ${operationPath}`);
    for (const name of [route.requestSchema, route.querySchema, ...Object.values(route.responses).map((r) => r.schema), ...Object.values(route.variants ?? {})].filter((v): v is string => Boolean(v))) {
      if (!schemas[name]) throw new Error(`Missing schema ${name} for ${route.method} ${operationPath}`);
    }
    const parameters: Record<string, unknown>[] = [...operationPath.matchAll(/\{([^}]+)\}/g)].map((match) => ({ name: match[1], in: 'path', required: true, schema: { type: 'string', minLength: 1 } }));
    if (route.querySchema) {
      const schema = schemas[route.querySchema]!;
      const required = schema['required'] as string[] | undefined;
      for (const [name, property] of Object.entries(schema['properties'] as Record<string, unknown> ?? {})) parameters.push({ name, in: 'query', required: required?.includes(name) ?? false, schema: property });
    }
    if (route.requiresIdempotencyKey) parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: ref('IdempotencyKey'), description: 'Stable identity of one command. Reuse across retry; current authority is rechecked. Replay contains only minimal safe outcome markers.' });
    if (route.requestKind === 'xlsx') parameters.push({ name: 'X-Default-Column-Id', in: 'header', required: false, schema: { type:'string', minLength:1 }, description: 'Alternative to defaultColumnId query for raw XLSX; multipart carries the field.' });
    const responses: Record<string, unknown> = {};
    for (const [status, response] of Object.entries(route.responses)) {
      const headers: Record<string, unknown> = { 'X-Request-Id': { schema: { type:'string' }, description: 'Assigned by shared middleware when app initialization succeeds.' } };
      if (status === '302') headers['Location'] = { schema: { type:'string' }, description:'Authorization provider or safe frontend landing/sign-in destination.' };
      if (route.errorKind) headers['Cache-Control'] = { schema: { type:'string', const:'no-store' } };
      if (route.auth === 'oauth-mcp' && status === '401') headers['WWW-Authenticate'] = { schema:{type:'string'}, description:'Bearer resource_metadata="APP_ORIGIN/.well-known/oauth-protected-resource/api/v1/mcp". No cookie or PAT fallback.' };
      if (status === '405' || (route.method === 'OPTIONS' && status === '204')) headers['Allow'] = { schema:{type:'string',const:'POST, OPTIONS'} };
      if (response.empty || status === '204' || status === '302') { responses[status] = { description: response.description, headers }; continue; }
      let content: Record<string, unknown>;
      if (response.contentType) {
        const types = response.contentType === 'image/*' ? ['image/png','image/jpeg','image/webp'] : [response.contentType];
        content = Object.fromEntries(types.map((mime) => [mime, { schema: mime === 'text/csv' ? { type:'string', description:'Safe escaped CSV outcome report' } : binary }]));
      } else if (response.schema) {
        const normal = route.replay ? `${response.schema}WithReplayFlag` : response.schema;
        const variants = route.variants ? Object.values(route.variants).map(ref) : [ref(normal)];
        if (route.replay) variants.push(ref('MinimalReplayResponse'));
        content = { 'application/json': { schema: variants.length === 1 ? variants[0] : { anyOf: variants } } };
      } else throw new Error(`Missing JSON schema or binary MIME for ${route.method} ${operationPath} response ${status}`);
      responses[status] = { description: response.description, headers, content };
    }
    const protocolError = route.errorKind === 'oauth' ? 'HostedOAuthError' : route.errorKind === 'jsonrpc' ? 'HostedMcpError' : undefined;
    responses['default'] = { description: `${protocolError ? 'Protocol failures use '+protocolError+'. ' : ''}Route/global validation, authentication, authorization, quota, lifecycle, rate, body, storage and availability errors. Machine codes and known statuses are in x-error-catalog. Worker bootstrap CONFIG_ERROR is a separate pre-middleware shape.`,
      headers: { 'X-Request-Id': { schema: {type:'string'} }, 'Retry-After': { schema: {type:'string'},description:'429 and retryable conflicts when supplied.' } },
      content: { 'application/json': { schema: { anyOf:[...(protocolError ? [ref(protocolError)] : []), ref('ErrorEnvelope'), ref('WorkerBootstrapError')] } } } };
    const security = route.auth === 'public' || route.auth === 'local-test' ? []
      : route.auth === 'optional-session' ? [{},{sessionCookie:[]}]
      : route.auth === 'oauth-mcp' ? [{oauthMcpBearer:[]}]
      : route.auth === 'admin-secret' ? [{adminSecret:[]}]
      : route.auth === 'session-or-token' ? [{sessionCookie:[]},{personalAccessToken:[]}]
      : [{sessionCookie:[]}];
    if (route.auth === 'oauth-mcp' && route.method === 'POST') {
      parameters.push({name:'Accept',in:'header',required:true,schema:{type:'string'},description:'Must include both application/json and text/event-stream with positive quality.'});
      parameters.push({name:'MCP-Protocol-Version',in:'header',required:false,schema:{type:'string'},description:'Installed SDK-supported protocol version; future protocol support is not implied.'});
    }
    const requestBody = route.requestKind === 'image' ? { required:true, content:{'application/octet-stream':{schema:binary}} }
      : route.requestKind === 'xlsx' ? { required:true, content:{ 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':{schema:binary}, 'application/octet-stream':{schema:binary},
          'multipart/form-data':{schema:{type:'object',properties:{file:binary,defaultColumnId:{type:'string',minLength:1}},required:['file','defaultColumnId']}} } }
      : route.requestSchema ? { required:!route.requestOptional,content:{[route.requestKind === 'form' ? 'application/x-www-form-urlencoded' : 'application/json']:{schema:ref(route.requestSchema)}} } : undefined;
    location[method] = { operationId:`${route.method.toLowerCase()}_${operationPath.replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'')}`,
      summary:route.summary,description:route.description,security,parameters,responses,
      ...(requestBody ? {requestBody} : {}),
      ...(route.maxRequestBytes ? {'x-max-request-bytes':route.maxRequestBytes} : {}),
      ...(route.auth === 'oauth-mcp' ? {'x-oauth-resource':'APP_ORIGIN/api/v1/mcp','x-oauth-rest-authority':'Forbidden; OAuth credentials are valid only at the exact MCP transport path.'} : {}),
      ...(route.lifecycle==='retired' ? {deprecated:true} : {}),
      'x-minimum-project-role':route.minimumRole,'x-authority-note':'Owner is implicit only in owned workspace. Board-derived paths require current project membership plus board grant for non-Owners; role alone is insufficient. Resource ancestry, actor ownership and lifecycle rules apply.',
      'x-runtime-source':route.source,'x-lifecycle':route.lifecycle ?? 'active',
      ...(route.patScope ? {'x-required-token-scope':route.patScope,'x-token-project-binding':'A project-limited PAT cannot read/write another project; current project/board grants remain mandatory.'} : {'x-personal-access-token':'Forbidden, including explicit bearer credentials on otherwise public/session operations.'}),
      ...(route.variants ? {'x-auth-response-variants':route.variants} : {}),
      ...(route.replay ? {'x-replay-schema':'MinimalReplayResponse','x-response-validation':'Documented wire projection; not a claim all handlers execute output-schema parsing.'} : {}) };
  }
  return { ...OPENAPI_SPEC_METADATA, jsonSchemaDialect:'https://json-schema.org/draft/2020-12/schema', paths,
    components: { securitySchemes: { sessionCookie:{type:'apiKey',in:'cookie',name:'flowboard_session'}, oauthMcpBearer:{type:'http',scheme:'bearer',bearerFormat:'flw_mcp_access_<64 hex characters>',description:'OAuth resource credential accepted only by /api/v1/mcp, never ordinary REST operations.'}, personalAccessToken:{type:'http',scheme:'bearer',bearerFormat:'flw_pat_<64 hex characters>'}, adminSecret:{type:'apiKey',in:'header',name:'X-Dev-Secret'} },schemas },
    'x-error-catalog':ERROR_CATALOG,
    'x-runtime-inventory':'Explicit mounted Node/Worker routes and aliases. Automatic HEAD behavior for GET and shared CORS OPTIONS are middleware behavior, not additional route capabilities. The exact hosted MCP path has its own explicit OPTIONS protocol handler documented here.',
    'x-evidence-limit':'Generated contract and route parity do not approve implementation, real OAuth, provider delivery, UAT or production. Custom JavaScript refinements and authorization are not fully expressible in JSON Schema.' };
}
export async function writeOpenApi(checkOnly = false) {
  const output=JSON.stringify(generateOpenApiDocument(),null,2)+'\n';
  const destination=path.join(root,OPENAPI_OUTPUT);
  if(checkOnly) {
    const current=await fs.readFile(destination,'utf8').catch(()=>null);
    if(current!==output) throw new Error('Generated OpenAPI is missing or stale. Run npm run openapi:generate.');
  } else await fs.writeFile(destination,output);
  return {path:OPENAPI_OUTPUT,operations:OPENAPI_ROUTES.length,schemas:Object.keys(OPENAPI_SCHEMAS).length};
}
if(process.argv[1] && import.meta.url===new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const result=await writeOpenApi(process.argv.includes('--check'));
  console.log(JSON.stringify({...result,mode:process.argv.includes('--check')?'check':'generate'}));
}
