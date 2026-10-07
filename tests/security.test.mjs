import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, deferred, order, USER_A, USER_B } from './browser-harness.mjs';

test('account transition clears sensitive state and rejects a stale order response', async () => {
    const app = await createApp();
    app.login(USER_A);
    app.set('allOrders', [order()]);
    app.set('selectedFotosFiles', [{ name: 'private.jpg' }]);
    app.set('morePhotosToUpload', [{ name: 'private-extra.jpg' }]);
    app.get('nombre').value = 'Private draft';
    app.evaluate('renderOrders()');

    const pending = deferred();
    app.client.from = () => ({
        select() { return this; },
        eq() { return this; },
        order: () => pending.promise
    });
    const request = app.evaluate('fetchOrders()');

    app.client.auth.handler('SIGNED_IN', { user: { id: USER_B } });
    assert.equal(app.evaluate('allOrders.length'), 0);
    assert.equal(app.evaluate('selectedFotosFiles.length'), 0);
    assert.equal(app.evaluate('morePhotosToUpload.length'), 0);
    assert.equal(app.get('nombre').value, '');
    assert.equal(app.get('orders-table-body').innerHTML, '');
    assert.equal(app.get('app-container').classList.contains('hidden'), true);

    app.login(USER_B);
    pending.resolve({ data: [order()], error: null });
    assert.equal(await request, false);
    assert.equal(app.evaluate('allOrders.length'), 0);
    assert.equal(app.get('orders-table-body').innerHTML, '');
});

test('sign-out clears visible state immediately and rejects a late order response', async () => {
    const app = await createApp();
    app.login(USER_A);
    app.set('allOrders', [order()]);
    app.evaluate('renderOrders()');

    const pending = deferred();
    app.client.from = () => ({
        select() { return this; },
        eq() { return this; },
        order: () => pending.promise
    });
    const request = app.evaluate('fetchOrders()');
    await app.get('logout-btn').click();

    assert.equal(app.evaluate('currentUser'), null);
    assert.equal(app.evaluate('allOrders.length'), 0);
    assert.equal(app.get('orders-table-body').innerHTML, '');
    pending.resolve({ data: [order()], error: null });
    assert.equal(await request, false);
    assert.equal(app.evaluate('allOrders.length'), 0);
});

test('stored payloads remain inert in table, detail, public, notification, and print paths', async () => {
    const app = await createApp();
    app.login();
    const payload = `</td><img src=x onerror="globalThis.auditMarker=1"><script>alert('xss')</script>'"`;
    const malicious = order(Object.fromEntries([
        'nombre', 'telefono', 'vehiculo', 'dominio', 'novedades', 'forma_pago', 'notas_extra'
    ].map(field => [field, payload])));
    malicious.status = 'Finalizada';
    malicious.monto_cobrado = payload;
    malicious.fotos = [
        `https://example.test/photo.jpg' onerror='alert(1)`,
        'javascript:alert(1)'
    ];

    app.set('allOrders', [malicious]);
    app.set('testOrder', malicious);
    app.evaluate('renderOrders(); viewOrder(testOrder); printWorkOrder(testOrder)');

    const rendered = [
        app.get('orders-table-body').children[0].innerHTML,
        app.get('view-order-content').innerHTML,
        app.calls.print.join('')
    ];
    for (const html of rendered) {
        assert.ok(!html.includes(payload));
        assert.ok(!html.includes('<script>alert'));
        assert.ok(html.includes('&lt;'));
        assert.ok(html.includes('&quot;'));
        assert.ok(html.includes('&#39;'));
    }

    const gallery = app.get('detail-gallery');
    assert.equal(gallery.children.length, 2);
    assert.equal(gallery.children[1].children[0].src, '');
    assert.equal(typeof gallery.children[0].children[0].onclick, 'function');

    app.client.from = () => ({
        select() { return this; },
        eq() { return this; },
        single: async () => ({ data: malicious, error: null })
    });
    await app.evaluate(`showPublicOrderView('${malicious.id}')`);
    assert.equal(app.get('pub-trabajos').textContent, payload);
    assert.equal(app.get('pub-notas').textContent, payload);

    app.set('testPayload', payload);
    app.evaluate('showNotification(testPayload); showPublicError(testPayload)');
    assert.equal(app.get('notification-message').textContent, payload);
    assert.ok(!app.get('public-container').innerHTML.includes(payload));
    assert.ok(app.get('public-container').innerHTML.includes('&lt;script&gt;'));
});

test('late completion responses cannot repopulate notifications after logout', async () => {
    const app = await createApp();
    app.login();
    const pending = deferred();
    const filters = [];
    app.client.from = () => ({
        update() { return this; },
        eq(key, value) { filters.push([key, value]); return filters.length >= 2 ? pending.promise : this; }
    });
    app.get('complete-order-id').value = order().id;
    app.get('monto-cobrado').value = '100';
    const request = app.get('complete-order-form').dispatch('submit');
    await app.get('logout-btn').click();
    pending.resolve({ error: null });
    await request;
    assert.deepEqual(filters, [['id', order().id], ['user_id', USER_A]]);
    assert.equal(app.get('notification-message').textContent, '');
    assert.equal(app.evaluate('allOrders.length'), 0);
});

test('logout clears verification drafts and public checks and rejects pending photo compression', async () => {
    const app = await createApp();
    app.login();
    app.evaluate("setVerificationChecklistItem('REGULADOR', 'OK', 'Private draft')");
    app.set('verificationSelectedFiles', [{ name: 'private.pdf', type: 'application/pdf' }]);
    app.get('pub-garantia').innerHTML = 'Private check';
    const pending = deferred();
    app.set('compressImage', () => pending.promise);
    app.set('testFiles', [{ name: 'private.jpg' }]);
    const request = app.evaluate('processSelectedFiles(testFiles)');
    await app.get('logout-btn').click();
    pending.resolve(new Blob(['private']));
    await request;
    assert.equal(app.evaluate('selectedFotosFiles.length'), 0);
    assert.equal(app.evaluate('verificationSelectedFiles.length'), 0);
    assert.equal(app.evaluate('verificationChecklist.REGULADOR.note'), '');
    assert.equal(app.get('pub-garantia').innerHTML, '');
});

test('late signed-in events do not reopen the app after explicit logout', async () => {
    const app = await createApp();
    app.login();
    app.client.auth.getUser = async () => ({ data: { user: { id: USER_A } }, error: null });
    await app.get('logout-btn').click();
    app.client.auth.handler('SIGNED_IN', { user: { id: USER_A } });
    for (const callback of [...app.timers.values()]) await callback();
    assert.equal(app.evaluate('currentUser'), null);
    assert.equal(app.get('app-container').classList.contains('hidden'), true);
});

test('resolved network failure after committed insert retains UUID, attachments, and the new-order guard', async () => {
    for (const response of [
        { status: 0, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } },
        { status: 0, error: { message: 'AbortError: The operation was aborted.', details: '', hint: '', code: '' } },
        { error: { message: 'TypeError: fetch failed' } },
        { status: undefined, error: { name: 'AbortError', message: 'The operation was aborted.' } }
    ]) {
        const app = await createApp();
        app.login();
        const inserted = [];
        const uploads = [];
        const removals = [];
        app.client.storage.from = () => ({
            upload: async path => { uploads.push(path); return { data: { path }, error: null }; },
            getPublicUrl: path => ({ data: { publicUrl: `https://example.test/${path}` } }),
            remove: async paths => { removals.push([...paths]); return { error: null }; }
        });
        app.client.from = () => ({
            insert: async rows => {
                inserted.push(JSON.parse(JSON.stringify(rows[0])));
                return { data: null, ...response };
            }
        });
        app.set('verificationSelectedFiles', [{ name: 'sheet.pdf', type: 'application/pdf' }]);
        await app.get('work-order-form').dispatch('submit');
        const pending = app.evaluate('pendingNewOrder');
        assert.equal(pending?.id, inserted[0].id);
        assert.deepEqual([...pending.verification_files], uploads);
        assert.equal(app.evaluate('verificationSelectedFiles[0].commitUncertain'), true);
        assert.deepEqual(removals, []);
        assert.match(app.get('notification-message').textContent, /No se pudo confirmar/);

        await app.get('work-order-form').dispatch('submit');
        assert.equal(inserted.length, 1);
        assert.equal(uploads.length, 1);
        assert.deepEqual(removals, []);
        assert.equal(app.evaluate('pendingNewOrder.id'), inserted[0].id);
        assert.equal(app.evaluate('verificationSelectedFiles[0].uploadedPath'), uploads[0]);
    }
});
