import { ExternalLink } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface YahooLinkButtonProps {
  /** Used in the label, e.g. "Apple Inc.". */
  stockName: string;
  href: string;
}

/** A small link icon beside a stock's name that opens its Yahoo Finance page in a new tab. */
export function YahooLinkButton({ stockName, href }: YahooLinkButtonProps) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${stockName} on Yahoo Finance`}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </TooltipTrigger>
      <TooltipContent side="top">Open on Yahoo Finance</TooltipContent>
    </Tooltip>
  );
}
