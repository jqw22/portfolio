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
import type { GroupSummary, GroupSummaryTable } from '@/lib/analysis';
import { formatWhole } from '@/lib/portfolio';
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
}

function pnlClass(value: number): string {
  if (Math.round(value) === 0) return 'text-muted-foreground';
  return value > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
}

function formatShare(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function SummaryCells({ row, currency, isTotal = false }: { row: GroupSummary; currency: string; isTotal?: boolean }) {
  const weight = isTotal ? 'font-semibold' : 'font-medium';
  return (
    <>
      <TableCell className="text-right tabular-nums">{row.isCash ? '—' : row.positions}</TableCell>
      <TableCell className={cn('text-right tabular-nums', weight)}>{formatWhole(row.costBasis, currency)}</TableCell>
      <TableCell className="text-right tabular-nums">
        <span className={weight}>{formatWhole(row.currentValue, currency)}</span>
        {row.unpriced > 0 ? (
          <p className="mt-0.5 text-xs font-normal text-muted-foreground">{row.unpriced} at cost</p>
        ) : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.priced > 0 ? (
          <span className={cn(weight, pnlClass(row.unrealised))}>{formatWhole(row.unrealised, currency)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.isCash ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={cn(weight, pnlClass(row.realisedPnl))}>{formatWhole(row.realisedPnl, currency)}</span>
        )}
      </TableCell>
      <TableCell className="pr-6 text-right tabular-nums">
        <span className={weight}>{formatShare(row.share)}</span>
        {!isTotal ? (
          <div className="mt-1.5 ml-auto h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${Math.min(100, Math.max(0, row.share * 100))}%` }}
            />
          </div>
        ) : null}
      </TableCell>
    </>
  );
}

/** One summary row per account or label, with a total row. */
export function AnalysisTable({ title, description, groupHeading, unnamedLabel, summary, currency }: AnalysisTableProps) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-0 border-b pt-5 [.border-b]:pb-5">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <Table className="min-w-[52rem] table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-48 pl-6">{groupHeading}</TableHead>
              <TableHead className="w-24 text-right">Positions</TableHead>
              <TableHead className="text-right">Cost basis</TableHead>
              <TableHead className="text-right">Current value</TableHead>
              <TableHead className="text-right">Unrealised</TableHead>
              <TableHead className="text-right">Realised P&L</TableHead>
              <TableHead className="w-32 pr-6 text-right">Share of value</TableHead>
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
                <SummaryCells row={row} currency={currency} />
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-6">Total</TableCell>
              <SummaryCells row={summary.total} currency={currency} isTotal />
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}
