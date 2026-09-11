export const MAX_PLAINTEXT_BYTES = 100 * 1024;
export const ENVELOPE_VERSION = 2;
export const PBKDF2_ITERATIONS = 600000;

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ENVELOPE_HEADER_BYTES = 1 + IV_BYTES;
const HKDF_INFO = new TextEncoder().encode('blinddrop-v2');
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface EncryptedSecret {
  ciphertext: string;
  fragmentKey: string;
  passphraseSalt?: string;
}

function webCrypto(): Crypto {
  return globalThis.crypto;
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function bytesToBase64(bytes: Uint8Array): string {
  // Avoid spreading a large ciphertext into a function call. Build one binary
  // string from bounded chunks, then encode it once so padding stays correct.
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    let binary = '';
    for (let index = 0; index < chunk.length; index += 1) {
      binary += String.fromCharCode(chunk[index]);
    }
    chunks.push(binary);
  }
  return btoa(chunks.join(''));
}

export function base64ToBytes(value: string): Uint8Array {
  if (!BASE64.test(value) || value.length % 4 !== 0) {
    throw new Error('Invalid base64 value.');
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytesToBase64(bytes) !== value) throw new Error('Invalid base64 value.');
  return bytes;
}

export function assertPlaintextSize(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_PLAINTEXT_BYTES) {
    throw new Error('Secret is too large. The UTF-8 limit is 100 KiB.');
  }
  return bytes;
}

function assertKeyBytes(value: Uint8Array): void {
  if (value.byteLength !== KEY_BYTES) throw new Error('Invalid encryption key.');
}

function assertSaltBytes(value: Uint8Array): void {
  if (value.byteLength !== SALT_BYTES) throw new Error('Invalid passphrase parameters.');
}

async function importAesKey(rawKey: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  assertKeyBytes(rawKey);
  return webCrypto().subtle.importKey(
    'raw',
    bufferSource(rawKey),
    { name: 'AES-GCM' },
    false,
    usages
  );
}

async function derivePbkdf2Output(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  assertSaltBytes(salt);
  const keyMaterial = await webCrypto().subtle.importKey(
    'raw',
    bufferSource(new TextEncoder().encode(passphrase)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const output = await webCrypto().subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: bufferSource(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    KEY_BYTES * 8
  );
  return new Uint8Array(output);
}

// Exported for known-answer tests. The byte-level inputs make the KDF roles
// explicit: PBKDF2 output is the HKDF salt, and the fragment key is HKDF IKM.
export async function deriveV2KeyBytes(
  fragmentKey: Uint8Array,
  passphrase: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  assertKeyBytes(fragmentKey);
  const kdfOutput = await derivePbkdf2Output(passphrase, salt);
  const fragmentKeyMaterial = await webCrypto().subtle.importKey(
    'raw',
    bufferSource(fragmentKey),
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );
  const output = await webCrypto().subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: bufferSource(kdfOutput),
      info: bufferSource(HKDF_INFO)
    },
    fragmentKeyMaterial,
    KEY_BYTES * 8
  );
  return new Uint8Array(output);
}

async function deriveV2AesKey(
  fragmentKey: Uint8Array,
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  return importAesKey(await deriveV2KeyBytes(fragmentKey, passphrase, salt), ['encrypt', 'decrypt']);
}

function randomBytes(length: number): Uint8Array {
  return webCrypto().getRandomValues(new Uint8Array(length));
}

async function encryptWithAesKey(plaintext: Uint8Array, key: CryptoKey): Promise<string> {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await webCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv: bufferSource(iv) },
    key,
    bufferSource(plaintext)
  );
  const packed = new Uint8Array(ENVELOPE_HEADER_BYTES + ciphertext.byteLength);
  packed[0] = ENVELOPE_VERSION;
  packed.set(iv, 1);
  packed.set(new Uint8Array(ciphertext), ENVELOPE_HEADER_BYTES);
  return bytesToBase64(packed);
}

export async function encryptSecret(text: string, passphrase?: string): Promise<EncryptedSecret> {
  const plaintext = assertPlaintextSize(text);
  const fragmentKeyBytes = randomBytes(KEY_BYTES);
  let aesKey: CryptoKey;
  let passphraseSalt: string | undefined;

  if (passphrase !== undefined) {
    const saltBytes = randomBytes(SALT_BYTES);
    passphraseSalt = bytesToBase64(saltBytes);
    aesKey = await deriveV2AesKey(fragmentKeyBytes, passphrase, saltBytes);
  } else {
    aesKey = await importAesKey(fragmentKeyBytes, ['encrypt']);
  }

  return {
    ciphertext: await encryptWithAesKey(plaintext, aesKey),
    fragmentKey: bytesToBase64(fragmentKeyBytes),
    ...(passphraseSalt ? { passphraseSalt } : {})
  };
}

export async function decryptSecret(
  ciphertextBase64: string,
  fragmentKeyBase64: string,
  passphrase?: string,
  passphraseSaltBase64?: string
): Promise<string | null> {
  try {
    const packed = base64ToBytes(ciphertextBase64);
    const fragmentKey = base64ToBytes(fragmentKeyBase64);
    if (
      packed.byteLength < ENVELOPE_HEADER_BYTES + AUTH_TAG_BYTES ||
      packed[0] !== ENVELOPE_VERSION
    ) return null;
    assertKeyBytes(fragmentKey);

    let aesKey: CryptoKey;
    if (passphrase === undefined) {
      aesKey = await importAesKey(fragmentKey, ['decrypt']);
    } else {
      if (!passphraseSaltBase64) return null;
      aesKey = await deriveV2AesKey(fragmentKey, passphrase, base64ToBytes(passphraseSaltBase64));
    }

    const plaintext = await webCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: bufferSource(packed.slice(1, ENVELOPE_HEADER_BYTES)) },
      aesKey,
      bufferSource(packed.slice(ENVELOPE_HEADER_BYTES))
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch {
    // Wrong keys, wrong passphrases, version changes, malformed envelopes and
    // authentication failures intentionally have the same result.
    return null;
  }
}
