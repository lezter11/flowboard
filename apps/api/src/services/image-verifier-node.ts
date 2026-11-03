// Node-only import graph. Never import this module from the Worker runtime.
import sharp from 'sharp';
import { MAX_IMAGE_MEGAPIXELS } from './image-validator.ts';
import { corruptImage, imageVerificationUnavailable, type ImageVerifier, type ImageVerificationFrame } from './image-verifier.ts';

// Cached libvips operations can suppress warnings on later decodes of the same bytes.
// Verification must perform a fresh decode. Warnings are a process-wide native queue,
// so serialize our native jobs and bound their waiting input buffers.
sharp.cache(false);
let nativeBusy = false;
interface Waiter {
  signal: AbortSignal;
  grant: () => void;
  reject: (error: Error) => void;
  abort: () => void;
}
const waiting: Waiter[] = [];
function releaseNative(): void {
  for (;;) {
    const next = waiting.shift();
    if (!next) {
      nativeBusy = false;
      return;
    }
    next.signal.removeEventListener('abort', next.abort);
    if (next.signal.aborted) {
      next.reject(imageVerificationUnavailable());
      continue;
    }
    next.grant();
    return;
  }
}
async function acquireNative(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw imageVerificationUnavailable();
  if (!nativeBusy) {
    nativeBusy = true;
    return;
  }
  if (waiting.length >= 4) throw imageVerificationUnavailable();
  await new Promise<void>((resolve, reject) => {
    const item: Waiter = {
      signal,
      grant: resolve,
      reject,
      abort: () => {
        const index = waiting.indexOf(item);
        if (index >= 0) waiting.splice(index, 1);
        reject(imageVerificationUnavailable());
      }
    };
    waiting.push(item);
    signal.addEventListener('abort', item.abort, {
      once: true
    });
  });
}
export class SharpImageVerifier implements ImageVerifier {
  async verify(frame: ImageVerificationFrame, signal: AbortSignal): Promise<void> {
    await acquireNative(signal);
    let decoder: ReturnType<typeof sharp> | undefined;
    let warned = false;
    try {
      if (signal.aborted) throw imageVerificationUnavailable();
      decoder = sharp(frame.bytes, {
        failOn: 'warning',
        limitInputPixels: MAX_IMAGE_MEGAPIXELS,
        limitInputChannels: 4,
        sequentialRead: true,
        animated: true
      });
      decoder.on('warning', () => {
        warned = true;
      });
      const metadata = await decoder.metadata();
      if ('image/' + metadata.format !== frame.contentType || metadata.width !== frame.width || (metadata.pageHeight ?? metadata.height) !== frame.height || (metadata.pages ?? 1) !== 1) throw corruptImage();
      // A complete native pipeline consumes all original pixels and reports decode
      // warnings. Drain encoded chunks; never expose/collect raw pixel buffers.
      // Native timeout is below the caller deadline. On caller abort, keep the
      // mutex until the native job actually settles so its warnings cannot leak
      // into the next job; the caller has already failed without a write ticket.
      // Output is disposable. Flatten forces alpha participation in the full
      // decode; no resize/shrink is requested and uploaded bytes stay unchanged.
      decoder.flatten({
        background: '#ffffff'
      }).jpeg({
        quality: 1
      }).timeout({
        seconds: 3
      });
      const outputLimit = frame.width * frame.height * 8 + frame.height * 16 + 1_048_576;
      let bytes = 0;
      for await (const chunk of decoder) {
        bytes += chunk.byteLength;
        if (bytes > outputLimit) throw imageVerificationUnavailable();
      }
      if (warned) throw corruptImage();
      if (signal.aborted || !bytes) throw imageVerificationUnavailable();
    } catch (error) {
      if (signal.aborted) throw imageVerificationUnavailable();
      if (error instanceof Error && error.name === 'HttpError') throw error;
      if (error instanceof Error && /timeout|time limit|allocation|out of memory|unable to allocate|memory limit/i.test(error.message)) throw imageVerificationUnavailable();
      throw corruptImage();
    } finally {
      decoder?.destroy();
      releaseNative();
    }
  }
}
