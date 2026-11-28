/**
 * decodeZip — Decode a gzip+base64 (URL-safe) string back to plain text.
 *
 * Uses the same encoding as WhiteboardPlaygroundButton / StorybookWorkbench:
 *   encode: raw bytes → gzip → base64 → URL-safe (+-/= → -_<empty>)
 *   decode: reverse
 *
 * Falls back to strict UTF-8 plain base64 only when the bytes do not carry a
 * gzip header and decode cleanly to printable text without control garbage (WW-161).
 */

const VALID_BASE64_RE = /^[A-Za-z0-9+/_=-]+$/;
// Reject non-whitespace C0/DEL control bytes (anything other than \t, \n, \r).
// eslint-disable-next-line no-control-regex
const BINARY_CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

export async function decodeZip(z: string): Promise<string | null> {
  const trimmed = typeof z === 'string' ? z.trim() : '';
  if (!trimmed || !VALID_BASE64_RE.test(trimmed)) return null;
  try {
    let padded = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4 !== 0) {
      padded += '=';
    }
    const binary = atob(padded);
    if (binary.length === 0) return null;
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (isGzip) {
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      // Attach rejection handler on the write side so corrupt gzip payloads
      // never emit an unhandled rejection when DecompressionStream errors.
      const writeDone = writer
        .write(bytes)
        .then(() => writer.close())
        .catch(() => undefined);
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      await writeDone;
      const totalLen = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(totalLen);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(merged);
      if (!text || BINARY_CONTROL_RE.test(text)) return null;
      return text;
    }

    // Fallback: plain base64 (no compression) — must be valid UTF-8 printable text.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text || BINARY_CONTROL_RE.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}
