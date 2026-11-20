import { describe, expect, it } from 'vitest';
import {
  crc32,
  encodePngTextChunk,
  extractPngTextMetadata,
  formatLocalIsoWithMs,
  injectPngTextMetadata,
  isValidPngSignature
} from '../src/pngMetadata';

function makeMinimalValidPng(): Uint8Array {
  // Valid 1x1 RGB PNG (IHDR + IDAT + IEND) with valid CRC32 checksums
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];

  const makeChunk = (type: string, data: number[]): number[] => {
    const typeBytes = Array.from(type).map((ch) => ch.charCodeAt(0));
    const len = data.length;
    const body = new Uint8Array([...typeBytes, ...data]);
    const checksum = crc32(body);
    return [
      (len >>> 24) & 0xff,
      (len >>> 16) & 0xff,
      (len >>> 8) & 0xff,
      len & 0xff,
      ...typeBytes,
      ...data,
      (checksum >>> 24) & 0xff,
      (checksum >>> 16) & 0xff,
      (checksum >>> 8) & 0xff,
      checksum & 0xff
    ];
  };

  // 1x1, bit depth 8, color type 2 (RGB), compression 0, filter 0, interlace 0
  const ihdr = makeChunk('IHDR', [
    0, 0, 0, 1,
    0, 0, 0, 1,
    8, 2, 0, 0, 0
  ]);

  // Valid zlib stream for 1x1 black pixel (filter byte 0 + RGB 0,0,0)
  const idat = makeChunk('IDAT', [
    0x78, 0x01, 0x63, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x05, 0x00, 0x01
  ]);

  const iend = makeChunk('IEND', []);

  return new Uint8Array([...sig, ...ihdr, ...idat, ...iend]);
}

describe('pngMetadata', () => {
  it('computes standard IEEE 802.3 CRC32 correctly', () => {
    const sample = new TextEncoder().encode('123456789');
    expect(crc32(sample)).toBe(0xcbf43926);
  });

  it('encodes tEXt chunks with valid structure and CRC', () => {
    const chunk = encodePngTextChunk('Experiences-Value', '0.7341829104215832');
    const view = new DataView(chunk.buffer);
    const dataLen = view.getUint32(0, false);
    expect(dataLen).toBe('Experiences-Value'.length + 1 + '0.7341829104215832'.length);
    expect(String.fromCharCode(chunk[4], chunk[5], chunk[6], chunk[7])).toBe('tEXt');
    const storedCrc = view.getUint32(8 + dataLen, false);
    expect(storedCrc).toBe(crc32(chunk, 4, 4 + dataLen));
  });

  it('injects exact normalized value and millisecond timestamps before IEND and round-trips losslessly', () => {
    const basePng = makeMinimalValidPng();
    expect(isValidPngSignature(basePng)).toBe(true);

    const value = 0.8123456789012345;
    const tsMs = 1795100374819;
    const iso = formatLocalIsoWithMs(tsMs);

    const tagged = injectPngTextMetadata(basePng, {
      'Experiences-Value': String(value),
      'Experiences-Timestamp-Ms': String(tsMs),
      'Experiences-Timestamp-ISO': iso
    });

    // Must still end with the 12-byte IEND chunk
    const tail = tagged.subarray(tagged.length - 12);
    expect(String.fromCharCode(tail[4], tail[5], tail[6], tail[7])).toBe('IEND');

    const extracted = extractPngTextMetadata(tagged);
    expect(extracted['Experiences-Value']).toBe('0.8123456789012345');
    expect(Number(extracted['Experiences-Value'])).toBe(value);
    expect(extracted['Experiences-Timestamp-Ms']).toBe('1795100374819');
    expect(extracted['Experiences-Timestamp-ISO']).toBe(iso);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  });

  it('rejects corrupted CRC checksums during extraction', () => {
    const tagged = injectPngTextMetadata(makeMinimalValidPng(), {
      'Experiences-Value': '0.5'
    });
    const corrupted = new Uint8Array(tagged);
    corrupted[corrupted.length - 15] ^= 0xff;
    expect(() => extractPngTextMetadata(corrupted)).toThrow(/CRC mismatch/);
  });
});
