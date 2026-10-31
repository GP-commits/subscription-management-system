import React from 'react';
import { money } from '../utils.js';

function monthLabel(month) {
  const parsed = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? String(month)
    : new Intl.DateTimeFormat('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(parsed);
}

const amount = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export default function RevenueChart({ monthly = [], currency = 'INR' }) {
  const axisAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
  const maximum = Math.max(
    1,
    ...monthly.flatMap((month) => [amount(month.invoiced), amount(month.payments)]),
  );
  return (
    <>
      <div
        className="chart-scroll"
        role="region"
        aria-label="Revenue comparison chart"
        tabIndex={0}
      >
        <div
          className="chart"
          aria-hidden="true"
          style={{ minWidth: Math.max(320, monthly.length * 72 + 96) }}
        >
          <div className="chart-axis">
            <span title={money(maximum, currency)}>{axisAmount.format(maximum)}</span>
            <span title={money(maximum / 2, currency)}>{axisAmount.format(maximum / 2)}</span>
            <span>{axisAmount.format(0)}</span>
          </div>
          <div className="chart-plot">
            <div className="chart-gridlines">
              <i />
              <i />
              <i />
            </div>
            {monthly.map((month) => (
              <div className="bar-group" key={month.month}>
                <div className="bar-pair">
                  <div
                    className="bar invoice-bar"
                    style={{ height: `${Math.max(0, (amount(month.invoiced) / maximum) * 100)}%` }}
                    title={`${monthLabel(month.month)}: invoiced ${money(month.invoiced, currency)}`}
                  />
                  <div
                    className="bar payment-bar"
                    style={{ height: `${Math.max(0, (amount(month.payments) / maximum) * 100)}%` }}
                    title={`${monthLabel(month.month)}: collected ${money(month.payments, currency)}`}
                  />
                </div>
                <span>{monthLabel(month.month)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <details className="chart-data">
        <summary>View monthly amounts</summary>
        <div className="table-scroll">
          <table>
            <caption>Monthly invoiced revenue and collected payments ({currency})</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="numeric">
                  Invoiced revenue
                </th>
                <th scope="col" className="numeric">
                  Collected payments
                </th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((month) => (
                <tr key={month.month}>
                  <th scope="row">
                    <time dateTime={month.month}>{monthLabel(month.month)}</time>
                  </th>
                  <td className="numeric">{money(month.invoiced, currency)}</td>
                  <td className="numeric">{money(month.payments, currency)}</td>
                </tr>
              ))}
              {!monthly.length && (
                <tr>
                  <td colSpan={3}>No monthly amounts in this period</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
