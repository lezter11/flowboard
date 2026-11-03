import sharp from 'sharp';
import type { ImageVerifierBinding } from '../../src/services/image-verifier-worker.ts';
// Existing direct Worker-function storage tests run in Node with a fake R2 binding.
// This protocol fixture uses a real native codec; actual workerd coverage is separate.
export function nativeImageBindingForTests(): ImageVerifierBinding {
  return {
    input(source) {
      return {
        async output(options) {
          try {
            const bytes = Buffer.from(await new Response(source).arrayBuffer());
            const output = await sharp(bytes, {
              failOn: 'warning'
            }).flatten({
              background: '#ffffff'
            }).jpeg({
              quality: options.quality
            }).toBuffer();
            return {
              response: () => new Response(new Uint8Array(output).buffer, {
                headers: {
                  'content-type': 'image/jpeg'
                }
              })
            };
          } catch {
            throw Object.assign(new Error('Invalid image'), {
              code: 9412
            });
          }
        }
      };
    }
  };
}
