# Lime Smart Navigation

A London cycling-navigation prototype: choose a destination, compare routes, select parking, estimate the cost, and follow directions using device location. Built with React 19, TypeScript, TanStack Start, Tailwind CSS and Leaflet.

This guide moves development and deployment to GitHub. **GitHub stores the code; a hosting service runs the app.** GitHub Pages is not a drop-in host for this project because it includes server-rendered pages. The deployment path below uses Cloudflare Workers with automatic deployments from GitHub Actions.

## What is real and what is simulated

| Feature | Current source / limitation |
| --- | --- |
| Map | OpenStreetMap tiles through Leaflet; retain visible attribution. |
| Cycling routes | Public OSRM bike router, with simulated routes if the request fails. The endpoint contains `/driving`, but uses the provider's bike-routing deployment. |
| Location | Browser GPS with permission. Outside roughly 40 km of central London, or if unavailable/blocked, the app uses a demo London starting point. |
| Destination search | Fixed list of London places, not live geocoding. |
| Bikes and parking | Simulated, not a live Lime feed; parking has no capacity model. |
| Traffic and rerouting alerts | Simulated traffic, not TfL or another live traffic feed. |
| Prices | Placeholder rates: Lime £1 unlock + £0.25/minute; Lime Access £0 unlock + £0.08/minute. Not verified official prices. |
| Settings | Plan choice lives in memory and resets on reload. |
| Voice directions | Browser speech synthesis; availability varies by device. |

This is not an official Lime application and cannot unlock bikes or charge for rides. GPS updates depend on the browser remaining active; this is not background navigation. Simulated fallback routes are **not safe turn-by-turn routes**. A routing fallback does not make the map or app fully offline-capable.

## 1. Move the code to GitHub

If already connected, wait until the latest changes appear in your repository and clone it. Otherwise:

1. In Lovable, open **Project settings → Git**, connect GitHub, and select your account or organisation. This creates a **new private repository**; it cannot connect to an existing repository.
2. Alternatively, on a paid plan, use **Project settings → Git → Download codebase**, extract the source, and upload it to a repository you manage. Do not upload dependencies, build output, credentials, or repository metadata from another checkout.
3. Check that `README.md`, `package.json`, `bun.lock`, `bunfig.toml`, `vite.config.ts`, `src/`, and `public/` are in GitHub.
4. Deploy and test your new hosted app before disconnecting anything. To stop two-way editing from Lovable, disconnect in **Project settings → Git**. Reconnecting later creates a new repository rather than re-linking the old one.

While sync remains connected, avoid rewriting pushed history and keep the connected branch working. Once disconnected, GitHub and your hosting service become your development and deployment workflow; the Lovable Publish button no longer deploys that independent site.

## 2. Run locally

Install **Node.js 22.12+** (Vite 8 requires a supported modern Node version) and [Bun](https://bun.sh). Use Bun because this repository includes its lockfile.

```sh
git clone https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
cd YOUR-REPOSITORY
bun install --frozen-lockfile
bun run dev
```

Open the localhost address printed by Vite. For checks:

```sh
bun run test
bun run lint
bun run build
bun run preview
```

`preview` is for local inspection, not production hosting. Deployment commands below are intended for your local checkout or GitHub CI, outside the Lovable sandbox.

### Environment variables

**The current app needs no API keys or environment variables.** There is no connected database, app login service, payment service, or live traffic service to migrate. OSRM and OpenStreetMap are requested directly by the browser; Google Fonts also requires network access.

If you add private API keys later, keep them in the hosting service's secret storage and call the service from server-side code. Never commit them or place them in `VITE_*` variables: those are exposed to the browser. Do not copy Lovable platform environment variables into GitHub. If you later add a database, moving source code does not move its data or users.

## 3. Configure Cloudflare deployment

Create a Cloudflare account. In your local checkout, install its deployment CLI and commit the resulting `package.json` and `bun.lock` changes:

```sh
bun add -d wrangler
```

In `vite.config.ts`, retain the existing server entry and explicitly select the hosting target so CI cannot auto-detect a different provider:

```ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: {
    preset: "cloudflare-module",
    cloudflare: { nodeCompat: true, deployConfig: true },
  },
  tanstackStart: {
    server: { entry: "server" },
  },
});
```

The existing config package is a build dependency, not a requirement to host on Lovable. Keep it for this deployment; replacing it requires reconstructing its Vite, TanStack, Tailwind, and Nitro setup rather than simply removing the import.

Create `wrangler.json` in the repository root to set a stable deployment name:

```json
{
  "name": "lime-navigation",
  "compatibility_date": "2026-11-10",
  "compatibility_flags": ["nodejs_compat"]
}
```

Choose your own Worker name if necessary. Nitro generates the server entry and asset paths in `.output/server/wrangler.json`; deploy **that generated configuration**, not the minimal root file. `.output/` is already ignored by Git.

### First deployment from your computer

```sh
bunx wrangler login
bun run test
bun run build
bunx wrangler deploy --config .output/server/wrangler.json
```

Wrangler prints the deployed URL. For a local production-runtime check after building:

```sh
bunx wrangler dev --config .output/server/wrangler.json
```

Do not upload only the client assets to a static host: the generated server and assets must be deployed together. No React Router replacement or static-host `_redirects` file is needed.

## 4. Deploy automatically from GitHub

In GitHub, open **Repository Settings → Secrets and variables → Actions** and add:

- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: a scoped token using Cloudflare's **Edit Cloudflare Workers** template, restricted to the account hosting this app.

Do not use your global API key. For custom domain configuration, grant additional permissions only if required; the initial Worker deployment does not need to manage your DNS.

After completing the configuration in section 3, create `.github/workflows/deploy.yml`:

```yaml
name: Deploy Lime Navigation

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: production-deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.4.4'
      - run: bun install --frozen-lockfile
      - run: bun run test
      - run: bun run build
      - name: Deploy
        run: bunx wrangler deploy --config .output/server/wrangler.json
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Change `main` if your production branch has a different name. Use the same Bun version locally and in CI; update the pinned version together when upgrading. Review and pin action commit hashes if your organisation requires hardened CI. Pull requests do not deploy production with this workflow. Every successful push to the chosen branch tests, builds, and deploys the app; inspect failures in GitHub's **Actions** tab.

## 5. Domain and launch checks

You can start with the HTTPS `workers.dev` URL. To use your own domain, add it to the deployed Worker in Cloudflare's **Settings → Domains & Routes** and follow its DNS instructions. A domain connected to Lovable does not automatically move to Cloudflare; update DNS only after the new deployment works.

Check the deployed site on a real phone:

- Open the HTTPS URL, allow location, and confirm that it uses your real location when in London.
- Search for **Tate Modern**, compare routes, choose parking, inspect the cost, and start navigation.
- Switch between Lime and Lime Access in Settings and confirm the estimate changes.
- Check a route crossing the Thames uses an appropriate cycling bridge; do not treat simulated fallback paths as real directions.
- Try voice guidance, denied location permission, and an outside-London location.
- Refresh the page and confirm it still loads. Check browser and Cloudflare logs for failed requests or server errors.

GPS requires HTTPS (localhost is an exception) and browser permission. Location typically stops when the phone locks or the page is backgrounded. Check Cloudflare's current pricing and limits before launch. Public OSRM and OpenStreetMap tile services have usage policies and no guaranteed availability; a scaled production app should use appropriate hosted services or self-hosted infrastructure, with caching/rate control and attribution. See [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

## Troubleshooting

| Problem | Check |
| --- | --- |
| CI cannot install packages | Commit `bun.lock` alongside dependency edits; use the same Bun version. `bunfig.toml` also blocks very newly published package versions. |
| Build rejects Node version | Use Node 22.12+ or another version supported by the installed Vite release. |
| Deployment config is missing | Confirm section 3 is applied and `bun run build` succeeded; use a clean checkout outside Lovable, where output is `.output/`. |
| Deployment is denied | Check token scope, account ID, and repository secret names. |
| Location uses Clerkenwell | Permission is denied/unavailable, or GPS is outside the supported London area. |
| Routes look artificial | The OSRM request failed and the simulated planner was used. Inspect the browser's network/console output. |
| Map is blank | Check tile requests, network access, content blocking, attribution and provider usage limits. |
| Prices differ from Lime | Rates are placeholders; replace them with verified local prices in `src/lib/lime/data.ts`. |

To roll back, use Cloudflare's deployment/version rollback controls, or revert the bad change with a new GitHub commit and let CI redeploy. Do not rewrite synced Git history.

## Code map

- `src/routes/index.tsx` — journey screens, settings and navigation.
- `src/components/lime/MapView.tsx` — Leaflet map and overlays.
- `src/lib/lime/routing.ts` — OSRM cycling-route requests and fallback.
- `src/lib/lime/geo.ts` — location watching and London/demo fallback.
- `src/lib/lime/data.ts` — sample places, bikes, parking, traffic, route planner and rates.
- `src/lib/lime/plan.ts` — in-memory pricing-plan selection.
- `src/routes/__root.tsx` — shared page shell and fonts.
- `src/styles.css` — design tokens and styles.
- `src/server.ts`, `src/start.ts` — server entry and request middleware.
- `src/test/` — existing tests.

Deployment examples are documentation, not installed automation: this README does not create the workflow, add Wrangler, change your hosting, connect/disconnect GitHub, or deploy the app. Commands and generated paths were checked against the installed configuration packages; an independent Cloudflare deployment has not been run from this project.
