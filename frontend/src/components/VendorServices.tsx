import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { Loading } from './ui/Feedback';
import RequiredMark from './ui/RequiredMark';
import { useCompletion } from './BusinessSetup';
import {
  PRICING_DESCRIPTION_MAX,
  PRICING_DESCRIPTION_MIN,
  PRICING_LABEL,
  QUOTE_ONLY,
  OfferingErrors,
  catalogStep,
  offeringAmount,
  offeringErrors,
  titleCaseWords,
} from '../lib/catalog-rules';
import ConfirmDialog from './ConfirmDialog';
import DynamicForm, {
  Answers,
  FieldSpec,
  cleanAnswers,
  formatAnswer,
  validateAnswers,
} from './DynamicForm';

interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

interface Definition {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  allowedPricingModels: string[];
  availabilityModel: string;
  packagesAllowed: boolean;
}

interface Offering {
  id: string;
  name: string;
  description: string | null;
  pricingModel: string;
  price: string | null;
  currency: string;
  unitLabel: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  isPackage: boolean;
  inclusions: string[];
  active: boolean;
}

interface VendorService {
  id: string;
  definitionId: string;
  displayName: string | null;
  description: string | null;
  attributes: Answers;
  active: boolean;
  bookable: boolean;
  /** Its category is no longer one the business lists, so it is off sale. */
  outsideSelectedCategories?: boolean;
  definition: Definition | null;
  category: Category | null;
  serviceForm: FieldSpec[];
  bookingForm: FieldSpec[];
  offerings: Offering[];
}

// The labels and the amount wording live in lib/catalog-rules.ts, shared with
// the mobile app; re-exported here for the screens that already import them.
export { PRICING_LABEL };

/** Where a quantity is part of the price rather than decoration. */
const QUANTITY_MODELS = ['per_person', 'per_item', 'per_hour', 'per_day', 'per_session'];

export function priceLabel(
  o: Pick<Offering, 'pricingModel' | 'price' | 'currency' | 'unitLabel'>,
): string {
  return offeringAmount(o);
}

/**
 * What this business sells.
 *
 * Every field on this screen comes from the catalog: which services exist,
 * which questions each one asks, which pricing models it may use, and whether
 * it is sold as a package at all. Nothing here is written per vendor type,
 * which is what lets an administrator add a trade without a deployment.
 */
export default function VendorServices({
  vendorId,
  selectedCategories,
}: {
  vendorId: string;
  selectedCategories: string[];
}) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [pricing, setPricing] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: 'service'; id: string; name: string } | { kind: 'offering'; serviceId: string; id: string; name: string } | null
  >(null);
  const [deleting, setDeleting] = useState(false);

  const { data: services = [], isLoading } = useQuery<VendorService[]>({
    queryKey: ['vendor-services', vendorId],
    queryFn: async () => (await api.get(`/vendors/${vendorId}/services`)).data,
    enabled: Boolean(vendorId),
  });

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError('');
    setNotice('');
    try {
      await fn();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['vendor-services', vendorId] }),
        // The checklist counts services and prices per category, so it is
        // asked again after every change here.
        qc.invalidateQueries({ queryKey: ['business-completion'] }),
      ]);
      setNotice(ok);
      return true;
    } catch (err) {
      setError(apiMessage(err, 'That change was not accepted.'));
      return false;
    }
  }

  /*
   * Every service is listed, including one whose category the business no
   * longer lists. The server takes those off sale; the vendor still has to see
   * them to switch them off or remove them.
   */
  const visibleServices = services;
  const { data: completion } = useCompletion(vendorId);
  const catalog = catalogStep(completion);
  const takenDefinitionIds = useMemo(() => services.map((s) => s.definitionId), [services]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="section-title">Services you offer</h2>
          <p className="text-sm text-gray-600">
            What you sell, what it costs, and the questions clients are asked when they pick a service.
          </p>
        </div>
        <button className="btn" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : 'Add a service'}
        </button>
      </div>

      {error && <p className="alert-critical">{error}</p>}
      {notice && <p className="alert-positive">{notice}</p>}

      {/*
        What is still missing, per category and per service, in the server's
        words: every category the business lists needs a service, and every
        service a live price, before Review & Submit opens.
      */}
      {catalog.issues.length > 0 && (
        <div className="alert-caution" role="status">
          <p className="text-sm font-medium">Still needed before Review &amp; Submit:</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {catalog.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {adding && (
        <AddService
          taken={takenDefinitionIds}
          selectedCategories={selectedCategories}
          onAdd={async (body) => {
            const ok = await act(
              () => api.post(`/vendors/${vendorId}/services`, body),
              'Service added. Give it a price so clients can book it.',
            );
            if (ok) setAdding(false);
          }}
        />
      )}

      {isLoading && <div className="card">
          <Loading rows={2} />
        </div>}
      {!isLoading && visibleServices.length === 0 && !adding && (
        <p className="card text-sm text-gray-400">
          Nothing listed yet. Add a service to start taking requests.
        </p>
      )}

      {visibleServices.map((service) => (
        <div key={service.id} className="card space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="section-title">
                {service.displayName ?? service.definition?.name ?? 'Service'}
              </h3>
              <p className="text-xs text-gray-500">
                {service.category?.name}
                {service.definition ? ` · ${service.definition.name}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-sm px-2 py-1 text-xs ${
                  service.bookable
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-amber-50 text-amber-800'
                }`}
              >
                {service.bookable
                  ? 'Bookable'
                  : !service.active
                    ? 'Switched off'
                    : service.outsideSelectedCategories
                      ? 'Outside your categories'
                      : 'No price published'}
              </span>
              <button
                className="btn-outline"
                onClick={() => setEditing(editing === service.id ? null : service.id)}
              >
                {editing === service.id ? 'Close' : 'Edit'}
              </button>
              <button
                className="btn-outline text-critical-fg"
                onClick={() =>
                  setDeleteTarget({
                    kind: 'service',
                    id: service.id,
                    name: service.displayName ?? service.definition?.name ?? 'this service',
                  })
                }
              >
                Delete
              </button>
              <button
                className="btn-outline"
                onClick={() => setPricing(pricing === service.id ? null : service.id)}
              >
                {pricing === service.id ? 'Close prices' : `Prices (${service.offerings.length})`}
              </button>
              <button
                className="btn-outline"
                onClick={() =>
                  act(
                    () =>
                      api.put(`/vendors/${vendorId}/services/${service.id}`, {
                        definitionId: service.definitionId,
                        active: !service.active,
                      }),
                    service.active ? 'Service switched off.' : 'Service switched on.',
                  )
                }
              >
                {service.active ? 'Switch off' : 'Switch on'}
              </button>
            </div>
          </div>

          {service.outsideSelectedCategories && (
            <p className="rounded-sm bg-amber-50 p-2 text-xs text-amber-800">
              This service is under a category your business no longer lists, so clients cannot
              book it. Add the category back to your business, or switch the service off.
            </p>
          )}
          {service.description && <p className="text-sm text-gray-700">{service.description}</p>}

          {/* The vendor's own answers, read back. */}
          {Object.keys(service.attributes).length > 0 && editing !== service.id && (
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {service.serviceForm
                .filter((f) => service.attributes[f.key] !== undefined)
                .map((f) => (
                  <div key={f.key} className="flex gap-2">
                    <dt className="text-gray-500">{f.label}:</dt>
                    <dd className="font-medium text-gray-800">
                      {formatAnswer(f, service.attributes[f.key])}
                    </dd>
                  </div>
                ))}
            </dl>
          )}

          {editing === service.id && (
            <EditService
              service={service}
              onDelete={() =>
                setDeleteTarget({
                  kind: 'service',
                  id: service.id,
                  name: service.displayName ?? service.definition?.name ?? 'this service',
                })
              }
              onSave={async (body) => {
                const ok = await act(
                  () => api.put(`/vendors/${vendorId}/services/${service.id}`, body),
                  'Service updated.',
                );
                if (ok) setEditing(null);
              }}
            />
          )}

          {pricing === service.id && (
            <Offerings
              vendorId={vendorId}
              service={service}
              onDelete={(offering) =>
                setDeleteTarget({
                  kind: 'offering',
                  serviceId: service.id,
                  id: offering.id,
                  name: offering.name,
                })
              }
              onChanged={(ok) => act(async () => undefined, ok)}
            />
          )}
        </div>
      ))}

      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.kind === 'service' ? 'Delete service?' : 'Delete pricing/package?'}
          body={`Delete "${deleteTarget.name}" permanently? This cannot be undone.`}
          confirmLabel="Delete"
          busy={deleting}
          onDismiss={() => {
            if (!deleting) setDeleteTarget(null);
          }}
          onConfirm={async () => {
            setDeleting(true);
            const target = deleteTarget;
            const ok = await act(
              () =>
                target.kind === 'service'
                  ? api.delete(`/vendors/${vendorId}/services/${target.id}`)
                  : api.delete(
                      `/vendors/${vendorId}/services/${target.serviceId}/offerings/${target.id}`,
                    ),
              target.kind === 'service' ? 'Service deleted.' : 'Pricing/package deleted.',
            );
            setDeleting(false);
            if (ok) {
              setDeleteTarget(null);
              setEditing(null);
              setPricing(null);
            }
          }}
        />
      )}
    </div>
  );
}

function AddService({
  taken,
  selectedCategories,
  onAdd,
}: {
  taken: string[];
  selectedCategories: string[];
  onAdd: (b: unknown) => void;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [definitionId, setDefinitionId] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['catalog-categories'],
    queryFn: async () => (await api.get('/catalog/categories')).data,
  });

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

  function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateAnswers(fields, answers);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onAdd({
      definitionId,
      attributes: cleanAnswers(fields, answers),
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-gray-700">Category</span>
          <select
            className="input mt-1"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setDefinitionId('');
              setAnswers({});
            }}
            required
          >
            <option value="">Choose…</option>
            {availableCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium text-gray-700">Service</span>
          <select
            className="input mt-1"
            value={definitionId}
            onChange={(e) => {
              setDefinitionId(e.target.value);
              setAnswers({});
            }}
            disabled={!categoryId}
            required
          >
            <option value="">Choose…</option>
            {definitions.map((d) => (
              <option key={d.id} value={d.id} disabled={taken.includes(d.id)}>
                {d.name}
                {taken.includes(d.id) ? ': already listed' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {described && (
        <>
          {described.definition.description && (
            <p className="text-sm text-gray-600">{described.definition.description}</p>
          )}
          <DynamicForm fields={fields} answers={answers} errors={errors} onChange={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))} />
          <button className="btn">Add this service</button>
        </>
      )}
    </form>
  );
}

function EditService({
  service,
  onDelete,
  onSave,
}: {
  service: VendorService;
  onDelete: () => void;
  onSave: (b: Record<string, unknown>) => void;
}) {
  const [displayName, setDisplayName] = useState(service.displayName ?? '');
  const [description, setDescription] = useState(service.description ?? '');
  const [answers, setAnswers] = useState<Answers>(service.attributes);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateAnswers(service.serviceForm, answers);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSave({
      definitionId: service.definitionId,
      displayName: displayName.trim(),
      description: description.trim(),
      attributes: cleanAnswers(service.serviceForm, answers),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-gray-700">Your name for it</span>
          <input
            className="input mt-1"
            placeholder={service.definition?.name ?? ''}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="font-medium text-gray-700">Description</span>
        <textarea
          className="input mt-1"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <DynamicForm
        fields={service.serviceForm}
        answers={answers}
        errors={errors}
        onChange={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))}
      />

      <div className="flex flex-wrap gap-2">
        <button className="btn">Save</button>
        <button
          type="button"
          className="btn-outline"
          onClick={onDelete}
        >
          Remove
        </button>
      </div>
    </form>
  );
}

function Offerings({
  vendorId,
  service,
  onDelete,
  onChanged,
}: {
  vendorId: string;
  service: VendorService;
  onDelete: (offering: Offering) => void;
  onChanged: (ok: string) => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const allowed = service.definition?.allowedPricingModels ?? [];

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError('');
    try {
      await fn();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['vendor-services', vendorId] }),
        qc.invalidateQueries({ queryKey: ['business-completion'] }),
      ]);
      onChanged(ok);
      setEditing(null);
    } catch (err) {
      setError(apiMessage(err, 'That price was not accepted.'));
    }
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800">Prices</h4>
        <button className="btn-outline" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
          {editing === 'new' ? 'Cancel' : 'Add a price'}
        </button>
      </div>
      {error && <p className="alert-critical">{error}</p>}

      {editing === 'new' && (
        <OfferingForm
          allowed={allowed}
          packagesAllowed={service.definition?.packagesAllowed ?? true}
          onSave={(body) =>
            act(
              () => api.post(`/vendors/${vendorId}/services/${service.id}/offerings`, body),
              'Price published.',
            )
          }
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="divide-y">
        {service.offerings.map((o) =>
          editing === o.id ? (
            <OfferingForm
              key={o.id}
              existing={o}
              allowed={allowed}
              packagesAllowed={service.definition?.packagesAllowed ?? true}
              onSave={(body) =>
                act(
                  () =>
                    api.put(
                      `/vendors/${vendorId}/services/${service.id}/offerings/${o.id}`,
                      body,
                    ),
                  'Price updated.',
                )
              }
              onCancel={() => setEditing(null)}
              onRemove={() => onDelete(o)}
            />
          ) : (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {o.name}
                  {o.isPackage && (
                    <span className="ml-2 rounded-sm bg-brand/10 px-1.5 py-0.5 text-xs text-brand">
                      Package
                    </span>
                  )}
                  {!o.active && <span className="ml-2 text-xs text-gray-400">Retired</span>}
                </p>
                <p className="text-xs text-gray-500">
                  {priceLabel(o)}
                  {o.minQuantity ? ` · from ${o.minQuantity}` : ''}
                  {o.maxQuantity ? ` up to ${o.maxQuantity}` : ''}
                </p>
                {o.inclusions.length > 0 && (
                  <p className="text-xs text-gray-500">Includes: {o.inclusions.join(', ')}</p>
                )}
                {o.description && <p className="text-xs text-gray-600">{o.description}</p>}
              </div>
              <button className="btn-outline" onClick={() => setEditing(o.id)}>
                Edit
              </button>
              <button className="btn-outline text-critical-fg" onClick={() => onDelete(o)}>
                Delete
              </button>
            </div>
          ),
        )}
        {service.offerings.length === 0 && editing !== 'new' && (
          <p className="py-2 text-sm text-gray-400">
            No prices yet, clients cannot request this service until there is one.
          </p>
        )}
      </div>
    </div>
  );
}

function OfferingForm({
  existing,
  allowed,
  packagesAllowed,
  onSave,
  onCancel,
  onRemove,
}: {
  existing?: Offering;
  allowed: string[];
  packagesAllowed: boolean;
  onSave: (b: Record<string, unknown>) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [model, setModel] = useState(existing?.pricingModel ?? allowed[0] ?? 'fixed');
  const [price, setPrice] = useState(existing?.price ?? '');
  const [unitLabel, setUnitLabel] = useState(existing?.unitLabel ?? '');
  const [minQuantity, setMinQuantity] = useState(existing?.minQuantity?.toString() ?? '');
  const [maxQuantity, setMaxQuantity] = useState(existing?.maxQuantity?.toString() ?? '');
  const [isPackage, setIsPackage] = useState(existing?.isPackage ?? false);
  const [inclusions, setInclusions] = useState((existing?.inclusions ?? []).join(', '));
  const [active, setActive] = useState(existing?.active ?? true);
  const [problem, setProblem] = useState('');
  const [fieldErrors, setFieldErrors] = useState<OfferingErrors>({});

  const quoteOnly = QUOTE_ONLY.includes(model);
  const takesQuantity = QUANTITY_MODELS.includes(model);
  const descriptionLength = description.trim().length;

  function submit(e: FormEvent) {
    e.preventDefault();
    // The server's rules, checked first so each field says what is wrong
    // beside itself: a name that is not blank, an amount above zero, and a
    // 50 to 500 character description.
    const found = offeringErrors({ name, description, pricingModel: model, price });
    setFieldErrors(found);
    if (Object.keys(found).length > 0) {
      setProblem('');
      return;
    }
    if (minQuantity && maxQuantity && Number(minQuantity) > Number(maxQuantity)) {
      setProblem('The minimum is above the maximum.');
      return;
    }
    setProblem('');
    // Title Case on submission ("pre-wedding-shoot" -> "Pre-wedding-shoot"),
    // shown in the field too so the vendor sees what was saved.
    const finalName = titleCaseWords(name);
    setName(finalName);
    onSave({
      name: finalName,
      description: description.trim(),
      pricingModel: model,
      price: quoteOnly ? undefined : String(price),
      unitLabel: unitLabel.trim() || undefined,
      minQuantity: takesQuantity && minQuantity ? Number(minQuantity) : undefined,
      maxQuantity: takesQuantity && maxQuantity ? Number(maxQuantity) : undefined,
      isPackage,
      inclusions: inclusions
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      active,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-sm bg-gray-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-gray-700">
            Pricing name <RequiredMark />
          </span>
          <input
            className="input mt-1"
            placeholder="Full day, two photographers"
            value={name}
            maxLength={140}
            aria-invalid={Boolean(fieldErrors.name)}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setName((v) => titleCaseWords(v))}
          />
          {fieldErrors.name && <span className="mt-1 block text-xs text-red-600">{fieldErrors.name}</span>}
        </label>
        <label className="text-sm">
          <span className="font-medium text-gray-700">How it is priced</span>
          <select className="input mt-1" value={model} onChange={(e) => setModel(e.target.value)}>
            {allowed.map((m) => (
              <option key={m} value={m}>
                {PRICING_LABEL[m] ?? m}
              </option>
            ))}
          </select>
        </label>
        {!quoteOnly && (
          <label className="text-sm">
            <span className="font-medium text-gray-700">
              Pricing amount (INR) <RequiredMark />
            </span>
            <input
              className="input mt-1"
              type="number"
              min={0.01}
              step="0.01"
              value={price}
              aria-invalid={Boolean(fieldErrors.price)}
              onChange={(e) => setPrice(e.target.value)}
            />
            {fieldErrors.price && <span className="mt-1 block text-xs text-red-600">{fieldErrors.price}</span>}
          </label>
        )}
        {!quoteOnly && (
          <label className="text-sm">
            <span className="font-medium text-gray-700">Per what?</span>
            <input
              className="input mt-1"
              placeholder="per plate"
              value={unitLabel}
              onChange={(e) => setUnitLabel(e.target.value)}
            />
          </label>
        )}
        {takesQuantity && (
          <>
            <label className="text-sm">
              <span className="font-medium text-gray-700">Minimum you will take</span>
              <input
                className="input mt-1"
                type="number"
                min={1}
                value={minQuantity}
                onChange={(e) => setMinQuantity(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="font-medium text-gray-700">Maximum</span>
              <input
                className="input mt-1"
                type="number"
                min={1}
                value={maxQuantity}
                onChange={(e) => setMaxQuantity(e.target.value)}
              />
            </label>
          </>
        )}
      </div>

      <label className="block text-sm">
        <span className="font-medium text-gray-700">
          Description <RequiredMark />
        </span>
        <textarea
          className="input mt-1"
          rows={3}
          maxLength={PRICING_DESCRIPTION_MAX}
          placeholder="What the client gets: hours, people, deliverables, anything not included."
          value={description}
          aria-invalid={Boolean(fieldErrors.description)}
          onChange={(e) => setDescription(e.target.value)}
        />
        <span
          className={`mt-1 block text-xs ${
            descriptionLength > 0 && descriptionLength < PRICING_DESCRIPTION_MIN
              ? 'text-amber-700'
              : 'text-gray-500'
          }`}
        >
          {descriptionLength} / {PRICING_DESCRIPTION_MAX} characters, at least {PRICING_DESCRIPTION_MIN}.
        </span>
        {fieldErrors.description && (
          <span className="mt-1 block text-xs text-red-600">{fieldErrors.description}</span>
        )}
      </label>

      {packagesAllowed && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={isPackage}
            onChange={(e) => setIsPackage(e.target.checked)}
          />
          <span className="text-gray-700">This is a package</span>
        </label>
      )}

      {isPackage && (
        <label className="block text-sm">
          <span className="font-medium text-gray-700">What it includes</span>
          <input
            className="input mt-1"
            placeholder="Album, drone coverage, two edits"
            value={inclusions}
            onChange={(e) => setInclusions(e.target.value)}
          />
          <span className="mt-1 block text-xs text-gray-500">Separate each one with a comma.</span>
        </label>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        <span className="text-gray-700">Offer this to clients</span>
      </label>

      {problem && <p className="text-sm text-red-600">{problem}</p>}

      <div className="flex flex-wrap gap-2">
        <button className="btn">{existing ? 'Save' : 'Publish price'}</button>
        <button type="button" className="btn-outline" onClick={onCancel}>
          Cancel
        </button>
        {onRemove && (
          <button
            type="button"
            className="btn-outline"
            onClick={() => {
              if (confirm('Remove this price?')) onRemove();
            }}
          >
            Remove
          </button>
        )}
      </div>
    </form>
  );
}
