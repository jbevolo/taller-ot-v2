# Taller OT v2

A mobile-first workshop dashboard with a disconnected, read-only demo and an independent Supabase setup path. **Publication and live cloud verification are pending.** Intended Pages URL: https://jbevolo.github.io/taller-ot-v2/.

## Quick start

Requires Node.js 24 or newer.

```sh
npm ci
npm run build
python3 -m http.server 8080 --directory dist
```

Open http://localhost:8080/ and choose **Explorar demo**. Build output always has empty cloud configuration, even if your local `config.js` contains values. HTTP localhost supports service workers; production requires HTTPS.

## Demo versus real cloud

| Demo | Independent cloud |
| --- | --- |
| Eight synthetic, in-memory orders | Authenticated, owner-scoped workshop records |
| Read-only; no writes, photos, exports or contacts | Existing order, verification, photo, print and backup tools |
| Offline shell after a successful online installation | Network required for authentication, data and actions |

Prepare a **new** Supabase project using [SETUP](docs/SETUP.md). No backend is provisioned or connected by this release. Public customer access is not enabled; an order UUID is not authorization.

## Verify locally

```sh
npm test
npm run test:browser
npm run build
npm audit --omit=dev
npm audit
git diff --check
```

The browser runner uses installed Chrome or an existing Playwright Chromium, with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` as an override. It blocks external destinations, preserves the four responsive viewport checks, and exercises the real service worker offline at `/taller-ot-v2/`. It does not prove live Supabase integration. The preexisting database suite is separate and was not required for this PWA unit.

## Pages and privacy

The parent publisher must create a sanitized root snapshot in **jbevolo/taller-ot-v2**, without inherited history/customer backups, then select **GitHub Actions** in Settings → Pages. `.github/workflows/pages.yml` tests and builds an explicit `dist/` allowlist using official Pages actions. Never upload the repository root or introduce service secrets into the workflow/artifact.

Only the shell, empty configuration, local CSS/SDK and icons ship. Tests, SQL, docs, backups, task files and Git metadata do not. Setup links open the repository documentation and require network. No runtime CDN, remote font or icon dependency exists. Tailwind and Supabase versions are pinned in the lockfile; vendor code is copied from the npm package, not downloaded at runtime.

The worker caches only allowlisted shell assets in its own `taller-ot-v2:` namespace. It never caches orders, customer images, Supabase/Storage responses or auth tokens, and has no synchronization queue. Cloud actions are not supported offline. Supabase's normal browser session storage, downloaded backups and public Storage URLs have separate privacy implications; see [SETUP](docs/SETUP.md#offline-and-privacy-limits).
