// Tier 1 primitive — zero domain knowledge (structure.md's three-tier
// component placement). Takes token-based utility classes rather than raw
// hexes so a badge follows the active theme; domain-aware badges (like invoice
// status) live in shared/components and compose this.
export function Badge({ label, className, dotClassName }: { label: string; className: string; dotClassName: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClassName}`} />
      {label}
    </span>
  );
}
