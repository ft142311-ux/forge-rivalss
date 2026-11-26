/**
 * Shared deterministic 32-bit FNV-1a hash.
 * Keep the input string unchanged at call sites to preserve existing outcomes.
 */
export function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
