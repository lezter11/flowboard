import sharp from 'sharp';
import type { ImageContentType } from '@flowboard/contracts';
export async function* maximumImageFixtures() {
  for (const kind of ['png16', 'jpeg444baseline', 'jpeg444progressive', 'jpegcmykprogressive', 'webplossless']) {
    const source = sharp({
      create: {
        width: 5000,
        height: 4000,
        channels: 4,
        background: {
          r: 12,
          g: 140,
          b: 99,
          alpha: 0.7
        }
      }
    });
    let bytes: Buffer, contentType: ImageContentType;
    if (kind === 'png16') {
      bytes = await source.toColourspace('rgb16').png().toBuffer();
      contentType = 'image/png';
    } else if (kind === 'jpeg444progressive' || kind === 'jpeg444baseline') {
      bytes = await source.removeAlpha().jpeg({
        progressive: kind === 'jpeg444progressive',
        chromaSubsampling: '4:4:4'
      }).toBuffer();
      contentType = 'image/jpeg';
    } else if (kind === 'jpegcmykprogressive') {
      bytes = await source.removeAlpha().toColourspace('cmyk').jpeg({
        progressive: true,
        chromaSubsampling: '4:4:4'
      }).toBuffer();
      contentType = 'image/jpeg';
    } else {
      bytes = await source.webp({
        lossless: true
      }).toBuffer();
      contentType = 'image/webp';
    }
    yield {
      name: '20MP-' + kind,
      bytes,
      contentType,
      width: 5000,
      height: 4000
    };
  }
}

// Deterministic textured maxima exercise entropy complexity; solid-color maxima
// alone do not prove that every valid20MP image fits the processing budget.
export async function* texturedMaximumJpegFixtures() {
  const width = 5000,
    height = 4000;
  const raw = Buffer.alloc(width * height * 3);
  let state = 19790621;
  for (let offset = 0; offset < raw.length; offset += 3) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    raw[offset] = state & 255;
    raw[offset + 1] = state >>> 8 & 255;
    raw[offset + 2] = state >>> 16 & 255;
  }
  for (const cmyk of [false, true]) {
    let bytes: Buffer | undefined;
    for (const quality of [30, 20, 10, 5]) {
      let image = sharp(raw, {
        raw: {
          width,
          height,
          channels: 3
        }
      });
      if (cmyk) image = image.toColourspace('cmyk');
      bytes = await image.jpeg({
        progressive: true,
        chromaSubsampling: '4:4:4',
        quality
      }).toBuffer();
      if (bytes.length <= 10 * 1024 * 1024) break;
    }
    if (!bytes || bytes.length > 10 * 1024 * 1024) throw new Error('Textured max fixture exceeds input cap');
    yield {
      name: '20MP-textured-' + (cmyk ? 'cmyk444' : 'rgb444'),
      width,
      height,
      bytes,
      contentType: 'image/jpeg' as const
    };
  }
}
