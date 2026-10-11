/**
 * Row codec for the SQL `data` column. Plain JSON.stringify destroys
 * ArrayBuffer values ({}); attachment rows carry raw blobs, so encoding tags
 * the declared binary field and decoding revives it.
 *
 * Collision safety: tagging applies ONLY to the declared binary field of the
 * declared store (attachments.data) — arbitrary rows (meta, notes, …) are
 * plain JSON in both directions, so authored {$binary:…}-shaped objects
 * anywhere else round-trip byte-for-byte. Within attachments.data the value
 * is typed `ArrayBuffer | string`; strings pass through, and only the exact
 * two-key tag revives.
 */

const TAG = '$binary';
const LEN = '$bytes';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // String.fromCharCode.apply arg ceiling
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length); // exact-length buffer: .buffer IS the decoded ArrayBuffer
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Tag shape: exactly { $binary: base64, $bytes: length }. */
function reviveBinary(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes(TAG) || !keys.includes(LEN)) return value;
  const tag = value as Record<string, unknown>;
  if (typeof tag[TAG] !== 'string' || typeof tag[LEN] !== 'number') return value;
  const bytes = base64ToBytes(tag[TAG]);
  if (bytes.length !== tag[LEN]) {
    throw new Error(`corrupt binary cell: declared ${tag[LEN]} bytes, decoded ${bytes.length}`);
  }
  return bytes.buffer;
}

/** Serialize a row; when `binaryField` is set and holds an ArrayBuffer, it is
 * replaced by the lossless tag (shallow copy — the input row is untouched). */
export function encodeRowJson(value: unknown, binaryField?: string): string {
  if (binaryField && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    const data = row[binaryField];
    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      return JSON.stringify({ ...row, [binaryField]: { [TAG]: bytesToBase64(bytes), [LEN]: bytes.length } });
    }
  }
  return JSON.stringify(value);
}

/** Parse a row; when `binaryField` is set, a tagged value there revives as an
 * ArrayBuffer. Every other value — including tag-shaped data in other fields
 * or stores — is returned exactly as authored. */
export function decodeRowJson<T = unknown>(text: string, binaryField?: string): T {
  const row = JSON.parse(text) as unknown;
  if (binaryField && row !== null && typeof row === 'object' && !Array.isArray(row)) {
    const record = row as Record<string, unknown>;
    const revived = reviveBinary(record[binaryField]);
    if (revived !== record[binaryField]) record[binaryField] = revived;
  }
  return row as T;
}
