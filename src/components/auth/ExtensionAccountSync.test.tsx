import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { NLogin, useNostrLogin } from '@nostrify/react/login';

import { TestApp } from '@/test/TestApp';
import { ExtensionAccountSync } from './ExtensionAccountSync';

function CurrentLogin() {
  const { logins } = useNostrLogin();
  return <p data-testid="current">{logins[0]?.pubkey ?? 'none'}</p>;
}

function stubExtension(pubkey: string) {
  (globalThis as { nostr?: unknown }).nostr = { getPublicKey: async () => pubkey };
}

afterEach(() => {
  delete (globalThis as { nostr?: unknown }).nostr;
  localStorage.clear();
});

describe('ExtensionAccountSync', () => {
  it('switches to a saved login that matches the extension account', async () => {
    const a = getPublicKey(generateSecretKey());
    const b = getPublicKey(generateSecretKey());
    const logins = [new NLogin('extension', a, null), new NLogin('extension', b, null)];
    localStorage.setItem('test-login', JSON.stringify(logins));
    stubExtension(b);

    render(
      <TestApp>
        <CurrentLogin />
        <ExtensionAccountSync />
      </TestApp>,
    );

    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent(b));
  });

  it('adds a login for a new extension account', async () => {
    const a = getPublicKey(generateSecretKey());
    const b = getPublicKey(generateSecretKey());
    localStorage.setItem('test-login', JSON.stringify([new NLogin('extension', a, null)]));
    stubExtension(b);

    render(
      <TestApp>
        <CurrentLogin />
        <ExtensionAccountSync />
      </TestApp>,
    );

    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent(b));
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('test-login') ?? '[]');
      expect(stored.map((l: { pubkey: string }) => l.pubkey)).toEqual([b, a]);
    });
  });
});
