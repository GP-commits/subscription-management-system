# Frontend handoff in the shared repository

The team chose to submit both applications in GP-commits/subscription-management-system. The `frontend-handoff` branch includes `frontend/` alongside `backend/`, with separate dependencies, tests, and runtime processes. Original frontend commits were imported beneath `frontend/` with their authors and feature boundaries preserved.

## Running independently

Install Node 24.14 or newer Node 24, enter `frontend/`, run `npm ci`, and run `npm run dev`. Keep the backend running on port 4000. The Vite proxy maps `/api` to `http://localhost:4000`; `VITE_API_URL` can configure a different API base. Use consistent `localhost` hostnames in development so cookie sessions work.

Run `npm test` and `npm run build` before submitting changes. The frontend has its own package manifest, lockfile, source, environment example, README, and tests. The active frontend CI workflow lives in the root `.github/workflows/frontend-ci.yml`. Keep node_modules, runtime secrets, database files, and Git credentials untracked.

## Integration

Use [the API contract](api.md). Money values are in major currency units, dates use YYYY-MM-DD, requests include credentials, and server errors use `{error}`. All authorization and financial calculations are authoritative on the backend. The frontend must not manufacture paid statuses or dashboard totals.

For deployment, serve the frontend and reverse-proxy `/api` under the same HTTPS origin. Configure the backend's FRONTEND_URL accordingly. If using separate origins, cookie and origin policies must be configured and tested explicitly.

## Teammate push

After accepting repository collaborator access, the teammate can fetch `frontend-handoff` from the complete-repository Git bundle into a clone of the existing GitHub repository, verify `npm run check`, and push the branch. Open a pull request into `main`; use a merge commit to retain the feature history. Do not replace the backend repository with the older standalone frontend bundle or force-push unrelated history. Authentication as the teammate records who pushes; existing commit authors remain unchanged.

## Design

The owner requested a Zoho Billing-style application layout using the [official Odoo brand palette](https://www.odoo.com/page/brand-assets): purple #714B67, teal #017E84, gray #8F8F8F. The product retains the Brightloop name from the PDF. The interactive Zoho demo could not be inspected because browser approval was declined; the dashboard is an interpretation of that requested layout, not a verified pixel-for-pixel reproduction.
