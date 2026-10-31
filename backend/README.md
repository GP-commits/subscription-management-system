# Backend

Reserved for the independently runnable application API and billing worker. Keep backend source, database migrations, tests, and environment examples inside this directory.

Required modules: identity and roles, customers, catalog and variants, plans, quotation templates, subscriptions, taxes, discounts, recurring invoices, payment allocations, reporting, and audit records.

Financial operations must use precise decimal arithmetic, transactional database writes, authorization checks, and duplicate-billing protection. Scheduled work must recover safely from retries and missed executions.
