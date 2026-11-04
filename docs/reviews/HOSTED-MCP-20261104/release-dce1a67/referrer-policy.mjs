// Referrer Policy section 8.1: the last recognized nonempty policy wins.
// https://www.w3.org/TR/referrer-policy/#parse-referrer-policy-from-header
const recognized = new Set(['no-referrer', 'no-referrer-when-downgrade', 'same-origin', 'origin', 'strict-origin', 'origin-when-cross-origin', 'strict-origin-when-cross-origin', 'unsafe-url']);
export function effectiveReferrerPolicy(header) {
  if (typeof header !== 'string' || /[\r\n]/.test(header)) return '';
  return header.split(',').map(value => value.trim()).filter(value => recognized.has(value)).at(-1) ?? '';
}

export function effectiveReferrerPolicyFromFields(fields) {
  if (!Array.isArray(fields) || !fields.every(value => typeof value === 'string')) return '';
  return effectiveReferrerPolicy(fields.join(', '));
}
