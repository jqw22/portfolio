import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { dayChangePercentOf, type GroupSummary, type GroupSummaryTable } from '@/lib/analysis';
/** A whole amount with thousands separators and no currency symbol, e.g. `12,345` or `-49`. */
function formatAmount(value: number): string {
  const safe = Number.isFinite(value) ? Math.round(value) : 0;
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(safe === 0 ? 0 : safe);
}

/** Printable area of an A4 portrait page with 12mm margins, in CSS pixels. */
const MM = 96 / 25.4;
const PAGE_WIDTH_PX = (210 - 24) * MM;
const PAGE_HEIGHT_PX = (297 - 24) * MM;

interface PrintTableProps {
  title: string;
  groupHeading: string;
  unnamedLabel: string;
  summary: GroupSummaryTable;
  showCash?: boolean;
  showShare?: boolean;
  /** Narrow first column, for labels (at most 10 characters). */
  narrowName?: boolean;
}

function signClass(value: number): string {
  if (Math.round(value) === 0) return '';
  return value > 0 ? 'gain' : 'loss';
}

function Cells({ row, showCash, showShare }: { row: GroupSummary; showCash: boolean; showShare: boolean }) {
  const dayPercent = dayChangePercentOf(row);
  return (
    <>
      <td className="num">{row.isCash ? '—' : row.positions}</td>
      <td className="num">{formatAmount(row.costBasis)}</td>
      <td className={`num ${dayPercent !== null ? signClass(row.dayChange) : ''}`}>
        {dayPercent !== null ? formatAmount(row.dayChange) : '—'}
      </td>
      <td className="num">
        {formatAmount(row.currentValue)}
        {row.unpriced > 0 ? <span className="sub"> ({row.unpriced} at cost)</span> : null}
      </td>
      {showCash ? <td className="num">{formatAmount(row.cash)}</td> : null}
      <td className={`num ${row.priced > 0 ? signClass(row.unrealised) : ''}`}>
        {row.priced > 0 ? formatAmount(row.unrealised) : '—'}
      </td>
      {showShare ? <td className="num">{`${(row.share * 100).toFixed(1)}%`}</td> : null}
    </>
  );
}

function PrintTable({ title, groupHeading, unnamedLabel, summary, showCash = false, showShare = false, narrowName = false }: PrintTableProps) {
  return (
    <section className={narrowName ? 'narrow-name' : undefined}>
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            <th className="name">{groupHeading}</th>
            <th className="num">Positions</th>
            <th className="num">Cost basis</th>
            <th className="num">Day change</th>
            <th className="num">Current value</th>
            {showCash ? <th className="num">Cash</th> : null}
            <th className="num">Unrealised</th>
            {showShare ? <th className="num">Share</th> : null}
          </tr>
        </thead>
        <tbody>
          {summary.rows.map((row) => (
            <tr key={row.key} className={row.isCash ? 'cash' : undefined}>
              <td className="name">{row.name ?? <span className="muted">{unnamedLabel}</span>}</td>
              <Cells row={row} showCash={showCash} showShare={showShare} />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="name">Total</td>
            <Cells row={summary.total} showCash={showCash} showShare={showShare} />
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

interface AnalysisPrintSheetProps {
  accountSummary: GroupSummaryTable;
  labelSummary: GroupSummaryTable;
  currency: string;
  /** Called once the print dialog has closed. Keep it stable (useCallback). */
  onDone: () => void;
}

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * The By account and By label tables laid out for one A4 page. While it is
 * mounted, printing shows only this sheet; it shrinks itself to fit the page
 * when the tables are too long, then opens the browser's print dialog.
 */
export function AnalysisPrintSheet({ accountSummary, labelSummary, currency, onDone }: AnalysisPrintSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.zoom = '';
    const scale = Math.min(1, PAGE_HEIGHT_PX / sheet.scrollHeight);
    if (scale < 1) sheet.style.zoom = String(Math.floor(scale * 1000) / 1000);

    document.body.classList.add('printing-analysis');
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      document.body.classList.remove('printing-analysis');
      onDone();
    };
    window.addEventListener('afterprint', finish);
    // Let the browser lay the sheet out before the dialog opens.
    const timer = window.setTimeout(() => {
      window.print();
      // Some browsers never fire afterprint; print() blocks until the dialog closes in most.
      window.setTimeout(finish, 500);
    }, 50);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
      document.body.classList.remove('printing-analysis');
    };
  }, [onDone]);

  const now = new Date();
  return createPortal(
    <div ref={sheetRef} className="analysis-print-sheet" style={{ width: PAGE_WIDTH_PX }}>
      <header>
        <h1>Portfolio summary</h1>
        <p>
          {`Amounts in ${currency} · `}
          {now.toLocaleString('en-GB', DATE_TIME)}
        </p>
      </header>
      <PrintTable
        title="By account"
        groupHeading="Account"
        unnamedLabel="No account"
        summary={accountSummary}
        showCash
      />
      <PrintTable
        title="By label"
        groupHeading="Label"
        unnamedLabel="Unlabelled"
        summary={labelSummary}
        showShare
        narrowName
      />
      <p className="note">
        Unpriced holdings count at cost. Each position counts under the label of its latest labelled trade.
      </p>
    </div>,
    document.body,
  );
}
