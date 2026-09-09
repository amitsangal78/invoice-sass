// Pure, stateless domain knowledge — safe to import from a route, a shared
// component, or a feature (structure.md's lib/ vs features/ boundary).

export const INVOICE_STATUSES = ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

// Colors match design-system.md exactly — never hardcode these in a component;
// import this config instead.
export const STATUS_BADGE_CONFIG: Record<InvoiceStatus, { label: string; bg: string; text: string; dot: string }> = {
  DRAFT: { label: 'Draft', bg: '#F1F5F9', text: '#475569', dot: '#94A3B8' },
  SENT: { label: 'Sent', bg: '#DBEAFE', text: '#2563EB', dot: '#2563EB' },
  PARTIALLY_PAID: { label: 'Partially Paid', bg: '#FEF3C7', text: '#D97706', dot: '#D97706' },
  PAID: { label: 'Paid', bg: '#DCFCE7', text: '#16A34A', dot: '#16A34A' },
  OVERDUE: { label: 'Overdue', bg: '#FEE2E2', text: '#DC2626', dot: '#DC2626' },
  CANCELLED: { label: 'Cancelled', bg: '#E2E8F0', text: '#334155', dot: '#64748B' },
};

export function formatCurrency(amount: string, currency: string): string {
  const symbols: Record<string, string> = { INR: '₹', USD: '$', GBP: '£', EUR: '€', AUD: 'A$' };
  const symbol = symbols[currency] ?? `${currency} `;
  return `${symbol}${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
