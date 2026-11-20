const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, start = 0, length = bytes.length - start): number {
  let c = 0xffffffff;
  const end = start + length;
  for (let i = start; i < end; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function encodeLatin1(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

function decodeLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

export function formatLocalIsoWithMs(timestampMs: number): string {
  const d = new Date(timestampMs);
  const pad2 = (n: number): string => String(n).padStart(2, '0');
  const pad3 = (n: number): string => String(n).padStart(3, '0');

  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hours = pad2(d.getHours());
  const minutes = pad2(d.getMinutes());
  const seconds = pad2(d.getSeconds());
  const ms = pad3(d.getMilliseconds());

  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMin);
  const offH = pad2(Math.floor(absOffset / 60));
  const offM = pad2(absOffset % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}${sign}${offH}:${offM}`;
}

export function isValidPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/**
 * Encodes a standard PNG tEXt chunk:
 * [length: 4B BE][type: "tEXt"][keyword Latin-1][0x00][text Latin-1][crc32: 4B BE]
 */
export function encodePngTextChunk(keyword: string, text: string): Uint8Array {
  if (keyword.length < 1 || keyword.length > 79) {
    throw new Error('Invalid PNG tEXt keyword length');
  }
  const keyBytes = encodeLatin1(keyword);
  const textBytes = encodeLatin1(text);
  const dataLen = keyBytes.length + 1 + textBytes.length;

  const chunk = new Uint8Array(12 + dataLen);
  const view = new DataView(chunk.buffer);

  view.setUint32(0, dataLen, false);
  // "tEXt"
  chunk[4] = 0x74;
  chunk[5] = 0x45;
  chunk[6] = 0x58;
  chunk[7] = 0x74;

  chunk.set(keyBytes, 8);
  chunk[8 + keyBytes.length] = 0x00;
  chunk.set(textBytes, 8 + keyBytes.length + 1);

  const checksum = crc32(chunk, 4, 4 + dataLen);
  view.setUint32(8 + dataLen, checksum, false);

  return chunk;
}

/**
 * Inserts one or more PNG tEXt chunks immediately before the IEND chunk.
 */
export function injectPngTextMetadata(
  pngBytes: Uint8Array,
  entries: Record<string, string>
): Uint8Array {
  if (!isValidPngSignature(pngBytes)) {
    throw new Error('Invalid PNG byte stream');
  }

  const view = new DataView(
    pngBytes.buffer,
    pngBytes.byteOffset,
    pngBytes.byteLength
  );

  let offset = 8;
  let iendOffset = -1;

  while (offset + 12 <= pngBytes.length) {
    const length = view.getUint32(offset, false);
    const chunkTotal = 12 + length;
    if (offset + chunkTotal > pngBytes.length) {
      throw new Error('Truncated PNG chunk');
    }

    const isIend =
      pngBytes[offset + 4] === 0x49 && // I
      pngBytes[offset + 5] === 0x45 && // E
      pngBytes[offset + 6] === 0x4e && // N
      pngBytes[offset + 7] === 0x44;   // D

    if (isIend) {
      iendOffset = offset;
      break;
    }

    offset += chunkTotal;
  }

  if (iendOffset === -1) {
    throw new Error('PNG IEND chunk not found');
  }

  const chunks = Object.entries(entries).map(([k, v]) => encodePngTextChunk(k, v));
  const extraLength = chunks.reduce((sum, c) => sum + c.length, 0);

  const out = new Uint8Array(pngBytes.length + extraLength);
  out.set(pngBytes.subarray(0, iendOffset), 0);

  let writePos = iendOffset;
  for (const chunk of chunks) {
    out.set(chunk, writePos);
    writePos += chunk.length;
  }

  out.set(pngBytes.subarray(iendOffset), writePos);
  return out;
}

/**
 * Extracts all PNG tEXt metadata chunks and validates every chunk's CRC32.
 */
export function extractPngTextMetadata(pngBytes: Uint8Array): Record<string, string> {
  if (!isValidPngSignature(pngBytes)) {
    throw new Error('Invalid PNG byte stream');
  }

  const view = new DataView(
    pngBytes.buffer,
    pngBytes.byteOffset,
    pngBytes.byteLength
  );
  const result: Record<string, string> = {};

  let offset = 8;
  while (offset + 12 <= pngBytes.length) {
    const length = view.getUint32(offset, false);
    const chunkTotal = 12 + length;
    if (offset + chunkTotal > pngBytes.length) {
      throw new Error('Truncated PNG chunk');
    }

    const expectedCrc = view.getUint32(offset + 8 + length, false);
    const actualCrc = crc32(pngBytes, offset + 4, 4 + length);
    if (expectedCrc !== actualCrc) {
      throw new Error(`PNG chunk CRC mismatch at offset ${offset}`);
    }

    const isText =
      pngBytes[offset + 4] === 0x74 && // t
      pngBytes[offset + 5] === 0x45 && // E
      pngBytes[offset + 6] === 0x58 && // X
      pngBytes[offset + 7] === 0x74;   // t

    if (isText) {
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      let nulIndex = -1;
      for (let i = dataStart; i < dataEnd; i++) {
        if (pngBytes[i] === 0) {
          nulIndex = i;
          break;
        }
      }
      if (nulIndex > dataStart) {
        const key = decodeLatin1(pngBytes.subarray(dataStart, nulIndex));
        const val = decodeLatin1(pngBytes.subarray(nulIndex + 1, dataEnd));
        result[key] = val;
      }
    }

    offset += chunkTotal;
  }

  return result;
}
