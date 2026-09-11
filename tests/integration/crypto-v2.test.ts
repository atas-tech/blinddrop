import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { hkdfSync, pbkdf2Sync, webcrypto } from 'node:crypto';
import {
  base64ToBytes,
  bytesToBase64,
  decryptSecret,
  deriveV2KeyBytes,
  encryptSecret,
  ENVELOPE_VERSION
} from '../../src/crypto.js';

before(() => {
  if (!globalThis.crypto) {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  }
});

const VECTORS = [
  {
    passphrase: 'correct horse battery staple',
    salt: 'Dw4NDAsKCQgHBgUEAwIBAA==',
    fragmentKey: '//79/Pv6+fj39vX08/Lx8O/u7ezr6uno5+bl5OPi4eA=',
    pbkdf2Output: '6df1e3664169d9b7683db4b00824be49114fa8add4c1ff8dc83848052c427978',
    aesKey: '0de33763a53ed3a7ac263d2c646cc9f05421972b11b5c4c5be2cb9f36ea620fd'
  },
  {
    passphrase: 'pässphrase 🔐',
    salt: 'Dw4NDAsKCQgHBgUEAwIBAA==',
    fragmentKey: '//79/Pv6+fj39vX08/Lx8O/u7ezr6uno5+bl5OPi4eA=',
    pbkdf2Output: 'dc241153512252ebbc3c59cb064bcf59366de204cb1bdbe92edba0f420f01d14',
    aesKey: '8f348b973dd25ce3d28733841a574f49adf7d78bb35f43652e39fe08dd5e2923'
  }
];

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

test('combined_derivation_matches_independent_vectors', async () => {
  for (const vector of VECTORS) {
    const salt = base64ToBytes(vector.salt);
    const fragmentKey = base64ToBytes(vector.fragmentKey);
    const derived = await deriveV2KeyBytes(fragmentKey, vector.passphrase, salt);

    // Recalculate the expected values with Node's independent primitives so
    // the browser WebCrypto implementation is checked against known answers.
    const pbkdf2Output = pbkdf2Sync(
      Buffer.from(vector.passphrase, 'utf8'),
      Buffer.from(salt),
      600000,
      32,
      'sha256'
    );
    const independentAesKey = Buffer.from(hkdfSync(
      'sha256',
      Buffer.from(fragmentKey),
      pbkdf2Output,
      Buffer.from('blinddrop-v2', 'utf8'),
      32
    ));

    assert.equal(pbkdf2Output.toString('hex'), vector.pbkdf2Output);
    assert.equal(independentAesKey.toString('hex'), vector.aesKey);
    assert.equal(hex(derived), vector.aesKey);
  }
});

test('v2_envelopes_use_the_fragment_key_in_both_modes', async () => {
  const plaintext = '  first line\nsecond line — café & <tag>  ';
  const plain = await encryptSecret(plaintext);
  const protectedSecret = await encryptSecret(plaintext, 'long unique passphrase');

  assert.equal(base64ToBytes(plain.ciphertext)[0], ENVELOPE_VERSION);
  assert.equal(base64ToBytes(protectedSecret.ciphertext)[0], ENVELOPE_VERSION);
  assert.equal(base64ToBytes(plain.fragmentKey).byteLength, 32);
  assert.equal(base64ToBytes(protectedSecret.fragmentKey).byteLength, 32);
  assert.equal(await decryptSecret(plain.ciphertext, plain.fragmentKey), plaintext);
  assert.equal(
    await decryptSecret(
      protectedSecret.ciphertext,
      protectedSecret.fragmentKey,
      'long unique passphrase',
      protectedSecret.passphraseSalt
    ),
    plaintext
  );
});

test('v2_decryption_rejects_wrong_or_malformed_material_without_plaintext', async () => {
  const encrypted = await encryptSecret('secret', 'correct passphrase');
  const wrongFragmentKey = bytesToBase64(new Uint8Array(32).fill(9));
  const envelope = base64ToBytes(encrypted.ciphertext);
  const modifiedVersion = new Uint8Array(envelope);
  modifiedVersion[0] = 1;

  const cases = [
    decryptSecret(encrypted.ciphertext, wrongFragmentKey, 'correct passphrase', encrypted.passphraseSalt),
    decryptSecret(encrypted.ciphertext, encrypted.fragmentKey, 'wrong passphrase', encrypted.passphraseSalt),
    decryptSecret(bytesToBase64(modifiedVersion), encrypted.fragmentKey, 'correct passphrase', encrypted.passphraseSalt),
    decryptSecret(bytesToBase64(new Uint8Array([ENVELOPE_VERSION, 1, 2])), encrypted.fragmentKey, 'correct passphrase', encrypted.passphraseSalt),
    decryptSecret(encrypted.ciphertext.slice(0, -1), encrypted.fragmentKey, 'correct passphrase', encrypted.passphraseSalt)
  ];

  assert.deepEqual(await Promise.all(cases), [null, null, null, null, null]);
});
