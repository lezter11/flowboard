import { LogoMark } from './logo-mark';

/**
 * The one Flowboard wordmark: gradient text from the prototype (.brand-wordmark; pastel gradient, so it needs a dark
 * surface: the sidebar pill). `outline` is for light surfaces: a hairline violet stroke keeps the pastel letters readable. `inline` keeps the surrounding font size (headings).
 * `mark` adds the logo mark for lockups: the sidebar, the sign-in header and the invitation header.
 */
export function Wordmark({ className, inline = false, mark = false, animate = false, outline = false }: { className?: string; inline?: boolean; mark?: boolean; animate?: boolean; outline?: boolean }) {
  const text = <span className={`${inline ? '' : 'brand-name '}brand-wordmark${outline ? ' wordmark-outline' : ''}${className ? ` ${className}` : ''}`}>Flowboard</span>;
  if (!mark) return text;
  return (
    <>
      <LogoMark size={26} animate={animate} />
      {text}
    </>
  );
}
