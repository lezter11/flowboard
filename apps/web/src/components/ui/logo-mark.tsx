/**
 * Flowboard logo mark, taken from the prototype's sidebar mark (the Lucide "kanban" icon: three vertical bars, stroke 2,
 * round caps, on a 24 grid) but on a circle: the prototype's #302638 plum, white bars. Bars: x 6/12/18, from y 5 down to
 * 16 / 11 / 19. The icon fills 4/7 of the circle, as the prototype's 16 px icon fills its 28 px box.
 * Under 24 px the bars get a heavier stroke so they survive. Colours are CSS variables (.logo-mark in signin-preview.css):
 * on dark surfaces the circle gets a thin lighter ring so it stays visible.
 */
export function LogoMark({ size = 26, className }: { size?: number; className?: string }) {
  const compact = size < 24;
  return (
    <svg className={`logo-mark${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle className="logo-circle" cx="32" cy="32" r="31" />
      <g className="logo-bars" transform="translate(32 32) scale(1.52) translate(-12 -12)" strokeWidth={compact ? 2.8 : 2} strokeLinecap="round" fill="none">
        <path d="M6 5v11" /><path d="M12 5v6" /><path d="M18 5v14" />
      </g>
    </svg>
  );
}
