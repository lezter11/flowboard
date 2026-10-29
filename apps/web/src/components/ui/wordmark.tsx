/**
 * The one Flowboard wordmark: gradient text from the prototype (.brand-wordmark; sign-in gradient on the sign-in page,
 * pastel gradient on the sidebar pill). `inline` keeps the surrounding font size (headings).
 * `mark` adds the prototype's small brand mark (rounded square with three staggered bars, screens/screens.js `.brand-mark`)
 * for lockups: the sidebar, the sign-in header and the invitation header.
 */
export function Wordmark({ className, inline = false, mark = false }: { className?: string; inline?: boolean; mark?: boolean }) {
  const text = <span className={`${inline ? '' : 'brand-name '}brand-wordmark${className ? ` ${className}` : ''}`}>Flowboard</span>;
  if (!mark) return text;
  return (
    <>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
          <path d="M4.5 6.5h6" /><path d="M4.5 12h15" /><path d="M13.5 17.5h6" />
        </svg>
      </span>
      {text}
    </>
  );
}
