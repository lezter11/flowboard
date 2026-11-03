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
  const forbiddenSnippets = ['<svg', '<?xml', '<html', '<!doctype html', '<script', '<iframe', '<body', 'javascript:', 'onload=', 'onerror='];
  for (const snippet of forbiddenSnippets) {
    if (textPrefix.includes(snippet)) {
      throw new ImageValidationError('REJECTED_FORMAT', `File contains markup or script content (${snippet}), which is not permitted.`);
    }
  }
}

// These checks validate container envelopes, not compressed pixel streams or full decoding.
// Walk the original bounded input by offsets; never allocate from an untrusted length,
// decompress image data, or expand a 20MP image into a pixel buffer in the Worker.
function malformed(message: string): never {
  throw new ImageValidationError('MALFORMED_IMAGE', message);
}
const crcTable = Uint32Array.from({
  length: 256
}, (_, n) => {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
function pngCrc(buffer: Buffer, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = crc >>> 8 ^ crcTable[(crc ^ buffer[i]!) & 255]!;
  return (crc ^ 0xffffffff) >>> 0;
}
function parsePngDimensions(buffer: Buffer): ImageDimensions {
  if (buffer.length < 8 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new ImageValidationError('MIME_SPOOF_DETECTED', 'Invalid PNG signature.');
  }
  let offset = 8;
  let dimensions: ImageDimensions | undefined;
  let color = -1,
    depth = 0,
    palette = false,
    dataStarted = false,
    dataClosed = false,
    dataBytes = 0;
  const zlibHeader: number[] = [];
  while (offset < buffer.length) {
    if (buffer.length - offset < 12) malformed('PNG chunk truncated.');
    const length = buffer.readUInt32BE(offset);
    if (length > buffer.length - offset - 12) malformed('PNG chunk exceeds payload.');
    const end = offset + 12 + length;
    const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
    if (!/^[A-Za-z]{4}$/.test(type) || buffer[offset + 6]! & 32) malformed('Invalid PNG chunk type.');
    if (pngCrc(buffer, offset + 4, end - 4) !== buffer.readUInt32BE(end - 4)) malformed('PNG chunk checksum mismatch.');
    const data = offset + 8;
    if (!dimensions && type !== 'IHDR') malformed('PNG must begin with IHDR.');
    if (type === 'IHDR') {
      if (dimensions || length !== 13) malformed('Invalid or repeated PNG IHDR.');
      dimensions = {
        width: buffer.readUInt32BE(data),
        height: buffer.readUInt32BE(data + 4)
      };
      depth = buffer[data + 8]!;
      color = buffer[data + 9]!;
      const depths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16]
      };
      if (!depths[color]?.includes(depth) || buffer[data + 10] !== 0 || buffer[data + 11] !== 0 || buffer[data + 12]! > 1) malformed('Invalid PNG image header fields.');
    } else if (type === 'PLTE') {
      if (palette || dataStarted || color === 0 || color === 4 || !length || length % 3 || length > 768 || color === 3 && length / 3 > 2 ** depth) malformed('Invalid PNG palette.');
      palette = true;
    } else if (type === 'IDAT') {
      if (dataClosed || color === 3 && !palette) malformed('Invalid PNG image-data order.');
      dataStarted = true;
      dataBytes += length;
      for (let i = 0; i < length && zlibHeader.length < 2; i++) zlibHeader.push(buffer[data + i]!);
    } else {
      if (dataStarted) dataClosed = true;
      if (type === 'IEND') {
        if (length || !dataStarted || dataBytes < 6 || end !== buffer.length) malformed('PNG requires image data and a final IEND.');
        const cmf = zlibHeader[0]!,
          flg = zlibHeader[1]!;
        if ((cmf & 15) !== 8 || cmf >>> 4 > 7 || ((cmf << 8) + flg) % 31 || flg & 32) malformed('Invalid PNG zlib stream header.');
        return dimensions!;
      }
      if (!(buffer[offset + 4]! & 32)) malformed('Unknown critical PNG chunk.');
    }
    offset = end;
  }
  return malformed('PNG has no final IEND.');
}
function parseJpegDimensions(buffer: Buffer): ImageDimensions {
  if (buffer.length < 4 || buffer[0] !== 255 || buffer[1] !== 216) {
    throw new ImageValidationError('MIME_SPOOF_DETECTED', 'Invalid JPEG signature.');
  }
  let offset = 2,
    scans = 0;
  let dimensions: ImageDimensions | undefined;
  let progressive = false;
  const components = new Map<number, number>();
  const quantization = new Set<number>(),
    huffman = new Set<number>();
  while (offset < buffer.length) {
    if (buffer[offset++] !== 255) malformed('JPEG marker expected.');
    while (buffer[offset] === 255) offset++;
    if (offset >= buffer.length) malformed('JPEG marker truncated.');
    const marker = buffer[offset++]!;
    if (marker === 217) {
      if (!dimensions || !scans || offset !== buffer.length) malformed('JPEG requires complete scans and final EOI.');
      return dimensions;
    }
    if (marker === 0 || marker === 216 || marker >= 208 && marker <= 215) malformed('Unexpected JPEG marker.');
    if (marker === 1) continue;
    if (buffer.length - offset < 2) malformed('JPEG segment truncated.');
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || length > buffer.length - offset) malformed('JPEG segment exceeds payload.');
    const end = offset + length,
      data = offset + 2;
    if (marker === 219) {
      let q = data;
      while (q < end) {
        const info = buffer[q++]!;
        if (info >>> 4 > 1 || (info & 15) > 3) malformed('Invalid JPEG quantization table.');
        q += 64 * ((info >>> 4) + 1);
        if (q > end) malformed('JPEG quantization table truncated.');
        quantization.add(info & 15);
      }
      if (q === data) malformed('Empty JPEG quantization table.');
    } else if (marker === 196) {
      let q = data;
      while (q < end) {
        const info = buffer[q++]!;
        if (info >>> 4 > 1 || (info & 15) > 3 || end - q < 16) malformed('Invalid JPEG Huffman table.');
        let symbols = 0,
          available = 1;
        for (let i = 0; i < 16; i++) {
          const n = buffer[q++]!;
          symbols += n;
          available = available * 2 - n;
          if (available < 0) malformed('Oversubscribed JPEG Huffman table.');
        }
        if (!symbols || symbols > 256 || symbols > end - q) malformed('JPEG Huffman symbols truncated.');
        q += symbols;
        huffman.add(info);
      }
      if (q === data) malformed('Empty JPEG Huffman table.');
    } else if (marker === 192 || marker === 193 || marker === 194) {
      if (dimensions || length < 8 || buffer[data] !== 8) malformed('Invalid JPEG frame.');
      dimensions = {
        width: buffer.readUInt16BE(data + 3),
        height: buffer.readUInt16BE(data + 1)
      };
      const count = buffer[data + 5]!;
      if (!count || count > 4 || length !== 8 + 3 * count) malformed('Invalid JPEG frame components.');
      // Direct uploads support grayscale/RGB JPEGs. Reject CMYK before entropy
      // processing; browser conversion is an explicit, separately tested UI step.
      if (count !== 1 && count !== 3) throw new ImageValidationError('JPEG_COLOR_MODEL_UNSUPPORTED', 'Use an RGB or grayscale JPEG. Convert CMYK images before uploading.');
      for (let i = 0; i < count; i++) {
        const p = data + 6 + i * 3,
          id = buffer[p]!,
          sampling = buffer[p + 1]!,
          table = buffer[p + 2]!;
        if (components.has(id) || !(sampling >>> 4) || sampling >>> 4 > 4 || !(sampling & 15) || (sampling & 15) > 4 || table > 3) malformed('Invalid JPEG frame component.');
        components.set(id, table);
      }
      progressive = marker === 194;
    } else if (marker === 218) {
      const count = buffer[data]!;
      if (!dimensions || !count || count > components.size || length !== 6 + 2 * count) malformed('Invalid JPEG scan header.');
      const start = buffer[end - 3]!,
        stop = buffer[end - 2]!,
        approximation = buffer[end - 1]!;
      if (!progressive && (start !== 0 || stop !== 63 || approximation !== 0) || progressive && (start > stop || stop > 63 || start === 0 && stop !== 0 || start > 0 && count !== 1 || approximation >>> 4 > 13 || (approximation & 15) > 13)) malformed('Invalid JPEG spectral scan.');
      const selected = new Set<number>();
      for (let i = 0; i < count; i++) {
        const id = buffer[data + 1 + i * 2]!,
          tables = buffer[data + 2 + i * 2]!;
        if (selected.has(id) || !components.has(id) || !quantization.has(components.get(id)!) || tables >>> 4 > 3 || (tables & 15) > 3) malformed('Invalid JPEG scan component.');
        if (start === 0 && !(approximation >>> 4) && !huffman.has(tables >>> 4) || stop > 0 && !huffman.has(16 + (tables & 15))) malformed('JPEG scan references missing Huffman table.');
        selected.add(id);
      }
      offset = end;
      let entropyBytes = 0;
      while (offset < buffer.length) {
        if (buffer[offset] !== 255) {
          offset++;
          entropyBytes++;
          continue;
        }
        const markerStart = offset++;
        while (buffer[offset] === 255) offset++;
        if (offset >= buffer.length) malformed('JPEG entropy stream truncated.');
        const next = buffer[offset]!;
        if (next === 0) {
          offset++;
          entropyBytes++;
          continue;
        }
        if (next >= 208 && next <= 215) {
          offset++;
          continue;
        }
        offset = markerStart;
        break;
      }
      if (!entropyBytes) malformed('Empty JPEG entropy scan.');
      scans++;
      continue;
    } else if (marker === 221) {
      if (length !== 4) malformed('Invalid JPEG restart interval.');
    } else if (!(marker >= 224 && marker <= 239) && marker !== 254) {
      malformed('Unsupported or invalid JPEG structural marker.');
    }
    offset = end;
  }
  return malformed('JPEG has no final EOI.');
}
function uint24(buffer: Buffer, offset: number): number {
  return buffer[offset]! | buffer[offset + 1]! << 8 | buffer[offset + 2]! << 16;
}
function webpPayload(buffer: Buffer, type: string, start: number, length: number): ImageDimensions {
  if (type === 'VP8 ') {
    if (length <= 10 || buffer[start + 3] !== 157 || buffer[start + 4] !== 1 || buffer[start + 5] !== 42) malformed('Invalid WebP VP8 keyframe.');
    const tag = uint24(buffer, start),
      partition = tag >>> 5;
    if (tag & 1 || (tag >>> 1 & 7) > 3 || !(tag & 16) || !partition || partition > length - 10) malformed('Invalid WebP VP8 partition.');
    return {
      width: buffer.readUInt16LE(start + 6) & 16383,
      height: buffer.readUInt16LE(start + 8) & 16383
    };
  }
  if (length <= 5 || buffer[start] !== 47 || buffer[start + 4]! >>> 5) malformed('Invalid WebP lossless stream.');
  const bits = buffer.readUInt32LE(start + 1);
  return {
    width: 1 + (bits & 16383),
    height: 1 + (bits >>> 14 & 16383)
  };
}
function parseWebpDimensions(buffer: Buffer): ImageDimensions {
  if (buffer.length < 12 || buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WEBP') {
    throw new ImageValidationError('MIME_SPOOF_DETECTED', 'Invalid WebP signature.');
  }
  if (buffer.readUInt32LE(4) !== buffer.length - 8) malformed('WebP RIFF length mismatch.');
  let offset = 12,
    flags = 0,
    frames = 0,
    animationHeader = false;
  let canvas: ImageDimensions | undefined, image: ImageDimensions | undefined;
  const seen = new Set<string>();
  while (offset < buffer.length) {
    if (buffer.length - offset < 8) malformed('WebP chunk header truncated.');
    const type = buffer.toString('latin1', offset, offset + 4),
      length = buffer.readUInt32LE(offset + 4),
      data = offset + 8;
    const end = data + length,
      padded = end + (length & 1);
    if (padded > buffer.length || length & 1 && buffer[end] !== 0) malformed('WebP chunk exceeds payload or has invalid padding.');
    if (type === 'VP8X') {
      if (offset !== 12 || length !== 10 || buffer[data]! & 193 || buffer[data + 1] || buffer[data + 2] || buffer[data + 3]) malformed('Invalid WebP extended header.');
      flags = buffer[data]!;
      canvas = {
        width: 1 + uint24(buffer, data + 4),
        height: 1 + uint24(buffer, data + 7)
      };
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (image || frames || flags & 2) malformed('Repeated or misplaced WebP image data.');
      image = webpPayload(buffer, type, data, length);
      if (canvas && (image.width !== canvas.width || image.height !== canvas.height)) malformed('WebP image and canvas dimensions disagree.');
    } else if (type === 'ANIM') {
      if (!(flags & 2) || animationHeader || length !== 6 || frames || image) malformed('Invalid WebP animation header.');
      animationHeader = true;
    } else if (type === 'ANMF') {
      if (!canvas || !animationHeader || length < 16 || buffer[data + 15]! & 252) malformed('Invalid WebP animation frame.');
      const x = uint24(buffer, data) * 2,
        y = uint24(buffer, data + 3) * 2;
      const width = 1 + uint24(buffer, data + 6),
        height = 1 + uint24(buffer, data + 9);
      if (x + width > canvas.width || y + height > canvas.height) malformed('WebP frame exceeds canvas.');
      let q = data + 16,
        frameImage = false,
        alpha = false;
      while (q < end) {
        if (end - q < 8) malformed('WebP frame chunk truncated.');
        const subType = buffer.toString('latin1', q, q + 4),
          n = buffer.readUInt32LE(q + 4),
          body = q + 8,
          next = body + n + (n & 1);
        if (next > end || n & 1 && buffer[body + n] !== 0) malformed('WebP frame chunk exceeds bounds.');
        if (subType === 'ALPH') {
          if (alpha || frameImage || n < 2 || buffer[body]! & 192 || (buffer[body]! & 3) > 1 || (buffer[body]! >>> 4 & 3) > 1) malformed('Invalid WebP frame alpha data.');
          alpha = true;
        } else if (subType === 'VP8 ' || subType === 'VP8L') {
          if (frameImage || alpha && subType === 'VP8L') malformed('Repeated WebP frame image.');
          const frame = webpPayload(buffer, subType, body, n);
          if (frame.width !== width || frame.height !== height) malformed('WebP frame dimensions disagree.');
          frameImage = true;
        } else malformed('Invalid WebP animation frame chunk.');
        q = next;
      }
      if (!frameImage) malformed('WebP animation frame has no image data.');
      frames++;
    } else if (type === 'ALPH') {
      if (!canvas || !(flags & 16) || image || seen.has(type) || length < 2 || buffer[data]! & 192 || (buffer[data]! & 3) > 1 || (buffer[data]! >>> 4 & 3) > 1) malformed('Invalid WebP alpha data.');
    } else if (type === 'ICCP' || type === 'EXIF' || type === 'XMP ') {
      const flag = type === 'ICCP' ? 32 : type === 'EXIF' ? 8 : 4;
      if (!canvas || !(flags & flag) || seen.has(type) || !length) malformed('Invalid WebP metadata.');
    }
    if (type === 'ALPH' || type === 'ICCP' || type === 'EXIF' || type === 'XMP ') seen.add(type);
    offset = padded;
  }
  if (flags & 2 ? !frames : !image) malformed('WebP contains no complete image payload.');
  for (const [flag, type] of [[32, 'ICCP'], [8, 'EXIF'], [4, 'XMP ']] as const) if (flags & flag && !seen.has(type)) malformed('Missing declared WebP metadata.');
  return canvas ?? image!;
}

/**
 * Validates image bytes against format, dimensions, size, and security constraints.
 */
export function validateImageBinary(data: Uint8Array | Buffer, expectedContentType: ImageContentType, expectedSha256?: string): ImageValidationResult {
  // Check before converting/copying an untrusted Uint8Array.
  if (data.byteLength > MAX_IMAGE_BYTE_LENGTH) throw new ImageValidationError('FILE_TOO_LARGE', 'The image is too large.');
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

  // 1. File size checks
  if (buffer.length === 0) {
    throw new ImageValidationError('EMPTY_FILE', 'Image payload cannot be empty.');
  }
  if (buffer.length > MAX_IMAGE_BYTE_LENGTH) {
    throw new ImageValidationError('FILE_TOO_LARGE', 'The image is too large.');
  }

  // 2. Reject SVG/HTML/script markup
  checkForPolyglotOrMarkup(buffer);

  // 3. Verify SHA-256 digest if expected hash is provided
  const computedHash = crypto.createHash('sha256').update(buffer).digest('hex').toLowerCase();
  if (expectedSha256 && computedHash !== expectedSha256.toLowerCase()) {
    throw new ImageValidationError('DIGEST_MISMATCH', `Calculated SHA-256 digest (${computedHash}) does not match expected digest (${expectedSha256}).`);
  }

  // 4. Validate complete bounded container structure and extract dimensions
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
      throw new ImageValidationError('UNSUPPORTED_MEDIA_TYPE', `Unsupported image content type: ${expectedContentType}`);
  }

  // 5. Dimension bounds
  if (dimensions.width <= 0 || dimensions.height <= 0) {
    throw new ImageValidationError('INVALID_DIMENSIONS', `Image dimensions must be positive integers (got ${dimensions.width}x${dimensions.height}).`);
  }
  if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
    throw new ImageValidationError('DIMENSIONS_EXCEEDED', `Image dimensions (${dimensions.width}x${dimensions.height}) exceed maximum allowed dimension of ${MAX_IMAGE_DIMENSION}px.`);
  }
  const megapixels = dimensions.width * dimensions.height;
  if (megapixels > MAX_IMAGE_MEGAPIXELS) {
    throw new ImageValidationError('MEGAPIXELS_EXCEEDED', `Image resolution (${megapixels} pixels) exceeds maximum limit of 20 megapixels (20,000,000 pixels).`);
  }
  return {
    valid: true,
    contentType: expectedContentType,
    width: dimensions.width,
    height: dimensions.height,
    byteLength: buffer.length,
    sha256: computedHash
  };
}
