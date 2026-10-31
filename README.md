# Subscription Management System

Brightloop Software's subscription platform, based on the supplied Subscription Management System brief.

## Repository structure

- `frontend/`: planned independently runnable customer portal and internal web application; teammate-owned UI work will live here.
- `backend/`: planned API for authentication, authorization, catalog, subscriptions, recurring billing, invoices, payments, and reports.
- `docs/requirements.md`: brief-derived acceptance checklist.
- `docs/frontend-handoff.md`: collaboration boundaries and frontend handoff.

## Status

Initial repository setup. Application implementation has not started. No requirement is considered complete until its acceptance checks pass.

The first commit is `initial commit`. Subsequent commits should describe implemented behavior and include relevant validation.

## Collaboration

Use `frontend/<feature>` and `backend/<feature>` branches and pull requests into `main`. Keep commits focused on your own work. Agree API changes through the shared contract before integrating them. Do not commit secrets, local databases, customer data, or generated dependencies.

## Scope

Both frontend and backend are required. The source brief is authoritative for business requirements. Additional billing-policy choices must be documented explicitly; they must not silently remove requested functionality.
