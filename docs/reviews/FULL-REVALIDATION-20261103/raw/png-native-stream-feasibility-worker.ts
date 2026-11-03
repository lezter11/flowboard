export default {
  async fetch(request: Request): Promise<Response> {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const size = new URL(request.url).searchParams.has('bytewise') ? 1 : Math.max(1, bytes.length);
    let at = 0;
    const source = new ReadableStream<Uint8Array>({pull(controller) {
      if (at === bytes.length) return controller.close();
      const end = Math.min(bytes.length, at + size);
      controller.enqueue(bytes.subarray(at, end)); at = end;
    }});
    let count = 0;
    try {
      const reader = source.pipeThrough(new DecompressionStream('deflate')).getReader();
      try {for (;;) {
        const result = await reader.read(); if (result.done) break;
        count += result.value.byteLength;
        if (count > 1024) throw new Error('Probe output limit exceeded');
      }} finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
      return Response.json({accepted: true, expandedBytes: count});
    } catch (error) {return Response.json({accepted:false,expandedBytes:count,errorName:(error as Error).name,message:(error as Error).message});}
  }
};
