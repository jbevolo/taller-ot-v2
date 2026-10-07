# Taller OT v2

A mobile-first workshop dashboard with a disconnected, read-only demo and an independent Supabase setup path. **Publication and live cloud verification are pending.** Intended Pages URL: https://jbevolo.github.io/taller-ot-v2/.

## Quick start

Requires Node.js 24 or newer.

```sh
npm ci
npm run build
python3 -m http.server 8080 --directory dist
```

Open http://localhost:8080/ and choose **Explorar demo**. By default the build writes empty cloud configuration, and it never reads your local `config.js`. HTTP localhost supports service workers; production requires HTTPS.

## Optional: activate the cloud

The deployed build stays a disconnected demo until an operator supplies the public project values at build time:

```sh
TALLER_OT_SUPABASE_URL=https://<project-ref>.supabase.co \
TALLER_OT_EXPECTED_SUPABASE_URL=https://<project-ref>.supabase.co \
TALLER_OT_SUPABASE_PUBLISHABLE_KEY=<public publishable key> \
npm run build
```

All three are required together and validated: HTTPS `*.supabase.co` origin, matching expected target, public publishable key only (`sb_secret_*`, service-role and other JWT keys are rejected). The key value is safe to embed — RLS and Storage policies, not the key, decide what data a browser can reach — but it must never be committed to the repository, a workflow file, or documentation. Private photo links expire 5 minutes after signing; logout clears local references but cannot revoke links already issued or files already downloaded. See [SETUP](docs/SETUP.md#activate-the-deployed-build).

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

The parent publisher must create a sanitized root snapshot in **jbevolo/taller-ot-v2**, without inherited history/customer backups, then select **GitHub Actions** in Settings → Pages. `.github/workflows/pages.yml` runs the unchanged tests, then builds an explicit `dist/` allowlist using official Pages actions; on pushes to `main` it rebuilds with the repository activation variables/secret when present and otherwise builds the disconnected shell. Permissions are unchanged and no additional token scope was added. Never upload the repository root or paste a key value into the workflow/artifact.

Only the shell, `dist/config.js`, local CSS/SDK and icons ship. Tests, SQL, docs, backups, task files and Git metadata do not. Setup links open the repository documentation and require network. No runtime CDN, remote font or icon dependency exists. Tailwind and Supabase versions are pinned in the lockfile; vendor code is copied from the npm package, not downloaded at runtime.

The worker caches only allowlisted shell assets in its own `taller-ot-v2:` namespace. It never caches orders, customer images, Supabase/Storage responses or auth tokens, and has no synchronization queue. Cloud actions are not supported offline. Supabase's normal browser session storage, downloaded backups and public Storage URLs have separate privacy implications; see [SETUP](docs/SETUP.md#offline-and-privacy-limits).
