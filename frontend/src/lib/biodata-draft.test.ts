import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, createDraftGuard, loadDraft, saveDraft, submitDraft } from './biodata-draft';

/**
 * A biodata section's local draft is the only copy of what was typed until the
 * server accepts it. The personal section is refused until three photographs
 * are on the profile, and clearing the draft before sending meant that refusal
 * lost every answer the moment the section was closed.
 */
describe('biodata drafts', () => {
  const KEY = 'biodata:p1:personal';

  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the draft when the server refuses the save', async () => {
    saveDraft(KEY, { firstName: 'Bhavana' });

    const ok = await submitDraft(Promise.resolve(false), () => clearDraft(KEY));

    expect(ok).toBe(false);
    expect(loadDraft(KEY)).toEqual({ firstName: 'Bhavana' });
  });

  it('drops the draft once the server has accepted it', async () => {
    saveDraft(KEY, { firstName: 'Bhavana' });

    const ok = await submitDraft(Promise.resolve(true), () => clearDraft(KEY));

    expect(ok).toBe(true);
    expect(loadDraft(KEY)).toBeNull();
  });

  it('does not clear before the answer arrives', async () => {
    saveDraft(KEY, { firstName: 'Bhavana' });
    let accept: (ok: boolean) => void = () => {};
    const pending = submitDraft(
      new Promise<boolean>((resolve) => (accept = resolve)),
      () => clearDraft(KEY),
    );

    expect(loadDraft(KEY)).toEqual({ firstName: 'Bhavana' });
    accept(true);
    await pending;
    expect(loadDraft(KEY)).toBeNull();
  });

  it('never writes a draft for a form nobody has touched', () => {
    const guard = createDraftGuard();

    // First render, before the server has answered: the form holds blanks.
    guard.seeded(false);
    guard.persist(KEY, { rashi: '', star: '' });

    // So when the saved answers arrive there is nothing to shadow them.
    expect(loadDraft(KEY)).toBeNull();
  });

  it('writes once the person edits, through the wrapped setter', () => {
    const guard = createDraftGuard();
    const seen: string[] = [];
    const setRashi = guard.edit((value: string) => void seen.push(value));

    guard.seeded(false);
    setRashi('Tula');
    guard.persist(KEY, { rashi: 'Tula' });

    expect(seen).toEqual(['Tula']);
    expect(loadDraft(KEY)).toEqual({ rashi: 'Tula' });
  });

  it('keeps writing a draft restored from an earlier visit (EZ1-I73)', () => {
    saveDraft(KEY, { rashi: 'Tula' });
    const guard = createDraftGuard();

    guard.seeded(true);
    guard.persist(KEY, { rashi: 'Mesha' });

    expect(loadDraft(KEY)).toEqual({ rashi: 'Mesha' });
  });

  it('stops writing after an accepted save until the next edit', () => {
    const guard = createDraftGuard();
    const setRashi = guard.edit((_value: string) => {});
    setRashi('Tula');
    guard.persist(KEY, { rashi: 'Tula' });

    guard.clear(KEY);
    // The refetched answers re-seed the form; that is not an edit.
    guard.seeded(false);
    guard.persist(KEY, { rashi: 'Tula' });

    expect(loadDraft(KEY)).toBeNull();
  });
});
