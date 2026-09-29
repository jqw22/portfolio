import { useState } from 'react';
import { Database, Download, FileUp, Sparkles, Trash2 } from 'lucide-react';

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
import { todayIso, type Transaction } from '@/lib/portfolio';

interface DataMenuProps {
  transactions: Transaction[];
  onRequestImport: () => void;
  onLoadSample: () => void;
  onClear: () => void;
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

export function DataMenu({ transactions, onRequestImport, onLoadSample, onClear }: DataMenuProps) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleExportCsv = () => {
    downloadFile(`stock-ledger-${todayIso()}.csv`, transactionsToCsv(transactions), 'text/csv;charset=utf-8');
    toast({
      title: 'CSV exported',
      description: `${transactions.length} transaction${transactions.length === 1 ? '' : 's'} downloaded.`,
    });
  };

  const handleExportJson = () => {
    downloadFile(
      `stock-ledger-${todayIso()}.json`,
      JSON.stringify(transactions, null, 2),
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
            disabled={transactions.length === 0}
            className="cursor-pointer gap-2"
          >
            <Download className="size-4" />
            Export CSV
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleExportJson}
            disabled={transactions.length === 0}
            className="cursor-pointer gap-2"
          >
            <Download className="size-4" />
            Export JSON
          </DropdownMenuItem>
          {transactions.length === 0 ? (
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
            disabled={transactions.length === 0}
            onClick={() => setConfirmOpen(true)}
            className="cursor-pointer gap-2"
          >
            <Trash2 className="size-4" />
            Clear all
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the entire ledger?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes all {transactions.length} transaction{transactions.length === 1 ? '' : 's'}. Export a backup
              first if you want to keep them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                onClear();
                setConfirmOpen(false);
                toast({ title: 'Ledger cleared' });
              }}
            >
              Clear all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
