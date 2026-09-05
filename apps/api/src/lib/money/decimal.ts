import Decimal from 'decimal.js';

/**
 * Every money calculation in this codebase goes through here — never raw
 * `+`/`*` on a JS `number` (core-invoicing/design.md's "money arithmetic"
 * rule). Postgres NUMERIC round-trips as a string through Drizzle/pg, so the
 * boundary is: string in, Decimal for math, string out.
 */

export function toDecimal(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

export function sum(values: Decimal.Value[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));
}

export function multiply(a: Decimal.Value, b: Decimal.Value): Decimal {
  return new Decimal(a).times(b);
}

export function toDbString(value: Decimal): string {
  return value.toFixed(2);
}

export function isGreaterThanOrEqual(a: Decimal.Value, b: Decimal.Value): boolean {
  return new Decimal(a).gte(b);
}

export function isGreaterThanZero(a: Decimal.Value): boolean {
  return new Decimal(a).gt(0);
}
