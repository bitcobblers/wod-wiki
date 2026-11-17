/**
 * decodeZip — Decode a gzip+base64 (URL-safe) string back to plain text.
 *
 * Uses the same encoding as WhiteboardPlaygroundButton / StorybookWorkbench:
 *   encode: raw bytes → gzip → base64 → URL-safe (+-/= → -_<empty>)
 *   decode: reverse
 *
 * Falls back to plain base64 if gzip decompression fails.
 */

export async function decodeZip(z: string): Promise<string | null> {
  try {
    let padded = z.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4 !== 0) {
      padded += '=';
    }
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    try {
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      void writer.write(bytes);
      void writer.close();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLen = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(totalLen);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      return new TextDecoder().decode(merged);
    } catch {
      // Fallback: plain base64 (no compression)
      return new TextDecoder().decode(bytes);
    }
  } catch {
    return null;
  }
}
