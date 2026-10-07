import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('private SQL Editor bootstrap is self-contained and atomic functions stay in lockstep', () => {
    const bootstrap = readFileSync(new URL('../database/bootstrap-private-cloud.sql', import.meta.url), 'utf8');
    const migration = readFileSync(new URL('../database/safe-order-operations.sql', import.meta.url), 'utf8');
    const functions = migration.slice(migration.indexOf('create or replace function public.verification_checklist_is_valid'), migration.indexOf("notify pgrst"));
    assert.ok(bootstrap.includes(functions), 'embedded atomic definitions must exactly match the reviewed migration');
    assert.match(bootstrap, /begin;/);
    assert.match(bootstrap, /commit;\s*$/);
    assert.doesNotMatch(bootstrap, /\\i\b|drop policy|public = true/i);
    assert.match(bootstrap, /20971520/);
    for (const command of ['insert', 'select', 'delete']) assert.match(bootstrap, new RegExp(`for ${command} to authenticated`, 'i'));
});
