import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { RomanticPattern } from './RomanticPattern';

export interface FutureWeddingPanelProps {
  enabled: boolean;
  to: string;
  title: string;
  description: string;
}

/** A permission-aware planning invitation. Disabled states never expose a link. */
export default function FutureWeddingPanel({
  enabled,
  to,
  title,
  description,
}: FutureWeddingPanelProps): JSX.Element {
  return (
    <section className="individual-future-wedding" aria-labelledby="future-wedding-title">
      {enabled && <RomanticPattern density="celebration" />}
      <div className="individual-future-wedding__content">
        <p className="eyebrow">A shared future</p>
        <h2 id="future-wedding-title" className="section-title">
          {title}
        </h2>
        <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-gray-700">{description}</p>
        {enabled ? (
          <Link className="btn mt-4" to={to}>
            Begin planning together
          </Link>
        ) : (
          <p className="mt-4 text-xs font-medium uppercase tracking-[0.16em] text-gray-500">Available after your match is fixed</p>
        )}
      </div>
    </section>
  );
}
