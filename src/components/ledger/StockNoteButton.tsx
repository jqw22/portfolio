import { useState } from 'react';
import { StickyNote } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { STOCK_NOTE_MAX_LENGTH } from '@/lib/portfolio';
import { cn } from '@/lib/utils';

interface StockNoteButtonProps {
  /** Shown in the editor's heading, e.g. "Apple Inc.". */
  stockName: string;
  note?: string;
  onSave: (note: string) => void;
}

/**
 * A note icon beside a stock's name. With a note it is always shown and the note
 * appears on hover; without one it only shows while the row is hovered, as a way
 * to add one. Clicking opens an editor either way.
 */
export function StockNoteButton({ stockName, note, onSave }: StockNoteButtonProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note ?? '');
  const [hovering, setHovering] = useState(false);
  const hasNote = Boolean(note);

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(note ?? '');
    setOpen(next);
  };

  const save = (value: string) => {
    onSave(value);
    setOpen(false);
  };

  const unchanged = draft.trim() === (note ?? '');

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
        <Tooltip delayDuration={150} open={hasNote && !open && hovering} onOpenChange={setHovering}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={hasNote ? `Note for ${stockName}` : `Add a note for ${stockName}`}
                className={cn(
                  'inline-flex size-6 shrink-0 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  hasNote
                    ? 'text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300'
                    : 'text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-50',
                )}
              >
                <StickyNote className="size-3.5" fill={hasNote ? 'currentColor' : 'none'} fillOpacity={0.2} />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          {hasNote ? (
            <TooltipContent side="top" align="start" className="max-w-xs text-left whitespace-pre-wrap text-pretty">
              {note}
            </TooltipContent>
          ) : null}
        </Tooltip>
      <PopoverContent align="start" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-medium">Note</p>
          <p className="truncate text-xs text-muted-foreground">{stockName}, shared by every account</p>
        </div>
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              save(draft);
            }
          }}
          maxLength={STOCK_NOTE_MAX_LENGTH}
          placeholder="Why you hold it, targets, reminders…"
          rows={5}
          autoFocus
          aria-label={`Note for ${stockName}`}
        />
        <div className="flex items-center justify-between gap-2">
          {hasNote ? (
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => save('')}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={unchanged} onClick={() => save(draft)}>
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
