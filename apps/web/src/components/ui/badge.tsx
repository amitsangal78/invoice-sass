// Tier 1 primitive — zero domain knowledge (structure.md's three-tier
// component placement). Takes raw colors; domain-aware badges (like invoice
// status) live in shared/components and compose this.
export function Badge({ label, bg, text, dot }: { label: string; bg: string; text: string; dot: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: bg, color: text }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dot }} />
      {label}
    </span>
  );
}
