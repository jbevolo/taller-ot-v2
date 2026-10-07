# Prepare safe order operations

`safe-order-operations.sql` requires manual review and application by an authorized operator in the **new independent project**. Its presence in this repository does not mean it is deployed. T1 performs no database operations or live integration verification.

## Apply after provisioning

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

Use the focused frontend command in SETUP for mock-only checks. The separate `tests/database.test.mjs` suite manages a local PostgreSQL cluster; inspect its requirements and safety before running it. It was not run for T1.

To disable restore/photo mutations, an authorized operator can revoke execution on exactly `restore_work_orders(jsonb, uuid)` and `change_order_photos(uuid, jsonb, jsonb, uuid)` from `authenticated`. The frontend then reports failure without unsafe fallback. Preserve verification columns containing data; dropping them is not a frontend rollback.
