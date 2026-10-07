# Connect a new independent cloud

Taller OT v2 ships with an empty `config.js`. It makes no Supabase calls until a valid public configuration is supplied. Use a **new, independent project**; never copy the original application's project settings or customer data. No live cloud integration has been tested by this work unit.

## Explore before connecting

Open the application and choose **Explorar demo**. Eight synthetic orders demonstrate the dashboard, status filters, search, and keyboard-accessible details. The demo is read-only and keeps its records in memory; it has no customer contact destinations, photos, authentication, cloud queries, exports, or saves. Leaving the demo clears its records and drafts. The demo is available only with no active cloud client.

The dashboard's status counts describe the full set of loaded orders. Search and status filters combine before pagination (50 orders per page); clearing search keeps the selected status. On a configured cloud, **Nueva orden** opens the entry form. Printing, completion, deletion, photos, verification, and WhatsApp remain available inside each order's details; backup tools remain in the workspace navigation. Unsaved forms ask for confirmation before exit.

Connection labels distinguish an unconfigured cloud, local demo, browser-reported offline state, and the last confirmed cloud load. Browser connectivity alone never claims the cloud is reachable. A previous successful load is not a continuous health check.

## Setup path

1. Have the authorized operator open the independent project `frkxjospolfxnkcgbgko` (API origin `https://frkxjospolfxnkcgbgko.supabase.co`) and prepare email authentication.
2. Review and run the **entire** `database/bootstrap-private-cloud.sql` once in that project's SQL Editor, following [the database guide](../database/README.md). It includes the table, owner RLS, private Storage, and atomic functions; no second migration is needed.
3. Copy the fields from `config.example.js` into `config.js`. Set `supabaseUrl` to the new HTTPS project origin and `supabaseKey` to its public publishable key. Missing, invalid, or privileged configuration displays the setup screen without constructing a client. Local `config.js` is used only when you serve the source yourself; **the build never reads it**.
4. **Optional — activate the deployed Pages site.** Add repository Actions secrets/variables, then let a push to `main` build the configured shell (see [Activate the deployed build](#activate-the-deployed-build)). Without them the deployed build stays a disconnected demo, which is the default and a valid end state.
5. Verify the new environment with synthetic records and two independent users before entering workshop data. Live activation and cloud isolation remain unverified by this work unit; they require explicit authorization.

`config.js` is public. Never place `sb_secret_*`, `service_role`, database passwords, or management tokens there — not in the file, not in a workflow, not in documentation. Public keys are safe in the browser **only when RLS and Storage policies enforce the intended permissions**. The browser's key validation prevents common configuration mistakes; database authorization remains authoritative.

## Activate the deployed build

Activation is optional. Without the values below, `npm run build` and the Pages workflow publish a disconnected demo shell.

```sh
TALLER_OT_SUPABASE_URL=https://<new-project-ref>.supabase.co \
TALLER_OT_EXPECTED_SUPABASE_URL=https://<new-project-ref>.supabase.co \
TALLER_OT_SUPABASE_PUBLISHABLE_KEY=<public publishable key> \
npm run build
```

| Input | Meaning | Rejected when |
| --- | --- | --- |
| `TALLER_OT_SUPABASE_URL` | Bare HTTPS project origin | Not HTTPS, has credentials/path/query, not a `*.supabase.co` host |
| `TALLER_OT_EXPECTED_SUPABASE_URL` | Confirmation of the intended target | Does not equal the URL origin, so a wrong project cannot be activated |
| `TALLER_OT_SUPABASE_PUBLISHABLE_KEY` | Public publishable key only | `sb_secret_*`, any JWT, empty, or non-`sb_publishable_*` value |

All three are required together; a partial set fails the build before touching `dist/`. The build logs only the project origin, never the key. Only `dist/config.js` changes.

For the Pages workflow, set `TALLER_OT_SUPABASE_URL` and `TALLER_OT_EXPECTED_SUPABASE_URL` as repository **Actions variables** and `TALLER_OT_SUPABASE_PUBLISHABLE_KEY` as an **Actions secret** (secrets are used for the key even though it is publishable). The activated build runs only on pushes to `main` when all three exist; every other run builds the disconnected shell. Do not paste the key value into the workflow file or this document.

## Table and ownership

The bootstrap is the executable schema reference, not evidence of deployment. All fields are required except nullable `monto_cobrado`; defaults are described below.

| Fields | Type and contract |
|---|---|
| `id`, `user_id` | UUID primary key (random default), authenticated owner referencing `auth.users` |
| `order_number`, `fecha` | Positive integer; date |
| `nombre`, `vehiculo`, `dominio`, `novedades` | Required text |
| `telefono`, `forma_pago`, `notas_extra` | Text, empty default |
| `garantia`, `oblea`, `ph`, `nv`, `retencion`, `mangueras` | Boolean, false default |
| `fotos`, `verification_files` | Text arrays, empty default; canonical owner-prefixed private paths only |
| `verification_checklist` | JSONB, empty default or complete canonical twelve-item checklist |
| `status` | `Abierta` default or `Finalizada` |
| `monto_cobrado`, `created_at` | Nullable nonnegative numeric; timestamp with time zone, current-time default |

Only authenticated owners receive table CRUD access. RLS checks both existing and replacement ownership; anonymous access is not granted. Checklist updates remain owner-filtered table updates validated by constraints; no checklist RPC exists.

Do not add anonymous `SELECT` policies to make customer links work. The existing `?id=<uuid>` route requires a signed-in owner and still applies owner filters and RLS. A UUID is not an authorization mechanism. Customer access needs a separately reviewed, narrowly scoped sharing endpoint before it can be enabled.

## Storage contract

- Bucket: `photos`. Photo paths are `{owner_uuid}/{random_uuid}.jpg`; verification attachments use `{owner_uuid}/verification/{random_uuid}.{extension}`.
- The bootstrap creates a **private** bucket with a 20 MiB per-object limit and JPG/PNG/PDF/XLS/XLSX MIME allowlist. Photo references permit JPG/JPEG/PNG; attachment references also permit PDF/XLS/XLSX.
- INSERT, SELECT, and DELETE policies require `bucket_id = 'photos'`, the authenticated owner prefix, and the exact UUID filename shape. No UPDATE/upsert policy, anonymous policy, traversal, encoded separator, or foreign URL is accepted.
- Photos are resolved through session-scoped signed links that expire after 5 minutes and are renewed on access; attachments are downloaded through authenticated storage access. Durable records and backups keep stable owner-prefixed paths, never signed URLs.
- Removing an order photo updates its database references atomically and preserves the object for backups or other references. Removing a verification attachment cleans up only a confirmed, owner-scoped path after the database save succeeds.
- Explicit write rejection compensates new uploads. Unknown write outcomes retain objects and show a recovery message. Check the order before retrying; new-order retries are blocked until reload to avoid duplicate inserts.

Backups contain durable paths, not object bytes or expiring signed links. Restore rejects foreign owners and legacy photo URLs; it does not transfer Storage objects between projects. `sample_backup.json` is an unmistakably fictional legacy-format example with no photo URLs. Old generic atomic SQL can still accept HTTPS photo URLs for compatibility; the private bootstrap's table constraint and delta validation cannot.

## Authentication redirects

In the new project's Authentication → URL Configuration, set **Site URL** to `https://jbevolo.github.io/taller-ot-v2/` and allow that exact production redirect. Email confirmation uses the Site URL because this application's password signup does not supply a custom redirect. Add only the exact local testing origin/path you need (for example `http://localhost:8080/`); avoid broad production wildcards. Keep email confirmation enabled and test confirmation with synthetic users before activation. See [Supabase redirect documentation](https://supabase.com/docs/guides/auth/redirect-urls).

## Apply the SQL safely

1. Confirm the dashboard project reference is **frkxjospolfxnkcgbgko**, never the original project. Review the complete SQL before execution.
2. In SQL Editor, use the project's privileged database operator role (normally `postgres`), authorized to create tables/functions, grant permissions, insert bucket metadata, lock Storage tables, and create Storage policies. Never run as a browser role or paste database credentials into the application.
3. Paste the complete `database/bootstrap-private-cloud.sql`, including `begin;` and `commit;`, into one new query and run it once. SQL Editor cannot resolve `psql` include commands; all atomic definitions are embedded and tested in lockstep here.
4. If any statement fails, the transaction rolls back. If the editor retains an aborted transaction, issue `rollback;` before further inspection. Do not run selected fragments, remove guards, delete policies, or flip a public bucket to private to force success.
5. Confirm the owner policy, private bucket, size/MIME settings, and RPC grants in the dashboard. Report successful operator setup before any activation. Two synthetic users must subsequently prove owner isolation through the real API after authorization.

This is intentionally one-shot: any existing `work_orders` table (empty or populated), application helper, `photos` bucket (private or public), or Storage object policy causes an abort. Unrelated Storage policies also require manual audit because permissive policies OR together. A successful rerun also aborts safely; no automatic repair or destructive replacement is attempted. These instructions do not authorize the agent to run remote SQL.

## Offline and privacy limits

- The installed worker restores the shell and synthetic read-only demo after one successful online visit. First-ever offline visits cannot install it. Real-cloud authentication, queries and mutations require network; there is **no offline save or sync queue**.
- Only explicit local shell assets are cached. Query strings are not navigation cache keys; a cached shell still runs the original authenticated-owner checks for `?id=`. Customer data/images, API and Storage responses, arbitrary local URLs and authenticated requests never enter worker caches.
- Cleanup removes only this application's `taller-ot-v2:` caches, not sibling sites on `github.io`. Old unscoped `taller-ot-v1` caches are deliberately not deleted because ownership cannot be established. An operator can inspect/remove a known legacy cache manually in browser developer tools.
- Worker caches contain no auth tokens or orders. The Supabase SDK may persist its usual session in browser storage. Logging out clears local media references and revokes blob URLs, but signed photo links already issued stay usable until they expire (5 minutes) and files already downloaded cannot be revoked by the application. Shared devices need explicit logout and operator-approved browser-data cleanup.
- Open tabs keep their matching worker until they close; there is no forced mid-form update. The current shell cache version is `shell-v2`; increment it in `sw.js` for future shell releases. Close old tabs and revisit online to install an update. Browser HTTP caches remain browser-managed; this is not an all-device erasure guarantee.
- Setup documentation is linked on GitHub, excluded from the Pages artifact, and unavailable offline. Build output stays disconnected until an operator supplies the activation values and an authorized deployment follows.

## Local verification

```sh
npm ci
npm test
npm run test:browser
npm run build
npm audit --omit=dev
npm audit
git diff --check
```

The Node harness executes the real inline module with mocked browser and Supabase boundaries. The browser suite starts and stops its own loopback server, uses installed Chrome on macOS or an existing Playwright Chromium installation, and accepts `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for another local Chromium binary. It never downloads a browser. Install a browser separately if neither is available.

Browser checks cover 360, 390, 768, and 1440px layouts, keyboard focus, demo isolation, combined filters, pagination, unsaved changes, and a 420px-high camera dialog. UI scenarios use local build output and synthetic cloud mocks with service workers blocked; the separate PWA scenario serves the actual artifact under `/taller-ot-v2/`, installs the real worker, blocks all network, and loads a fresh shell/demo. External destinations are blocked. Screenshots are written under the OS temporary directory's `opencode/taller-ot-t2-*` folder, never into the repository. Passing these checks does not prove live integration or cross-browser/device behavior.

The local build uses pinned Tailwind 4.3.3 through its Node compiler with explicit source tokens, avoiding the vulnerable glob/watch trees in Tailwind 3 and the Tailwind CLI. It emits local CSS; the pinned Supabase 2.117.3 browser UMD bundle is copied from its npm artifact. Fonts use existing local/system fallbacks and decorative icons use local CSS symbols. Tailwind 4 targets Safari 16.4+, Chrome 111+, and Firefox 128+; only installed Chrome was verified here. Both production-only and full npm audits report zero advisories at this unit's verification boundary; rerun them before release.

After authorized cloud provisioning, verify owner isolation, logout during pending loads, missing-RPC failure, transactional restore, photo deltas, and verification attachments against synthetic data. Order numbers currently use browser `max + 1` and are not a concurrency-safe sequence. Publication, workflow execution on GitHub and deployed-site verification remain pending with the parent publisher. See [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
