import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { api, apiMessage } from '@/lib/api';
import { Textarea } from '@/components/form';
import { Alert, Body, Button, Caption, Card, SectionTitle } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';
import { Check } from 'phosphor-react-native';
import { CORRECTABLE_FIELD_KEYS, CORRECTION_FIELD_LABELS } from '@/shared/permissions';

/**
 * The server's own correction keys, so a granted request opens exactly the
 * fields that were ticked. Shared with the web client and checked against the
 * backend list there, so the three cannot drift apart.
 */
const CHANGE_OPTIONS = CORRECTABLE_FIELD_KEYS.map((value) => ({
  value,
  label: CORRECTION_FIELD_LABELS[value],
}));

/**
 * A verified listing's legal details are locked, so a genuine change to one
 * goes through the same correction path an officer uses.
 *
 * The vendor has no endpoint to reopen their own listing — and should not: the
 * point of verification is that they cannot quietly rewrite what was checked.
 * So this raises a `vendor` support case describing the change, and the team
 * then reopens the listing through the existing unlock flow.
 */
export function RequestChange({ vendorId }: { vendorId: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState('');
  const [fields, setFields] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api.post('/verification/cases', {
        subjectType: 'vendor',
        subjectId: vendorId,
        title: 'Change request: verified business details',
        description: detail.trim(),
        // Said explicitly: an ordinary "My business listing" case is also about
        // a vendor, and must not be treated as a request for edit access.
        category: 'business_change',
        requestedFields: fields,
      });
      setNotice('Sent. An administrator will review the request and grant temporary edit access if approved.');
      setDetail('');
      setFields([]);
      setOpen(false);
    } catch (err) {
      setError(apiMessage(err, 'That could not be sent.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: space(2.5) }}>
      <SectionTitle>Request a change</SectionTitle>
      <Body tone="muted">
        PAN, GST, registration and the other verified details are locked. Need one changed?
      </Body>

      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}

      {!open ? (
        <Button label="Request a change" variant="outline" onPress={() => setOpen(true)} />
      ) : (
        <View style={{ gap: space(2.5) }}>
          <View style={{ gap: space(1.5) }}>
            <Caption tone="faint">Details to change</Caption>
            <View style={{ gap: space(1) }}>
              {CHANGE_OPTIONS.map((option) => {
                const selected = fields.includes(option.value);
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    onPress={() =>
                      setFields((current) =>
                        selected
                          ? current.filter((field) => field !== option.value)
                          : [...current, option.value],
                      )
                    }
                    style={({ pressed }) => [
                      styles.checkboxRow,
                      {
                        borderColor: rgb(selected ? theme.brand : theme.border),
                        backgroundColor: rgb(selected ? theme.brandSoft : theme.surface),
                      },
                      pressed && { opacity: 0.75 },
                    ]}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        {
                          borderColor: rgb(selected ? theme.brand : theme.ink[400]),
                          backgroundColor: rgb(selected ? theme.brand : theme.surface),
                        },
                      ]}
                    >
                      {selected ? <Check size={14} color={rgb(theme.brandFg)} weight="bold" /> : null}
                    </View>
                    <Body>{option.label}</Body>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Textarea
            label="Reason for this change"
            value={detail}
            onChange={setDetail}
            rows={4}
            maxLength={2000}
            placeholder="Reason for this change and any information the administrator should review."
          />
          <View style={{ flexDirection: 'row', gap: space(2) }}>
            <Button
              label="Cancel"
              variant="outline"
              onPress={() => {
                setOpen(false);
                setDetail('');
                setFields([]);
              }}
              style={{ flex: 1 }}
            />
            <Button
              label="Send request"
              busy={busy}
              disabled={detail.trim().length < 10 || fields.length === 0}
              onPress={() => void submit()}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  checkboxRow: {
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: space(2),
    minHeight: 48,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
  },
  checkbox: {
    alignItems: 'center',
    borderRadius: 3,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
});
