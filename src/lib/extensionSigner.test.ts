import { describe, it, expect, afterEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { ExtensionAccountMismatchError, ExtensionSigner } from './extensionSigner';

/** Stub a NIP-07 extension whose active account is `sk`. */
function stubExtension(sk: Uint8Array) {
  (globalThis as { nostr?: unknown }).nostr = {
    getPublicKey: async () => getPublicKey(sk),
    signEvent: async (event: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(event, sk),
    nip44: {
      encrypt: async (_pubkey: string, plaintext: string) => `enc:${plaintext}`,
      decrypt: async (_pubkey: string, ciphertext: string) => ciphertext.replace(/^enc:/, ''),
    },
  };
}

afterEach(() => {
  delete (globalThis as { nostr?: unknown }).nostr;
});

const template = { kind: 1, content: 'hi', tags: [], created_at: 0 };

describe('ExtensionSigner', () => {
  it('signs and decrypts while the extension uses the bound account', async () => {
    const sk = generateSecretKey();
    stubExtension(sk);
    const signer = new ExtensionSigner(getPublicKey(sk));

    const event = await signer.signEvent(template);
    expect(event.pubkey).toBe(getPublicKey(sk));
    expect(await signer.nip44!.decrypt(event.pubkey, 'enc:note')).toBe('note');
  });

  it('refuses to sign or decrypt as another account', async () => {
    const bound = generateSecretKey();
    stubExtension(generateSecretKey());
    const signer = new ExtensionSigner(getPublicKey(bound));

    await expect(signer.signEvent(template)).rejects.toBeInstanceOf(ExtensionAccountMismatchError);
    await expect(signer.nip44!.decrypt('x', 'enc:note')).rejects.toBeInstanceOf(
      ExtensionAccountMismatchError,
    );
    // getPublicKey reports the bound account, not the extension's.
    expect(await signer.getPublicKey()).toBe(getPublicKey(bound));
  });

  it('notices an account switch after the check has been cached', async () => {
    const bound = generateSecretKey();
    stubExtension(bound);
    const signer = new ExtensionSigner(getPublicKey(bound));
    await signer.signEvent(template);

    stubExtension(generateSecretKey());
    // The cached check passes, but the signature's pubkey gives it away.
    await expect(signer.signEvent(template)).rejects.toBeInstanceOf(ExtensionAccountMismatchError);
  });
});
