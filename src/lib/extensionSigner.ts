import { NBrowserSigner, type NostrEvent, type NostrSigner } from '@nostrify/nostrify';

/**
 * Thrown when the NIP-07 extension's active account is not the account the
 * app is logged in as. A site can't pick the extension's account, so the
 * user has to switch it in the extension.
 */
export class ExtensionAccountMismatchError extends Error {
  constructor(
    readonly expectedPubkey: string,
    readonly activePubkey: string,
  ) {
    super('Your signer extension is using a different account. Switch accounts in the extension.');
    this.name = 'ExtensionAccountMismatchError';
  }
}

/** How long a confirmed extension pubkey is trusted before asking again. */
const CHECK_TTL_MS = 1000;

/**
 * A NIP-07 signer bound to one pubkey. `NBrowserSigner` signs and decrypts
 * with whatever account the extension has active, which silently breaks
 * when the user has several accounts in the extension. This wrapper checks
 * the extension's active pubkey before every operation and refuses to act
 * as the wrong account.
 */
export class ExtensionSigner implements NostrSigner {
  readonly #inner = new NBrowserSigner();
  readonly #pubkey: string;
  #checkedAt = 0;
  #inflight: Promise<void> | null = null;

  readonly #nip44: NonNullable<NostrSigner['nip44']>;
  readonly #nip04: NonNullable<NostrSigner['nip04']>;

  constructor(pubkey: string) {
    this.#pubkey = pubkey;

    this.#nip44 = {
      encrypt: async (pubkey, plaintext) => {
        await this.#assertAccount();
        return this.#cipher('nip44').encrypt(pubkey, plaintext);
      },
      decrypt: async (pubkey, ciphertext) => {
        await this.#assertAccount();
        return this.#cipher('nip44').decrypt(pubkey, ciphertext);
      },
    };
    this.#nip04 = {
      encrypt: async (pubkey, plaintext) => {
        await this.#assertAccount();
        return this.#cipher('nip04').encrypt(pubkey, plaintext);
      },
      decrypt: async (pubkey, ciphertext) => {
        await this.#assertAccount();
        return this.#cipher('nip04').decrypt(pubkey, ciphertext);
      },
    };
  }

  // Mirror NBrowserSigner: undefined when the extension lacks the method.
  get nip44() {
    return this.#inner.nip44 ? this.#nip44 : undefined;
  }

  get nip04() {
    return this.#inner.nip04 ? this.#nip04 : undefined;
  }

  async getPublicKey(): Promise<string> {
    return this.#pubkey;
  }

  async signEvent(event: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> {
    await this.#assertAccount();
    const signed = await this.#inner.signEvent(event);
    // The account could change between the check and the signature.
    if (signed.pubkey !== this.#pubkey) {
      this.#checkedAt = 0;
      throw new ExtensionAccountMismatchError(this.#pubkey, signed.pubkey);
    }
    return signed;
  }

  async getRelays() {
    return this.#inner.getRelays();
  }

  #cipher(kind: 'nip44' | 'nip04') {
    const cipher = this.#inner[kind];
    if (!cipher) throw new Error(`${kind.toUpperCase()} encryption not supported by extension`);
    return cipher;
  }

  /** Share one extension round trip between concurrent operations. */
  #assertAccount(): Promise<void> {
    if (Date.now() - this.#checkedAt < CHECK_TTL_MS) return Promise.resolve();
    if (!this.#inflight) {
      this.#inflight = this.#inner
        .getPublicKey()
        .then((active) => {
          if (active !== this.#pubkey) {
            throw new ExtensionAccountMismatchError(this.#pubkey, active);
          }
          this.#checkedAt = Date.now();
        })
        .finally(() => {
          this.#inflight = null;
        });
    }
    return this.#inflight;
  }
}

/** The extension's active pubkey, or undefined if there is no extension or it refuses. */
export async function getExtensionPubkey(): Promise<string | undefined> {
  if (!(globalThis as { nostr?: unknown }).nostr) return undefined;
  try {
    return await new NBrowserSigner().getPublicKey();
  } catch {
    return undefined;
  }
}
