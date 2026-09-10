// Pure, stateless domain knowledge — safe to import from a route, a shared
// component, or a feature (structure.md's lib/ vs features/ boundary).

export const INVOICE_STATUSES = ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * Semantic tokens, not hexes. Each status resolves through the CSS variable
 * layer (`--color-success`, `--color-danger`, …), so one definition renders
 * correctly in light *and* dark — the palette swaps underneath. Previously
 * these were literal hexes, which meant every badge stayed a light pastel pill
 * on a dark surface.
 *
 * The tint/ink split matches the design comps: a soft tinted background with
 * saturated ink on top, in both themes.
 */
export const STATUS_BADGE_CONFIG: Record<InvoiceStatus, { label: string; className: string; dotClassName: string }> = {
  DRAFT: { label: 'Draft', className: 'bg-text-muted/15 text-text-secondary', dotClassName: 'bg-text-muted' },
  SENT: { label: 'Sent', className: 'bg-primary/15 text-primary', dotClassName: 'bg-primary' },
  PARTIALLY_PAID: { label: 'Partially Paid', className: 'bg-warning/15 text-warning', dotClassName: 'bg-warning' },
  PAID: { label: 'Paid', className: 'bg-success/15 text-success', dotClassName: 'bg-success' },
  OVERDUE: { label: 'Overdue', className: 'bg-danger/15 text-danger', dotClassName: 'bg-danger' },
  // Deliberately a heavier neutral than DRAFT — "closed" should not read the
  // same as "in progress" (design-system.md).
  CANCELLED: { label: 'Cancelled', className: 'bg-text-secondary/20 text-text-secondary', dotClassName: 'bg-text-secondary' },
};

export function formatCurrency(amount: string, currency: string): string {
  const symbols: Record<string, string> = { INR: '₹', USD: '$', GBP: '£', EUR: '€', AUD: 'A$' };
  const symbol = symbols[currency] ?? `${currency} `;
  return `${symbol}${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
