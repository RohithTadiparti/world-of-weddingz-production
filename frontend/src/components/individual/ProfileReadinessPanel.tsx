import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { readinessPresentation } from '../../lib/individual-journey';

export interface ProfileReadinessPanelProps {
  percent: number;
  missing: string[];
  to: string;
}

/** Explains completion using host-calculated data without deciding eligibility. */
export default function ProfileReadinessPanel({ percent, missing, to }: ProfileReadinessPanelProps): JSX.Element {
  const presentation = readinessPresentation(percent, missing);

  return (
    <section className="individual-readiness" aria-label="Profile readiness">
      <div className="individual-panel__heading">
        <div>
          <p className="eyebrow">Your introduction</p>
          <h2 className="section-title">{presentation.label}</h2>
        </div>
        <span className="individual-readiness__value" aria-hidden="true">
          {presentation.percent}%
        </span>
      </div>
      <div
        className="individual-readiness__track"
        role="progressbar"
        aria-label="Profile completion"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={presentation.percent}
      >
        <span className="individual-readiness__fill" style={{ width: `${presentation.percent}%` }} />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-gray-700">{presentation.description}</p>
      <Link className="btn-outline btn-sm mt-4" to={to}>
        {presentation.nextAction}
      </Link>
    </section>
  );
}
