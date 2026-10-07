# Prepare safe order operations

For a fresh private project, run **`bootstrap-private-cloud.sql` only**, as one complete SQL Editor transaction. It contains the schema, owner policies, private bucket, and exact embedded atomic definitions from `safe-order-operations.sql`. No remote SQL or live integration has been performed by this work unit; local execution uses simulated Supabase schemas.

## Fresh private setup

Follow [the exact operator sequence](../docs/SETUP.md#apply-the-sql-safely) for project `frkxjospolfxnkcgbgko`. Use an authorized privileged SQL Editor role, never browser credentials. The bootstrap rejects any existing application table/function/bucket and any Storage object policy, including unrelated policies. It does not replace objects or repair unknown state. Reruns fail closed, even after successful setup.

Private references are `{owner_uuid}/{file_uuid}.jpg` (also JPEG/PNG) or `{owner_uuid}/verification/{file_uuid}.{jpg,jpeg,png,pdf,xls,xlsx}`. Direct writes, restore, and photo additions/removals enforce ownership and reject URLs, traversal, encoded slashes, null elements, and foreign prefixes. The bucket is private, limited to 20 MiB and the five documented MIME types; INSERT/SELECT/DELETE policies are authenticated owner-only. RPCs are security-invoker with bounded search paths and authenticated-only execution. Do not activate the frontend until private upload/rendering and configured-build work are complete.

## Generic migration after audited provisioning

`safe-order-operations.sql` is retained for separately audited existing schemas; it does not provision private Storage and allows legacy HTTPS photo references. Do not use it instead of the private bootstrap for this fresh project.

1. Prepare the table, authentication, owner-only grants/RLS, and Storage in [SETUP](../docs/SETUP.md).
2. Inspect constraints, triggers, foreign keys, grants, and every applicable RLS policy. Back up any existing data and test recovery outside production.
3. Review the complete migration. It fails its preflight unless writable columns, UUID identity, unique IDs, authenticated privileges, enabled RLS, and applicable policies exist. Policy presence alone does not prove correct ownership semantics.
4. Apply it to the new project's staging environment and verify two-owner isolation before activating the frontend configuration.

## Contracts

| Boundary | Behavior |
|---|---|
| `restore_work_orders(jsonb, uuid)` | Validates all rows, preserves UUIDs, upserts, then removes omitted owner rows in one transaction. Any database failure rolls back the entire restore. |
| `change_order_photos(uuid, jsonb, jsonb, uuid)` | Locks the owner row, merges unique additions/removals against the latest array, and returns the result. Empty deltas provide a no-op preflight. Additions to finalized orders are rejected. |
| Verification columns | Adds `verification_checklist` and `verification_files`, canonical checklist validation, and safe attachment-path constraints. Legacy empty checklists remain valid. |
| Authorization | Both mutation RPCs use `SECURITY INVOKER`, validate `auth.uid()` against the supplied owner, and grant execution only to `authenticated`. No table grants or RLS policies are added by the migration. |

The browser fails closed when an RPC is missing. There is no direct-table photo-array fallback and no browser-side DELETE-then-INSERT restore.

## Backup and upload recovery

- Restore accepts snake_case exports and the legacy `orderNumber` / `createdAt` aliases. Only legacy records without an identity or with the documented sample placeholder receive a new UUID.
- Unknown fields, foreign owners, duplicate/invalid IDs, invalid dates, malformed photos/checklists, empty backups, more than 10,000 rows, and payloads over 20 MiB are rejected before the restore RPC.
- Backups preserve Storage references, not file contents. Transaction rollback cannot undo custom trigger/webhook effects.
- Explicit failed writes compensate only uploads attributable to that operation. Uncertain commits preserve uploads, including across retry rejection. Removed order-photo objects are retained intentionally.
- Verification attachment updates use owner-filtered table writes, not a dedicated atomic merge RPC. Concurrent whole-checklist saves are last-write-wins; operators should avoid simultaneous editing of the same sheet.

## Verification and rollback

`npm test` includes bootstrap lockstep assertions and real inline frontend tests with mocked boundaries. `node --test tests/database.test.mjs` requires local `initdb`, `pg_ctl`, and `psql`; it creates a fresh socket-only temporary cluster, strips ambient PostgreSQL/DSN settings, and cleans only that cluster. It executes the full private bootstrap with simulated auth/Storage schemas, tests rollback on unexpected policies/public bucket, and proves two-owner table/media isolation. This is real PostgreSQL execution, not proof of the hosted Storage service or real API behavior.

To disable restore/photo mutations, an authorized operator can revoke execution on exactly `restore_work_orders(jsonb, uuid)` and `change_order_photos(uuid, jsonb, jsonb, uuid)` from `authenticated`. The frontend then reports failure without unsafe fallback. Preserve verification columns containing data; dropping them is not a frontend rollback.
