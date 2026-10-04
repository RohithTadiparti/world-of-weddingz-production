import { useState } from 'react';
import { View } from 'react-native';

import { api } from '@/lib/api';
import { formatAnswer, validateAnswers, cleanAnswers, type Answers } from '@/shared/dynamic-form';
import { Badge, DetailGrid, DetailRow, Divider } from '@/components/chrome';
import { DynamicForm } from '@/components/dynamic-form';
import { Textarea } from '@/components/form';
import { Offerings } from '@/components/business/offerings';
import { PromptSheet } from '@/components/prompt';
import type { VendorService } from '@/components/business/service-types';
import { Alert, Body, Button, Caption, Card, Field, SectionTitle } from '@/components/ui';
import { space } from '@/theme';

/**
 * One service the business sells.
 *
 * The web client renders every service's edit form and every service's prices
 * inline, all expandable at once. Here each card holds three states — read,
 * edit, prices — and only one of them at a time, because a phone showing two
 * open forms is a phone showing neither.
 *
 * `bookable` is the server's own answer and is shown as it comes: a vendor
 * needs to know the difference between a service that is switched off and one
 * that is on but has no published price, because the second looks live from
 * this screen and is invisible to a client.
 */
export function ServiceCard({
  vendorId,
  service,
  onAct,
  onNotice,
}: {
  vendorId: string;
  service: VendorService;
  onAct: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;
  onNotice: (message: string) => void;
}) {
  const [mode, setMode] = useState<'read' | 'edit' | 'prices'>('read');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <Card>
      <View style={{ gap: space(1) }}>
        <SectionTitle numberOfLines={2}>
          {service.displayName ?? service.definition?.name ?? 'Service'}
        </SectionTitle>
        <Caption tone="faint">
          {[service.category?.name, service.definition?.name]
            .filter(Boolean)
            .join(' · ')}
        </Caption>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), alignItems: 'center' }}>
        <Badge tone={service.bookable ? 'positive' : 'caution'}>
          {service.bookable
            ? 'Bookable'
            : !service.active
              ? 'Switched off'
              : service.outsideSelectedCategories
                ? 'Outside your categories'
                : 'No price published'}
        </Badge>
      </View>

      {service.outsideSelectedCategories ? (
        <Alert tone="caution">
          This service is under a category your business no longer lists, so clients cannot book
          it. Add the category back to your business, or switch the service off.
        </Alert>
      ) : null}

      {service.description ? <Body tone="muted">{service.description}</Body> : null}

      {/* The vendor's own answers, read back. */}
      {mode === 'read' && Object.keys(service.attributes).length > 0 && (
        <>
          <Divider />
          <DetailGrid>
            {service.serviceForm
              .filter((f) => service.attributes[f.key] !== undefined)
              .map((f) => (
                <DetailRow key={f.key} label={f.label}>
                  {formatAnswer(f, service.attributes[f.key])}
                </DetailRow>
              ))}
          </DetailGrid>
        </>
      )}

      {mode === 'edit' && (
        <EditService
          service={service}
          onSave={async (body) => {
            const ok = await onAct(
              () => api.put(`/vendors/${vendorId}/services/${service.id}`, body),
              'Service updated.',
            );
            if (ok) setMode('read');
          }}
          onRemove={async () => {
            setConfirmingDelete(true);
          }}
          onCancel={() => setMode('read')}
        />
      )}

      {mode === 'prices' && (
        <Offerings vendorId={vendorId} service={service} onChanged={onNotice} />
      )}

      <Divider />
      <View style={{ gap: space(2) }}>
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          <Button
            label={mode === 'edit' ? 'Close' : 'Edit'}
            variant="outline"
            small
            onPress={() => setMode(mode === 'edit' ? 'read' : 'edit')}
            style={{ flex: 1 }}
          />
          <Button
            label="Delete"
            variant="outline"
            small
            onPress={() => setConfirmingDelete(true)}
            style={{ flex: 1 }}
          />
          <Button
            label={mode === 'prices' ? 'Close prices' : `Prices (${service.offerings.length})`}
            variant="outline"
            small
            onPress={() => setMode(mode === 'prices' ? 'read' : 'prices')}
            style={{ flex: 1 }}
          />
        </View>
        <Button
          label={service.active ? 'Switch off' : 'Switch on'}
          variant="ghost"
          small
          onPress={() =>
            void onAct(
              () =>
                api.put(`/vendors/${vendorId}/services/${service.id}`, {
                  definitionId: service.definitionId,
                  active: !service.active,
                }),
              service.active ? 'Service switched off.' : 'Service switched on.',
            )
          }
        />
      </View>

      <PromptSheet
        visible={confirmingDelete}
        title="Delete service?"
        message={`Delete "${service.displayName ?? service.definition?.name ?? 'this service'}" permanently? This also deletes its prices and cannot be undone.`}
        confirmLabel="Delete"
        input={false}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          void (async () => {
            const ok = await onAct(
              () => api.delete(`/vendors/${vendorId}/services/${service.id}`),
              'Service deleted.',
            );
            if (ok) setMode('read');
            setConfirmingDelete(false);
          })();
        }}
      />
    </Card>
  );
}

function EditService({
  service,
  onSave,
  onRemove,
  onCancel,
}: {
  service: VendorService;
  onSave: (body: Record<string, unknown>) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [displayName, setDisplayName] = useState(service.displayName ?? '');
  const [description, setDescription] = useState(service.description ?? '');
  const [answers, setAnswers] = useState<Answers>(service.attributes);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit() {
    const found = validateAnswers(service.serviceForm, answers);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSave({
      definitionId: service.definitionId,
      displayName: displayName.trim() || null,
      description: description.trim() || null,
      attributes: cleanAnswers(service.serviceForm, answers),
    });
  }

  return (
    <View style={{ gap: space(3) }}>
      <Divider />
      <Field
        label="Your name for it"
        placeholder={service.definition?.name ?? ''}
        value={displayName}
        onChangeText={setDisplayName}
      />
      <Textarea label="Description" value={description} onChange={setDescription} rows={3} />

      <DynamicForm
        fields={service.serviceForm}
        answers={answers}
        errors={errors}
        onChange={(key, value) => setAnswers((a) => ({ ...a, [key]: value }))}
      />

      <Button label="Save" onPress={submit} />
      <View style={{ flexDirection: 'row', gap: space(2) }}>
        <Button label="Cancel" variant="outline" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          label="Delete"
          variant="outline"
          onPress={onRemove}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}
