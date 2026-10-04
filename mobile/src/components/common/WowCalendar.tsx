import { useState, useMemo, useEffect } from 'react';
import { View, Pressable, StyleSheet, ScrollView, Modal } from 'react-native';
import { X, CaretDown, Check } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Trigger, Wrapper } from '@/components/form';
import { formatLongDate } from '@/components/calendar';
import { Button, SectionTitle } from '@/components/ui';
import { radius, rgb, rgba, space, useTheme } from '@/theme';
import { Txt } from '@/theme/fonts';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function WowCalendar({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  title,
  subtitle,
  hint,
  error,
  placeholder = 'Select date',
  required,
  autoFilled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minimumDate?: string;
  maximumDate?: string;
  title?: string;
  subtitle?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  required?: boolean;
  autoFilled?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<'calendar' | 'month' | 'year'>('calendar');

  const [tempValue, setTempValue] = useState(value);

  const [cursor, setCursor] = useState(() => {
    let anchor = value || maximumDate || minimumDate || new Date().toISOString().split('T')[0];
    return {
      year: Number(anchor.slice(0, 4)),
      month: Number(anchor.slice(5, 7)) - 1
    };
  });

  useEffect(() => {
    if (open) {
      setTempValue(value);
      setViewing('calendar');
      let anchor = value || maximumDate || minimumDate || new Date().toISOString().split('T')[0];
      setCursor({
        year: Number(anchor.slice(0, 4)),
        month: Number(anchor.slice(5, 7)) - 1
      });
    }
  }, [open, value, maximumDate, minimumDate]);

  const maxYear = maximumDate ? Number(maximumDate.slice(0, 4)) : new Date().getFullYear() + 10;
  const minYear = minimumDate ? Number(minimumDate.slice(0, 4)) : new Date().getFullYear() - 100;

  const years = useMemo(() => {
    const y = [];
    for (let i = maxYear; i >= minYear; i--) y.push(i);
    return y;
  }, [maxYear, minYear]);

  const cells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const days = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const firstDay = first.getDay();
    const prevDays = new Date(cursor.year, cursor.month, 0).getDate();

    const arr = [];
    for (let i = 0; i < firstDay; i++) {
      arr.push({ type: 'prev', day: prevDays - firstDay + i + 1, iso: '' });
    }

    for (let d = 1; d <= days; d++) {
      const iso = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      arr.push({ type: 'current', day: d, iso });
    }

    let nextDay = 1;
    while (arr.length % 7 !== 0) {
      arr.push({ type: 'next', day: nextDay++, iso: '' });
    }

    return arr;
  }, [cursor.year, cursor.month]);

  const handleClose = () => setOpen(false);
  const handleSave = () => {
    if (tempValue) {
      onChange(tempValue);
    }
    setOpen(false);
  };

  const todayIso = new Date().toISOString().split('T')[0];

  return (
    <Wrapper label={label} hint={hint} error={error} required={required} autoFilled={autoFilled}>
      <Trigger
        value={value ? formatLongDate(value) : undefined}
        placeholder={placeholder}
        invalid={Boolean(error)}
        onPress={() => setOpen(true)}
      />
      <Modal visible={open} transparent animationType="slide" onRequestClose={handleClose}>
        <View style={{ flex: 1, justifyContent: 'center', backgroundColor: rgba(theme.scrim, 0.45), padding: space(4) }}>
          <View
            style={{
              backgroundColor: rgb(theme.surface),
              borderRadius: radius.lg,
              padding: space(4),
              maxHeight: '95%',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 16,
              elevation: 8,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: space(4) }}>
              <View style={{ flex: 1, paddingRight: space(2) }}>
                <SectionTitle style={{ color: rgb(theme.brandStrong), marginBottom: space(1) }}>{title || `Select ${label}`}</SectionTitle>
                {subtitle ? (
                  <Txt style={{ fontSize: 13, color: rgb(theme.ink[500]) }}>
                    {subtitle}
                  </Txt>
                ) : null}
              </View>
              <Pressable
                onPress={handleClose}
                style={({ pressed }) => [
                  { padding: space(1), borderRadius: radius.sm },
                  pressed && { backgroundColor: rgb(theme.surfaceSunken) },
                ]}
              >
                <X size={24} color={rgb(theme.ink[700])} />
              </Pressable>
            </View>

            <View style={{ marginVertical: space(1) }}>
              {viewing === 'calendar' ? (
                <>
                  <View style={{ flexDirection: 'row', gap: space(2), marginBottom: space(5) }}>
                    <Pressable
                      onPress={() => setViewing('month')}
                      style={{
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingHorizontal: space(3),
                        height: 48,
                        borderWidth: 1,
                        borderColor: rgb(theme.border),
                        borderRadius: radius.md,
                        backgroundColor: rgb(theme.surface),
                      }}
                    >
                      <Txt style={{ fontSize: 15, fontWeight: '500', color: rgb(theme.ink[900]) }}>{MONTHS[cursor.month]}</Txt>
                      <CaretDown size={18} color={rgb(theme.ink[500])} />
                    </Pressable>
                    <Pressable
                      onPress={() => setViewing('year')}
                      style={{
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingHorizontal: space(3),
                        height: 48,
                        borderWidth: 1,
                        borderColor: rgb(theme.border),
                        borderRadius: radius.md,
                        backgroundColor: rgb(theme.surface),
                      }}
                    >
                      <Txt style={{ fontSize: 15, fontWeight: '500', color: rgb(theme.ink[900]) }}>{cursor.year}</Txt>
                      <CaretDown size={18} color={rgb(theme.ink[500])} />
                    </Pressable>
                  </View>

                  <View style={{ flexDirection: 'row', marginBottom: space(3) }}>
                    {WEEKDAYS.map((day) => (
                      <View key={day} style={{ flex: 1, alignItems: 'center' }}>
                        <Txt style={{ fontSize: 11, fontWeight: '700', color: rgb(theme.ink[400]) }}>{day}</Txt>
                      </View>
                    ))}
                  </View>

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {cells.map((cell, i) => {
                      if (cell.type !== 'current') {
                        return (
                          <View key={`adj-${i}`} style={{ width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                            <Txt style={{ fontSize: 14, color: rgb(theme.ink[300]), opacity: 0.5 }}>{cell.day}</Txt>
                          </View>
                        );
                      }
                      const disabled = (maximumDate ? cell.iso > maximumDate : false) || (minimumDate ? cell.iso < minimumDate : false);
                      const isSelected = cell.iso === tempValue;
                      const isToday = cell.iso === todayIso;

                      return (
                        <View key={cell.iso} style={{ width: `${100 / 7}%`, height: 44, padding: 2 }}>
                          <Pressable
                            disabled={disabled}
                            onPress={() => setTempValue(cell.iso)}
                            style={({ pressed }) => [
                              {
                                flex: 1,
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 20,
                              },
                              isSelected && { backgroundColor: rgb(theme.brandStrong) },
                              !isSelected && isToday && { borderWidth: 1, borderColor: rgba(theme.brand, 0.3) },
                              !isSelected && !isToday && pressed && { backgroundColor: rgb(theme.surfaceSunken) },
                              disabled && { opacity: 0.3 },
                            ]}
                          >
                            <Txt
                              style={{
                                fontSize: 14,
                                fontWeight: isSelected ? '700' : '500',
                                color: isSelected ? '#FFFFFF' : rgb(theme.ink[900]),
                              }}
                            >
                              {cell.day}
                            </Txt>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                </>
              ) : viewing === 'month' ? (
                <View style={{ height: 320 }}>
                  <ScrollView showsVerticalScrollIndicator={false}>
                    {MONTHS.map((m, i) => {
                      const isActive = i === cursor.month;
                      return (
                        <Pressable
                          key={m}
                          onPress={() => {
                            setCursor((c) => ({ ...c, month: i }));
                            setViewing('calendar');
                          }}
                          style={({ pressed }) => [
                            {
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              paddingVertical: space(3.5),
                              paddingHorizontal: space(2),
                              borderBottomWidth: StyleSheet.hairlineWidth,
                              borderBottomColor: rgb(theme.border),
                            },
                            isActive && { backgroundColor: rgba(theme.brand, 0.05), borderRadius: radius.sm },
                            pressed && !isActive && { backgroundColor: rgb(theme.surfaceSunken), borderRadius: radius.sm },
                          ]}
                        >
                          <Txt style={{ fontSize: 16, fontWeight: isActive ? '600' : '400', color: isActive ? rgb(theme.brandStrong) : rgb(theme.ink[900]) }}>{m}</Txt>
                          {isActive && <Check size={20} weight="bold" color={rgb(theme.brandStrong)} />}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : (
                <View style={{ height: 320 }}>
                  <ScrollView showsVerticalScrollIndicator={false}>
                    {years.map((y) => {
                      const isActive = y === cursor.year;
                      return (
                        <Pressable
                          key={y}
                          onPress={() => {
                            setCursor((c) => ({ ...c, year: y }));
                            setViewing('calendar');
                          }}
                          style={({ pressed }) => [
                            {
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              paddingVertical: space(3.5),
                              paddingHorizontal: space(2),
                              borderBottomWidth: StyleSheet.hairlineWidth,
                              borderBottomColor: rgb(theme.border),
                            },
                            isActive && { backgroundColor: rgba(theme.brand, 0.05), borderRadius: radius.sm },
                            pressed && !isActive && { backgroundColor: rgb(theme.surfaceSunken), borderRadius: radius.sm },
                          ]}
                        >
                          <Txt style={{ fontSize: 16, fontWeight: isActive ? '600' : '400', color: isActive ? rgb(theme.brandStrong) : rgb(theme.ink[900]) }}>{y}</Txt>
                          {isActive && <Check size={20} weight="bold" color={rgb(theme.brandStrong)} />}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
            </View>

            {viewing === 'calendar' && (
              <View style={{ flexDirection: 'row', gap: space(3), paddingTop: space(4), marginTop: space(4), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: rgb(theme.border) }}>
                <Button label="Cancel" variant="outline" onPress={handleClose} style={{ flex: 1 }} />
                <Button label="Done" onPress={handleSave} style={{ flex: 1 }} disabled={!tempValue} />
              </View>
            )}

            {viewing !== 'calendar' && (
              <View style={{ flexDirection: 'row', gap: space(3), paddingTop: space(4), marginTop: space(4), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: rgb(theme.border) }}>
                <Button label="Back" variant="outline" onPress={() => setViewing('calendar')} style={{ flex: 1 }} />
              </View>
            )}

          </View>
        </View>
      </Modal>
    </Wrapper>
  );
}
