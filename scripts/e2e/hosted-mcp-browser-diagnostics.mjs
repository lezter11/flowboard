// Error fields are untrusted: never copy their text into acceptance evidence.
const errorTypes = new Set(['Error', 'AssertionError', 'TimeoutError', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError']);
export function safeBrowserError(error) {
  let name, stack;
  try { name = error?.name; } catch {}
  try { stack = error?.stack; } catch {}
  const errorType = errorTypes.has(name) ? name : 'Error';
  const diagnostic = { errorType };
  if (typeof stack !== 'string') return diagnostic;
  const frame = stack.slice(0, 65_536).match(/(?:\/|\()hosted-mcp-browser\.mjs:([1-9]\d{0,6}):([1-9]\d{0,6})(?=\)|\s|$)/);
  if (frame) diagnostic.sourceFrame = { file: 'hosted-mcp-browser.mjs', line: Number(frame[1]), column: Number(frame[2]) };
  return diagnostic;
}
