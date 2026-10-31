# Frontend handoff

## Ownership

Frontend contributors work in `frontend/`; backend contributors work in `backend/`. Shared interface and requirement documentation belongs in `docs/`. This is one repository whose applications will be independently runnable; it can be split into separate repositories later if requested.

## Integration contract to establish first

Agree authentication transport and CSRF policy, API base URL, role/capability responses, pagination/filtering, date/time formats, decimal money representation, currency codes, field validation errors, status values, and lifecycle action endpoints. Publish an OpenAPI contract before parallel application implementation.

## Screens

1. Registration, login, forgot/reset password.
2. Internal dashboard and filtered reports.
3. Customer management.
4. Product/variant and plan management.
5. Quotation templates and customer quotations.
6. Subscription list, detail, transition actions, and billing history.
7. Invoice list, detail, confirmation, cancellation, sending, and printing.
8. Payment recording and invoice allocation.
9. Customer portal restricted to the current customer's records.
10. Admin-only staff, tax, and discount management.

## Git workflow

Create a feature branch from current `main`, commit only the intended changes, push the branch, and open a pull request. Do not rewrite shared history. This repository is private, so a teammate needs repository access before they can clone or contribute. The teammate's identity and collaborator permissions will be handled when supplied by the owner.

## Acceptance

Provide loading, empty, error, validation, and permission-denied states. Connect all completed screens to real API behavior. Demonstrate customer isolation, permitted lifecycle actions, correct monetary display, and printable invoices. Track mocked or unfinished interactions explicitly.
