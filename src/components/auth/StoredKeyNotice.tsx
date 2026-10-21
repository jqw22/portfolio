import { useState } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import { useNostrLogin } from '@nostrify/react/login';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/useToast';

/**
 * Shown to anyone still logged in with a secret key saved in this browser
 * from before Ledger dropped nsec logins. The key is not removed
 * automatically, because it may be the only copy and losing it would lock the
 * user out of their encrypted ledger. Instead they are asked to move it into
 * an extension or signer and then remove it here.
 */
export function StoredKeyNotice() {
  const { logins, removeLogin } = useNostrLogin();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const login = logins[0];
  if (login?.type !== 'nsec') return null;

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(login.data.nsec);
      toast({ title: 'Secret key copied', description: 'Paste it into your extension or signer app.' });
    } catch {
      toast({ title: 'Could not copy the key', variant: 'destructive' });
    }
  };

  return (
    <>
      <Alert className="mb-6 border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
        <KeyRound />
        <AlertTitle>Your secret key is saved in this browser</AlertTitle>
        <AlertDescription className="text-amber-900 dark:text-amber-200">
          <p>
            Ledger now only logs in with a browser extension or a remote signer. Add this key to one of
            those, then remove it from this browser and log back in with it.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={copyKey}>
              <Copy className="size-4" />
              Copy key
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
              Remove key and log out
            </Button>
          </div>
        </AlertDescription>
      </Alert>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the key from this browser?</AlertDialogTitle>
            <AlertDialogDescription>
              Make sure the key is saved in your extension, signer app or somewhere safe first. Without it you
              cannot open your encrypted ledger again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeLogin(login.id)}>Remove key</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
