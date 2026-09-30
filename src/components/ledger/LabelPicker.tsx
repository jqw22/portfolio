import { useState } from 'react';
import { Check, ChevronsUpDown, Plus, Tag, Trash2, X } from 'lucide-react';

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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { findLabel, normalizeLabel } from '@/lib/portfolio';

interface LabelPickerProps {
  id?: string;
  value: string | undefined;
  labels: string[];
  /** How many saved transactions use each label, for the delete confirmation. */
  usage: Record<string, number>;
  onChange: (label: string | undefined) => void;
  /** Create a label and return its stored spelling. */
  onCreate: (label: string) => string | undefined;
  onDelete: (label: string) => void;
}

export function LabelPicker({ id, value, labels, usage, onChange, onCreate, onDelete }: LabelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const typed = normalizeLabel(search);
  const canCreate = Boolean(typed && !findLabel(labels, typed));

  const select = (label: string | undefined) => {
    onChange(label);
    setSearch('');
    setOpen(false);
  };

  const create = () => {
    if (!typed) return;
    const created = onCreate(typed);
    if (created) select(created);
  };

  const confirmDelete = (label: string) => {
    onDelete(label);
    if (value && value.toLowerCase() === label.toLowerCase()) onChange(undefined);
    setPendingDelete(null);
  };

  const requestDelete = (label: string) => {
    if ((usage[label] ?? 0) > 0) {
      setPendingDelete(label);
    } else {
      confirmDelete(label);
    }
  };

  const pendingCount = pendingDelete ? (usage[pendingDelete] ?? 0) : 0;

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch('');
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={cn('flex min-w-0 items-center gap-2', !value && 'text-muted-foreground')}>
              <Tag className="size-4 shrink-0" />
              <span className="truncate">{value ?? 'No label'}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-60 p-0" align="start">
          <Command>
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search or create a label"
              aria-label="Search or create a label"
              maxLength={64}
            />
            <CommandList>
              {!canCreate ? (
                <CommandEmpty className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {labels.length === 0 ? 'No labels yet. Type a name to create one.' : 'No matching labels.'}
                </CommandEmpty>
              ) : null}
              {value && !search ? (
                <CommandGroup>
                  <CommandItem value="__clear__" onSelect={() => select(undefined)}>
                    <X />
                    Remove label
                  </CommandItem>
                </CommandGroup>
              ) : null}
              {labels.length > 0 ? (
                <CommandGroup heading="Labels">
                  {labels.map((label) => {
                    const active = value?.toLowerCase() === label.toLowerCase();
                    return (
                      <CommandItem key={label} value={label} onSelect={() => select(label)} className="pr-1">
                        <Check className={cn(active ? 'opacity-100' : 'opacity-0')} />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete label ${label}`}
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            requestDelete(label);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}
              {canCreate ? (
                <>
                  {labels.length > 0 ? <CommandSeparator /> : null}
                  <CommandGroup forceMount>
                    <CommandItem value={`__create__${typed}`} onSelect={create} forceMount>
                      <Plus />
                      <span className="truncate">Create “{typed}”</span>
                    </CommandItem>
                  </CommandGroup>
                </>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(next) => !next && setPendingDelete(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete label “{pendingDelete}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be removed from {pendingCount} transaction{pendingCount === 1 ? '' : 's'}. The transactions
              themselves are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) confirmDelete(pendingDelete);
              }}
            >
              Delete label
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
