import { describe, expect, it } from 'vitest';
import { db } from '@invoice-saas/db';
import { generateInvoiceNumber } from './generate-invoice-number';
import { createTestWorkspace } from '../../test/fixtures';

describe('generateInvoiceNumber — concurrency safety', () => {
  it('should produce N unique sequential numbers under concurrent generation for one workspace', async () => {
    const ws = await createTestWorkspace('concurrent@example.com');
    const N = 20;

    // Fire all N concurrently, each in its own transaction — this is the
    // scenario that a read-then-increment race would fail
    // (core-invoicing/design.md's explicit concurrency concern).
    const numbers = await Promise.all(
      Array.from({ length: N }, () => db.transaction((tx) => generateInvoiceNumber(tx, ws.workspaceId))),
    );

    const unique = new Set(numbers);
    expect(unique.size).toBe(N);

    const sequenceNumbers = numbers.map((n) => Number(n.split('-').pop())).sort((a, b) => a - b);
    expect(sequenceNumbers).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  it('should keep separate sequences per workspace', async () => {
    const wsA = await createTestWorkspace('seqA@example.com');
    const wsB = await createTestWorkspace('seqB@example.com');

    const numberA = await db.transaction((tx) => generateInvoiceNumber(tx, wsA.workspaceId));
    const numberB = await db.transaction((tx) => generateInvoiceNumber(tx, wsB.workspaceId));

    expect(numberA.endsWith('-0001')).toBe(true);
    expect(numberB.endsWith('-0001')).toBe(true); // both start at 1 — independent sequences
  });
});
