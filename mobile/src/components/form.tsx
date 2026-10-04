import { useState, useMemo, useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, TextInput } from 'react-native';
import { CalendarBlank, CaretDown, Check, MagnifyingGlass } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MonthCalendar, formatLongDate } from '@/components/calendar';
import { Sheet } from '@/components/sheet';
import { Body, Button, Caption, Field, SectionTitle } from '@/components/ui';
import { radius, rgb, rgba, space, useTheme } from '@/theme';
import { Txt, typeface } from '@/theme/fonts';

/**
 * The form controls the portals need beyond a text field.
 *
 * The web client uses `<select>`, `<input type="date">` and
 * `<input type="time">`, all of which the browser renders natively and none of
 * which exists in React Native. Each is replaced here by the control the
 * platform would have given: a sheet of options, a month grid, a list of times.
 * (`window.prompt` gets the same treatment in components/prompt.tsx.)
 *
 * No new native dependency for any of them. A date or time picker module would
 * mean rebuilding the dev client — this app already carries a config plugin, so
 * it is not an Expo Go build — and a month grid was needed for Availability
 * regardless, so the calendar is reused rather than a second one installed.
 */

// ------------------------------------------------------------------ label --

function Label({ children, required, autoFilled }: { children: string; required?: boolean; autoFilled?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
      <Txt style={{ fontSize: 13, fontWeight: '500', color: rgb(theme.ink[600]) }}>
        {children}
        {required ? <Txt style={{ color: rgb(theme.criticalFg) }}> *</Txt> : null}
      </Txt>
      {autoFilled && (
        <View style={{ backgroundColor: rgb(theme.positiveBg), paddingHorizontal: 6, paddingVertical: 2, borderRadius: 12, flexDirection: 'row', alignItems: 'center' }}>
          <Txt style={{ color: rgb(theme.positiveFg), fontSize: 10, fontWeight: '700' }}>AUTO-FILLED</Txt>
        </View>
      )}
    </View>
  );
}

/**
 * The pressable that looks like an input and opens a sheet.
 *
 * Shared by the select, the date and the time so the three read as one family;
 * a date field that did not match the field above it would look like a bug.
 */
export function Trigger({
  value,
  placeholder,
  invalid,
  disabled,
  onPress,
}: {
  value?: string;
  placeholder: string;
  invalid?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space(2),
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: rgb(invalid ? theme.criticalFg : theme.border),
          backgroundColor: rgb(theme.surface),
          borderRadius: radius.sm,
          paddingHorizontal: space(3),
          paddingVertical: 10,
          minHeight: 48,
        },
        pressed && { backgroundColor: rgb(theme.surfaceSunken) },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Txt
        style={{
          flex: 1,
          fontSize: 16,
          color: rgb(value ? theme.ink[900] : theme.ink[400]),
        }}
        numberOfLines={1}
      >
        {value || placeholder}
      </Txt>
      <CaretDown size={16} color={rgb(theme.ink[400])} />
    </Pressable>
  );
}

export function Wrapper({
  label,
  hint,
  error,
  required,
  autoFilled,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  autoFilled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Label required={required} autoFilled={autoFilled}>{label}</Label>
      {children}
      {error ? <Caption tone="critical">{error}</Caption> : null}
      {hint && !error ? <Caption tone="faint">{hint}</Caption> : null}
    </View>
  );
}

// ----------------------------------------------------------------- select --

export interface Option {
  value: string;
  label: string;
  /** Why this one cannot be chosen — an already-listed service, an officer on
   *  leave. Shown beside the label rather than hiding the row, so somebody
   *  looking for a name finds it and learns why it is unavailable. */
  note?: string;
  disabled?: boolean;
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  hint,
  error,
  disabled,
  required,
  autoFilled,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  autoFilled?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (open) {
      setSearch('');
    }
  }, [open]);

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  return (
    <Wrapper label={label} hint={hint} error={error} required={required} autoFilled={autoFilled}>
      <Trigger
        value={current?.label}
        placeholder={placeholder}
        invalid={Boolean(error)}
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      <Sheet
        visible={open}
        title={`Select ${label}`}
        subtitle={`Choose your ${label.toLowerCase()} from the list.`}
        onClose={() => setOpen(false)}
      >
        {options.length >= 10 && (
          <View style={{ paddingHorizontal: space(4), marginBottom: space(2) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: rgb(theme.surfaceRaised), borderRadius: radius.sm, borderWidth: 1, borderColor: rgb(theme.border), paddingHorizontal: space(3), height: 44 }}>
              <MagnifyingGlass size={18} color={rgb(theme.ink[400])} style={{ marginRight: space(2) }} />
              <TextInput style={{ flex: 1, fontSize: 16, color: rgb(theme.ink[900]) }} placeholder="Search..." placeholderTextColor={rgb(theme.ink[400])} value={search} onChangeText={setSearch} />
            </View>
          </View>
        )}
        <ScrollView style={{ paddingHorizontal: space(4), flexShrink: 1, marginBottom: insets.bottom + space(4) }}>
          {filteredOptions.map((option, i) => {
            const active = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: active, disabled: Boolean(option.disabled) }}
                disabled={option.disabled}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  { flexDirection: 'row', alignItems: 'center', paddingVertical: space(3), paddingHorizontal: space(2), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rgb(theme.border), minHeight: 48, borderRadius: radius.sm },
                  active && { backgroundColor: rgba(theme.brand, 0.08) },
                  pressed && !active && { backgroundColor: rgb(theme.surfaceSunken) },
                  option.disabled && { opacity: 0.45 },
                ]}
              >
                <View style={{ flex: 1, gap: space(0.5) }}>
                  <Body style={{ color: active ? rgb(theme.brandStrong) : rgb(theme.ink[900]) }}>{option.label}</Body>
                  {option.note ? <Caption tone="faint">{option.note}</Caption> : null}
                </View>
                {active ? <Check size={18} weight="bold" color={rgb(theme.brandStrong)} /> : null}
              </Pressable>
            );
          })}
          {filteredOptions.length === 0 && (
            <View style={{ paddingVertical: space(4), alignItems: 'center' }}>
              <Caption tone="faint">No options found.</Caption>
            </View>
          )}
        </ScrollView>
      </Sheet>
    </Wrapper>
  );
}

// ------------------------------------------------------------------- date --

export function DateField({
  label,
  value,
  onChange,
  from,
  to,
  hint,
  error,
  placeholder = 'Pick a date',
}: {
  label: string;
  /** `YYYY-MM-DD`, which is what every one of these endpoints takes. */
  value: string;
  onChange: (value: string) => void;
  from?: string;
  to?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Wrapper label={label} hint={hint} error={error}>
      <Trigger
        value={value ? formatLongDate(value) : undefined}
        placeholder={placeholder}
        invalid={Boolean(error)}
        onPress={() => setOpen(true)}
      />
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <MonthCalendar
          from={from}
          to={to}
          selected={value || undefined}
          onSelect={(date) => {
            onChange(date);
            setOpen(false);
          }}
        />
        {/* Clearing matters on the optional dates — a trading-since or a
            quotation expiry entered by mistake has to be removable. */}
        {value ? (
          <Button
            label="Clear"
            variant="ghost"
            onPress={() => {
              onChange('');
              setOpen(false);
            }}
          />
        ) : null}
      </Sheet>
    </Wrapper>
  );
}

export function formatDobInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function dobInputToIso(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return `${yearText}-${monthText}-${dayText}`;
}

export function isoToDobInput(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

export function adultDobMaxIso(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setFullYear(date.getFullYear() - 18);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateParts(value: string): { year: number; month: number } {
  const iso = dobInputToIso(value);
  if (!iso) {
    const max = adultDobMaxIso();
    return { year: Number(max.slice(0, 4)), month: Number(max.slice(5, 7)) - 1 };
  }
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1 };
}

const DOB_MONTHS = Array.from({ length: 12 }, (_, month) =>
  new Date(2000, month, 1).toLocaleDateString(undefined, { month: 'long' }),
);

export function DobField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'year' | 'month' | 'date'>('year');
  const [selection, setSelection] = useState(() => dateParts(value));
  const maxIso = adultDobMaxIso();
  const maxYear = Number(maxIso.slice(0, 4));
  const years = Array.from({ length: 101 }, (_, index) => maxYear - index);

  function openPicker() {
    setSelection(dateParts(value));
    setStep('year');
    setOpen(true);
  }

  return (
    <Wrapper label={label} error={error}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: rgb(error ? theme.criticalFg : theme.border),
          backgroundColor: rgb(theme.surface),
          borderRadius: radius.sm,
          minHeight: 46,
        }}
      >
        <TextInput
          value={value}
          onChangeText={(text) => onChange(formatDobInput(text))}
          placeholder="DD/MM/YYYY"
          placeholderTextColor={rgb(theme.ink[400])}
          keyboardType="number-pad"
          maxLength={10}
          style={typeface({
            flex: 1,
            paddingHorizontal: space(3),
            paddingVertical: space(3),
            fontSize: 16,
            color: rgb(theme.ink[900]),
          })}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose date of birth from calendar"
          onPress={openPicker}
          style={{ paddingHorizontal: space(3), paddingVertical: space(3) }}
        >
          <CalendarBlank size={20} color={rgb(theme.ink[500])} />
        </Pressable>
      </View>
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        {step === 'year' ? (
          <ScrollView style={{ maxHeight: 360 }}>
            {years.map((year) => (
              <Pressable
                key={year}
                accessibilityRole="button"
                onPress={() => {
                  setSelection((current) => ({ ...current, year }));
                  setStep('month');
                }}
                style={({ pressed }) => [
                  { paddingVertical: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rgb(theme.border) },
                  pressed && { backgroundColor: rgb(theme.surfaceSunken) },
                ]}
              >
                <Body>{year}</Body>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {step === 'month' ? (
          <ScrollView style={{ maxHeight: 360 }}>
            {DOB_MONTHS.map((month, index) => (
              <Pressable
                key={month}
                accessibilityRole="button"
                onPress={() => {
                  setSelection((current) => ({ ...current, month: index }));
                  setStep('date');
                }}
                style={({ pressed }) => [
                  { paddingVertical: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rgb(theme.border) },
                  pressed && { backgroundColor: rgb(theme.surfaceSunken) },
                ]}
              >
                <Body>{month}</Body>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {step === 'date' ? (
          <MonthCalendar
            from="1900-01-01"
            to={maxIso}
            selected={`${selection.year}-${String(selection.month + 1).padStart(2, '0')}-01`}
            onSelect={(iso) => {
              onChange(isoToDobInput(iso));
              setOpen(false);
            }}
            key={`${selection.year}-${selection.month}`}
          />
        ) : null}
      </Sheet>
    </Wrapper>
  );
}

// ------------------------------------------------------------------- time --

/** Half-hour steps across the day, which is how availability windows are sold. */
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2);
  return `${String(hour).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`;
});

/** 14:30 as "2:30 pm", the way a person reads a time back. */
export function readableTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function TimeField({
  label,
  value,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  /** `HH:MM`. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <Wrapper label={label} hint={hint}>
      <Trigger
        value={value ? readableTime(value) : undefined}
        placeholder="Pick a time"
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <ScrollView style={{ maxHeight: 380 }}>
          {TIMES.map((time, i) => {
            const active = time === value;
            return (
              <Pressable
                key={time}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  onChange(time);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: space(3),
                    borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: rgb(theme.border),
                    minHeight: 46,
                  },
                  pressed && { backgroundColor: rgb(theme.surfaceSunken) },
                ]}
              >
                <Body style={{ flex: 1 }}>{readableTime(time)}</Body>
                {active ? <Check size={18} weight="bold" color={rgb(theme.brandStrong)} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Sheet>
    </Wrapper>
  );
}

// --------------------------------------------------------------- textarea --

/**
 * A multi-line field.
 *
 * `textAlignVertical` is what makes Android start the text at the top; without
 * it the first line sits in the middle of an empty box and the field reads as a
 * single-line input that happens to be tall.
 */
export function Textarea({
  label,
  value,
  onChange,
  rows = 4,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: string;
  error?: string;
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <Field
      label={label}
      value={value}
      onChangeText={onChange}
      multiline
      style={{ minHeight: 22 * rows, paddingTop: space(3), textAlignVertical: 'top' }}
      {...rest}
    />
  );
}

// ------------------------------------------------------------- check rows --

/** A checkbox as a whole row, so the label is part of the target. */
export function CheckRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space(3),
          paddingVertical: space(2),
          minHeight: 44,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: checked ? rgb(theme.brand) : 'transparent',
          borderWidth: checked ? 0 : StyleSheet.hairlineWidth,
          borderColor: rgb(theme.borderStrong),
        }}
      >
        {checked ? <Check size={13} weight="bold" color={rgb(theme.brandFg)} /> : null}
      </View>
      <View style={{ flex: 1, gap: space(0.5) }}>
        <Body>{label}</Body>
        {hint ? <Caption tone="faint">{hint}</Caption> : null}
      </View>
    </Pressable>
  );
}
