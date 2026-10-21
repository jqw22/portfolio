import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ExternalLink, Loader2, Puzzle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  useLoginActions,
  generateNostrConnectParams,
  generateNostrConnectURI,
  type NostrConnectParams,
  type NostrConnectStatus,
} from '@/hooks/useLoginActions';

interface AuthDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Permissions asked of a remote signer during a nostrconnect handshake, so it
 * can approve them up front instead of prompting for every sync. Ledger signs
 * its own kind 30078 events, encrypts them to the user's key with NIP-44, and
 * answers relay AUTH (kind 22242).
 */
const SIGNER_PERMS = 'sign_event:30078,sign_event:22242,nip44_encrypt,nip44_decrypt';

const validateBunkerUri = (uri: string) => uri.startsWith('bunker://');

const connectStatusLabel = (status: NostrConnectStatus | null): string => {
  switch (status) {
    case 'awaiting-connect':
      return 'Waiting for signer connection…';
    case 'getting-public-key':
      return 'Getting public key…';
    default:
      return '';
  }
};

/** Check if running on an actual mobile device (not just a small screen). */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Whether a NIP-07 extension has injected `window.nostr`. */
function hasExtension(): boolean {
  return typeof window !== 'undefined' && 'nostr' in window && Boolean((window as { nostr?: unknown }).nostr);
}

/**
 * Login dialog. Ledger never handles a secret key: the user logs in with a
 * NIP-07 browser extension or a NIP-46 remote signer (bunker), and the signer
 * does all signing and NIP-44 encryption.
 */
const AuthDialog: React.FC<AuthDialogProps> = ({ isOpen, onClose }) => {
  const [extensionFound, setExtensionFound] = useState(false);
  const [isExtensionLoggingIn, setIsExtensionLoggingIn] = useState(false);
  const [extensionError, setExtensionError] = useState('');

  const [bunkerInput, setBunkerInput] = useState('');
  const [isBunkerLoggingIn, setIsBunkerLoggingIn] = useState(false);
  const [bunkerError, setBunkerError] = useState('');

  // Nostrconnect ("Open signer app") state. No QR code is shown — the URI is
  // launched directly on the device and the app listens for the handshake.
  const [nostrConnectParams, setNostrConnectParams] = useState<NostrConnectParams | null>(null);
  const [nostrConnectUri, setNostrConnectUri] = useState('');
  const [connectError, setConnectError] = useState<string | null>(null);
  // Progress status for the nostrconnect handshake. `null` means the user
  // hasn't launched the signer yet (or they canceled).
  const [connectStatus, setConnectStatus] = useState<NostrConnectStatus | null>(null);
  // Whether the user has launched the signer app. Until then we show the
  // login options; once launched we swap in the progress view.
  const [hasOpenedSigner, setHasOpenedSigner] = useState(false);

  const login = useLoginActions();
  // Stable refs so the nostrconnect listening effect below doesn't restart on
  // every parent render. Parents typically pass inline arrow functions for
  // onClose, and useLoginActions returns a fresh object each render — without
  // stable refs, an effect depending on them would tear down the in-flight
  // subscription on every render and cause approved logins to be swallowed.
  const loginRef = useRef(login);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    loginRef.current = login;
  }, [login]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Reset state when the dialog closes, and look for an extension when it
  // opens (extensions can inject `window.nostr` after the page has loaded).
  // This is the "reset state when a prop changes" pattern; the usual
  // React-preferred alternative is a `key` prop on the caller, but the
  // public API of this component is a simple open/close boolean, so we
  // reset here. The multiple setState calls are intentional.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (isOpen) {
      setExtensionFound(hasExtension());
      return;
    }
    setIsExtensionLoggingIn(false);
    setExtensionError('');
    setBunkerInput('');
    setIsBunkerLoggingIn(false);
    setBunkerError('');
    setNostrConnectParams(null);
    setNostrConnectUri('');
    setConnectError(null);
    setConnectStatus(null);
    setHasOpenedSigner(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, [isOpen]);

  // Generate a nostrconnect session and return its URI. The listening effect
  // (keyed on the params) handles the handshake once params are set.
  const generateConnectSession = useCallback((): string => {
    const relayUrls = login.getRelayUrls();
    const params = generateNostrConnectParams(relayUrls);
    const baseUri = generateNostrConnectURI(params, {
      name: 'Ledger',
      // Bring the user back to this app (respecting the GitHub Pages base
      // path) once the signer app has approved the connection.
      callback: isMobileDevice() ? `${window.location.origin}${import.meta.env.BASE_URL}` : undefined,
    });
    const uri = `${baseUri}&perms=${encodeURIComponent(SIGNER_PERMS)}`;
    setNostrConnectParams(params);
    setNostrConnectUri(uri);
    setConnectError(null);
    return uri;
  }, [login]);

  // Start listening for a nostrconnect response once params are set.
  //
  // Deps are intentionally limited to `nostrConnectParams` so that parent
  // re-renders (which produce fresh onClose closures and a fresh `login`
  // object from useLoginActions) do NOT tear down an in-flight
  // subscription. An earlier version used a `cancelled` flag flipped by
  // the effect's cleanup, which caused a successful nostrconnect response
  // to be silently swallowed after the signer approved — the subscription
  // was re-created mid-handshake and the first instance's success branch
  // saw `cancelled === true`.
  //
  // Cancellation is handled explicitly by the `isOpen` effect (on dialog
  // close) and by handleConnectRetry() (on user cancel/retry).
  useEffect(() => {
    if (!nostrConnectParams) return;

    const startListening = async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        await loginRef.current.nostrconnect(
          nostrConnectParams,
          controller.signal,
          (status) => {
            if (controller.signal.aborted) return;
            setConnectStatus(status);
          },
        );
        // If the dialog was explicitly closed (handled by the isOpen
        // effect, which aborts the controller), don't try to re-close it.
        // Otherwise the user is logged in — close the dialog.
        if (controller.signal.aborted) return;
        onCloseRef.current();
      } catch (error) {
        // AbortError means we intentionally aborted (dialog closed or retry)
        if (error instanceof Error && error.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        console.error('Nostrconnect failed:', error);
        setConnectStatus(null);
        setConnectError(error instanceof Error ? error.message : String(error));
      }
    };

    startListening();

    // No cleanup here: we do NOT want a re-render-triggered effect teardown
    // to cancel the in-flight subscription.
  }, [nostrConnectParams]);

  const handleConnectRetry = useCallback(() => {
    abortControllerRef.current?.abort();
    setNostrConnectParams(null);
    setNostrConnectUri('');
    setConnectError(null);
    setConnectStatus(null);
    setHasOpenedSigner(false);
  }, []);

  // Launch a remote signer app via nostrconnect. Generates the session (if
  // needed) and navigates to the URI; the listening effect handles the
  // handshake. No QR code is shown.
  const handleOpenSignerApp = () => {
    setBunkerError('');
    setHasOpenedSigner(true);
    const uri = nostrConnectUri || generateConnectSession();
    if (uri) {
      window.location.href = uri;
    }
  };

  const handleExtensionLogin = async () => {
    setIsExtensionLoggingIn(true);
    setExtensionError('');
    try {
      await login.extension();
      onClose();
    } catch (error) {
      setExtensionError(
        hasExtension()
          ? error instanceof Error ? error.message : 'The extension did not allow the login.'
          : 'No Nostr extension found in this browser.',
      );
      setIsExtensionLoggingIn(false);
    }
  };

  const handleBunkerLogin = () => {
    const value = bunkerInput.trim();
    if (!validateBunkerUri(value)) {
      setBunkerError('Enter a bunker://… address from your signer.');
      return;
    }

    setIsBunkerLoggingIn(true);
    setBunkerError('');
    login
      .bunker(value)
      .then(() => onClose())
      .catch(() => {
        setBunkerError('Failed to connect. Check the bunker address and that your signer is online.');
        setIsBunkerLoggingIn(false);
      });
  };

  const isBusy = isExtensionLoggingIn || isBunkerLoggingIn;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-sm max-h-[90dvh] p-0 gap-0 overflow-hidden rounded-2xl overflow-y-auto">
        <DialogHeader className="px-6 pt-6 space-y-2">
          <DialogTitle className="text-lg font-semibold leading-none tracking-tight text-center">
            Log in
          </DialogTitle>
          <DialogDescription className="text-center">
            Ledger never asks for your secret key. Your signer keeps it and encrypts your ledger for you.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 pt-5 space-y-5">
          {connectError ? (
            <div className="flex flex-col items-center space-y-3 py-4">
              <p className="text-sm text-destructive text-center">{connectError}</p>
              <Button variant="outline" onClick={handleConnectRetry} className="rounded-full">
                Try again
              </Button>
            </div>
          ) : hasOpenedSigner ? (
            <div className="flex flex-col items-center space-y-4 py-6 w-full">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground text-center min-h-[1.25rem]">
                {connectStatusLabel(connectStatus) || 'Waiting for your signer…'}
              </p>
              <button
                type="button"
                onClick={handleConnectRetry}
                className="text-sm text-primary hover:underline underline-offset-4 font-medium"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              {/* NIP-07 browser extension. */}
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Browser extension</h3>
                <Button
                  onClick={handleExtensionLogin}
                  disabled={isBusy}
                  className="w-full h-11 rounded-full"
                >
                  {isExtensionLoggingIn ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Puzzle className="w-4 h-4" />
                  )}
                  {isExtensionLoggingIn ? 'Waiting for extension…' : 'Log in with extension'}
                </Button>
                {extensionError ? (
                  <p className="text-sm text-destructive">{extensionError}</p>
                ) : (
                  !extensionFound && (
                    <p className="text-xs text-muted-foreground">
                      No extension detected. Install one such as Alby or nos2x, then reload this page.
                    </p>
                  )
                )}
              </section>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>

              {/* NIP-46 remote signer. */}
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Remote signer (bunker)</h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleBunkerLogin();
                  }}
                  className="space-y-2"
                >
                  <Input
                    value={bunkerInput}
                    onChange={(e) => {
                      setBunkerInput(e.target.value);
                      if (bunkerError) setBunkerError('');
                    }}
                    placeholder="bunker://…"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Bunker address"
                    className={bunkerError ? 'border-destructive focus-visible:ring-destructive' : ''}
                  />
                  {bunkerError && <p className="text-sm text-destructive">{bunkerError}</p>}
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={isBusy || !bunkerInput.trim()}
                    className="w-full rounded-full"
                  >
                    {isBunkerLoggingIn ? 'Connecting…' : 'Connect'}
                  </Button>
                </form>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleOpenSignerApp}
                  disabled={isBusy}
                  className="w-full rounded-full"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open signer app
                </Button>
              </section>

              <p className="text-xs text-muted-foreground text-center">
                New to Nostr? Create your key in a signer such as nsec.app, Amber (Android) or Alby, then log in here with it.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AuthDialog;
