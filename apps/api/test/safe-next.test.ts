import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeNextPath } from '../src/http/safe-next.ts';

// Pure unit tests: no database. Every payload here must be dropped (null), except the
// legitimate ones at the bottom.
test('rejects open-redirect and scheme payloads', () => {
  const hostile = [
    '//evil.test',
    '//evil.test/projects',
    '/\\evil.test',
    '/\\/evil.test',
    'https://evil.test',
    'https://evil.test/projects',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '%2f%2fevil.test',
    '/%2f%2fevil.test',
    '/%0d%0aSet-Cookie:x=1',
    '/projects%0a/x',
    'projects',
    ' /projects',
    '/projects ',
    '/projects\n',
    '/projects\r\nLocation: https://evil.test',
    '/\tprojects',
    '/projects/../admin',
    '/projects/./x',
    '/projects@evil.test',
    '/board#fragment',
    '/board?id=abc#x',
    '/board?id=a?b',
    '/board?redirect=https://evil.test',
    '/board?id=%20',
    '/board?id=a b',
  ];
  for (const payload of hostile) {
    assert.equal(sanitizeNextPath(payload), null, `should drop ${JSON.stringify(payload)}`);
  }
});

test('rejects unknown paths and prefix lookalikes', () => {
  for (const payload of ['/admin', '/api/v1/session', '/projectsevil', '/boardx', '/invitations', '/', '/settings-old']) {
    assert.equal(sanitizeNextPath(payload), null, `should drop ${payload}`);
  }
});

test('rejects overlong input and non-string values', () => {
  assert.equal(sanitizeNextPath(`/projects/${'a'.repeat(300)}`), null);
  assert.equal(sanitizeNextPath(undefined), null);
  assert.equal(sanitizeNextPath(null), null);
  assert.equal(sanitizeNextPath(42), null);
  assert.equal(sanitizeNextPath(['/projects']), null);
  assert.equal(sanitizeNextPath(''), null);
});

test('accepts allowlisted app paths, with a query in the allowed characters', () => {
  assert.equal(sanitizeNextPath('/projects'), '/projects');
  assert.equal(sanitizeNextPath('/board?id=abc'), '/board?id=abc');
  assert.equal(sanitizeNextPath('/board/brd_123?id=abc&view=list.v2'), '/board/brd_123?id=abc&view=list.v2');
  assert.equal(sanitizeNextPath('/invitations/accept?token=AbC-_9'), '/invitations/accept?token=AbC-_9');
  assert.equal(sanitizeNextPath('/my-tasks'), '/my-tasks');
});
