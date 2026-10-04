/**
 * The mark beside a field a form will not save without.
 *
 * The asterisk is for the eye and is hidden from screen readers, which hear
 * "(required)" instead: a bare "star" read after a label tells nobody anything.
 * Pair it with `aria-required` on the control itself.
 */
export default function RequiredMark() {
  return (
    <>
      <span aria-hidden="true" className="ml-0.5 text-brand">
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

/** The one-line key under a form title that explains the mark. */
export function RequiredNote() {
  return (
    <p className="text-xs text-gray-500">
      Fields marked{' '}
      <span aria-hidden="true" className="text-brand">
        *
      </span>
      <span className="sr-only">with an asterisk</span> are required.
    </p>
  );
}
