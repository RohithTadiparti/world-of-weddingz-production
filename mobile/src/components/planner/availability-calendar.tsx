import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { CaretLeft, CaretRight } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { formatLongDate, isoDate, todayIso } from '@/components/calendar';
import { Body, Caption } from '@/components/ui';
import {
  DAY_STATUS_LABEL,
  type PlannerDay,
  type PlannerDayStatus,
} from '@/shared/planner-profile';
import { rgb, space, useTheme, type Theme } from '@/theme';
import { Txt } from '@/theme/fonts';

/**
 * A planner's month, as a couple choosing a wedding date reads it.
 *
 * The shared MonthCalendar (components/calendar) is the provider's own
 * editing grid: tinted cells, a year stepper, and no word to its caller about
 * which month is on screen. This one asks the server for exactly the month in
 * view (`/availability/days`), marks each day with a dot rather than a fill so
 * the selected day stays the loudest thing in the grid, and says in words what
 * the picked day means underneath.
 *
 * A day the planner published nothing for is absent from the answer, not a
 * fifth state: it draws plain and reads "Not published", because the planner
 * may well take it and the couple can still ask.
 */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function dayDotColour(theme: Theme, status: PlannerDayStatus): string {
  switch (status) {
    case 'available':
      return rgb(theme.positiveFg);
    case 'limited':
      return rgb(theme.cautionFg);
    case 'booked':
      return rgb(theme.brand);
    default:
      return rgb(theme.ink[400]);
  }
}

const LEGEND: { status: PlannerDayStatus; label: string }[] = [
  { status: 'available', label: 'Available' },
  { status: 'limited', label: 'Limited' },
  { status: 'booked', label: 'Booked' },
  { status: 'unavailable', label: 'Not available' },
];

function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(first.getDay()).fill(null);
  for (let d = 1; d <= days; d += 1) cells.push(isoDate(year, month, d));
  // Padded to whole weeks so the last row's cells keep their width.
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** What the picked day means, in a sentence. */
export function dayStatusText(day: PlannerDay | undefined): string {
  if (!day) return 'Not published, you can still ask.';
  if ((day.status === 'available' || day.status === 'limited') && day.openings > 0) {
    return `${DAY_STATUS_LABEL[day.status]}, ${day.openings} ${day.openings === 1 ? 'opening' : 'openings'} left.`;
  }
  return `${DAY_STATUS_LABEL[day.status]}.`;
}

export function PlannerAvailabilityCalendar({
  plannerId,
  selected,
  onSelect,
}: {
  plannerId: string;
  selected: string;
  onSelect: (date: string) => void;
}) {
  const theme = useTheme();
  const today = todayIso();
  const [cursor, setCursor] = useState(() => {
    const anchor = selected && selected >= today ? selected : today;
    return { year: Number(anchor.slice(0, 4)), month: Number(anchor.slice(5, 7)) - 1 };
  });

  const cells = useMemo(() => monthCells(cursor.year, cursor.month), [cursor]);
  const first = isoDate(cursor.year, cursor.month, 1);
  const last = isoDate(cursor.year, cursor.month, new Date(cursor.year, cursor.month + 1, 0).getDate());
  // Nothing before today is asked for: those days cannot be picked anyway.
  const from = first < today ? today : first;
  const isCurrentMonth = today.slice(0, 7) === first.slice(0, 7);

  const days = useQuery({
    queryKey: ['planner-days', plannerId, from, last],
    queryFn: async () =>
      (
        await api.get(`/wedding-planners/${plannerId}/availability/days`, {
          params: { from, to: last },
        })
      ).data as PlannerDay[],
    enabled: Boolean(plannerId) && from <= last,
    retry: false,
  });

  const byDate = useMemo(() => {
    const map = new Map<string, PlannerDay>();
    for (const d of Array.isArray(days.data) ? days.data : []) map.set(d.date.slice(0, 10), d);
    return map;
  }, [days.data]);

  const step = (by: number) =>
    setCursor((c) => {
      const next = new Date(c.year, c.month + by, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const picked = selected ? byDate.get(selected) : undefined;
  const pickedInView = selected && selected.slice(0, 7) === first.slice(0, 7);

  return (
    <View style={{ gap: space(3) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        <Txt style={{ flex: 1, fontSize: 16, fontWeight: '600', color: rgb(theme.ink[900]) }}>
          {monthLabel}
        </Txt>
        {days.isFetching ? <ActivityIndicator size="small" color={rgb(theme.ink[400])} /> : null}
        <MonthStep label="Previous month" disabled={isCurrentMonth} onPress={() => step(-1)}>
          <CaretLeft size={18} color={rgb(isCurrentMonth ? theme.ink[300] : theme.ink[700])} />
        </MonthStep>
        <MonthStep label="Next month" onPress={() => step(1)}>
          <CaretRight size={18} color={rgb(theme.ink[700])} />
        </MonthStep>
      </View>

      <View style={{ flexDirection: 'row' }}>
        {WEEKDAYS.map((d, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            <Txt style={{ fontSize: 11, fontWeight: '600', color: rgb(theme.ink[400]) }}>{d}</Txt>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((cell, i) => {
          if (!cell) return <View key={`blank-${i}`} style={{ width: `${100 / 7}%`, height: 46 }} />;
          const past = cell < today;
          const day = byDate.get(cell);
          const isSelected = cell === selected;
          const isToday = cell === today;
          return (
            <View key={cell} style={{ width: `${100 / 7}%`, height: 46, padding: 2 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${formatLongDate(cell)}, ${past ? 'past' : dayStatusText(day)}`}
                accessibilityState={{ disabled: past, selected: isSelected }}
                disabled={past}
                onPress={() => onSelect(isSelected ? '' : cell)}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    backgroundColor: isSelected ? rgb(theme.brand) : 'transparent',
                    borderWidth: isToday && !isSelected ? 1 : 0,
                    borderColor: rgb(theme.borderStrong),
                  },
                  past && { opacity: 0.3 },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Txt
                  style={{
                    fontSize: 14,
                    fontWeight: isSelected ? '700' : '500',
                    fontVariant: ['tabular-nums'],
                    color: isSelected ? rgb(theme.brandFg) : rgb(theme.ink[800]),
                  }}
                >
                  {Number(cell.slice(8, 10))}
                </Txt>
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor:
                      day && !past
                        ? isSelected
                          ? rgb(theme.brandFg)
                          : dayDotColour(theme, day.status)
                        : 'transparent',
                  }}
                />
              </Pressable>
            </View>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space(4), rowGap: space(2) }}>
        {LEGEND.map(({ status, label }) => (
          <View key={status} style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dayDotColour(theme, status) }}
            />
            <Caption tone="muted">{label}</Caption>
          </View>
        ))}
      </View>

      {days.error ? (
        <Caption tone="critical">
          {apiMessage(days.error, 'Availability could not be loaded. You can still pick a date and ask.')}
        </Caption>
      ) : null}

      {selected ? (
        <View
          style={{
            padding: space(3),
            gap: space(1),
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: rgb(theme.border),
            backgroundColor: rgb(theme.surfaceSunken),
          }}
        >
          <Body style={{ fontWeight: '600' }}>{formatLongDate(selected)}</Body>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
            {picked ? (
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: dayDotColour(theme, picked.status),
                }}
              />
            ) : null}
            <Caption>
              {pickedInView || picked ? dayStatusText(picked) : 'Selected for your request.'}
            </Caption>
          </View>
        </View>
      ) : (
        <Caption tone="faint">
          Tap a date to see whether the planner is free, and to add it to your request.
        </Caption>
      )}
    </View>
  );
}

function MonthStep({
  label,
  disabled = false,
  onPress,
  children,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: 40,
          height: 40,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: rgb(theme.border),
        },
        pressed && { backgroundColor: rgb(theme.surfaceSunken) },
      ]}
    >
      {children}
    </Pressable>
  );
}
