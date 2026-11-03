/** Map only the server's local card-notification route. Board/card authorization
 * remains with their APIs; a notification is never an access grant. */
export function notificationHref(link: string): string | null {
  if (!link.startsWith('/') || link.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/.test(link) || /%(?![\da-f]{2})/i.test(link)) return null;
  try {
    const url = new URL(link, 'https://flowboard.invalid');
    if (url.origin !== 'https://flowboard.invalid' || url.hash) return null;
    // Match before URL normalization as well: dot segments must not change ancestry.
    const match = /^\/projects\/([^/?#]+)\/boards\/([^/?#]+)\?([^#]+)$/.exec(link);
    if (!match || url.pathname !== link.slice(0, link.indexOf('?'))) return null;
    const decodeId = (value: string) => {
      const id = decodeURIComponent(value);
      // Reject encoded separators, nested encoding and control characters rather
      // than letting different route layers interpret a different resource.
      return id && id !== '.' && id !== '..' && !/[/%\\\u0000-\u001f\u007f]/.test(id) ? id : null;
    };
    if (!decodeId(match[1]!)) return null;
    const board = decodeId(match[2]!);
    const entries = [...url.searchParams];
    if (!board || entries.length !== 1 || !['cardId', 'card'].includes(entries[0]![0])) return null;
    // searchParams already decoded exactly once; do not decode the card twice.
    const card = entries[0]![1];
    if (!card || card === '.' || card === '..' || /[/%\\\u0000-\u001f\u007f]/.test(card) || card.includes('\ufffd')) return null;
    return `/board?id=${encodeURIComponent(board)}&card=${encodeURIComponent(card)}`;
  } catch { return null; }
}
