import Link from 'next/link';
import { Icon } from '@/components/ui/icon';

/**
 * A screen that exists in the prototype but is not wired to the API yet.
 * Uses the prototype's page head and empty-state card so it sits natively in the shell.
 */
export function ComingSoon({ title, eyebrow, description, icon }: { title: string; eyebrow?: string; description: string; icon: string }) {
  return (
    <>
      <div className="page-head portfolio-head">
        <div className="page-head-copy">
          {eyebrow && <p className="portfolio-eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          <p className="page-sub">Coming soon</p>
        </div>
      </div>
      <section className="project-collection" aria-label={`${title} is coming soon`}>
        <div className="ph-empty">
          <span className="ph-empty-mark" aria-hidden="true"><Icon name={icon} /></span>
          <h3>{title} is coming soon</h3>
          <p>{description}</p>
          <Link className="btn" href="/projects">Back to projects</Link>
        </div>
      </section>
    </>
  );
}
