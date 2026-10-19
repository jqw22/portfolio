import { describe, expect, it } from 'vitest';

import {
  chartData,
  localDate,
  mergeSnapshots,
  NO_ACCOUNT,
  parseSnapshots,
  renameSnapshotAccount,
  upsertSnapshot,
  type Snapshot,
} from '@/lib/snapshots';

function snap(date: string, values: Record<string, number>, takenAt = 1, currency = 'GBP'): Snapshot {
  return { date, currency, values, takenAt };
}

describe('localDate', () => {
  it('formats the local calendar day', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('upsertSnapshot', () => {
  it('adds a new day in date order', () => {
    const list = [snap('2026-10-19', { ISA: 100 })];
    expect(upsertSnapshot(list, snap('2026-10-18', { ISA: 90 })).map((entry) => entry.date)).toEqual([
      '2026-10-18',
      '2026-10-19',
    ]);
  });

  it('replaces the same day only when the values change', () => {
    const list = [snap('2026-10-19', { ISA: 100 })];
    expect(upsertSnapshot(list, snap('2026-10-19', { ISA: 100 }, 5))).toBe(list);
    expect(upsertSnapshot(list, snap('2026-10-19', { ISA: 120 }, 5))).toEqual([snap('2026-10-19', { ISA: 120 }, 5)]);
  });
});

describe('mergeSnapshots', () => {
  it('keeps every day and the later copy of a shared day', () => {
    const local = [snap('2026-10-18', { ISA: 90 }, 1), snap('2026-10-19', { ISA: 120 }, 9)];
    const remote = [snap('2026-10-17', { ISA: 80 }, 1), snap('2026-10-19', { ISA: 100 }, 5)];
    expect(mergeSnapshots(local, remote)).toEqual([
      snap('2026-10-17', { ISA: 80 }, 1),
      snap('2026-10-18', { ISA: 90 }, 1),
      snap('2026-10-19', { ISA: 120 }, 9),
    ]);
  });
});

describe('renameSnapshotAccount', () => {
  it('renames the account in every snapshot', () => {
    const list = [snap('2026-10-18', { isa: 90, GIA: 10 }), snap('2026-10-19', { GIA: 12 })];
    expect(renameSnapshotAccount(list, 'ISA', 'Stocks ISA')).toEqual([
      snap('2026-10-18', { GIA: 10, 'Stocks ISA': 90 }),
      snap('2026-10-19', { GIA: 12 }),
    ]);
  });
});

describe('parseSnapshots', () => {
  it('drops malformed entries', () => {
    const json = {
      version: 1,
      snapshots: [
        { date: '2026-10-19', currency: 'GBP', values: { ISA: 100, Bad: 'x' }, takenAt: 3 },
        { date: '19/10/2026', currency: 'GBP', values: {} },
        { date: '2026-10-18', values: { ISA: 1 } },
        null,
      ],
    };
    expect(parseSnapshots(json)).toEqual([snap('2026-10-19', { ISA: 100 }, 3)]);
    expect(parseSnapshots('nope')).toEqual([]);
  });
});

describe('chartData', () => {
  it('keeps the last 12 months in the current currency, accounts in ledger order', () => {
    const list = [
      snap('2025-10-01', { ISA: 1 }),
      snap('2026-01-10', { ISA: 100, [NO_ACCOUNT]: 5 }),
      snap('2026-05-01', { ISA: 999 }, 1, 'USD'),
      snap('2026-10-19', { GIA: 50, ISA: 120, Old: 7 }),
    ];
    const data = chartData(list, 'GBP', ['GIA', 'ISA'], '2026-10-19');
    expect(data.accounts).toEqual(['GIA', 'ISA', 'Old', NO_ACCOUNT]);
    expect(data.rows).toEqual([
      { date: '2026-01-10', values: [null, 100, null, 5], total: 105 },
      { date: '2026-10-19', values: [50, 120, 7, null], total: 177 },
    ]);
  });
});
