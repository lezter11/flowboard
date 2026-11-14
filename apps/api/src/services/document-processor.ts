import type { DocumentMediaType } from '@flowboard/contracts';

/** A document is publishable only after a configured processor returns these exact bytes. */
export interface ProcessedDocument {
  bytes: Uint8Array;
  originalByteLength: number;
  mediaType: DocumentMediaType;
  sha256: string;
}

export interface DocumentProcessor {
  process(bytes: Uint8Array, signal: AbortSignal, mediaType?: DocumentMediaType): Promise<ProcessedDocument>;
}

export { MAX_DOCUMENT_BYTES } from '@flowboard/contracts';

export class DocumentProcessingError extends Error {
  readonly code: DocumentProcessingCode;

  constructor(code: DocumentProcessingCode) {
    super(messages[code]);
    this.name = 'DocumentProcessingError';
    this.code = code;
  }
}

const messages = {
  DOCUMENT_TOO_LARGE: 'Documents must be at most 1 MiB.',
  UNSUPPORTED_DOCUMENT: 'Choose a supported PDF, Word (.docx), or Excel (.xlsx) document without encryption or active content.',
  DOCUMENT_REJECTED: 'The file did not pass its safety scan.',
  DOCUMENT_PROCESSOR_UNAVAILABLE: 'Document processing is temporarily unavailable. Try again shortly.',
} as const;

export type DocumentProcessingCode = keyof typeof messages;
