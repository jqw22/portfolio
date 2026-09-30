import { useState } from 'react';
import { Database, Download, FileUp, RotateCcw, Sparkles } from 'lucide-react';

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/useToast';
import { transactionsToCsv } from '@/lib/csv';
import { todayIso, type Ledger } from '@/lib/portfolio';

interface DataMenuProps {
  ledger: Ledger;
  onRequestImport: () => void;
  onLoadSample: () => void;
  /** Delete every transaction, cash movement, label and account. */
  onReset: () => void;
}

function pluralize(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

function downloadFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function DataMenu({ ledger, onRequestImport, onLoadSample, onReset }: DataMenuProps) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { transactions, cash, labels, accounts } = ledger;
  const entryCount = transactions.length + cash.length;
  const isEmpty = entryCount === 0 && labels.length === 0 && accounts.length === 0;

  const handleExportCsv = () => {
    downloadFile(`stock-ledger-${todayIso()}.csv`, transactionsToCsv(transactions, cash), 'text/csv;charset=utf-8');
    toast({
      title: 'CSV exported',
      description: `${pluralize(entryCount, 'entry', 'entries')} downloaded.`,
    });
  };

  const handleExportJson = () => {
    downloadFile(
      `stock-ledger-${todayIso()}.json`,
      JSON.stringify({ transactions, cash, labels, accounts }, null, 2),
      'application/json;charset=utf-8',
    );
    toast({ title: 'JSON exported', description: 'A machine-readable backup was downloaded.' });
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Ledger data options">
            <Database />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={onRequestImport} className="cursor-pointer gap-2">
            <FileUp className="size-4" />
            Import CSV
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleExportCsv}
            disabled={entryCount === 0}
            className="cursor-pointer gap-2"
          >
            <Download className="size-4" />
            Export CSV
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleExportJson}
            disabled={entryCount === 0}
            className="cursor-pointer gap-2"
          >
            <Download className="size-4" />
            Export JSON
          </DropdownMenuItem>
          {entryCount === 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLoadSample} className="cursor-pointer gap-2">
                <Sparkles className="size-4" />
                Load sample data
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={isEmpty}
            onClick={() => setConfirmOpen(true)}
            className="cursor-pointer gap-2"
          >
            <RotateCcw className="size-4" />
            Reset ledger
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the entire ledger?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {pluralize(transactions.length, 'trade')},{' '}
              {pluralize(cash.length, 'deposit or withdrawal', 'deposits and withdrawals')},{' '}
              {pluralize(labels.length, 'label')} and {pluralize(accounts.length, 'account')}, here and on your
              relays. Export a backup first if you want to keep them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                onReset();
                setConfirmOpen(false);
                toast({ title: 'Ledger reset' });
              }}
            >
              Reset ledger
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
