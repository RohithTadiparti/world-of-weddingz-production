import type { ReactNode } from 'react';
import { Loading } from '../../ui/Feedback';
import { apiMessage } from '../../../lib/api-errors';
import { httpStatus } from '../../../lib/infrastructure';

/**
 * Loading, refused and failed, said the same way in every Infrastructure
 * section. A section with no data never falls through to its "healthy" body:
 * it says why it has nothing to show.
 */
export function SectionState({
  label,
  isLoading,
  error,
  onRetry,
  children,
}: {
  label: string;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (error) {
    if (httpStatus(error) === 403) {
      return (
        <div className="alert-critical" role="alert" data-state="forbidden">
          Your account does not have permission to read {label}. It needs admin:infrastructure:read.
        </div>
      );
    }
    return (
      <div className="alert-critical flex-wrap justify-between" role="alert" data-state="error">
        <span>
          {label.charAt(0).toUpperCase() + label.slice(1)} could not be loaded: {apiMessage(error, 'the server did not answer.')}{' '}
          Nothing on this panel should be read as healthy.
        </span>
        <button type="button" className="btn-outline btn-sm" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div data-state="loading">
        <Loading rows={3} />
      </div>
    );
  }
  return <>{children}</>;
}
