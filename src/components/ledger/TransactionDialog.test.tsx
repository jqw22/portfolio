import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { TransactionDialog } from '@/components/ledger/TransactionDialog';
import { makeTransaction, type Transaction } from '@/lib/portfolio';

const held: Transaction[] = [
  makeTransaction({ symbol: 'AAPL', date: '2024-01-01', type: 'buy', quantity: 10, price: 100 }, 'buy-1'),
];

function renderDialog(onSubmit = vi.fn()) {
  render(
    <TransactionDialog
      open
      onOpenChange={() => {}}
      transaction={null}
      transactions={held}
      symbols={['AAPL']}
      currency="USD"
      labels={[]}
      accounts={[]}
      onCreateLabel={(label) => label}
      onDeleteLabel={() => {}}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

function fillSell(quantity: string) {
  fireEvent.click(screen.getByRole('button', { name: 'sell' }));
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'AAPL' } });
  fireEvent.change(screen.getByLabelText('Trade date'), { target: { value: '2024-02-01' } });
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: quantity } });
  fireEvent.change(screen.getByLabelText(/Price/), { target: { value: '120' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add transaction' }));
}

describe('TransactionDialog', () => {
  it('rejects a sell of more shares than are held', () => {
    const onSubmit = renderDialog();
    fillSell('15');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/sell more AAPL shares than you hold/)).toBeInTheDocument();
  });

  it('accepts a sell covered by the position', () => {
    const onSubmit = renderDialog();
    fillSell('10');

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'AAPL', type: 'sell', quantity: 10 }));
  });
});
