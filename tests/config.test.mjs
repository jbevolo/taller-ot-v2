import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createApp, deferred, order, USER_A } from './browser-harness.mjs';

const config = key => ({ supabaseUrl: 'https://independent.example.test', supabaseKey: key });
const jwt = role => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;

test('shipped config is empty and loaded before the application', () => {
    const sandbox = { window: {} };
    vm.runInNewContext(readFileSync(new URL('../config.js', import.meta.url), 'utf8'), sandbox);
    assert.equal(sandbox.window.TALLER_CONFIG.supabaseUrl, '');
    assert.equal(sandbox.window.TALLER_CONFIG.supabaseKey, '');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.ok(html.indexOf('src="config.js"') < html.indexOf('<script type="module">'));
    assert.ok(!/https:\/\/[a-z]{20}\.supabase\.co|eyJhbGciOi/.test(html));
});

test('missing or invalid config never constructs a client or attempts authentication/public reads', async () => {
    for (const value of [undefined, {}, config(''), config('sb_secret_private'), config(jwt('service_role')),
        config(jwt('authenticated')), config('not-a-key'), { ...config('sb_publishable_test'), supabaseUrl: 'http://example.test' },
        { ...config('sb_publishable_test'), supabaseUrl: 'https://user:password@example.test' }]) {
        const app = await createApp({ config: value, search: `?id=${order().id}` });
        assert.equal(app.calls.clients.length, 0);
        assert.equal(app.calls.auth, 0);
        assert.equal(app.calls.queries.length, 0);
        assert.equal(app.get('setup-container').classList.contains('hidden'), false);
        await app.get('login-btn').click();
        assert.equal(app.calls.auth, 0);
    }
});

test('public publishable and legacy anon keys enable only the configured client', async () => {
    for (const key of ['sb_publishable_test_only', jwt('anon')]) {
        const app = await createApp({ config: config(key) });
        assert.deepEqual(app.calls.clients[0].slice(0, 2), ['https://independent.example.test', key]);
        assert.equal(app.calls.auth, 1);
    }
});

test('public access requires a signed-in owner and late public responses cannot survive logout', async () => {
    const app = await createApp();
    await app.evaluate(`showPublicOrderView('${order().id}')`);
    assert.equal(app.calls.queries.length, 0);
    app.login(USER_A);
    const pending = deferred();
    app.client.from = () => ({ select() { return this; }, eq() { return this; }, single: () => pending.promise });
    const request = app.evaluate(`showPublicOrderView('${order().id}')`);
    await app.get('logout-btn').click();
    pending.resolve({ data: order(), error: null });
    await request;
    assert.equal(app.get('pub-cliente').textContent, '');
    assert.equal(app.get('public-container').classList.contains('hidden'), true);
});
