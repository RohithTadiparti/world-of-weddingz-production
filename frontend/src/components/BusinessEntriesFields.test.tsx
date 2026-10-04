import { Children, isValidElement, ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import BusinessEntriesFields from './BusinessEntriesFields';
import { readBusinessEntries } from '../lib/business-entries';

function elements(node: ReactNode): ReactElement[] {
  return Children.toArray(node).flatMap((child) => isValidElement(child)
    ? [child, ...elements(child.props.children)] : []);
}

describe('Business Entries shared by Individual and Agent Biodata', () => {
  const entries = [
    { id: 'first', businessName: 'Store', businessIncome: '0' },
    { id: 'second', businessName: 'Farm', businessIncome: '200000' },
    { id: 'third', businessName: 'Studio', businessIncome: '300000' },
  ];

  it('edits and removes only the selected business', () => {
    const onChange = vi.fn();
    const nodes = elements(BusinessEntriesFields({ entries, onChange }));
    nodes.find((node) => node.props.id === 'business-second-businessName')!
      .props.onChange({ target: { value: 'Updated farm' } });
    expect(onChange).toHaveBeenLastCalledWith([entries[0], { ...entries[1], businessName: 'Updated farm' }, entries[2]]);
    const remove = nodes.filter((node) => node.type === 'button' && node.props.children[0] === 'Remove');
    remove[1].props.onClick();
    expect(onChange).toHaveBeenLastCalledWith([entries[0], entries[2]]);
    expect(entries[1].businessName).toBe('Farm');
  });

  it('adds a new independent entry without changing existing records', () => {
    const onChange = vi.fn();
    const nodes = elements(BusinessEntriesFields({ entries, onChange }));
    nodes.find((node) => node.props.children === 'Add Another Business')!.props.onClick();
    const added = onChange.mock.calls[0][0];
    expect(added.slice(0, 3)).toEqual(entries);
    expect(added[3]).toMatchObject({ businessName: '', businessType: '', businessLocation: '', businessIncome: '' });
    expect(added[3].id).toEqual(expect.any(String));
    expect(new Set(added.map((entry: { id: string }) => entry.id)).size).toBe(4);
  });

  it('reads legacy records and reloaded arrays without losing zero income', () => {
    const legacy = { businessName: 'Store', businessIncome: 0 };
    expect(readBusinessEntries(legacy)).toEqual([legacy]);
    expect(readBusinessEntries(JSON.parse(JSON.stringify({ ...legacy, entries })))).toEqual(entries);
    expect(readBusinessEntries({})).toEqual([]);
    expect(readBusinessEntries({ ...legacy, entries: [] })).toEqual([]);
  });
});
