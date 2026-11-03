import os from 'node:os';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {createTestHarness} from 'wrangler';
import {imageFixtures} from './support/image-fixtures.ts';
import {malformedPngStreams, packedPng} from './support/png-stream-fixtures.ts';
test('PNG native stream actual workerd rejects semantic corruption and accepts color/Adam7/20MP16bit full pipelines', {timeout:90000}, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowboard-png-stream-test-'));
  const configPath = path.join(dir,'wrangler.json');
  await fs.writeFile(configPath,JSON.stringify({name:'flowboard-png-stream-test',main:fileURLToPath(new URL('./png-stream-worker-probe.ts',import.meta.url)),compatibility_date:'2026-10-19',compatibility_flags:['nodejs_compat'],images:{binding:'IMAGE_VERIFIER'}}));
  const harness = createTestHarness({workers:[{configPath}]});
  try {
    await harness.listen(); const worker = harness.getWorker('flowboard-png-stream-test');
    const send = (bytes:Uint8Array) => worker.fetch('http://localhost/',{method:'POST',body:Uint8Array.from(bytes).buffer});
    for (const row of malformedPngStreams()) {
      const response = await send(row.bytes);
      assert.equal(response.status,422,row.name+' '+await response.clone().text());
      assert.equal((await response.json() as any).code,'MALFORMED_IMAGE');
    }
    for (const row of imageFixtures.filter(row => row.contentType==='image/png')) {
      const response = await send(row.bytes); assert.equal(response.status,200,row.name+' '+await response.clone().text());
      assert.equal((await response.json() as any).fullPixelsVerified,true);
    }
    let combinations=0;
    for (const [color,depths] of [[0,[1,2,4,8,16]],[2,[8,16]],[3,[1,2,4,8]],[4,[8,16]],[6,[8,16]]] as const)
      for (const depth of depths) for (const interlace of [false,true]) for (const [width,height] of [[1,1],[3,2],[9,9]]) {
        const response=await send(packedPng(width!,height!,depth,color,interlace));
        assert.equal(response.status,200,JSON.stringify({color,depth,interlace,width,height})+' '+await response.clone().text()); combinations++;
      }
    // Native encoder creates the160MB expanded pixels; JS retains only compressed PNG.
    for (const progressive of [false,true]) {
      const bytes=await sharp({create:{width:5000,height:4000,channels:4,background:{r:12,g:140,b:99,alpha:0.7}}}).toColourspace('rgb16').png({progressive}).toBuffer();
      assert.equal(bytes[24],16); assert.equal(bytes[25],6); assert.ok(bytes.length<=10*1024*1024);
      const started=performance.now(),response=await send(bytes); assert.equal(response.status,200,await response.clone().text());
      const body=await response.json() as any; assert.equal(body.fullPixelsVerified,true);
      assert.ok(body.metrics.expandedBytes>=160_000_000); assert.ok(body.metrics.maxDecodedChunkBytes<2*1024*1024);
      t.diagnostic(JSON.stringify({name:'20MP-RGBA16-'+(progressive?'Adam7':'noninterlaced'),inputBytes:bytes.length,wallMs:Math.round(performance.now()-started),...body.metrics,limit:'local stream chunk/wall only; not hostedCPU or memory proof'}));
    }
    t.diagnostic(JSON.stringify({genuinePackedColorDepthInterlaceCombinations:combinations,malformedCases:malformedPngStreams().length}));
  } finally {await harness.close();await fs.rm(dir,{recursive:true,force:true});}
});
