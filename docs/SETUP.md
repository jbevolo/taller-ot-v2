# Connect a new independent cloud

Taller OT v2 ships with an empty `config.js`. It makes no Supabase calls until a valid public configuration is supplied. Use a **new, independent project**; never copy the original application's project settings or customer data. No live cloud integration has been tested by this work unit.

## Explore before connecting

Open the application and choose **Explorar demo**. Eight synthetic orders demonstrate the dashboard, status filters, search, and keyboard-accessible details. The demo is read-only and keeps its records in memory; it has no customer contact destinations, photos, authentication, cloud queries, exports, or saves. Leaving the demo clears its records and drafts. The demo is available only with no active cloud client.

The dashboard's status counts describe the full set of loaded orders. Search and status filters combine before pagination (50 orders per page); clearing search keeps the selected status. On a configured cloud, **Nueva orden** opens the entry form. Printing, completion, deletion, photos, verification, and WhatsApp remain available inside each order's details; backup tools remain in the workspace navigation. Unsaved forms ask for confirmation before exit.

Connection labels distinguish an unconfigured cloud, local demo, browser-reported offline state, and the last confirmed cloud load. Browser connectivity alone never claims the cloud is reachable. A previous successful load is not a continuous health check.

## Setup path

1. Have the authorized operator prepare the new Supabase project, email authentication, table, owner policies, and Storage described below.
2. Review and apply `database/safe-order-operations.sql` following [the database guide](../database/README.md). It requires an existing table and audited RLS.
3. Copy the fields from `config.example.js` into `config.js`. Set `supabaseUrl` to the new HTTPS project origin and `supabaseKey` to its public publishable key (preferred) or legacy `anon` key.
4. Serve the application over HTTPS. Missing, invalid, or privileged configuration displays the setup screen without constructing a client. The current Pages build deliberately replaces configuration with empty values; changing local `config.js` does **not** activate the deployed cloud. A future authorized cloud activation must deliberately review the build's public configuration policy, rebuild and deploy.
5. Verify the new environment with synthetic records and two independent users before entering workshop data.

`config.js` is public. Never place `sb_secret_*`, `service_role`, database passwords, or management tokens there. Public keys are safe in the browser **only when RLS and Storage policies enforce the intended permissions**. The browser's key validation prevents common configuration mistakes; database authorization remains authoritative.

## Table and ownership

The following is a schema reference for the **new** project, not evidence of a deployed schema. An authorized operator must review it before applying it.

```sql
create table public.work_orders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id),
    order_number integer not null,
    fecha date not null,
    nombre text not null,
    telefono text default '',
    vehiculo text not null,
    dominio text not null,
    novedades text not null,
    garantia boolean default false,
    oblea boolean default false,
    ph boolean default false,
    nv boolean default false,
    retencion boolean default false,
    mangueras boolean default false,
    fotos text[] default '{}',
    status text default 'Abierta',
    monto_cobrado numeric,
    forma_pago text default '',
    notas_extra text default '',
    created_at timestamptz default now()
);

alter table public.work_orders enable row level security;
revoke all on public.work_orders from anon;
grant select, insert, update, delete on public.work_orders to authenticated;
create policy owner_orders on public.work_orders
    for all to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);
```

The migration adds `verification_checklist` (JSONB), `verification_files` (text array), their validation constraints, and the atomic restore/photo helpers. Checklist updates are owner-filtered table updates validated by those constraints; no checklist RPC exists.

Do not add anonymous `SELECT` policies to make customer links work. The existing `?id=<uuid>` route requires a signed-in owner and still applies owner filters and RLS. A UUID is not an authorization mechanism. Customer access needs a separately reviewed, narrowly scoped sharing endpoint before it can be enabled.

## Storage contract

- Bucket: `photos`. Photo paths are `{owner_uuid}/{random_uuid}.jpg`; verification attachments use `{owner_uuid}/verification/{random_uuid}.{extension}`.
- Allowed verification types: JPG, PNG, PDF, XLS, XLSX; the UI caps each verification attachment at 20 MiB. Configure matching bucket limits and content types.
- Upload and deletion policies must restrict authenticated users to their own first path segment, for example `(storage.foldername(name))[1] = (select auth.uid())::text`, together with `bucket_id = 'photos'`. Audit all existing policies; permissive policies combine with OR.
- The current application uses `getPublicUrl`, so it expects public object downloads. Anyone holding an object URL can read that object, even after logout. If private attachments are required, implement signed downloads and private-bucket policies before activation.
- Removing an order photo updates its database references atomically and preserves the object for backups or other references. Removing a verification attachment cleans up only a confirmed, owner-scoped path after the database save succeeds.
- Explicit write rejection compensates new uploads. Unknown write outcomes retain objects and show a recovery message. Check the order before retrying; new-order retries are blocked until reload to avoid duplicate inserts.

Backups contain URLs and paths, not object bytes. Restoring a backup does not transfer Storage objects between projects. `sample_backup.json` is an unmistakably fictional legacy-format example with no photo URLs.

## Authentication redirects

In the new project's Authentication → URL Configuration, set **Site URL** to `https://jbevolo.github.io/taller-ot-v2/` and allow that exact production redirect. Email confirmation uses the Site URL because this application's password signup does not supply a custom redirect. Add only the exact local testing origin/path you need (for example `http://localhost:8080/`); avoid broad production wildcards. Keep email confirmation enabled and test confirmation with synthetic users before activation. See [Supabase redirect documentation](https://supabase.com/docs/guides/auth/redirect-urls).

## Apply the SQL safely

Use the new project's SQL Editor to run the schema/RLS above, then the complete reviewed `database/safe-order-operations.sql`. Alternatively, an authorized operator can apply them through a private database connection:

```sh
# NEW_PROJECT_DATABASE_URL stays in the operator's environment, never in config.js or CI.
psql "$NEW_PROJECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f /private/path/new-project-schema.sql
psql "$NEW_PROJECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/safe-order-operations.sql
```

Save the schema/RLS block above as the first file, and review both before execution. These are operator instructions, not commands run by this release. For Storage, create the `photos` bucket only after accepting the public-download caveat above. Create authenticated `INSERT`, `SELECT`, and `DELETE` policies on `storage.objects`, each constrained to `bucket_id = 'photos'` and `(storage.foldername(name))[1] = (select auth.uid())::text`; use `WITH CHECK` for inserts and `USING` for reads/deletes. Never enable unrestricted uploads or change someone else's project policies.

## Offline and privacy limits

- The installed worker restores the shell and synthetic read-only demo after one successful online visit. First-ever offline visits cannot install it. Real-cloud authentication, queries and mutations require network; there is **no offline save or sync queue**.
- Only explicit local shell assets are cached. Query strings are not navigation cache keys; a cached shell still runs the original authenticated-owner checks for `?id=`. Customer data/images, API and Storage responses, arbitrary local URLs and authenticated requests never enter worker caches.
- Cleanup removes only this application's `taller-ot-v2:` caches, not sibling sites on `github.io`. Old unscoped `taller-ot-v1` caches are deliberately not deleted because ownership cannot be established. An operator can inspect/remove a known legacy cache manually in browser developer tools.
- Worker caches contain no auth tokens or orders. The Supabase SDK may persist its usual session in browser storage; signing out clears app state, not downloaded backup files or already public object URLs. Shared devices need explicit logout and operator-approved browser-data cleanup.
- Open tabs keep their matching worker until they close; there is no forced mid-form update. Increment the shell cache version in `sw.js` for future shell releases. Close old tabs and revisit online to install an update. Browser HTTP caches remain browser-managed; this is not an all-device erasure guarantee.
- Setup documentation is linked on GitHub, excluded from the Pages artifact, and unavailable offline. Build output remains disconnected until a separately authorized cloud activation.

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
