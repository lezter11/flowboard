import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { cardDocumentResponseSchema, cardDocumentsResponseSchema, DOCUMENT_MEDIA_TYPES, type DocumentMediaType } from '@flowboard/contracts';
import { createApp } from '../src/http/app.ts';
import { hashSessionToken } from '../src/adapters/session.ts';
import { MemoryStorageDriver, runWithStorageDriver } from '../src/adapters/storage.ts';
import { cleanupCardDocuments } from '../src/adapters/documents.ts';
import { closePoolAfterWork } from '../src/runtime/worker.ts';
import { processPendingStorageDeletions, purgeExpiredTrash } from '../src/services/trash-purge.ts';
import { DocumentProcessingError, type DocumentProcessor } from '../src/services/document-processor.ts';
import { routeAuthFixture } from './support/route-auth-fixture.ts';
import { zipXmlParts } from './support/import-xml-fixture.ts';
import { workbook } from './support/import-workbook.ts';

const testUrl = process.env['FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL'];
const pdf = '%PDF-1.7\nlocal fixture\n%%EOF';
const cardPath = '/api/v1/cards/card/documents';
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('card documents remain disabled by default after authenticating', { skip: !testUrl }, async t => {
  const { app, actors } = await routeAuthFixture(t);
  assert.equal((await app.request(cardPath)).status, 401);
  const response = await app.request(cardPath, { headers: { cookie: `flowboard_session=${actors.owner!.session.id}` } });
  assert.equal(response.status, 503);
  assert.equal((await response.json() as {error:{code:string}}).error.code, 'CONFIG_ERROR');
});

test('one isolate caps concurrent document uploads across request-scoped apps', { skip: !testUrl, timeout: 10_000 }, async t => {
  const { pool, actors } = await routeAuthFixture(t);
  const store = new MemoryStorageDriver();
  const bothScanning = barrier(), thirdScan = barrier(), release = barrier();
  let calls = 0;
  const processor: DocumentProcessor = { async process(bytes) {
    calls++;
    if (calls === 2) bothScanning.resolve();
    if (calls === 3) thirdScan.resolve();
    await release.promise;
    return { bytes, sha256: sha(bytes), mediaType: DOCUMENT_MEDIA_TYPES.pdf, originalByteLength: bytes.length };
  } };
  const upload = async () => createApp(undefined, {
    pool, documents: { storage: store, processor },
    windowCounter: () => ({ consume: async () => ({ count: 1, retryAfterSeconds: 60 }) }),
  }).request(cardPath, {
    method: 'POST',
    body: pdf,
    headers: { cookie: `flowboard_session=${actors.owner!.session.id}`, 'content-type':DOCUMENT_MEDIA_TYPES.pdf,
      'idempotency-key':randomUUID(), 'x-document-filename':'test.pdf' },
  });
  const first = upload();
  const second = upload();
  let third: Promise<Response> | undefined;
  try {
    await Promise.race([bothScanning.promise, Promise.race([first,second]).then(() => assert.fail('Expected both scanner calls to be held.'))]);
    third = upload();
    const response = await Promise.race([third, thirdScan.promise.then(() => assert.fail('Third upload entered the scanner.'))]);
    assert.equal(response.status,429);
    assert.equal(calls,2);
    assert.equal(store.size(),0);
  } finally {
    release.resolve();
    await Promise.allSettled([first,second,third]);
  }
  assert.deepEqual((await Promise.all([first,second])).map(response => response.status),[201,201]);
  assert.equal((await upload()).status,201, 'The slot is reusable after the original work settles.');
});

test('Word and Excel routes bind the verified type and bytes throughout upload, replay and download', { skip: !testUrl }, async t => {
  const { pool, actors } = await routeAuthFixture(t);
  const ownerCookie = `flowboard_session=${actors.owner!.session.id}`;
  const viewerCookie = `flowboard_session=${actors.target!.session.id}`;
  await pool.query(`INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by)
    VALUES ('brd','prj','ws',$1,$2)`, [actors.target!.user.id, actors.owner!.user.id]);
  const word = zipXmlParts({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic fleet review</w:t></w:r></w:p></w:body></w:document>',
  });
  const excel = workbook([{ externalId: 'local-fixture', title: 'Synthetic fleet review' }]);
  const expected = new Map<DocumentMediaType, Buffer>([[DOCUMENT_MEDIA_TYPES.docx, word], [DOCUMENT_MEDIA_TYPES.xlsx, excel]]);
  let outputMode: 'normal' | 'changed-content' | 'wrong-type' = 'normal';
  const calls: DocumentMediaType[] = [];
  const processor: DocumentProcessor = { async process(bytes, _signal, mediaType = DOCUMENT_MEDIA_TYPES.pdf) {
    calls.push(mediaType);
    const fixture = expected.get(mediaType);
    if (!fixture || !Buffer.from(bytes).equals(fixture)) throw new DocumentProcessingError('UNSUPPORTED_DOCUMENT');
    const output = outputMode === 'changed-content' ? Uint8Array.from(bytes, (byte, i) => i === bytes.length - 1 ? byte ^ 1 : byte) : bytes;
    return { bytes: output, sha256: sha(output), mediaType: outputMode === 'wrong-type' ? DOCUMENT_MEDIA_TYPES.pdf : mediaType,
      originalByteLength: bytes.length };
  } };
  const storage = new MemoryStorageDriver();
  const readStored = storage.get.bind(storage);
  let wrongStoredType = false;
  storage.get = async key => {
    const object = await readStored(key);
    return object && wrongStoredType ? { ...object, contentType: DOCUMENT_MEDIA_TYPES.pdf } : object;
  };
  const app = createApp(undefined, { pool, documents: { storage, processor }, windowCounter: () => ({ consume: async () => ({ count: 1, retryAfterSeconds: 60 }) }) });
  const upload = (name: string, mediaType: string, content: Buffer | string, key = randomUUID()) => app.request(cardPath, {
    method: 'POST', body: typeof content === 'string' ? content : Uint8Array.from(content), headers: { cookie: ownerCookie,
      'idempotency-key': key, 'content-type': mediaType, 'x-document-filename': encodeURIComponent(name) },
  });
  const checkError = async (response: Response, status: number, code: string) => {
    assert.equal(response.status, status);
    assert.equal((await response.json() as { error: { code: string } }).error.code, code);
  };

  await checkError(await upload('word.docx', DOCUMENT_MEDIA_TYPES.pdf, word), 415, 'UNSUPPORTED_DOCUMENT');
  await checkError(await upload('word.docx', DOCUMENT_MEDIA_TYPES.docx, pdf), 415, 'UNSUPPORTED_DOCUMENT');
  await checkError(await upload('macro.docm', DOCUMENT_MEDIA_TYPES.docx, word), 400, 'MALFORMED_REQUEST');
  await checkError(await upload('\rword.docx', DOCUMENT_MEDIA_TYPES.docx, word), 400, 'MALFORMED_REQUEST');
  assert.deepEqual(calls, [], 'filename, media type, and signature must be screened before scanner calls');
  await checkError(await upload('workbook.xlsx', DOCUMENT_MEDIA_TYPES.xlsx, word), 415, 'UNSUPPORTED_DOCUMENT');
  outputMode = 'wrong-type';
  await checkError(await upload('word.docx', DOCUMENT_MEDIA_TYPES.docx, word), 503, 'DOCUMENT_PROCESSOR_UNAVAILABLE');
  outputMode = 'changed-content';
  await checkError(await upload('word.docx', DOCUMENT_MEDIA_TYPES.docx, word), 503, 'DOCUMENT_PROCESSOR_UNAVAILABLE');
  assert.equal(storage.size(), 0, 'no incompatible/unverified object is written');
  outputMode = 'normal';

  for (const [name, extension, mime, bytes] of [
    ['Résumé.DOCX', 'docx', DOCUMENT_MEDIA_TYPES.docx, word],
    ['Fleet.xlsx', 'xlsx', DOCUMENT_MEDIA_TYPES.xlsx, excel],
  ] as const) {
    const key = randomUUID();
    const result = await upload(name, mime, bytes, key);
    assert.equal(result.status, 201);
    const document = cardDocumentResponseSchema.parse(await result.json()).data;
    assert.equal(document.mediaType, mime);
    assert.equal(document.filename, name);
    assert.equal(document.byteLength, bytes.length);
    assert.equal(document.originalByteLength, bytes.length);
    const beforeReplay: number = calls.length;
    const replay = await upload(name, mime, bytes, key);
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get('idempotency-replayed'), 'true');
    assert.deepEqual(cardDocumentResponseSchema.parse(await replay.json()).data, document);
    assert.equal(calls.length, beforeReplay);
    const path = `/api/v1/documents/${document.id}/content`;
    assert.equal((await app.request(path)).status, 401);
    const download = await app.request(path, { headers: { cookie: viewerCookie } });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), mime);
    assert.equal(download.headers.get('cache-control'), 'private, no-store');
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(download.headers.get('content-security-policy'), 'sandbox');
    assert.equal(download.headers.get('content-disposition'), `attachment; filename="document.${extension}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    assert.equal(download.headers.get('x-content-sha256'), sha(bytes));
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    wrongStoredType = true;
    await checkError(await app.request(path, { headers: { cookie: viewerCookie } }), 503, 'DOCUMENT_PROCESSOR_UNAVAILABLE');
    wrongStoredType = false;
  }
  assert.equal(storage.size(), 2);
  const gallery = await app.request(cardPath, { headers: { cookie: viewerCookie } });
  const documents = cardDocumentsResponseSchema.parse(await gallery.json()).data;
  assert.deepEqual(documents.items.map(item => item.mediaType), [DOCUMENT_MEDIA_TYPES.docx, DOCUMENT_MEDIA_TYPES.xlsx]);
  await pool.query(`DELETE FROM board_grants WHERE board_id='brd' AND user_id=$1`, [actors.target!.user.id]);
  for (const item of documents.items) {
    assert.equal((await app.request(`/api/v1/documents/${item.id}/content`, { headers: { cookie: viewerCookie } })).status, 404);
  }
});

test('card documents publish only verified bytes, reauthorize and keep replay single-write', { skip: !testUrl }, async t => {
  const { pool, actors, pat } = await routeAuthFixture(t);
  await pool.query(`INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by) VALUES ('brd','prj','ws',$1,$2)`, [actors.target!.user.id, actors.owner!.user.id]);
  let scans = 0;
  let processing: (() => Promise<void>) | undefined;
  const processor: DocumentProcessor = { async process(bytes) {
    scans++;
    await processing?.();
    return { bytes, sha256: sha(bytes), mediaType: 'application/pdf', originalByteLength: bytes.length };
  } };
  const storage = new MemoryStorageDriver();
  let puts = 0;
  const writeObject = storage.put.bind(storage);
  let holdPut: (() => Promise<void>) | undefined;
  storage.put = async (...input) => { puts++; await holdPut?.(); await writeObject(...input); };
  const app = createApp(undefined, { pool, documents: { storage, processor } });
  const auth = (role = 'owner') => ({ cookie: `flowboard_session=${actors[role]!.session.id}` });
  const upload = async (key = randomUUID(), body = pdf, role = 'owner', name = 'Résumé.pdf') => app.request(cardPath, {
    method: 'POST', body, headers: { ...auth(role), 'idempotency-key': key, 'content-type': 'application/pdf',
      'x-document-filename': encodeURIComponent(name) },
  });
  const errorCode = async (response: Response, status: number, code?: string) => {
    const error = (await response.json() as { error: { code: string } }).error;
    assert.equal(response.status, status, JSON.stringify(error));
    if (code) assert.equal(error.code, code);
  };
  await errorCode(await upload(undefined, pdf, 'target'), 403);
  await errorCode(await upload(undefined, pdf, 'grantless'), 404);
  await errorCode(await app.request(cardPath, {headers: { authorization: `Bearer ${pat.token}` }}), 403);
  await errorCode(await upload(undefined,'x'.repeat(1048577)), 413, 'DOCUMENT_TOO_LARGE');
  await errorCode(await upload(undefined,'unknown'), 415, 'UNSUPPORTED_DOCUMENT');
  await errorCode(await upload(undefined,pdf,'owner','dir/escape.pdf'), 400, 'MALFORMED_REQUEST');
  await errorCode(await upload(undefined,pdf,'owner','tab\tname.pdf'), 400, 'MALFORMED_REQUEST');
  processing = async () => { throw new DocumentProcessingError('DOCUMENT_REJECTED'); };
  await errorCode(await upload(), 422, 'DOCUMENT_REJECTED');
  assert.equal(puts, 0);
  processing = undefined;

  const entered = barrier();
  const continuePut = barrier();
  holdPut = async () => { entered.resolve(); await continuePut.promise; };
  const key = randomUUID();
  const waiting = upload(key);
  try {
    const early = await Promise.race([entered.promise, waiting]);
    if (early) assert.fail(`First request did not reach storage: ${await early.text()}`);
    assert.equal((await pool.query('SELECT count(*) FROM card_documents')).rows[0].count, '0');
    assert.equal((await pool.query('SELECT count(*) FROM card_document_reservations')).rows[0].count, '1');
    const gallery = await app.request(cardPath, { headers: auth('target') });
    assert.deepEqual(cardDocumentsResponseSchema.parse(await gallery.json()).data, {items:[], count:0, canUpload:false});
    await errorCode(await upload(key), 409, 'DOCUMENT_UPLOAD_IN_PROGRESS');
    await errorCode(await upload(key, `${pdf}changed`), 409, 'IDEMPOTENCY_CONFLICT');
  } finally { continuePut.resolve(); }
  const created = await waiting;
  assert.equal(created.status, 201);
  const doc = cardDocumentResponseSchema.parse(await created.json()).data;
  assert.equal(doc.canRemove, true);
  assert.equal(storage.size(), 1);
  const replay = await upload(key);
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.equal(cardDocumentResponseSchema.parse(await replay.json()).data.id, doc.id);
  assert.equal(puts, 1);
  const at = `/api/v1/documents/${doc.id}`;
  const downloaded = await app.request(`${at}/content`, { headers: auth('target') });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('cache-control'), 'private, no-store');
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(downloaded.headers.get('x-content-sha256'), sha(pdf));
  assert.match(downloaded.headers.get('content-disposition') ?? '', /^attachment; filename="document.pdf"; filename\*=UTF-8''R%C3%A9sum%C3%A9.pdf$/);
  assert.equal(await downloaded.text(), pdf);
  await errorCode(await app.request(`${at}/content`, { headers: auth('grantless') }), 404);
  assert.equal(cardDocumentsResponseSchema.parse(await (await app.request(cardPath, {headers:auth('target')})).json()).data.items[0]!.canRemove, false);
  assert.equal(scans, 2);
  const deleteKey = randomUUID();
  const remove = () => app.request(at, { method:'DELETE', headers:{...auth(), 'idempotency-key':deleteKey} });
  assert.equal((await remove()).status, 200);
  const removeReplay = await remove();
  assert.equal(removeReplay.status, 200);
  assert.equal(removeReplay.headers.get('idempotency-replayed'), 'true');
  await errorCode(await upload(key), 404);
  await errorCode(await app.request(`${at}/content`, {headers:auth()}), 404);
  assert.deepEqual((await pool.query(`SELECT action, safe_changes FROM activity_log WHERE action LIKE 'document_%' ORDER BY created_at`)).rows,
    [{action:'document_attached',safe_changes:{documentId:doc.id}},{action:'document_removed',safe_changes:{documentId:doc.id}}]);

  const signoutEntered = barrier();
  const finishAfterSignout = barrier();
  processing = async () => { signoutEntered.resolve(); await finishAfterSignout.promise; };
  const signingOut = upload();
  try {
    const early = await Promise.race([signoutEntered.promise, signingOut]);
    if (early) assert.fail(`Did not reach scanner: ${await early.text()}`);
    await pool.query('DELETE FROM sessions WHERE id=$1', [hashSessionToken(actors.owner!.session.id)]);
  } finally { finishAfterSignout.resolve(); }
  await errorCode(await signingOut, 401);
  assert.equal(puts, 1);
});

test('card document reservations handle revoked uploads, failed PUT, full cards, trash and purge', { skip: !testUrl }, async t => {
  const { pool, actors } = await routeAuthFixture(t);
  const ownerId = actors.owner!.user.id;
  const memberId = actors.grantless!.user.id;
  const viewerId = actors.target!.user.id;
  await pool.query(`INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at) VALUES ('sibling','ws','prj','Sibling',NOW(),NOW())`);
  await pool.query(`INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by) VALUES
    ('brd','prj','ws',$1,$3),('brd','prj','ws',$2,$3),('sibling','prj','ws',$1,$3)`, [memberId, viewerId, ownerId]);
  const storage = new MemoryStorageDriver();
  const writeObject = storage.put.bind(storage);
  const readObject = storage.get.bind(storage);
  let holdPut: (() => Promise<void>) | undefined;
  let failPut = false;
  let corrupt = false;
  let holdRead: (() => Promise<void>) | undefined;
  storage.put = async (...input) => {
    await holdPut?.();
    await writeObject(...input);
    if (failPut) throw new Error('Simulated ambiguous remote PUT');
  };
  storage.get = async key => {
    const object = await readObject(key);
    await holdRead?.();
    if (object && corrupt) object.data[6] = (object.data[6] ?? 0) ^ 1;
    return object;
  };
  const processor: DocumentProcessor = { async process(bytes) {
    return { bytes, sha256: sha(bytes), mediaType: 'application/pdf', originalByteLength: bytes.length };
  } };
  const app = createApp(undefined, {pool,documents:{storage,processor}});
  const auth = (role = 'owner') => ({ cookie: `flowboard_session=${actors[role]!.session.id}` });
  const upload = async (options: {key?: string; role?: string; name?: string} = {}) => app.request(cardPath, {
    method:'POST', body: pdf, headers:{...auth(options.role), 'content-type':'application/pdf',
      'idempotency-key':options.key ?? randomUUID(), 'x-document-filename':encodeURIComponent(options.name ?? 'fleet (November).pdf')},
  });
  async function errorCode(res: Response, status: number, code?: string) {
    const error = (await res.json() as { error: { code: string } }).error;
    assert.equal(res.status,status,JSON.stringify(error));
    if (code) assert.equal(error.code,code);
  }
  async function count(table: 'card_documents' | 'card_document_reservations' | 'pending_storage_deletions') {
    return (await pool.query<{count:number}>(`SELECT count(*)::int AS count FROM ${table}`)).rows[0]!.count;
  }

  const entered = barrier(), release = barrier();
  holdPut = async () => { entered.resolve(); await release.promise; };
  const revoked = upload({role:'grantless'});
  try {
    const early = await Promise.race([revoked,entered.promise]);
    if (early) assert.fail(`Upload should be held at the object put: ${await early.text()}`);
    await pool.query(`DELETE FROM board_grants WHERE board_id='brd' AND user_id=$1`, [memberId]);
  } finally { release.resolve(); }
  await errorCode(await revoked,404);
  holdPut = undefined;
  assert.equal(await count('card_documents'),0);
  assert.equal(await count('card_document_reservations'),1);
  await errorCode(await app.request(cardPath,{headers:auth('grantless')}),404);
  await pool.query(`UPDATE card_document_reservations SET expires_at=NOW()-INTERVAL '2 seconds',reclaim_at=NOW()-INTERVAL '1 second'`);
  assert.deepEqual(await cleanupCardDocuments(pool), {queued:1,removed:0});
  await runWithStorageDriver(storage,()=>processPendingStorageDeletions(pool));
  assert.equal(storage.size(),0);

  const ambiguousKey = randomUUID();
  failPut = true;
  await errorCode(await upload({key:ambiguousKey}),503,'DOCUMENT_PROCESSOR_UNAVAILABLE');
  assert.equal(storage.size(),1);
  assert.equal(await count('card_documents'),0);
  assert.deepEqual(await cleanupCardDocuments(pool),{queued:0,removed:0});
  const oldObjectKey = (await pool.query(`SELECT storage_key FROM card_document_reservations`)).rows[0].storage_key;
  await pool.query(`UPDATE card_document_reservations SET expires_at=NOW()-INTERVAL '1 second'`);
  failPut = false;
  const recovered = await upload({key:ambiguousKey});
  assert.equal(recovered.status,201);
  const doc = cardDocumentResponseSchema.parse(await recovered.json()).data;
  const path = `/api/v1/documents/${doc.id}/content`;
  const removalPath = `/api/v1/documents/${doc.id}`;
  let workLifetime: Promise<void> | undefined;
  let poolClosed = false;
  let retainedClose: Promise<unknown> | undefined;
  const deadlineApp = createApp(undefined,{pool,documents:{storage,processor},deadlineMs:100,
    onDocumentWorkLifetime: work => { workLifetime = work; }});
  const held = await pool.connect();
  const deadlineHeaders = {...auth(),'idempotency-key':randomUUID()};
  try {
    await held.query('BEGIN');
    await held.query(`SELECT id FROM boards WHERE id='brd' FOR UPDATE`);
    await errorCode(await deadlineApp.request(removalPath,{method:'DELETE',headers:deadlineHeaders}),504,'DEADLINE_EXCEEDED');
    const waiting = Number((await held.query(`SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid()
      AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE OF b%'`)).rows[0].count);
    assert.ok(waiting >= 1,'Timed-out DELETE must still have been blocked on the held board lock.');
    assert.ok(workLifetime,'The request must expose its ongoing database work to the Worker.');
    await closePoolAfterWork({end: async () => { poolClosed = true; }},[workLifetime],{
      waitUntil: work => { retainedClose = work; },
    });
    assert.ok(retainedClose);
    assert.equal(poolClosed,false,'The pool cannot close while timed-out database work is still blocked.');
  } finally { await held.query('ROLLBACK'); held.release(); }
  await retainedClose;
  assert.equal(poolClosed,true,'The pool closes when the retained rollback settles.');
  // A board-lock acquisition serializes behind the timed-out mutation and observes its rollback.
  const check = await pool.connect();
  try {
    await check.query('BEGIN');
    await check.query(`SELECT id FROM boards WHERE id='brd' FOR UPDATE`);
    assert.equal((await check.query(`SELECT deleted_at FROM card_documents WHERE id=$1`,[doc.id])).rows[0].deleted_at,null);
    assert.equal((await check.query(`SELECT count(*)::int AS count FROM idempotency_receipts WHERE idempotency_key=$1`,[deadlineHeaders['idempotency-key']])).rows[0].count,0);
  } finally { await check.query('ROLLBACK'); check.release(); }
  const published = (await pool.query(`SELECT storage_key FROM card_documents WHERE id=$1`, [doc.id])).rows[0].storage_key;
  assert.notEqual(published,oldObjectKey);
  await pool.query(`UPDATE card_document_reservations SET reclaim_at=NOW() WHERE storage_key=$1`, [oldObjectKey]);
  assert.deepEqual(await cleanupCardDocuments(pool),{queued:1,removed:0});
  await runWithStorageDriver(storage,()=>processPendingStorageDeletions(pool));
  assert.ok(await readObject(published));
  assert.equal(await readObject(oldObjectKey),null);
  await errorCode(await app.request(path,{headers:auth('grantless')}),404);
  corrupt = true;
  await errorCode(await app.request(path,{headers:auth()}),503,'DOCUMENT_PROCESSOR_UNAVAILABLE');
  corrupt = false;

  const readerEntered = barrier(), finishRead = barrier();
  holdRead = async () => { readerEntered.resolve(); await finishRead.promise; };
  const reading = Promise.resolve(app.request(path, {headers:auth('target')}));
  try {
    const early = await Promise.race([readerEntered.promise,reading]);
    if (early) assert.fail(`Read should be held at storage: ${await early.text()}`);
    await pool.query(`DELETE FROM board_grants WHERE board_id='brd' AND user_id=$1`, [viewerId]);
  } finally { finishRead.resolve(); }
  await errorCode(await reading,404);
  holdRead = undefined;
  await pool.query(`INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by)
    VALUES ('brd','prj','ws',$1,$2)`, [viewerId,ownerId]);
  await pool.query(`UPDATE boards SET archived=true WHERE id='brd'`);
  await errorCode(await upload(),409,'READ_ONLY_CONTEXT');
  assert.equal(cardDocumentsResponseSchema.parse(await (await app.request(cardPath,{headers:auth()})).json()).data.canUpload,false);
  assert.equal((await app.request(path,{headers:auth('target')})).status,200);
  await pool.query(`UPDATE boards SET archived=false WHERE id='brd'`);

  for (let i = 1; i < 9; i++) assert.equal((await upload({name:`Fleet #${i}.pdf`})).status,201);
  const contenderKeys = [randomUUID(),randomUUID()];
  const contenders = await Promise.all(contenderKeys.map(key=>upload({key})));
  assert.deepEqual(contenders.map(res=>res.status).sort(), [201,409]);
  const winner = contenders.findIndex(res=>res.status===201);
  const winnerKey = contenderKeys[winner];
  assert.ok(winnerKey);
  assert.equal((await upload({key:winnerKey})).headers.get('idempotency-replayed'),'true');
  await errorCode(await upload(),409,'DOCUMENT_LIMIT_REACHED');
  const full = cardDocumentsResponseSchema.parse(await (await app.request(cardPath,{headers:auth()})).json()).data;
  assert.equal(full.count,10);
  assert.equal(full.canUpload,true);

  const changeCard = async (action: 'delete' | 'restore') => {
    const { version, structure_version } = (await pool.query(`SELECT c.version,b.structure_version FROM cards c JOIN boards b ON b.id=c.board_id WHERE c.id='card'`)).rows[0];
    const payload = { expectedVersion:Number(version),expectedBoardVersion:Number(structure_version), ...(action==='restore' && {toColumnId:'col'}) };
    const response = await app.request(`/api/v1/cards/card/${action}`, {method:'POST',body:JSON.stringify(payload),headers:{...auth(),'content-type':'application/json','idempotency-key':randomUUID()}});
    assert.equal(response.status,200,await response.text());
  };
  await changeCard('delete');
  await errorCode(await app.request(path,{headers:auth('target')}),404);
  assert.equal((await app.request(path,{headers:auth()})).status,200);
  assert.equal(cardDocumentsResponseSchema.parse(await (await app.request(cardPath,{headers:auth()})).json()).data.canUpload,false);
  await changeCard('restore');
  assert.equal((await app.request(path,{headers:auth('target')})).status,200);
  await changeCard('delete');
  await pool.query(`UPDATE cards SET restore_until=NOW()-INTERVAL '1 second' WHERE id='card'`);
  await errorCode(await app.request(path,{headers:auth()}),404);
  const purged = await runWithStorageDriver(storage,()=>purgeExpiredTrash(pool));
  assert.deepEqual(purged.purgedCardIds,['card']);
  assert.equal(await count('card_documents'),0);
  assert.equal(await count('pending_storage_deletions'),0);
  assert.equal(storage.size(),0);
});
