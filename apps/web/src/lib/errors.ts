import { ApiError } from '@/lib/api';
import { PrepareError } from '@/lib/image-prepare';
import { isStaleCode } from '@/lib/error-codes';

/** Turns an API failure into a short, user-facing sentence. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session ended. Sign in again.';
    if (error.status === 403) return 'You do not have permission to do that.';
    if (isStaleCode(error.code)) return 'Someone else changed this. The latest version has been loaded; try again.';
    if (error.status === 503 && error.code === 'CONFIG_ERROR') return 'This feature is not available right now. Try again later.';
    if (error.status === 429) return 'Too many requests. Wait a moment and try again.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function isStale(error: unknown): boolean {
  return error instanceof ApiError && isStaleCode(error.code);
}

/** Image upload failures: storage that is not configured answers 503 CONFIG_ERROR, which is not the user's doing and not retryable by them. */
export function describeImageError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503 && error.code === 'CONFIG_ERROR') return 'Image uploads are not available right now.';
  return describeError(error);
}

/** Friendly sentence for any failure while adding an image, and whether trying again could help. */
export function describeUploadError(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof PrepareError) return { message: error.message, retryable: false };
  if (error instanceof ApiError) {
    const code = error.code;
    if (error.status === 503 && code === 'CONFIG_ERROR') return { message: 'Image uploads are not available right now.', retryable: false };
    if (error.status === 413 || code === 'PAYLOAD_TOO_LARGE') return { message: 'This image is too large. The limit is 10 MB.', retryable: false };
    if (code === 'IMAGE_LIMIT_EXCEEDED') return { message: 'This card already has 10 images. Remove one to add another.', retryable: false };
    if (code === 'MIME_SPOOF_DETECTED' || code === 'MALFORMED_IMAGE' || code === 'REJECTED_FORMAT' || code === 'INVALID_IMAGE' || code === 'EMPTY_FILE' || code === 'INVALID_DIMENSIONS') return { message: 'This file is not a valid PNG, JPEG or WebP image.', retryable: false };
    if (code === 'DIMENSIONS_EXCEEDED' || code === 'MEGAPIXELS_EXCEEDED') return { message: 'This image has too many pixels. The limit is 20 megapixels and 8192 px on a side.', retryable: false };
    if (code === 'UPLOAD_EXPIRED') return { message: 'The upload took too long and expired. Try again.', retryable: true };
    if (code === 'SIZE_MISMATCH' || code === 'DIGEST_MISMATCH') return { message: 'The image changed or was damaged while uploading. Try again.', retryable: true };
    if (code === 'CARD_TRASHED') return { message: 'This card is in the trash, so images cannot be added.', retryable: false };
    if (error.status === 0) return { message: error.message, retryable: true };
    if (error.status === 403) return { message: 'You do not have permission to add images to this card.', retryable: false };
    return { message: describeError(error), retryable: error.status >= 500 };
  }
  return { message: describeError(error), retryable: true };
}
