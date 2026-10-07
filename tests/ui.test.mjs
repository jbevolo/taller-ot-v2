import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, order } from './browser-harness.mjs';

test('demo is synthetic, read-only and leaves no session or draft behind', async () => {
    const app = await createApp({ config: {} });
    app.evaluate('enterDemo()');
    assert.equal(app.evaluate('demoMode'), true);
    assert.equal(app.evaluate('currentUser'), null);
    assert.equal(app.evaluate('allOrders.length'), 8);
    assert.equal(app.evaluate('allOrders.every(o => !o.fotos.length && !o.telefono)'), true);
    app.evaluate('viewOrder(allOrders[0])');
    assert.match(app.get('view-order-content').innerHTML, /sintéticos/);
    app.evaluate('leaveDemo()');
    assert.equal(app.evaluate('allOrders.length'), 0);
    assert.equal(app.get('view-order-content').innerHTML, '');
    assert.equal(app.evaluate('selectedFotosFiles.length'), 0);
    assert.equal(app.calls.clients.length, 0);
    assert.equal(app.calls.auth, 0);
    assert.equal(app.calls.queries.length, 0);
});

test('demo guards callable mutation, authentication and export entry points', async () => {
    const app = await createApp({ config: {} });
    app.evaluate('enterDemo()');
    const original = app.evaluate('JSON.stringify(allOrders)');
    for (const expression of [
        'deleteOrder(allOrders[0].id, 1)', 'openCompleteModal(allOrders[0])',
        'deleteSpecificPhoto(allOrders[0].id, "https://example.test/a.jpg", 0)',
        'processSelectedFiles([])', 'restoreToCloud([])', 'setupVerificationEdit(allOrders[0])',
        'setupAddMorePhotos(allOrders[0])', 'shareViaWhatsApp(allOrders[0])',
        'printWorkOrder(allOrders[0])', 'window.removeFoto(0)',
        'setVerificationChecklistItem("CILINDRO", "OK", "change")'
    ]) await app.evaluate(expression);
    for (const id of ['work-order-form', 'complete-order-form']) await app.get(id).dispatch('submit');
    for (const id of ['login-btn', 'register-btn', 'backup-btn', 'restore-btn']) await app.get(id).click();
    assert.equal(app.evaluate('JSON.stringify(allOrders)'), original);
    assert.equal(app.evaluate('verificationEdit'), null);
    assert.match(app.get('notification-message').textContent, /solo lectura/);
    assert.equal(app.calls.auth, 0);
    assert.equal(app.calls.queries.length, 0);
    assert.equal(app.calls.print.length, 0);
});

test('status and search combine before pagination; clear search retains status', async () => {
    const app = await createApp();
    app.set('allOrders', Array.from({ length: 120 }, (_, i) => order({
        order_number: i + 1, nombre: i < 110 ? 'Atlas' : 'Other',
        status: i % 2 ? 'Finalizada' : 'Abierta'
    })));
    app.evaluate('setStatusFilter("Abierta"); filterOrders("Atlas")');
    assert.equal(app.evaluate('filteredOrders.length'), 55);
    assert.equal(app.get('orders-table-body').children.length, 50);
    app.evaluate('goToPage(2)');
    assert.equal(app.get('orders-table-body').children.length, 5);
    app.evaluate('filterOrders("")');
    assert.equal(app.evaluate('filteredOrders.length'), 60);
    assert.equal(app.evaluate('currentPage'), 1);
    assert.equal(app.get('count-open').textContent, '60');
    app.evaluate('filterOrders("missing")');
    assert.equal(app.evaluate('filteredOrders.length'), 0);
    assert.match(app.get('results-summary').textContent, /0 órdenes/);
});

test('connection text distinguishes browser connectivity from cloud verification', async () => {
    const app = await createApp({ config: {} });
    assert.match(app.evaluate('connectionLabel()'), /Sin configurar/);
    app.evaluate('enterDemo()');
    assert.match(app.evaluate('connectionLabel()'), /Demo/);
    app.evaluate('navigator.onLine = false');
    assert.match(app.evaluate('connectionLabel()'), /Sin conexión/);
    const configured = await createApp();
    assert.match(configured.evaluate('connectionLabel()'), /sin verificar/);
});

test('unsaved cloud forms require confirmation while read-only demo does not', async () => {
    const app = await createApp({ config: {} });
    app.login();
    app.evaluate('markDirty("work-order-form")');
    assert.equal(app.evaluate('hasUnsavedChanges()'), true);
    app.evaluate('clearSessionState()');
    assert.equal(app.evaluate('hasUnsavedChanges()'), false);
    app.evaluate('enterDemo(); markDirty("work-order-form")');
    assert.equal(app.evaluate('demoMode'), true);
    assert.equal(app.evaluate('hasUnsavedChanges()'), false);
});
