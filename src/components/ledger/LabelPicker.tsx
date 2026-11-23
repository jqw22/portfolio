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
import { findLabel, LABEL_MAX_LENGTH, normalizeNewLabel } from '@/lib/portfolio';

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
  /** A smaller button for use inside a table row. */
  compact?: boolean;
  /** What `usage` counts, for the delete confirmation (default "transaction"). */
  usageNoun?: string;
  /** Accessible name of the button, when there is no visible label for it. */
  ariaLabel?: string;
}

export function LabelPicker({
  id,
  value,
  labels,
  usage,
  onChange,
  onCreate,
  onDelete,
  compact = false,
  usageNoun = 'transaction',
  ariaLabel,
}: LabelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const typed = normalizeNewLabel(search);
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
            aria-label={ariaLabel}
            className={cn('w-full justify-between font-normal', compact && 'h-8 gap-1 px-2 text-sm')}
          >
            <span className={cn('flex min-w-0 items-center gap-2', compact && 'gap-1.5', !value && 'text-muted-foreground')}>
              <Tag className={cn('size-4 shrink-0', compact && 'size-3.5')} />
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
              placeholder={`Search or create (max ${LABEL_MAX_LENGTH})`}
              aria-label={`Search or create a label, up to ${LABEL_MAX_LENGTH} characters`}
              maxLength={LABEL_MAX_LENGTH}
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
              It will be removed from {pendingCount} {usageNoun}
              {pendingCount === 1 ? '' : 's'}. The {usageNoun}s themselves are kept.
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
