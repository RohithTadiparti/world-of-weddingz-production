import { View } from 'react-native';
import { CheckCircle, CircleIcon, Warning } from 'phosphor-react-native';

import type { Completion } from '@/components/business/completion';
import { Body, Button as ButtonProxy, Caption, Card } from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

export const BUSINESS_WIZARD_STEPS = [
  { key: 'details', label: 'Business details', route: '/business-details' },
  { key: 'catalog', label: 'Catalog & services', route: '/business-services' },
  { key: 'review', label: 'Review & submit', route: '/business-review' },
] as const;

function complete(completion: Completion | undefined, key: string) {
  const items = completion?.items ?? [];
  if (key === 'details') return items.some((i) => /identity|business/.test(i.key) && i.complete);
  if (key === 'catalog') return items.some((i) => /catalog|service/.test(i.key) && i.complete);
  return Boolean(completion?.canSubmit);
}

/** Shared mobile wizard header: progress is derived from the server checklist. */
export function BusinessWizard({ step, completion }: { step: number; completion?: Completion }) {
  const theme = useTheme();
  return (
    <Card style={{ gap: space(2), paddingVertical: space(2.5) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Body>Step {step + 1} of {BUSINESS_WIZARD_STEPS.length}</Body>
        <Caption>{BUSINESS_WIZARD_STEPS[step].label}</Caption>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={`Step ${step + 1} of ${BUSINESS_WIZARD_STEPS.length}`}>
        {BUSINESS_WIZARD_STEPS.map((item, i) => {
          const done = complete(completion, item.key);
          const current = i === step;
          return (
            <View key={item.key} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
              {done ? <CheckCircle size={18} weight="fill" color={rgb(theme.positiveFg)} /> : current ? <Warning size={18} weight="fill" color={rgb(theme.cautionFg)} /> : <CircleIcon size={18} color={rgb(theme.ink[300])} />}
              {i < BUSINESS_WIZARD_STEPS.length - 1 ? <View style={{ flex: 1, height: 2, marginHorizontal: space(1), backgroundColor: rgb(done ? theme.positiveFg : theme.border) }} /> : null}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

export function WizardNavigation({ back, next, nextLabel = 'Next', disabled = false }: { back?: () => void; next?: () => void; nextLabel?: string; disabled?: boolean }) {
  return <View style={{ flexDirection: 'row', gap: space(2) }}>{back ? <View style={{ flex: 1 }}><ButtonProxy label="Back" onPress={back} /></View> : null}{next ? <View style={{ flex: 1 }}><ButtonProxy label={nextLabel} onPress={next} disabled={disabled} /></View> : null}</View>;
}
