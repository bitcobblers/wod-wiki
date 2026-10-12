/** Cross-note fingerprint of the trimmed, unfenced workout body. Never an occurrence ID. */
export function blockContentId(content: string): string {
  const normalized = content.trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `bc-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
