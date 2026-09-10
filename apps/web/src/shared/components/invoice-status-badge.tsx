import { Badge } from '@/components/ui/badge';
import { STATUS_BADGE_CONFIG, type InvoiceStatus } from '@/lib/invoicing/status';

// Tier 2 — domain-aware, reused by the dashboard, invoice list, and invoice
// detail features. Never color alone: always label + dot (design-system.md).
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const config = STATUS_BADGE_CONFIG[status];
  return <Badge label={config.label} className={config.className} dotClassName={config.dotClassName} />;
}
