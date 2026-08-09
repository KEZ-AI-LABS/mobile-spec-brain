/** Recursively sorts object keys so equal values always serialize identically. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalize(nested)]),
  );
}

/** Compact, key-sorted serialization for hashing. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

/** Key-sorted, newline-terminated serialization for files committed to Git. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}
