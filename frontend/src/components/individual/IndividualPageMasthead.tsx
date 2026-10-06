import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { RomanticPattern } from './RomanticPattern';

export interface IndividualPageMastheadProps {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: { to: string; label: string };
  density?: 'quiet' | 'standard' | 'celebration';
}

/** A consistent, decorative-safe heading for individual-only route content. */
export default function IndividualPageMasthead({
  eyebrow,
  title,
  description,
  action,
  density = 'quiet',
}: IndividualPageMastheadProps): JSX.Element {
  return (
    <section className="individual-masthead" aria-labelledby="individual-page-title">
      <RomanticPattern density={density} />
      <div className="individual-masthead__content">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 id="individual-page-title" className="page-title">
          {title}
        </h1>
        {description && <p className="page-subtitle">{description}</p>}
        {action && (
          <Link className="btn mt-5" to={action.to}>
            {action.label}
          </Link>
        )}
      </div>
    </section>
  );
}
