import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RevenueChart from '../src/components/RevenueChart.jsx';

describe('accessible revenue comparison', () => {
  it('exposes exact monthly invoiced and collected amounts with currency and row headings', async () => {
    render(
      <RevenueChart
        monthly={[
          { month: '2026-09', invoiced: 15320.57, payments: 14200.25 },
          { month: '2026-10', invoiced: 17880, payments: 16300.75 },
        ]}
        currency="USD"
      />,
    );
    const region = screen.getByRole('region', { name: 'Revenue comparison chart' });
    expect(region).toHaveAttribute('tabindex', '0');
    await userEvent.setup().click(screen.getByText('View monthly amounts'));
    const table = screen.getByRole('table', {
      name: 'Monthly invoiced revenue and collected payments (USD)',
    });
    expect(within(table).getByRole('columnheader', { name: 'Invoiced revenue' })).toHaveAttribute(
      'scope',
      'col',
    );
    const september = within(table).getByRole('rowheader', { name: 'Sep 2026' });
    expect(september).toHaveAttribute('scope', 'row');
    expect(
      within(september.closest('tr'))
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['$15,320.57', '$14,200.25']);
    const october = within(table).getByRole('rowheader', { name: 'Oct 2026' });
    expect(
      within(october.closest('tr'))
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['$17,880.00', '$16,300.75']);
  });

  it('keeps zero amounts meaningful and handles an empty reporting period', async () => {
    const { rerender, container } = render(
      <RevenueChart monthly={[{ month: '2026-10', invoiced: 0, payments: 0 }]} currency="USD" />,
    );
    await userEvent.setup().click(screen.getByText('View monthly amounts'));
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['$0.00', '$0.00']);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    rerender(<RevenueChart monthly={[]} currency="USD" />);
    expect(
      screen.getByRole('cell', { name: 'No monthly amounts in this period' }),
    ).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('replaces old values and currency when filtered report data changes', async () => {
    const { rerender } = render(
      <RevenueChart monthly={[{ month: '2026-09', invoiced: 100, payments: 80 }]} currency="USD" />,
    );
    await userEvent.setup().click(screen.getByText('View monthly amounts'));
    rerender(
      <RevenueChart
        monthly={[{ month: '2026-10', invoiced: 250.5, payments: 200 }]}
        currency="EUR"
      />,
    );
    const table = screen.getByRole('table', {
      name: 'Monthly invoiced revenue and collected payments (EUR)',
    });
    expect(within(table).queryByRole('rowheader', { name: 'Sep 2026' })).not.toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Oct 2026' })).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['€250.50', '€200.00']);
    expect(within(table).queryByText('$100.00')).not.toBeInTheDocument();
  });

  it('preserves all months in a long history rather than dropping values for a narrow view', async () => {
    const monthly = Array.from({ length: 36 }, (_, index) => ({
      month: `${2024 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`,
      invoiced: (index + 1) * 100,
      payments: (index + 1) * 75,
    }));
    render(<RevenueChart monthly={monthly} currency="USD" />);
    await userEvent.setup().click(screen.getByText('View monthly amounts'));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('rowheader')).toHaveLength(36);
    expect(within(table).getByRole('rowheader', { name: 'Jan 2024' })).toBeInTheDocument();
    const lastMonth = within(table).getByRole('rowheader', { name: 'Dec 2026' });
    expect(
      within(lastMonth.closest('tr'))
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['$3,600.00', '$2,700.00']);
  });

  it('keeps large chart ticks concise while preserving precise ledger amounts', async () => {
    const { container } = render(
      <RevenueChart
        monthly={[{ month: '2026-10', invoiced: 100000000.25, payments: 90000000.75 }]}
        currency="USD"
      />,
    );
    expect(container.querySelector('.chart-axis')).toHaveTextContent('$100M');
    await userEvent.setup().click(screen.getByText('View monthly amounts'));
    const cells = within(screen.getByRole('table')).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual(['$100,000,000.25', '$90,000,000.75']);
  });
});
