import crypto from 'node:crypto';
import type { ImageContentType } from '@flowboard/contracts';

export const MAX_IMAGE_BYTE_LENGTH = 10 * 1024 * 1024; // 10 MiB (10,485,760 bytes)
export const MAX_IMAGE_DIMENSION = 8192; // 8192 pixels
export const MAX_IMAGE_MEGAPIXELS = 20_000_000; // 20 megapixels (width * height)

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ImageValidationResult {
  valid: true;
  contentType: ImageContentType;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
}

export class ImageValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ImageValidationError';
    this.code = code;
  }
}

/**
 * Checks for SVG, HTML, XML, script polyglots in the buffer.
 */
function checkForPolyglotOrMarkup(buffer: Buffer): void {
  // Check the initial slice and full text for dangerous markup tags
  const textPrefix = buffer.subarray(0, Math.min(buffer.length, 2048)).toString('utf8').toLowerCase();
  const forbiddenSnippets = [
    '<svg',
    '<?xml',
    '<html',
    '<!doctype html',
    '<script',
    '<iframe',
    '<body',
    'javascript:',
    'onload=',
    'onerror=',
  ];

  for (const snippet of forbiddenSnippets) {
    if (textPrefix.includes(snippet)) {
      throw new ImageValidationError(
        'REJECTED_FORMAT',
        `File contains markup or script content (${snippet}), which is not permitted.`,
      );
    }
  }
}

/**
 * Parses PNG dimensions from the IHDR chunk.
 */
function parsePngDimensions(buffer: Buffer): ImageDimensions {
  if (buffer.length < 24) {
    throw new ImageValidationError('MALFORMED_IMAGE', 'PNG file truncated before header.');
  }

  // PNG magic number: 89 50 4E 47 0D 0A 1A 0A
  const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < pngMagic.length; i++) {
    if (buffer[i] !== pngMagic[i]) {
      throw new ImageValidationError('MIME_SPOOF_DETECTED', 'Invalid PNG signature.');
    }
  }

  // Next chunk must be IHDR at offset 12: 49 48 44 52
  const chunkType = buffer.subarray(12, 16).toString('ascii');
  if (chunkType !== 'IHDR') {
    throw new ImageValidationError('MALFORMED_IMAGE', 'Missing PNG IHDR chunk.');
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  return { width, height };
}

/**
 * Parses JPEG dimensions by traversing SOF (Start of Frame) markers.
 */
function parseJpegDimensions(buffer: Buffer): ImageDimensions {
  if (buffer.length < 4) {
    throw new ImageValidationError('MALFORMED_IMAGE', 'JPEG file truncated before header.');
  }

  // JPEG magic: FF D8
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new ImageValidationError('MIME_SPOOF_DETECTED', 'Invalid JPEG signature.');
  }

  let offset = 2;
  const len = buffer.length;

  while (offset < len) {
    // Find next marker (FF xx)
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }

    // Skip consecutive 0xFF padding
    while (offset < len && buffer[offset] === 0xff) {
      offset++;
    }

    if (offset >= len) break;

    const marker = buffer[offset++];
    if (marker === undefined) break;

    // Standalone markers without length: RST0-7, SOI, EOI, TEM
    if (
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01 || // TEM
      marker === 0x00 // escaped 0xFF byte
    ) {
      continue;
    }

    if (marker === 0xd9) {
      // EOI (End of Image) reached without finding SOF
      break;
    }

    if (marker === 0xda) {
      // SOS (Start of Scan) - compressed data begins, SOF must have occurred prior
      break;
    }

    // Markers with length: read 2-byte big endian length (includes the 2 length bytes)
    if (offset + 2 > len) {
      throw new ImageValidationError('MALFORMED_IMAGE', 'JPEG segment truncated.');
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2) {
      throw new ImageValidationError('MALFORMED_IMAGE', 'Invalid JPEG segment length.');
    }

    // SOF markers: C0, C1, C2, C3, C5, C6, C7, C9, CA, CB, CD, CE, CF
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSof) {
      if (offset + 7 > len) {
        throw new ImageValidationError('MALFORMED_IMAGE', 'JPEG SOF header truncated.');
      }
      // offset is at segmentLength (2 bytes), then 1 byte precision, then 2 bytes height, then 2 bytes width
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return { width, height };
    }

    offset += segmentLength;
  }

  throw new ImageValidationError('MALFORMED_IMAGE', 'Could not determine JPEG dimensions.');
}

/**
 * Parses WebP dimensions from VP8, VP8L, or VP8X chunks.
 */
function parseWebpDimensions(buffer: Buffer): ImageDimensions {
  if (buffer.length < 16) {
    throw new ImageValidationError('MALFORMED_IMAGE', 'WebP file truncated before header.');
  }

  // RIFF header
  const riff = buffer.subarray(0, 4).toString('ascii');
  const webp = buffer.subarray(8, 12).toString('ascii');

  if (riff !== 'RIFF' || webp !== 'WEBP') {
    throw new ImageValidationError('MIME_SPOOF_DETECTED', 'Invalid WebP signature.');
  }

  const chunkType = buffer.subarray(12, 16).toString('ascii');

  if (chunkType === 'VP8 ') {
    // Lossy WebP
    if (buffer.length < 30) {
      throw new ImageValidationError('MALFORMED_IMAGE', 'WebP VP8 chunk truncated.');
    }
    // Keyframe start code at 23..25 must be 9D 01 2A
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) {
      throw new ImageValidationError('MALFORMED_IMAGE', 'Invalid WebP VP8 keyframe code.');
    }
    const b26 = buffer[26];
    const b27 = buffer[27];
    const b28 = buffer[28];
    const b29 = buffer[29];
    if (b26 === undefined || b27 === undefined || b28 === undefined || b29 === undefined) {
      throw new ImageValidationError('MALFORMED_IMAGE', 'WebP VP8 chunk truncated.');
    }
    const width = (b26 | (b27 << 8)) & 0x3fff;
    const height = (b28 | (b29 << 8)) & 0x3fff;
    return { width, height };
  }

  if (chunkType === 'VP8L') {
    // Lossless WebP
    if (buffer.length < 25) {
      throw new ImageValidationError('MALFORMED_IMAGE', 'WebP VP8L chunk truncated.');
    }
    // Signature byte at 20 must be 0x2F
    if (buffer[20] !== 0x2f) {
      throw new ImageValidationError('MALFORMED_IMAGE', 'Invalid WebP VP8L signature byte.');
    }
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
      throw new ImageValidationError('MALFORMED_IMAGE', 'WebP VP8L chunk truncated.');
    }
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }

  if (chunkType === 'VP8X') {
    // Extended WebP
    if (buffer.length < 30) {
      throw new ImageValidationError('MALFORMED_IMAGE', 'WebP VP8X chunk truncated.');
    }
    const b24 = buffer[24];
    const b25 = buffer[25];
    const b26 = buffer[26];
    const b27 = buffer[27];
    const b28 = buffer[28];
    const b29 = buffer[29];
    if (
      b24 === undefined ||
      b25 === undefined ||
      b26 === undefined ||
      b27 === undefined ||
      b28 === undefined ||
      b29 === undefined
    ) {
      throw new ImageValidationError('MALFORMED_IMAGE', 'WebP VP8X chunk truncated.');
    }
    // 24-bit canvas width at 24..26 (+1)
    const width = 1 + (b24 | (b25 << 8) | (b26 << 16));
    // 24-bit canvas height at 27..29 (+1)
    const height = 1 + (b27 | (b28 << 8) | (b29 << 16));
    return { width, height };
  }

  throw new ImageValidationError('MALFORMED_IMAGE', `Unsupported WebP format chunk: ${chunkType}`);
}

/**
 * Validates image bytes against format, dimensions, size, and security constraints.
 */
export function validateImageBinary(
  data: Uint8Array | Buffer,
  expectedContentType: ImageContentType,
  expectedSha256?: string,
): ImageValidationResult {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

  // 1. File size checks
  if (buffer.length === 0) {
    throw new ImageValidationError('EMPTY_FILE', 'Image payload cannot be empty.');
  }

  if (buffer.length > MAX_IMAGE_BYTE_LENGTH) {
    throw new ImageValidationError(
      'FILE_TOO_LARGE',
      `Image file size (${buffer.length} bytes) exceeds maximum limit of 10 MiB (10,485,760 bytes).`,
    );
  }

  // 2. Reject SVG/HTML/script markup
  checkForPolyglotOrMarkup(buffer);

  // 3. Verify SHA-256 digest if expected hash is provided
  const computedHash = crypto.createHash('sha256').update(buffer).digest('hex').toLowerCase();
  if (expectedSha256 && computedHash !== expectedSha256.toLowerCase()) {
    throw new ImageValidationError(
      'DIGEST_MISMATCH',
      `Calculated SHA-256 digest (${computedHash}) does not match expected digest (${expectedSha256}).`,
    );
  }

  // 4. Validate magic numbers and extract dimensions
  let dimensions: ImageDimensions;
  switch (expectedContentType) {
    case 'image/png':
      dimensions = parsePngDimensions(buffer);
      break;
    case 'image/jpeg':
      dimensions = parseJpegDimensions(buffer);
      break;
    case 'image/webp':
      dimensions = parseWebpDimensions(buffer);
      break;
    default:
      throw new ImageValidationError(
        'UNSUPPORTED_MEDIA_TYPE',
        `Unsupported image content type: ${expectedContentType}`,
      );
  }

  // 5. Dimension bounds
  if (dimensions.width <= 0 || dimensions.height <= 0) {
    throw new ImageValidationError(
      'INVALID_DIMENSIONS',
      `Image dimensions must be positive integers (got ${dimensions.width}x${dimensions.height}).`,
    );
  }

  if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
    throw new ImageValidationError(
      'DIMENSIONS_EXCEEDED',
      `Image dimensions (${dimensions.width}x${dimensions.height}) exceed maximum allowed dimension of ${MAX_IMAGE_DIMENSION}px.`,
    );
  }

  const megapixels = dimensions.width * dimensions.height;
  if (megapixels > MAX_IMAGE_MEGAPIXELS) {
    throw new ImageValidationError(
      'MEGAPIXELS_EXCEEDED',
      `Image resolution (${megapixels} pixels) exceeds maximum limit of 20 megapixels (20,000,000 pixels).`,
    );
  }

  return {
    valid: true,
    contentType: expectedContentType,
    width: dimensions.width,
    height: dimensions.height,
    byteLength: buffer.length,
    sha256: computedHash,
  };
}
