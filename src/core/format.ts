// Canonical number formatting — the one place floating-point noise could break byte-identical
// round-trips (serialize(parse(x)) === x), so it's pinned down precisely instead of left to
// Number.prototype.toString(). See docs/format-spec.md's "canonical ordering" section.
//
// Rule: integers get no decimal point ("4500", never "4500.0"). Non-integers are rounded to 4
// decimal places, then trailing zeros (and a trailing bare ".") are stripped ("0.8", never
// "0.80" or "0.8000"). This is idempotent: formatNumber(Number(formatNumber(n))) === formatNumber(n).
export function formatNumber(n: number): string {
  const v = Object.is(n, -0) ? 0 : n
  if (Number.isInteger(v)) return String(v)
  const rounded = Math.round(v * 10000) / 10000
  if (Number.isInteger(rounded)) return String(rounded)
  return rounded.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}
