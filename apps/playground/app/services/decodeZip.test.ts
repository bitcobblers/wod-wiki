import { describe, expect, it } from 'bun:test';
import { encodeZip } from './encodeZip';
import { decodeZip } from './decodeZip';

describe('decodeZip (WW-161)', () => {
  it('round-trips valid gzip+base64 payloads via encodeZip', async () => {
    const sample = '# Fran\n\n```wod\n21-15-9\n  Thrusters 95lb\n  Pull-ups\n```\n';
    const encoded = await encodeZip(sample);
    expect(await decodeZip(encoded)).toBe(sample);
  });

  it('decodes clean UTF-8 plain base64 payloads', async () => {
    const plain = '5x5 Back Squat 225lb';
    const b64 = btoa(plain).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await decodeZip(b64)).toBe(plain);
  });

  it('rejects arbitrary garbage strings instead of decoding mojibake (WW-161)', async () => {
    expect(await decodeZip('garbage-not-a-valid-bundle-12345')).toBeNull();
    expect(await decodeZip('not base64 at all!!!')).toBeNull();
    expect(await decodeZip('')).toBeNull();
  });

  it('rejects corrupted gzip-header payloads without falling back to raw binary', async () => {
    // 0x1f 0x8b gzip header followed by garbage bytes
    const badGzip = btoa('\x1f\x8b\x08\x00\xff\xff\xff\xff');
    expect(await decodeZip(badGzip)).toBeNull();
  });
});
