// Checksum verification for withdrawal addresses, on top of the format check
// in public/js/validation/validate-wallet-address.js. Catches typos that a
// regular expression cannot: Base58Check (Bitcoin legacy, TRON), Bech32 /
// Bech32m (Bitcoin SegWit/Taproot) and EIP-55 mixed-case (EVM).

import crypto from 'node:crypto';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(str) {
  let num = 0n;
  for (const ch of str) {
    const idx = BASE58.indexOf(ch);
    if (idx < 0) return null;
    num = num * 58n + BigInt(idx);
  }
  const bytes = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  for (const ch of str) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();

export function base58Encode(buf) {
  let num = BigInt(`0x${Buffer.from(buf).toString('hex') || '0'}`);
  let out = '';
  while (num > 0n) {
    out = BASE58[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (const byte of buf) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

// Builds a Base58Check address from a version byte and a 20-byte payload
// (used to generate valid demo/test addresses).
export function encodeBase58Check(version, payload20) {
  const body = Buffer.concat([Buffer.from([version]), Buffer.from(payload20)]);
  return base58Encode(Buffer.concat([body, sha256(sha256(body)).subarray(0, 4)]));
}

export function isValidBase58Check(address, { length = 25, versions } = {}) {
  const raw = base58Decode(address);
  if (!raw || raw.length !== length) return false;
  const payload = raw.subarray(0, raw.length - 4);
  const checksum = raw.subarray(raw.length - 4);
  if (!sha256(sha256(payload)).subarray(0, 4).equals(checksum)) return false;
  return !versions || versions.includes(payload[0]);
}

// Bech32 / Bech32m (BIP-173, BIP-350)
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i += 1) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp) {
  return [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
}

export function isValidSegwitAddress(address, expectedHrp = 'bc') {
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) return false;
  const lower = address.toLowerCase();
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length || lower.length > 90) return false;
  const hrp = lower.slice(0, pos);
  if (hrp !== expectedHrp) return false;
  const data = [];
  for (const ch of lower.slice(pos + 1)) {
    const idx = CHARSET.indexOf(ch);
    if (idx < 0) return false;
    data.push(idx);
  }
  const check = polymod(hrpExpand(hrp).concat(data));
  const version = data[0];
  if (version === 0) return check === 1;
  if (version >= 1 && version <= 16) return check === 0x2bc830a3;
  return false;
}

// Keccak-256 (Ethereum variant, not NIST SHA3) for EIP-55.
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn,
  0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n,
  0x0000000080008009n, 0x000000008000000an, 0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROTATION = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const MASK = (1n << 64n) - 1n;
const rotl = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK);

function keccakF(state) {
  for (let round = 0; round < 24; round += 1) {
    const c = [0, 1, 2, 3, 4].map((x) => state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]);
    for (let x = 0; x < 5; x += 1) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y += 1) state[x + 5 * y] ^= d;
    }
    const b = new Array(25);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y], ROTATION[x][y]);
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = b[x + 5 * y] ^ (~b[((x + 1) % 5) + 5 * y] & MASK & b[((x + 2) % 5) + 5 * y]);
      }
    }
    state[0] ^= RC[round];
  }
}

export function keccak256(input) {
  const rate = 136;
  const msg = Buffer.from(input);
  const padded = Buffer.alloc(Math.ceil((msg.length + 1) / rate) * rate);
  msg.copy(padded);
  padded[msg.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const state = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i += 1) state[i] ^= padded.readBigUInt64LE(off + i * 8);
    keccakF(state);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i += 1) out.writeBigUInt64LE(state[i], i * 8);
  return out.toString('hex');
}

export function isValidEip55(address) {
  const hex = address.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true; // no checksum encoded
  const hash = keccak256(hex.toLowerCase());
  for (let i = 0; i < 40; i += 1) {
    const ch = hex[i];
    if (/[a-f]/i.test(ch)) {
      const upper = parseInt(hash[i], 16) >= 8;
      if ((upper && ch !== ch.toUpperCase()) || (!upper && ch !== ch.toLowerCase())) return false;
    }
  }
  return true;
}

/** Network family -> checksum verification. Unknown families pass through. */
export function verifyAddressChecksum(family, address) {
  switch (family) {
    case 'bitcoin':
      return address.toLowerCase().startsWith('bc1')
        ? isValidSegwitAddress(address, 'bc')
        : isValidBase58Check(address, { length: 25, versions: [0x00, 0x05] });
    case 'tron':
      return isValidBase58Check(address, { length: 25, versions: [0x41] });
    case 'evm':
      return isValidEip55(address);
    default:
      return true;
  }
}
