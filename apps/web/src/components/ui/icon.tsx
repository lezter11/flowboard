import { SPRITE_SYMBOLS } from './sprite-symbols';

/** One inline SVG sprite, mounted once in the root layout, referenced by <Icon name="board" />. */
export function IconSprite() {
  return (
    <svg
      width="0"
      height="0"
      style={{ position: 'absolute' }}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: `<defs>${SPRITE_SYMBOLS}</defs>` }}
    />
  );
}

export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ''}`} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
