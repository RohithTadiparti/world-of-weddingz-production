import { plannerServiceLabel } from '../lib/planner-profile';

/**
 * The services a couple ticked when they asked a planner, as chips.
 *
 * Shown to both sides of the booking: the planner reads it as the brief, the
 * couple as a record of what they asked for. Renders nothing for a request
 * without any, which is every vendor booking and older planner ones.
 */
export default function RequestedServices({
  services,
  className = '',
}: {
  services?: string[] | null;
  className?: string;
}) {
  if (!services || services.length === 0) return null;
  return (
    <div className={className}>
      <p className="text-xs text-gray-400">Requested services</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {services.map((key) => (
          <span key={key} className="pill-brand">
            {plannerServiceLabel(key)}
          </span>
        ))}
      </div>
    </div>
  );
}
