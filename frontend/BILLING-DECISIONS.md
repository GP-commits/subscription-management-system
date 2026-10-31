# Billing decisions

The PDF specifies required capabilities but leaves these business policies open. These explicit implementation defaults keep the application deterministic and can be changed deliberately later.

| Topic                 | Implemented default                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Business and currency | One Brightloop business; configured currency, initially INR; two decimal places                                                               |
| Dates                 | UTC calendar dates for billing; date-only service periods                                                                                     |
| Pricing               | Plan base fee plus product lines; set plan price to zero for entirely line-based pricing                                                      |
| Variant pricing       | Variant surcharge is added to the entered base product unit price                                                                             |
| Charge timing         | Advance billing; generated invoices start Draft for team confirmation                                                                         |
| Month-end             | Preserve original billing anchor, clamping to the last valid day in a short month                                                             |
| Taxes                 | Administrator-defined exclusive percentages after discounts; no jurisdiction inference                                                        |
| Discounts             | One eligible rule per invoice, ordered by creation; no implicit stacking                                                                      |
| Usage limits          | Global invoice redemptions; draft invoices reserve a use, confirmation consumes it, cancellation releases it                                  |
| Pause                 | Bill any due periods before pausing; existing invoices remain due; resume skips paused periods and bills at the next original calendar anchor |
| Proration             | No automatic mid-period credit; contract end must align with billing boundaries                                                               |
| Closure               | Plan policy controls closure; already-issued invoices remain collectible                                                                      |
| Renewal               | Explicit extension of the existing contract term, retaining its history                                                                       |
| Payment               | Record actual receipts against a confirmed invoice; partial receipts accepted, overpayments rejected                                          |
| Revenue               | Confirmed invoiced charges excluding tax, separately from received payments                                                                   |
| Email                 | Real SMTP when configured; explicit local development outbox otherwise                                                                        |

These are configuration and product decisions, not claims about tax or accounting compliance. Set the actual business currency, tax rules, payment terms, and email service before entering live customer records.
