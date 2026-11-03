import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// Test-only offline oracle: pinned upstream decoder, never bundled into runtime.
const source = readFileSync(new URL('../../../../docs/reviews/FULL-REVALIDATION-20261103/raw/jpeg-js-0.4.4-reference.js.txt', import.meta.url), 'utf8');
assert.equal(crypto.createHash('sha256').update(source).digest('hex'), 'a3f175fd6f62d142aad94d3bd90f3a30be4e076baf9b6a6fa31c8e84d9d4aa9f');
const context = {
  module: {
    exports: undefined as any
  },
  Buffer
};
vm.runInNewContext(source, context, {
  timeout: 1000
});
export const jpegOracle = context.module.exports as (bytes: Uint8Array, options: {
  tolerantDecoding: boolean;
  useTArray: boolean;
  maxResolutionInMP: number;
  maxMemoryUsageInMB: number;
}) => {
  width: number;
  height: number;
  data: Uint8Array;
};
export function strictJpegOracle(bytes: Uint8Array) {
  return jpegOracle(bytes, {
    tolerantDecoding: false,
    useTArray: true,
    maxResolutionInMP: 20,
    maxMemoryUsageInMB: 512
  });
}
