// Same values as design-system.md / apps/web's lib/invoicing/status.ts —
// duplicated (not shared as runtime code) because RN can't consume a
// Next.js package's React components, only the token values conceptually
// match (structure.md: apps/mobile has almost nothing of its own beyond
// thin re-exports of shared shape — real logic lives in the API).
export const colors = {
  background: '#F8FAFC',
  surface: '#FFFFFF',
  border: '#E2E8F0',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  primary: '#2563EB',
  primaryLight: '#DBEAFE',
  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
};

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';

export const STATUS_BADGE: Record<InvoiceStatus, { label: string; bg: string; text: string; dot: string }> = {
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
