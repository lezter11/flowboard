/** The one Flowboard wordmark: pastel gradient text from screens/signin.css (.brand-wordmark). No icon mark. */
export function Wordmark({ className, as: Tag = 'span' }: { className?: string; as?: 'span' | 'h1' | 'div' }) {
  return <Tag className={`brand-name brand-wordmark${className ? ` ${className}` : ''}`}>Flowboard</Tag>;
}
