# Separate frontend handoff

The frontend is supplied as a standalone source archive. It is not tracked in GP-commits/subscription-management-system, in accordance with the owner's request. The initial commit contained only a frontend placeholder README; application frontend code has never been pushed here.

## Running independently

Unzip the frontend source, install Node 24.14 or newer Node 24, run `npm ci`, and run `npm run dev`. Keep the backend running on port 4000. The Vite proxy maps `/api` to `http://localhost:4000`; `VITE_API_URL` can configure a different API base. Use consistent `localhost` hostnames in development so cookie sessions work.

Run `npm test` and `npm run build` before submitting changes. The archive contains its own package manifest, lockfile, source, environment example, README, tests, and future GitHub Actions workflow. No node_modules, runtime secrets, database, or Git credentials belong in the archive.

## Integration

Use [the API contract](api.md). Money values are in major currency units, dates use YYYY-MM-DD, requests include credentials, and server errors use `{error}`. All authorization and financial calculations are authoritative on the backend. The frontend must not manufacture paid statuses or dashboard totals.

For deployment, serve the frontend and reverse-proxy `/api` under the same HTTPS origin. Configure the backend's FRONTEND_URL accordingly. If using separate origins, cookie and origin policies must be configured and tested explicitly.

## Publishing later

When the owner supplies the friend's GitHub account or repository, initialize/push the independent frontend there with the account owner's authorization. Do not copy the backend .git directory or credentials. Keeping source separate means frontend contributors can commit and deploy without rewriting backend history.

## Design

The owner requested a Zoho Billing-style application layout using the [official Odoo brand palette](https://www.odoo.com/page/brand-assets): purple #714B67, teal #017E84, gray #8F8F8F. The product retains the Brightloop name from the PDF. The interactive Zoho demo could not be inspected because browser approval was declined; the dashboard is an interpretation of that requested layout, not a verified pixel-for-pixel reproduction.
