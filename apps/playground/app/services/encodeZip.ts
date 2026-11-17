/**
 * encodeZip — Gzip-compress and base64 (URL-safe) encode a plain text string.
 *
 * Symmetric counterpart of decodeZip — produces a string that can be passed
 * as the `?z=` query parameter and decoded by the existing useZipProcessor hook.
 *
 * Encoding:
 *   raw text → UTF-8 bytes → gzip → base64 → URL-safe (+-/ → -_<empty>)
 */
export async function encodeZip(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  const reader = cs.readable.getReader()
  void writer.write(bytes)
  void writer.close()

  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  const totalLen = chunks.reduce((n, c) => n + c.length, 0)
  const merged = new Uint8Array(totalLen)
  let off = 0
  for (const c of chunks) {
    merged.set(c, off)
    off += c.length
  }

  // base64-encode the compressed bytes
  let binary = ''
  for (let i = 0; i < merged.length; i++) {
    binary += String.fromCharCode(merged[i])
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}
