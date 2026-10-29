/**
 * Flowboard logo mark: a circle holding three board columns of different heights, each carrying small stacked cards
 * (concept: the user's Canva sketch, docs/references/brand/logo-canva-sketch-2026-10-29.png; geometry only is refined).
 *
 * Geometry on a 64 grid: 10 wide bars, 6 gutters, tops aligned at y=14 and bottoms at 44, 36 and 50 so the group's
 * vertical centre sits on the circle's centre; cards are 6x3 with a 3 pitch on a 2 px inset.
 * Under 24 px the cards would blur, so the compact form keeps the three bars (thicker) and drops the cards.
 * Colours come from CSS variables so one mark serves every surface (see the .logo-mark rules in signin-preview.css):
 * the default is a dark circle with white bars; on the dark sidebar pill and in the dark theme it is the beige circle
 * with the third bar dark, the sketch's second variant.
 */
const BARS = [
  { x: 11, h: 30, cards: 4, tone: 'a' },
  { x: 27, h: 22, cards: 3, tone: 'b' },
  { x: 43, h: 36, cards: 5, tone: 'c' },
] as const;

export function LogoMark({ size = 26, animate = false, className }: { size?: number; animate?: boolean; className?: string }) {
  const compact = size < 24;
  return (
    <svg
      className={`logo-mark${compact ? ' is-compact' : ''}${animate ? ' is-animated' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="logo-circle" cx="32" cy="32" r="31.5" />
      {compact ? (
        <>
          <rect className="logo-bar" x="13" y="16" width="10" height="26" rx="2" />
          <rect className="logo-bar" x="27" y="16" width="10" height="19" rx="2" />
          <rect className="logo-bar logo-bar-pick" x="41" y="16" width="10" height="32" rx="2" />
        </>
      ) : (
        BARS.map((bar, index) => (
          <g key={bar.x}>
            <rect className={`logo-bar${index === 2 ? ' logo-bar-pick' : ''}`} x={bar.x} y="14" width="10" height={bar.h} rx="2.5" />
            {Array.from({ length: bar.cards }, (_, i) => (
              <rect key={i} className={`logo-card logo-card-${bar.tone}`} x={bar.x + 2} y={17 + i * 6} width="6" height="3" rx="1" style={{ ['--i' as string]: index * 2 + i }} />
            ))}
          </g>
        ))
      )}
    </svg>
  );
}
