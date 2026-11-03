import {validatePngPixelStream} from '../src/services/png-stream.ts';
import {validateImageBinary, ImageValidationError} from '../src/services/image-validator.ts';
import {ImagesBindingVerifier, type ImageVerifierBinding} from '../src/services/image-verifier-worker.ts';
import {imageVerifierStorage, verifyImagePixels, IMAGE_VERIFICATION_DEADLINE_MS} from '../src/services/image-verifier.ts';
import {withImageAdmission} from '../src/services/image-admission.ts';
export default {
  async fetch(request: Request, env: {IMAGE_VERIFIER: ImageVerifierBinding}, ctx: {waitUntil(work:Promise<unknown>):void}): Promise<Response> {
    try {
      return await withImageAdmission(request.signal, () => imageVerifierStorage.run(new ImagesBindingVerifier(env.IMAGE_VERIFIER), async () => {
        const deadline = Date.now() + IMAGE_VERIFICATION_DEADLINE_MS;
        const bytes = new Uint8Array(await request.arrayBuffer());
        const dimensions = validateImageBinary(bytes, 'image/png');
        const metrics = await validatePngPixelStream(bytes, request.signal, deadline);
        await verifyImagePixels(bytes, 'image/png', dimensions, request.signal, deadline - Date.now());
        return Response.json({metrics, fullPixelsVerified:true});
      }), work => ctx.waitUntil(work));
    } catch (error) {
      const status = error instanceof ImageValidationError ? 422 : (error as {status?:number}).status ?? 500;
      return Response.json({code:(error as {code?:string}).code ?? 'UNKNOWN'}, {status});
    }
  }
};
