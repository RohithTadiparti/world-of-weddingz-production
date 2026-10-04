import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { api, apiMessage } from '@/lib/api';
import { cleanAnswers, validateAnswers, type Answers, type FieldSpec } from '@/shared/dynamic-form';
import { InfoNote } from '@/components/chrome';
import { DynamicForm } from '@/components/dynamic-form';
import { SelectField } from '@/components/form';
import { useCatalogCategories } from '@/components/business/category-picker';
import { ServiceCard } from '@/components/business/service-card';
import type { Definition, VendorService } from '@/components/business/service-types';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Field,
  Loading,
  PageSubtitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useBusinesses } from '@/store/business';
import { useActiveListing } from '@/lib/vendor-listing';
import { useCompletion } from '@/components/business/completion';
import { BusinessWizard, WizardNavigation } from '@/components/business/wizard';
import { space } from '@/theme';

/**
 * Catalog & Services — step two of My Business.
 *
 * Every field on this screen comes from the catalog: which services exist,
 * which questions each one asks, which pricing models it may use, and whether
 * it is sold as a package at all. Nothing here is written per vendor type,
 * which is what lets an administrator add a trade without a deployment — and
 * why this screen needed no change when the thirty-five-category catalogue
 * landed.
 *
 * Services and their prices are one step, as they are on the web: they were two
 * and a vendor could finish the first without the second, which produced a
 * service a client could see and could not book.
 */
export default function BusinessServices() {
  const router = useRouter();
  const qc = useQueryClient();
  const { activeId } = useBusinesses();
  const { listing } = useActiveListing(activeId);
  const { data: completion } = useCompletion(activeId);
  const catalogItem = completion?.items.find((item) => /catalog|service/.test(item.key));
  const catalogComplete = Boolean(catalogItem?.complete);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);

  const { data: services = [], isPending } = useQuery<VendorService[]>({
    queryKey: ['vendor-services', activeId],
    queryFn: async () => (await api.get(`/vendors/${activeId}/services`)).data,
    enabled: Boolean(activeId),
  });

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError('');
    setNotice('');
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['vendor-services', activeId] });
      // The set-up checklist counts services, so it has to be asked again.
      await qc.invalidateQueries({ queryKey: ['business-completion'] });
      setNotice(ok);
      return true;
    } catch (err) {
      setError(apiMessage(err, 'That change was not accepted.'));
      return false;
    }
  }

  const selectedCategories = listing?.categories ?? (listing?.category ? [listing.category] : []);
  /*
   * Every service is listed, including one whose category the business no
   * longer lists. The server takes those off sale; the vendor still has to see
   * them to switch them off or remove them.
   */
  const visibleServices = services;
  const taken = useMemo(() => services.map((s) => s.definitionId), [services]);

  if (!activeId) {
    return (
      <Screen>
        <Header />
        <EmptyState title="Create your business listing first">
          Services hang off a listing, so there is nothing to attach them to yet.
        </EmptyState>
      </Screen>
    );
  }

  return (
    <Screen>
      <BusinessWizard step={1} completion={completion} />
      <Header />

      {error ? <Alert tone="critical">{error}</Alert> : null}
      {notice ? <Alert tone="positive">{notice}</Alert> : null}

      <Button
        label={adding ? 'Cancel' : 'Add a service'}
        variant={adding ? 'outline' : 'primary'}
        onPress={() => setAdding(!adding)}
      />

      {adding && (
        <AddService
          vendorId={activeId}
          taken={taken}
          selectedCategories={selectedCategories}
          onAdd={async (body) => {
            const ok = await act(
              () => api.post(`/vendors/${activeId}/services`, body),
              'Service added. Give it a price so clients can book it.',
            );
            if (ok) setAdding(false);
          }}
        />
      )}

      {isPending && <Loading rows={2} />}

      {!isPending && visibleServices.length === 0 && !adding && (
        <EmptyState title="Nothing listed yet">
          Add a service to start taking requests.
        </EmptyState>
      )}

      {visibleServices.map((service) => (
        <ServiceCard
          key={service.id}
          vendorId={activeId}
          service={service}
          onAct={act}
          onNotice={setNotice}
        />
      ))}
      {!catalogComplete ? <Alert tone="caution">{catalogItem?.missing ?? 'Add and price a service before reviewing your listing.'}</Alert> : null}
      <WizardNavigation back={() => router.back()} next={() => router.push('/business-review')} nextLabel="Review & submit" disabled={!catalogComplete} />
    </Screen>
  );
}

function Header() {
  return (
    // The screen's name is in the native header; only the explanation is
    // needed here.
    <View style={{ gap: space(1) }}>
      <PageSubtitle>
        What you sell, what it costs, and the questions clients are asked when they pick a service.
      </PageSubtitle>
    </View>
  );
}

/**
 * Adding a service.
 *
 * Category first, then the service within it, then that service's own
 * questions — each step only asks the server for what the previous answer made
 * relevant, which on a phone connection is the difference between a form that
 * appears and one that is waited for.
 */
function AddService({
  vendorId,
  taken,
  selectedCategories,
  onAdd,
}: {
  vendorId: string;
  taken: string[];
  selectedCategories: string[];
  onAdd: (body: unknown) => void;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [definitionId, setDefinitionId] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: categories = [] } = useCatalogCategories();

  const availableCategories = useMemo(
    // A business with no categories yet (moved over from the single legacy
    // category) has not narrowed anything down, and the server agrees.
    () =>
      selectedCategories.length === 0
        ? categories
        : categories.filter((category) => selectedCategories.includes(category.slug)),
    [categories, selectedCategories],
  );

  useEffect(() => {
    if (categoryId && !availableCategories.some((category) => category.id === categoryId)) {
      setCategoryId('');
      setDefinitionId('');
      setAnswers({});
    }
  }, [availableCategories, categoryId]);

  const { data: definitions = [] } = useQuery<Definition[]>({
    queryKey: ['catalog-definitions', categoryId],
    queryFn: async () => (await api.get(`/catalog/categories/${categoryId}/services`)).data,
    enabled: Boolean(categoryId),
  });

  const { data: described } = useQuery<{ definition: Definition; serviceForm: FieldSpec[] }>({
    queryKey: ['catalog-service', definitionId],
    queryFn: async () => (await api.get(`/catalog/services/${definitionId}`)).data,
    enabled: Boolean(definitionId),
  });

  const fields = described?.serviceForm ?? [];

  function submit() {
    const found = validateAnswers(fields, answers);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onAdd({ definitionId, attributes: cleanAnswers(fields, answers) });
  }

  return (
    <Card style={{ gap: space(3) }}>
      <SectionTitle>Add a service</SectionTitle>

      <SelectField
        label="Category"
        value={categoryId}
        onChange={(value) => {
          setCategoryId(value);
          setDefinitionId('');
          setAnswers({});
        }}
        options={availableCategories.map((c) => ({ value: c.id, label: c.name }))}
      />

      <SelectField
        label="Service"
        value={definitionId}
        disabled={!categoryId}
        onChange={(value) => {
          setDefinitionId(value);
          setAnswers({});
        }}
        options={definitions.map((d) => ({
          value: d.id,
          label: d.name,
          // Listed, marked and refused rather than missing: a vendor looking
          // for a service they already sell needs to see that it is theirs
          // already, not wonder where it went.
          disabled: taken.includes(d.id),
          note: taken.includes(d.id) ? 'Already listed' : undefined,
        }))}
      />

      {described && (
        <>
          {described.definition.description ? (
            <InfoNote>{described.definition.description}</InfoNote>
          ) : null}

          <DynamicForm
            fields={fields}
            answers={answers}
            errors={errors}
            onChange={(key, value) => setAnswers((a) => ({ ...a, [key]: value }))}
          />

          <Button label="Add this service" onPress={submit} />
        </>
      )}

      {!described ? (
        <Body tone="faint">Pick a category and a service to see what it asks for.</Body>
      ) : null}
    </Card>
  );
}
