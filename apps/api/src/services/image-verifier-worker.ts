import { corruptImage, imageVerificationUnavailable, type ImageVerifier, type ImageVerificationFrame } from './image-verifier.ts';
export interface ImageVerifierBinding {
  input(stream: ReadableStream<Uint8Array>): {
    output(options: {
      format: 'image/jpeg';
      quality: 1;
    }): Promise<{
      response(): Response;
    }>;
  };
}
export class ImagesBindingVerifier implements ImageVerifier {
  private readonly binding: ImageVerifierBinding;
  constructor(binding: ImageVerifierBinding) {
    this.binding = binding;
  }
  async verify(frame: ImageVerificationFrame, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw imageVerificationUnavailable();
    let inputController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        inputController = controller;
        controller.enqueue(frame.bytes);
        controller.close();
      }
    });
    const abort = () => {
      try {
        inputController?.error(imageVerificationUnavailable());
      } catch {}
      void reader?.cancel().catch(() => {});
    };
    signal.addEventListener('abort', abort, {
      once: true
    });
    try {
      const result = await this.binding.input(source).output({
        format: 'image/jpeg',
        quality: 1
      });
      const response = result.response();
      if (signal.aborted) {
        await response.body?.cancel().catch(() => {});
        throw imageVerificationUnavailable();
      }
      if (!response.ok || !response.body || response.headers.get('content-type')?.split(';')[0] !== 'image/jpeg') {
        await response.body?.cancel().catch(() => {});
        throw imageVerificationUnavailable();
      }
      reader = response.body.getReader();
      // Conservative encoded-output ceiling; drain/discard without collecting it.
      const outputLimit = frame.width * frame.height * 8 + frame.height * 16 + 1_048_576;
      let total = 0;
      for (;;) {
        const next = await reader.read();
        if (signal.aborted) throw imageVerificationUnavailable();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > outputLimit) throw imageVerificationUnavailable();
      }
      if (!total) throw imageVerificationUnavailable();
    } catch (error) {
      if (signal.aborted) throw imageVerificationUnavailable();
      if (error instanceof Error && error.name === 'HttpError') throw error;
      const code = Number((error as {
        code?: unknown;
      })?.code);
      // Quota, configuration, timeout and unknown service errors must never blame user bytes.
      if (code === 9412) throw corruptImage();
      const message = error instanceof Error ? error.message : '';
      // Miniflare/Images can report invalid input through generic9523. Only identified
      // decoder failures are malformed; unknown9523 and transport faults remain503.
      if (code === 9523 && /(?:corrupt (?:header|image)|invalid (?:image|zlib|deflate|huffman)|VipsPng:|unable to decode|failed to decode|unsupported image format|VipsJpeg:.*(?:Corrupt|premature|Invalid)|VipsWebp:|invalid bitstream|webp2vips: unable to read pixels)/i.test(message)) throw corruptImage();
      throw imageVerificationUnavailable();
    } finally {
      signal.removeEventListener('abort', abort);
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
  }
}
