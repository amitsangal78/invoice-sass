import { describe, expect, it } from 'vitest';
import {
  canRenewLink,
  isStaffSessionActive,
  loginInput,
  policy,
  signupInput,
  roundMoney,
  calculateLine,
  calculateInvoiceTotals,
  calculateCollectible,
  calculateOutstanding,
} from './index';

describe('agreed access boundaries', () => {
  const now = new Date('2026-11-08T10:00:00Z');

  it('verifies policy constants', () => {
    expect(policy.customerSessionMs).toBe(15 * 60 * 1000);
    expect(policy.invoiceLinkMs).toBe(5 * 24 * 60 * 60 * 1000);
    expect(policy.otpMs).toBe(5 * 60 * 1000);
    expect(policy.activeCreators).toBe(5);
    expect(policy.existingCreators).toBe(15);
    expect(policy.monthlyInvoices).toBe(10);
    expect(policy.refundsEnabled).toBe(false);
  });

  it('handles link renewal logic', () => {
    expect(canRenewLink(new Date(now.getTime() + 1), now)).toBe(false);
    expect(canRenewLink(now, now)).toBe(true);
  });

  it('ends staff sessions at idle and absolute expiry and after revocation', () => {
    const active = {
      expires_at: new Date(now.getTime() + 1),
      last_seen_at: new Date(now.getTime() - policy.staffIdleMs + 1),
      revoked_at: null,
    };
    expect(isStaffSessionActive(active, now)).toBe(true);
    expect(isStaffSessionActive({ ...active, last_seen_at: new Date(now.getTime() - policy.staffIdleMs) }, now)).toBe(false);
    expect(isStaffSessionActive({ ...active, expires_at: now }, now)).toBe(false);
    expect(isStaffSessionActive({ ...active, revoked_at: now }, now)).toBe(false);
  });

  it('rejects tenant/role injection and invalid transport types', () => {
    expect(signupInput.safeParse({ email: 'owner@example.com', password: 'long-test-password', role: 'PLATFORM_OWNER' }).success).toBe(false);
    expect(loginInput.safeParse({ email: 'owner@example.com', password: 'x', client_type: 'ADMIN' }).success).toBe(false);
  });
});

describe('calculation engine and money rules', () => {
  it('rounds money accurately to 2 decimal places', () => {
    expect(roundMoney(10.255)).toBe(10.26);
    expect(roundMoney(10.254)).toBe(10.25);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it('calculates line item without overrides for Creator', () => {
    const item = {
      id: 'item-1',
      name: 'Consulting',
      unit: 'hours',
      unit_price: 1000,
      tax_components: [{ name: 'GST', rate: 18 }],
    };
    // Creator cannot override unit price or discounts
    const calculated = calculateLine(item, { quantity: 2, unit_price: 500, discount_amount: 100 }, 1, false);
    expect(calculated.unit_price).toBe(1000);
    expect(calculated.discount_amount).toBe(0);
    expect(calculated.taxable_amount).toBe(2000);
    expect(calculated.tax_amount).toBe(360);
    expect(calculated.line_total).toBe(2360);
  });

  it('allows Owner to override line price', () => {
    const item = {
      id: 'item-1',
      name: 'Consulting',
      unit: 'hours',
      unit_price: 1000,
      tax_components: [{ name: 'GST', rate: 18 }],
    };
    const calculated = calculateLine(item, { quantity: 2, unit_price: 1500 }, 1, true);
    expect(calculated.unit_price).toBe(1500);
    expect(calculated.taxable_amount).toBe(3000);
    expect(calculated.tax_amount).toBe(540);
    expect(calculated.line_total).toBe(3540);
  });

  it('calculates invoice totals and rounding adjustment', () => {
    const line1 = {
      catalogue_item_id: 'i1',
      line_no: 1,
      description: 'Item 1',
      unit: 'qty',
      quantity: 1,
      unit_price: 100.4,
      discount_amount: 0,
      taxable_amount: 100.4,
      tax_components: [],
      tax_amount: 0,
      line_total: 100.4,
    };
    const totals = calculateInvoiceTotals([line1]);
    expect(totals.subtotal).toBe(100.4);
    expect(totals.total).toBe(100);
    expect(totals.rounding_adjustment).toBe(-0.4);
  });

  it('calculates collectible and outstanding balances correctly', () => {
    // 1000 invoice with 200 standalone credit note
    const collectible = calculateCollectible(1000, 200);
    expect(collectible).toBe(800);

    // 800 collectible with 300 active allocation
    const outstanding = calculateOutstanding(collectible, 300);
    expect(outstanding).toBe(500);

    // When fully paid
    expect(calculateOutstanding(collectible, 800)).toBe(0);
  });
});
