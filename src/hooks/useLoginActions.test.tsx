import { afterEach, describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { useNostrLogin } from '@nostrify/react/login';

import { TestApp } from '@/test/TestApp';
import { useLoginActions } from './useLoginActions';

/** Install a fake NIP-07 extension that reports the given pubkey. */
function mockExtension(pubkey: string) {
  (window as { nostr?: unknown }).nostr = {
    getPublicKey: async () => pubkey,
    signEvent: async () => {
      throw new Error('not implemented');
    },
  };
}

afterEach(() => {
  delete (window as { nostr?: unknown }).nostr;
});

/**
 * Regression test: adding a second login while one is already logged in
 * must switch the current user to the new login (logins[0]). Without the
 * fix, addLogin appends the new login to the end of the array and
 * logins[0] remains the previously-logged-in user.
 */
describe('useLoginActions auto-switch', () => {
  it('promotes the newly added extension login to logins[0]', async () => {
    const pubkey1 = getPublicKey(generateSecretKey());
    const pubkey2 = getPublicKey(generateSecretKey());

    const { result } = renderHook(
      () => ({
        actions: useLoginActions(),
        login: useNostrLogin(),
      }),
      { wrapper: TestApp },
    );

    // NostrLoginProvider renders null while it reads logins from storage,
    // so wait for the provider to mount.
    await waitFor(() => expect(result.current).not.toBeNull());

    mockExtension(pubkey1);
    await act(() => result.current.actions.extension());
    expect(result.current.login.logins).toHaveLength(1);

    mockExtension(pubkey2);
    await act(() => result.current.actions.extension());

    expect(result.current.login.logins).toHaveLength(2);
    // The newly added login MUST be at index 0 (current user).
    expect(result.current.login.logins[0].pubkey).toBe(pubkey2);
  });

  it('no longer offers a secret key login', async () => {
    const { result } = renderHook(() => useLoginActions(), { wrapper: TestApp });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect('nsec' in result.current).toBe(false);
  });
});
