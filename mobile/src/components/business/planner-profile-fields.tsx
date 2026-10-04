import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Divider } from '@/components/chrome';
import { DateField, Textarea } from '@/components/form';
import { MediaStrip, PhotoPicker } from '@/components/uploader';
import { Body, Button, Caption, Card, Field, SectionTitle } from '@/components/ui';
import {
  MAX_PLANNER_WEDDINGS,
  MAX_WEDDING_EVENTS,
  MAX_WEDDING_PHOTOS,
  MAX_WEDDING_VIDEOS,
  type PlannerWedding,
} from '@/shared/planner-profile';
import { radius, rgb, space, useTheme } from '@/theme';
import { Txt } from '@/theme/fonts';

/**
 * The public-profile parts of the planner's listing that are more than a text
 * field: toggle chips for services and specialisations, and the "Previous
 * weddings" editor.
 *
 * The web form's editor, simplified for a phone. A wedding here carries its
 * couple, place, date, a few words, photographs, video links and events by
 * name and date. What only the web form edits (the chosen cover, an event's
 * description) is carried through untouched, so saving from the phone never
 * wipes what was written on the web.
 */

/** An https link, which is all the server stores for a video. */
export const HTTPS_URL = /^https:\/\/[^\s/$.?#][^\s]*$/i;

/** A set of keys picked from a fixed list, as chips that wrap. */
export function ToggleChips({
  options,
  value,
  onChange,
}: {
  options: readonly { key: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
      {options.map((option) => {
        const on = value.includes(option.key);
        return (
          <Pressable
            key={option.key}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() =>
              onChange(on ? value.filter((k) => k !== option.key) : [...value, option.key])
            }
            style={({ pressed }) => [
              {
                borderRadius: radius.md,
                paddingHorizontal: space(3),
                minHeight: 34,
                justifyContent: 'center',
                backgroundColor: on ? rgb(theme.brand) : rgb(theme.surfaceSunken),
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: on ? rgb(theme.brand) : rgb(theme.border),
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Txt
              style={{
                fontSize: 13,
                fontWeight: on ? '600' : '500',
                color: on ? rgb(theme.brandFg) : rgb(theme.ink[700]),
              }}
            >
              {option.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A wedding as the form holds it. `id` is the server's, on saved weddings
 * only, and goes back on the save so the server keeps the same wedding.
 */
export interface WeddingDraft {
  id?: string;
  key: string;
  title: string;
  location: string;
  date: string;
  description: string;
  coverUrl: string | null;
  photos: string[];
  videos: string[];
  events: { name: string; date: string; description: string | null }[];
}

let draftCounter = 0;
const nextKey = () => `draft-${++draftCounter}`;
const dayOf = (d?: string | null) => (d ? d.slice(0, 10) : '');

export function toWeddingDrafts(weddings?: PlannerWedding[] | null): WeddingDraft[] {
  return (weddings ?? []).map((w) => ({
    id: w.id,
    key: w.id || nextKey(),
    title: w.title ?? '',
    location: w.location ?? '',
    date: dayOf(w.date),
    description: w.description ?? '',
    coverUrl: w.coverUrl ?? null,
    photos: w.photos ?? [],
    videos: w.videos ?? [],
    events: (w.events ?? []).map((e) => ({
      name: e.name ?? '',
      date: dayOf(e.date),
      description: e.description ?? null,
    })),
  }));
}

const blankWedding = (): WeddingDraft => ({
  key: nextKey(),
  title: '',
  location: '',
  date: '',
  description: '',
  coverUrl: null,
  photos: [],
  videos: [],
  events: [],
});

/** The weddings as the PUT expects them; blanks as null so a cleared field clears. */
export function weddingsPayload(drafts: WeddingDraft[]) {
  const orNull = (s: string) => (s.trim() ? s.trim() : null);
  return drafts.map((w) => ({
    ...(w.id ? { id: w.id } : {}),
    title: w.title.trim(),
    location: orNull(w.location),
    date: orNull(w.date),
    description: orNull(w.description),
    // A cover that is no longer among the photos would point at nothing.
    coverUrl: w.coverUrl && w.photos.includes(w.coverUrl) ? w.coverUrl : null,
    photos: w.photos,
    videos: w.videos.map((v) => v.trim()).filter(Boolean),
    events: w.events
      .filter((e) => e.name.trim())
      .map((e) => ({ name: e.name.trim(), date: orNull(e.date), description: e.description })),
  }));
}

/** What is wrong with the weddings, or null when they can be saved. */
export function weddingsError(drafts: WeddingDraft[]): string | null {
  for (const [i, w] of drafts.entries()) {
    const which = w.title.trim() || `Wedding ${i + 1}`;
    const len = w.title.trim().length;
    if (len < 2 || len > 120) return `${which}: give the couple's names (2 to 120 characters).`;
    if (w.videos.some((v) => v.trim() && !HTTPS_URL.test(v.trim()))) {
      return `${which}: video links must start with https://.`;
    }
  }
  return null;
}

function move<T>(list: T[], i: number, by: number): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** "Previous weddings": one card per wedding, added, removed and reordered here. */
export function WeddingsEditor({
  value,
  onChange,
  error,
}: {
  value: WeddingDraft[];
  onChange: (next: WeddingDraft[]) => void;
  error?: string;
}) {
  const update = (i: number, patch: Partial<WeddingDraft>) =>
    onChange(value.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  return (
    <Card>
      <SectionTitle>Previous weddings</SectionTitle>
      <Body tone="muted">
        Each wedding gets its own page on your profile. The first one here shows first.
      </Body>
      {value.length === 0 ? <Caption tone="faint">No weddings yet.</Caption> : null}
      {value.map((w, i) => (
        <View key={w.key} style={{ gap: space(3) }}>
          <Divider />
          <WeddingForm
            wedding={w}
            index={i}
            count={value.length}
            onChange={(patch) => update(i, patch)}
            onMove={(by) => onChange(move(value, i, by))}
            onRemove={() => onChange(value.filter((_, j) => j !== i))}
          />
        </View>
      ))}
      {error ? <Caption tone="critical">{error}</Caption> : null}
      <Divider />
      <Button
        label="Add a wedding"
        variant="outline"
        small
        disabled={value.length >= MAX_PLANNER_WEDDINGS}
        onPress={() => onChange([...value, blankWedding()])}
      />
    </Card>
  );
}

function WeddingForm({
  wedding: w,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  wedding: WeddingDraft;
  index: number;
  count: number;
  onChange: (patch: Partial<WeddingDraft>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const [videoDraft, setVideoDraft] = useState('');
  const [eventDraft, setEventDraft] = useState({ name: '', date: '' });
  const videoOk = HTTPS_URL.test(videoDraft.trim());

  return (
    <View style={{ gap: space(3) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        <Body style={{ flex: 1, fontWeight: '600' }}>{w.title.trim() || `Wedding ${index + 1}`}</Body>
        <Button label="Up" variant="ghost" small disabled={index === 0} onPress={() => onMove(-1)} />
        <Button
          label="Down"
          variant="ghost"
          small
          disabled={index === count - 1}
          onPress={() => onMove(1)}
        />
      </View>
      <Field
        label="Couple"
        placeholder="Rahul & Priya"
        value={w.title}
        onChangeText={(title) => onChange({ title })}
        autoCapitalize="words"
        maxLength={120}
      />
      <Field
        label="Location"
        value={w.location}
        onChangeText={(location) => onChange({ location })}
        autoCapitalize="words"
        maxLength={120}
      />
      <DateField label="Date" value={w.date} onChange={(date) => onChange({ date })} />
      <Textarea
        label="About this wedding"
        value={w.description}
        onChange={(description) => onChange({ description })}
        rows={3}
        maxLength={2000}
      />

      <Caption>Photos</Caption>
      <MediaStrip
        urls={w.photos}
        onRemove={(url) => onChange({ photos: w.photos.filter((u) => u !== url) })}
      />
      {w.photos.length < MAX_WEDDING_PHOTOS ? (
        <PhotoPicker label="Add photos" onUploaded={(url) => onChange({ photos: [...w.photos, url] })} />
      ) : null}

      <Caption>Video links</Caption>
      {w.videos.map((v, j) => (
        <View key={`${v}-${j}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <Body style={{ flex: 1 }} numberOfLines={1}>
            {v}
          </Body>
          <Button
            label="Remove"
            variant="ghost"
            small
            onPress={() => onChange({ videos: w.videos.filter((_, k) => k !== j) })}
          />
        </View>
      ))}
      {w.videos.length < MAX_WEDDING_VIDEOS ? (
        <>
          <Field
            label="Video link"
            placeholder="https://www.youtube.com/watch?v=..."
            value={videoDraft}
            onChangeText={setVideoDraft}
            error={videoDraft.trim() && !videoOk ? 'A video link must start with https://' : undefined}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button
            label="Add the video"
            variant="outline"
            small
            disabled={!videoOk}
            onPress={() => {
              onChange({ videos: [...w.videos, videoDraft.trim()] });
              setVideoDraft('');
            }}
          />
        </>
      ) : null}

      <Caption>Events</Caption>
      {w.events.map((ev, j) => (
        <View key={`${ev.name}-${j}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <Body style={{ flex: 1 }}>
            {ev.name}
            {ev.date ? `, ${ev.date}` : ''}
          </Body>
          <Button
            label="Remove"
            variant="ghost"
            small
            onPress={() => onChange({ events: w.events.filter((_, k) => k !== j) })}
          />
        </View>
      ))}
      {w.events.length < MAX_WEDDING_EVENTS ? (
        <>
          <Field
            label="Event name"
            placeholder="Haldi"
            value={eventDraft.name}
            onChangeText={(name) => setEventDraft((d) => ({ ...d, name }))}
            autoCapitalize="words"
            maxLength={80}
          />
          <DateField
            label="Event date"
            value={eventDraft.date}
            onChange={(date) => setEventDraft((d) => ({ ...d, date }))}
          />
          <Button
            label="Add the event"
            variant="outline"
            small
            disabled={!eventDraft.name.trim()}
            onPress={() => {
              onChange({
                events: [...w.events, { name: eventDraft.name.trim(), date: eventDraft.date, description: null }],
              });
              setEventDraft({ name: '', date: '' });
            }}
          />
        </>
      ) : null}

      <Button label="Remove this wedding" variant="ghost" small onPress={onRemove} />
    </View>
  );
}
