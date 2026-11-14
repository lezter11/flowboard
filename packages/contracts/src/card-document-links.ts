import { z } from 'zod';

export const MAX_CARD_DOCUMENT_LINKS = 10;
const MAX_DRIVE_URL_LENGTH = 2000;
const driveFilePath = /^\/file\/(?:u\/\d+\/)?d\/[A-Za-z0-9_-]+(?:\/(?:view|edit|preview))?\/?$/;
const googleEditorPath = /^\/(?:document|spreadsheets)\/(?:u\/\d+\/)?d\/[A-Za-z0-9_-]+(?:\/(?:edit|view|preview))?\/?$/;
const safeQueryValue = /^[A-Za-z0-9_.-]+$/;
const allowedQueryNames = new Set(['authuser', 'gid', 'ouid', 'resourcekey', 'rtpof', 'sd', 'tab', 'usp', 'usp_orig']);

function isGoogleDocumentUrl(value: string): boolean {
  if (
    /[\s\\\p{Cc}\p{Cf}]/u.test(value)
    || !/^https:\/\/(?:docs\.google\.com|drive\.google\.com)\//i.test(value)
  ) return false;

  let url: URL;
  try { url = new URL(value); } catch { return false; }
  // Validate the spelled path too. The platform parser normalizes dot segments.
  const path = value.slice(value.indexOf('/', 'https://'.length)).split(/[?#]/, 1)[0];
  if (path !== url.pathname) return false;
  const legacyOpen = url.hostname === 'drive.google.com' && path === '/open';
  if (legacyOpen) {
    if (!/^[A-Za-z0-9_-]+$/.test(url.searchParams.get('id') ?? '')) return false;
  } else if (!(url.hostname === 'drive.google.com' ? driveFilePath : googleEditorPath).test(url.pathname)) {
    return false;
  }

  const seen = new Set<string>();
  for (const [key, parameter] of url.searchParams) {
    if (seen.has(key) || (!allowedQueryNames.has(key) && !(legacyOpen && key === 'id')) || !safeQueryValue.test(parameter)) return false;
    seen.add(key);
  }
  return !url.hash || (
    path.startsWith('/spreadsheets/')
      ? /^#(?:gid=\d+(?:&range=[A-Za-z0-9:$]+)?|range=[A-Za-z0-9:$]+)$/.test(url.hash)
      : /^#(?:heading|bookmark)=[A-Za-z0-9_.-]+$/.test(url.hash)
  );
}

export const cardDocumentLinkSchema = z.object({
  title: z.string().trim().min(1, 'Enter a name for the document.').max(100, 'Document names can contain up to 100 characters.')
    .refine(title => !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(title), 'Document names must use printable text.'),
  url: z.string().trim().max(MAX_DRIVE_URL_LENGTH)
    .refine(isGoogleDocumentUrl, 'Use a sharing link to a Google Drive file, Google Doc, or Google Sheet.'),
}).strict();

export type CardDocumentLink = z.infer<typeof cardDocumentLinkSchema>;

export const cardDocumentLinksSchema = z.array(cardDocumentLinkSchema)
  .max(MAX_CARD_DOCUMENT_LINKS, 'A card can have up to 10 document links.')
  .refine(links => {
    // Ignore the case of the fixed HTTPS origin. The path and query are case-sensitive.
    const comparable = links.map(link => link.url.replace(
      /^https:\/\/[^/]+/i, origin => origin.toLowerCase(),
    ));
    return new Set(comparable).size === links.length;
  }, 'Each document URL can appear once.');
