import { useEffect, useRef } from 'react';
import { NLogin, useNostrLogin } from '@nostrify/react/login';
import { toast } from '@/hooks/useToast';
import { getExtensionPubkey } from '@/lib/extensionSigner';

/**
 * Keeps an extension login in step with the NIP-07 extension. A site can't
 * choose which account the extension uses, so when the user switches
 * accounts in the extension, the app follows: it activates the matching
 * saved login, or adds one for the new account. Checked on load and
 * whenever the tab regains focus (switching happens in the extension popup).
 *
 * Mount once near the app root.
 */
export function ExtensionAccountSync() {
  const nostrLogin = useNostrLogin();
  const { logins } = nostrLogin;
  // The context hands out fresh functions every render; read them through a
  // ref so the listeners below are only set up when the login type changes.
  const loginRef = useRef(nostrLogin);
  useEffect(() => {
    loginRef.current = nostrLogin;
  }, [nostrLogin]);

  const current = logins[0];
  const isExtension = current?.type === 'extension';

  useEffect(() => {
    if (!isExtension) return;

    let running = false;
    const sync = async () => {
      if (running) return;
      running = true;
      try {
        const active = await getExtensionPubkey();
        const { logins: now, addLogin, setLogin } = loginRef.current;
        if (!active || now[0]?.type !== 'extension' || now[0].pubkey === active) return;

        const saved = now.find((l) => l.type === 'extension' && l.pubkey === active);
        if (saved) {
          setLogin(saved.id);
        } else {
          const login = new NLogin('extension', active, null);
          addLogin(login);
          setLogin(login.id);
        }
        toast({
          title: 'Switched account',
          description: 'Now using the account that is active in your signer extension.',
        });
      } finally {
        running = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };

    sync();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isExtension]);

  return null;
}
