import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { TransactionDialog } from '@/components/ledger/TransactionDialog';
import { makeCashMovement, makeTransaction, type CashMovement, type Transaction } from '@/lib/portfolio';

const held: Transaction[] = [
  makeTransaction({ symbol: 'AAPL', date: '2024-01-01', type: 'buy', quantity: 10, price: 100, account: 'ISA' }, 'buy-1'),
];
const funded: CashMovement[] = [
  makeCashMovement({ date: '2024-01-01', type: 'deposit', amount: 1500, account: 'ISA' }, 'dep-1'),
];

function renderDialog({ onSubmit = vi.fn(), onSubmitCash = vi.fn() } = {}) {
  render(
    <TransactionDialog
      open
      onOpenChange={() => {}}
      transaction={null}
      transactions={held}
      cash={funded}
      symbols={['AAPL']}
      currency="GBP"
      labels={[]}
      accounts={['ISA']}
      onCreateLabel={(label) => label}
      onDeleteLabel={() => {}}
      onSubmit={onSubmit}
      onSubmitCash={onSubmitCash}
    />,
  );
  return { onSubmit, onSubmitCash };
}

function chooseAccount() {
  // Radix Select renders a hidden native select that mirrors its options.
  const native = document.querySelector('select');
  if (!native) throw new Error('No native select');
  fireEvent.change(native, { target: { value: 'ISA' } });
}

function fillTrade(type: 'Buy' | 'Sell', quantity: string, price = '120') {
  fireEvent.click(screen.getByRole('button', { name: type }));
  chooseAccount();
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'AAPL' } });
  fireEvent.change(screen.getByLabelText('Trade date'), { target: { value: '2024-02-01' } });
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: quantity } });
  fireEvent.change(screen.getByLabelText(/Price/), { target: { value: price } });
  fireEvent.click(screen.getByRole('button', { name: 'Add transaction' }));
}

describe('TransactionDialog', () => {
  it('rejects a sell of more shares than are held', () => {
    const { onSubmit } = renderDialog();
    fillTrade('Sell', '15');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/sell more AAPL shares than you hold/)).toBeInTheDocument();
  });

  it('accepts a sell covered by the position', () => {
    const { onSubmit } = renderDialog();
    fillTrade('Sell', '10');

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'AAPL', type: 'sell', quantity: 10, account: 'ISA' }),
    );
  });

  it('requires an account', () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'AAPL' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add transaction' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Choose an account.')).toBeInTheDocument();
  });

  it('rejects a buy the account does not have the cash for', () => {
    // £1,500 deposited, £1,000 spent: £500 left.
    const { onSubmit } = renderDialog();
    fillTrade('Buy', '5', '101');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Not enough cash in ISA/)).toBeInTheDocument();
  });

  it('accepts a buy the account can pay for', () => {
    const { onSubmit } = renderDialog();
    fillTrade('Buy', '5', '100');

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ type: 'buy', quantity: 5, price: 100 }));
  });

  it('records a deposit', () => {
    const { onSubmitCash } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Deposit' }));
    chooseAccount();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add transaction' }));

    expect(onSubmitCash).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'deposit', amount: 250, account: 'ISA' }),
    );
  });

  it('rejects a withdrawal larger than the cash held', () => {
    const { onSubmitCash } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    chooseAccount();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add transaction' }));

    expect(onSubmitCash).not.toHaveBeenCalled();
    expect(screen.getByText(/Not enough cash in ISA/)).toBeInTheDocument();
  });
});
