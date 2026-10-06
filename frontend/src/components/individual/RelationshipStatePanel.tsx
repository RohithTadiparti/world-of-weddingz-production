import { Link } from 'react-router-dom';
import { relationshipPresentation, type RelationshipState } from '../../lib/individual-journey';

export interface RelationshipStatePanelProps {
  state: RelationshipState;
  detail?: string;
  action?: { to: string; label: string };
}

/** A server-state explanation; host pages retain responsibility for permitted actions. */
export default function RelationshipStatePanel({
  state,
  detail,
  action,
}: RelationshipStatePanelProps): JSX.Element {
  const presentation = relationshipPresentation(state);
  const nextAction = action ??
    (presentation.to && presentation.nextAction
      ? { to: presentation.to, label: presentation.nextAction }
      : undefined);

  return (
    <section className="individual-relationship" aria-labelledby="relationship-state-title">
      <p className="eyebrow">Your connection</p>
      <h2 id="relationship-state-title" className="section-title">
        {presentation.label}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-700">{detail ?? presentation.description}</p>
      {nextAction && (
        <Link className="btn-outline btn-sm mt-4" to={nextAction.to}>
          {nextAction.label}
        </Link>
      )}
    </section>
  );
}
