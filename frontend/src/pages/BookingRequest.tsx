import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import RequestDialog from '../components/RequestDialog';
import { EmptyState, Loading } from '../components/ui/Feedback';

/**
 * Check Availability & Request, as a page of its own (row 14).
 *
 * It was a popup over the vendor directory, which squeezed the service, the
 * slots, the requested date and time and the brief into a box. A route gives
 * the whole form the page, and a link a buyer can come back to.
 */
export default function BookingRequest() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const { data: vendor, isLoading, error } = useQuery({
    queryKey: ['vendor', id],
    queryFn: async () =>
      (await api.get(`/vendors/${id}`)).data as {
        id: string;
        name: string;
        category: string | null;
        categories?: string[];
        city?: string;
      },
    enabled: Boolean(id),
    retry: false,
  });

  if (isLoading) return <Loading rows={4} />;
  if (error || !vendor) {
    return (
      <EmptyState title="Vendor unavailable">
        {apiMessage(error, 'This listing may no longer be available.')}
      </EmptyState>
    );
  }

  return (
    <RequestDialog
      vendor={vendor}
      initialDate={params.get('date') ?? undefined}
      onClose={() => navigate(`/vendors/${vendor.id}`)}
    />
  );
}
