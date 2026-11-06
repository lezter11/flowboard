// Pure policy probes only: importing the operator module never invokes main.
import test from 'node:test';
import assert from 'node:assert/strict';
import { permittedRequest } from '../hosted-banner-browser.mjs';

const origin = 'https://flowboard-app.pages.dev';
test('fixed anonymous request policy refuses URL credentials', () => {
  assert.equal(permittedRequest(origin, 'https://synthetic-user:synthetic-password@flowboard-app.pages.dev/api/v1/session', 'GET'), false);
});
test('fixed anonymous request policy refuses extra query/fragment state', () => {
  assert.equal(permittedRequest(origin, origin + '/release-status.json?synthetic_private=1', 'GET'), false);
  assert.equal(permittedRequest(origin, origin + '/signin#synthetic_private', 'GET'), false);
});
test('legitimate fixed assets and all other origin/write refusals remain intact', () => {
  assert.equal(permittedRequest(origin, origin + '/release-status.json', 'GET'), true);
  assert.equal(permittedRequest(origin, origin + '/_next/static/chunks/test.js', 'GET'), true);
  assert.equal(permittedRequest(origin, origin + '/api/v1/session', 'POST'), false);
  assert.equal(permittedRequest(origin, 'https://other.invalid/release-status.json', 'GET'), false);
});
