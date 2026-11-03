import { AsyncLocalStorage } from 'node:async_hooks';
import type { ImageContentType } from '@flowboard/contracts';
import { HttpError } from '../http/errors.ts';
import { assertImageWorkActive, retainImageWork } from './image-admission.ts';
import { MAX_IMAGE_MEGAPIXELS, type ImageDimensions } from './image-validator.ts';
export interface ImageVerificationFrame extends ImageDimensions {
  bytes: Uint8Array;
  contentType: ImageContentType;
}
export interface ImageVerifier {
  verify(frame: ImageVerificationFrame, signal: AbortSignal): Promise<void>;
}
export const MAX_IMAGE_FRAMES = 100;
export const IMAGE_VERIFICATION_DEADLINE_MS = 8_000;
export const imageVerifierStorage = new AsyncLocalStorage<ImageVerifier | null>();
export function imageVerificationUnavailable(): HttpError {
  return new HttpError(503, 'SERVICE_UNAVAILABLE', 'Image verification is unavailable. Try again later.');
}
export function corruptImage(): HttpError {
  return HttpError.unprocessable('The image pixels could not be verified.', 'MALFORMED_IMAGE');
}

// The caller has already checked every container/chunk length and the canvas dimensions.
// Retain only bounded frame offsets, and create at most one wrapped frame at a time.
export function* imageVerificationFrames(data: Uint8Array, contentType: ImageContentType, dimensions: ImageDimensions): Generator<ImageVerificationFrame> {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (contentType === 'image/png') {
    for (let offset = 8; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset),
        type = bytes.toString('latin1', offset + 4, offset + 8);
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw HttpError.unprocessable('Animated PNG is not supported. Use a still PNG or WebP.', 'REJECTED_FORMAT');
      offset += length + 12;
    }
  }
  if (contentType !== 'image/webp') {
    yield {
      bytes,
      contentType,
      ...dimensions
    };
    return;
  }
  // Check aggregate work before issuing even the first provider operation.
  let plannedFrames = 0,
    plannedPixels = 0;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4),
      start = offset + 8;
    if (bytes.toString('latin1', offset, offset + 4) === 'ANMF') {
      plannedFrames++;
      plannedPixels += (1 + bytes.readUIntLE(start + 6, 3)) * (1 + bytes.readUIntLE(start + 9, 3));
      if (plannedFrames > MAX_IMAGE_FRAMES) throw HttpError.unprocessable('Animation has too many frames.', 'IMAGE_FRAME_LIMIT_EXCEEDED');
      if (plannedPixels > MAX_IMAGE_MEGAPIXELS) throw HttpError.unprocessable('Animation exceeds the decoded image work limit.', 'MEGAPIXELS_EXCEEDED');
    }
    offset = start + length + (length & 1);
  }
  if (!plannedFrames) {
    yield {
      bytes,
      contentType,
      ...dimensions
    };
    return;
  }
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4),
      type = bytes.toString('latin1', offset, offset + 4),
      dataStart = offset + 8;
    if (type === 'ANMF') {
      const width = 1 + bytes.readUIntLE(dataStart + 6, 3),
        height = 1 + bytes.readUIntLE(dataStart + 9, 3);
      const payload = bytes.subarray(dataStart + 16, dataStart + length);
      const alpha = payload.toString('latin1', 0, 4) === 'ALPH';
      const header = Buffer.alloc(alpha ? 30 : 12);
      header.write('RIFF');
      header.writeUInt32LE(header.length + payload.length - 8, 4);
      header.write('WEBP', 8);
      if (alpha) {
        header.write('VP8X', 12);
        header.writeUInt32LE(10, 16);
        header[20] = 16;
        header.writeUIntLE(width - 1, 24, 3);
        header.writeUIntLE(height - 1, 27, 3);
      }
      yield {
        bytes: Buffer.concat([header, payload]),
        contentType,
        width,
        height
      };
    }
    offset = dataStart + length + (length & 1);
  }
}
export async function verifyImagePixels(data: Uint8Array, contentType: ImageContentType, dimensions: ImageDimensions, requestSignal?: AbortSignal, remainingMs = IMAGE_VERIFICATION_DEADLINE_MS): Promise<void> {
  const verifier = imageVerifierStorage.getStore();
  if (remainingMs <= 0) throw imageVerificationUnavailable();
  if (requestSignal?.aborted) throw imageVerificationUnavailable();
  if (!verifier) throw imageVerificationUnavailable();
  const controller = new AbortController();
  let abort!: () => void;
  const deadline = new Promise<never>((_, reject) => {
    abort = () => {
      reject(imageVerificationUnavailable());
      controller.abort();
    };
  });
  const timer = setTimeout(abort, Math.min(remainingMs, IMAGE_VERIFICATION_DEADLINE_MS));
  requestSignal?.addEventListener('abort', abort, {
    once: true
  });
  if (requestSignal?.aborted) abort();
  try {
    for (const frame of imageVerificationFrames(data, contentType, dimensions)) {
      if (controller.signal.aborted) throw imageVerificationUnavailable();
      assertImageWorkActive();
      const release = retainImageWork();
      // The binding may ignore abort. Retain admission until the actual operation settles,
      // even when the request's deadline wins the race below.
      const work = Promise.resolve().then(() => verifier.verify(frame, controller.signal));
      void work.then(release, release);
      await Promise.race([work, deadline]);
      if (controller.signal.aborted) throw imageVerificationUnavailable();
      assertImageWorkActive();
    }
  } finally {
    clearTimeout(timer);
    requestSignal?.removeEventListener('abort', abort);
    controller.abort();
  }
}
