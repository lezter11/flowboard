/**
 * The one Flowboard wordmark: gradient text from the prototype (.brand-wordmark; sign-in gradient on the sign-in page,
 * pastel gradient on the sidebar pill). No icon mark. `inline` keeps the surrounding font size (headings).
 */
export function Wordmark({ className, inline = false }: { className?: string; inline?: boolean }) {
  return <span className={`${inline ? '' : 'brand-name '}brand-wordmark${className ? ` ${className}` : ''}`}>Flowboard</span>;
}
