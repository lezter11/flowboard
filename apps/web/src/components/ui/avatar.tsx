import { initials, toneFor } from '@/lib/people';

export function Avatar({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <span className={`avatar ${toneFor(id)}${className ? ` ${className}` : ''}`} title={name} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
