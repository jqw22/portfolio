import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { dayChangePercentOf, type GroupSummary, type GroupSummaryTable } from '@/lib/analysis';
import { formatPercent, formatWhole } from '@/lib/portfolio';
import { cn } from '@/lib/utils';

interface AnalysisTableProps {
  title: string;
  description: string;
  /** Heading of the first column, e.g. "Account". */
  groupHeading: string;
  /** Name shown for the row with no account or no label. */
  unnamedLabel: string;
  summary: GroupSummaryTable;
  currency: string;
  /** Show the Share of value column (as a percentage). */
  showShare?: boolean;
  /** Show a Cash column after Current value. */
  showCash?: boolean;
  /** Makes each row's Positions count a link, e.g. to open Holdings filtered to the row. */
  onPositionsClick?: (row: GroupSummary) => void;
  /** Width class for the first column (labels are short, accounts can be longer). */
  nameWidth?: string;
}

function pnlClass(value: number): string {
  if (Math.round(value) === 0) return 'text-muted-foreground';
  return value > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
}

function formatShare(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function SummaryCells({
  row,
  currency,
  isTotal = false,
  showShare,
  showCash,
  onPositionsClick,
}: {
  row: GroupSummary;
  currency: string;
  isTotal?: boolean;
  showShare: boolean;
  showCash: boolean;
  onPositionsClick?: (row: GroupSummary) => void;
}) {
  const weight = isTotal ? 'font-semibold' : 'font-medium';
  const dayPercent = dayChangePercentOf(row);
  return (
    <>
      <TableCell className="text-right tabular-nums">
        {row.isCash ? (
          '—'
        ) : onPositionsClick && !isTotal && row.positions > 0 ? (
          <button
            type="button"
            className="font-medium text-sky-700 underline decoration-sky-700/30 underline-offset-4 hover:decoration-sky-700 dark:text-sky-400 dark:decoration-sky-400/30 dark:hover:decoration-sky-400"
            onClick={() => onPositionsClick(row)}
            title="Show these positions on Holdings"
          >
            {row.positions}
          </button>
        ) : (
          row.positions
        )}
      </TableCell>
      <TableCell className={cn('text-right tabular-nums', weight)}>{formatWhole(row.costBasis, currency)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {dayPercent !== null ? (
          <span className={cn(weight, pnlClass(row.dayChange))}>{formatWhole(row.dayChange, currency)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {dayPercent !== null ? (
          <span className={pnlClass(row.dayChange)}>{formatPercent(dayPercent, 1)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <span className={weight}>{formatWhole(row.currentValue, currency)}</span>
        {row.unpriced > 0 ? (
          <p className="mt-0.5 text-xs font-normal text-muted-foreground">{row.unpriced} at cost</p>
        ) : null}
      </TableCell>
      {showCash ? (
        <TableCell className={cn('text-right tabular-nums', weight)}>{formatWhole(row.cash, currency)}</TableCell>
      ) : null}
      <TableCell className={cn('text-right tabular-nums', !showShare && 'pr-6')}>
        {row.priced > 0 ? (
          <span className={cn(weight, pnlClass(row.unrealised))}>{formatWhole(row.unrealised, currency)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      {showShare ? (
        <TableCell className="pr-6 text-right tabular-nums">
          <span className={weight}>{formatShare(row.share)}</span>
        </TableCell>
      ) : null}
    </>
  );
}

/** One summary row per account or label, with a total row. */
export function AnalysisTable({ title, description, groupHeading, unnamedLabel, summary, currency, showShare = true, showCash = false, nameWidth = 'w-48', onPositionsClick }: AnalysisTableProps) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-0 border-b pt-5 [.border-b]:pb-5">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <Table className="min-w-[60rem] table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(nameWidth, 'pl-6')}>{groupHeading}</TableHead>
              <TableHead className="w-24 text-right">Positions</TableHead>
              <TableHead className="text-right">Cost basis</TableHead>
              <TableHead className="text-right">Day change</TableHead>
              <TableHead className="w-20 text-right">%</TableHead>
              <TableHead className="text-right">Current value</TableHead>
              {showCash ? <TableHead className="text-right">Cash</TableHead> : null}
              <TableHead className={cn('text-right', !showShare && 'pr-6')}>Unrealised</TableHead>
              {showShare ? <TableHead className="w-32 pr-6 text-right">Share of value</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.rows.map((row) => (
              <TableRow key={row.key} className={cn(row.isCash && 'bg-muted/30')}>
                <TableCell className="pl-6">
                  {row.name !== undefined ? (
                    <span className="block truncate font-semibold" title={row.name}>
                      {row.name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{unnamedLabel}</span>
                  )}
                </TableCell>
                <SummaryCells row={row} currency={currency} showShare={showShare} showCash={showCash} onPositionsClick={onPositionsClick} />
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-6">Total</TableCell>
              <SummaryCells row={summary.total} currency={currency} isTotal showShare={showShare} showCash={showCash} />
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}
