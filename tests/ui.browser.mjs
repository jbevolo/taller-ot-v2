import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
let server, browser, origin, screenshots;
const source = await readFile(new URL('index.html', root), 'utf8');
// Test-only access to the real module's closure; no debug API is shipped.
const html = source.replace('    </script>\n</body>', `
        window.__ui = { run: expression => eval(expression) };
    </script>\n</body>`);

before(async () => {
    execFileSync(process.execPath, ['scripts/build-pages.mjs'], { cwd: root });
    const temporaryRoot = join(tmpdir(), 'opencode');
    await mkdir(temporaryRoot, { recursive: true });
    screenshots = await mkdtemp(join(temporaryRoot, 'taller-ot-t2-'));
    server = createServer(async (request, response) => {
        const path = new URL(request.url, 'http://localhost').pathname;
        if (path.startsWith('/taller-ot-v2/')) {
            const relative = path.slice('/taller-ot-v2/'.length) || 'index.html';
            const allowed = ['index.html', 'styles.css', 'config.js', 'config.example.js', 'manifest.json', 'sw.js',
                'assets/utilities.css', 'assets/icons.css', 'assets/supabase.js', 'icons/icon-192.png', 'icons/icon-512.png'];
            if (!allowed.includes(relative)) { response.writeHead(404); response.end(); return; }
            const extension = relative.split('.').pop();
            const type = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/manifest+json', png: 'image/png' }[extension];
            response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
            response.end(await readFile(new URL(`dist/${relative}`, root)));
            return;
        }
        const files = { '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css', '/config.js': 'config.js', '/assets/utilities.css': 'assets/utilities.css', '/assets/icons.css': 'assets/icons.css', '/assets/supabase.js': 'assets/supabase.js' };
        if (!files[path]) { response.writeHead(204); response.end(); return; }
        const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.md') ? 'text/plain' : 'text/html';
        response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        response.end(files[path] === 'index.html' ? html : await readFile(new URL(`dist/${files[path]}`, root)));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
    browser = await chromium.launch({ headless: true, executablePath });
});

after(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    console.log(`Screenshots: ${screenshots}`);
});

async function openPage(width, cloud = false) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const errors = [], forbidden = [];
    await context.addInitScript(() => {
        window.__boundaryCalls = [];
        for (const method of ['setItem', 'removeItem', 'clear', 'getItem']) {
            Storage.prototype[method] = function () { window.__boundaryCalls.push(`storage:${method}`); throw new Error('Storage boundary crossed'); };
        }
        window.fetch = () => { window.__boundaryCalls.push('fetch'); throw new Error('Fetch boundary crossed'); };
        XMLHttpRequest.prototype.open = () => { window.__boundaryCalls.push('xhr'); throw new Error('XHR boundary crossed'); };
        window.open = () => { window.__boundaryCalls.push('window.open'); return null; };
    });
    await context.route('**/*', async route => {
        const url = route.request().url();
        if (url === `${origin}/assets/supabase.js`) {
            return route.fulfill({ contentType: 'text/javascript', body: cloud ? mockCloud() : 'window.supabase={createClient(){window.__boundaryCalls.push("createClient");throw Error("Unexpected cloud client")}};' });
        }
        if (cloud && url === `${origin}/config.js`) {
            return route.fulfill({ contentType: 'text/javascript', body: 'window.TALLER_CONFIG={supabaseUrl:"https://synthetic.example.test",supabaseKey:"sb_publishable_synthetic"};' });
        }
        if (url.startsWith(`${origin}/`)) return route.continue();
        forbidden.push(url);
        return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(origin);
    await page.waitForFunction(() => !!window.__ui);
    return { page, context, errors, forbidden };
}

function mockCloud() {
    return `window.supabase = { createClient() {
        const owner = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
        const orders = Array.from({length: 125}, (_, i) => ({
            id: 'synthetic-' + i, user_id: owner, order_number: 125 - i,
            fecha: '2026-10-07', nombre: i < 110 ? 'Cliente Atlas' : 'Otro cliente',
            vehiculo: 'Vehículo sintético', dominio: 'DEMO ' + i,
            telefono: '', novedades: 'Trabajo de prueba', fotos: [],
            status: i % 2 ? 'Finalizada' : 'Abierta'
        }));
        return {
            auth: { getUser: async () => ({data:{user:{id:owner,email:'synthetic@example.test'}}}), onAuthStateChange(){}, signOut: async () => ({error:null}) },
            from() { const chain = { select(){return chain}, eq(){return chain}, order(){return chain}, then(resolve){return Promise.resolve({data:orders,error:null}).then(resolve)} }; return chain; },
            rpc(){throw Error('Unexpected mutation')}, storage:{from(){throw Error('Unexpected storage')}}
        };
    }};`;
}

async function noOverflow(page) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
        JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => `${el.tagName}#${el.id}.${el.className}`).slice(0, 12))));
}

for (const width of [360, 390, 768, 1440]) {
    test(`empty config and isolated demo at ${width}px: layout, filters, keyboard and cleanup`, async () => {
        const { page, context, errors, forbidden } = await openPage(width);
        try {
            assert.equal(await page.locator('#setup-container').isVisible(), true);
            assert.match(await page.locator('#setup-container').innerText(), /nueva e independiente/);
            await noOverflow(page);
            await page.screenshot({ path: join(screenshots, `landing-${width}.png`), fullPage: true });
            await page.getByRole('button', { name: 'Explorar demo' }).click();
            assert.equal(await page.locator('#stat-total').innerText(), '8');
            assert.equal(await page.locator('#stat-open').innerText(), '5');
            assert.equal(await page.locator('#stat-done').innerText(), '3');
            assert.match(await page.locator('#connection-status').innerText(), /Demo local/);
            await noOverflow(page);
            await page.screenshot({ path: join(screenshots, `dashboard-${width}.png`), fullPage: true });
            await page.locator('#filter-done').click();
            assert.match(await page.locator('#results-summary').innerText(), /3 órdenes/);
            await page.locator('#search-input').fill('Peugeot');
            await page.waitForFunction(() => document.getElementById('results-summary').textContent.startsWith('1 orden encontrada'));
            await page.locator('#filter-open').click();
            assert.match(await page.locator('#results-summary').innerText(), /0 órdenes/);
            await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
            assert.match(await page.locator('#results-summary').innerText(), /5 órdenes/);
            const opener = page.getByRole('button', { name: 'Ver orden 108', exact: true });
            await opener.click();
            const dialog = page.getByRole('dialog', { name: 'Detalles de la orden', exact: true });
            assert.equal(await dialog.isVisible(), true);
            assert.match(await dialog.innerText(), /Datos sintéticos/);
            assert.equal(await dialog.locator('input:visible, select:visible, textarea:visible').count(), 0);
            assert.equal(await page.locator('#app-container').evaluate(node => node.inert), true);
            const smallTargets = await dialog.locator('button:visible').evaluateAll(nodes => nodes.filter(node => {
                const box = node.getBoundingClientRect();
                return box.width < 44 || box.height < 44;
            }).map(node => node.outerHTML));
            assert.deepEqual(smallTargets, []);
            await page.getByRole('button', { name: 'Cerrar detalles' }).focus();
            await page.keyboard.press('Shift+Tab');
            assert.match(await page.evaluate(() => document.activeElement.textContent), /Configurar mi nueva nube/);
            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Cerrar detalles');
            if (width === 390) await page.screenshot({ path: join(screenshots, 'detail-390.png') });
            await page.keyboard.press('Escape');
            assert.equal(await opener.evaluate(node => node === document.activeElement), true);
            await page.locator('#new-order-btn').click();
            assert.match(await page.locator('#notification-message').innerText(), /solo lectura/);
            await page.keyboard.press('Escape');
            const snapshot = await page.evaluate(() => window.__ui.run('JSON.stringify(allOrders)'));
            await page.evaluate(async () => {
                for (const command of [
                    'deleteOrder(allOrders[0].id, 108)', 'openCompleteModal(allOrders[0])',
                    'setupVerificationEdit(allOrders[0])', 'setupAddMorePhotos(allOrders[0])',
                    'processSelectedFiles([])', 'restoreToCloud([])', 'shareViaWhatsApp(allOrders[0])',
                    'printWorkOrder(allOrders[0])', 'window.removeFoto(0)',
                    'deleteSpecificPhoto(allOrders[0].id, "https://forbidden.example.test/photo.jpg", 0)',
                    'uploadFiles([], accountContext())', 'fetchOrders()', 'checkUser()',
                    'showPublicOrderView("forbidden")', 'openLightbox("https://forbidden.example.test/photo.jpg")'
                ]) await window.__ui.run(command);
                for (const id of ['work-order-form', 'complete-order-form']) document.getElementById(id).dispatchEvent(new Event('submit', {cancelable:true}));
                for (const id of ['login-btn', 'register-btn', 'backup-btn', 'restore-btn']) document.getElementById(id).click();
            });
            assert.equal(await page.evaluate(() => window.__ui.run('JSON.stringify(allOrders)')), snapshot);
            assert.deepEqual(await page.evaluate(() => window.__boundaryCalls), []);
            await page.keyboard.press('Escape');
            await context.setOffline(true);
            await page.waitForFunction(() => document.getElementById('connection-status').textContent.includes('Sin conexión'));
            await context.setOffline(false);
            await page.locator('#logout-btn').click();
            assert.equal(await page.evaluate(() => window.__ui.run('allOrders.length')), 0);
            assert.equal(await page.locator('#view-order-content').innerHTML(), '');
            assert.equal(await page.locator('#explore-demo').evaluate(node => node === document.activeElement), true);
            assert.equal(await page.evaluate(() => window.__ui.run('hasUnsavedChanges()')), false);
            assert.deepEqual(errors, []);
            assert.deepEqual(forbidden, []);
        } finally { await context.close(); }
    });
}

test('mock cloud combines pagination/search/filter and confirms unsaved exits on a short phone', async () => {
    const { page, context, errors, forbidden } = await openPage(390, true);
    try {
        assert.equal(await page.locator('#stat-total').innerText(), '125');
        await page.locator('#filter-open').click();
        await page.locator('#search-input').fill('Atlas');
        await page.waitForFunction(() => document.getElementById('results-summary').textContent.startsWith('55 órdenes'));
        assert.equal(await page.locator('#orders-cards-container > article').count(), 50);
        await page.locator('#next-page-btn').click();
        assert.equal(await page.locator('#orders-cards-container > article').count(), 5);
        await page.locator('#clear-search').click();
        assert.match(await page.locator('#results-summary').innerText(), /63 órdenes/);
        assert.match(await page.locator('#pagination-controls').innerText(), /Página 1 de 2/);
        await page.locator('#new-order-btn').click();
        await page.locator('#nombre').fill('Borrador sintético');
        await noOverflow(page);
        await page.screenshot({ path: join(screenshots, 'cloud-form-390.png') });
        await page.locator('#cancel-new-order').click();
        assert.match(await page.locator('#notification-message').innerText(), /sin guardar/);
        await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
        assert.equal(await page.locator('#nombre').inputValue(), 'Borrador sintético');
        await page.setViewportSize({ width: 390, height: 420 });
        await page.locator('#open-camera-modal').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.getByRole('dialog', { name: 'Seleccionar fuente de foto' }).isVisible(), true);
        await page.locator('#camera-cancel-btn').focus();
        const box = await page.locator('#camera-cancel-btn').boundingBox();
        assert.ok(box.y >= 0 && box.y + box.height <= 420);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#open-camera-modal').evaluate(node => node === document.activeElement), true);
        await page.locator('#cancel-new-order').click();
        await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
        assert.equal(await page.locator('#new-order-panel').isVisible(), false);
        assert.equal(await page.evaluate(() => window.__ui.run('hasUnsavedChanges()')), false);
        await noOverflow(page);
        assert.deepEqual(errors, []);
        assert.deepEqual(forbidden, []);
    } finally { await context.close(); }
});

test('mock cloud detail actions and nested dirty-dialog cancellation preserve the main draft', async () => {
    const { page, context, errors, forbidden } = await openPage(1440, true);
    try {
        await page.locator('#new-order-btn').click();
        await page.locator('#nombre').fill('Main draft');
        await page.getByRole('button', { name: 'Ver orden 125', exact: true }).click();
        assert.equal(await page.locator('#detail-print-btn').isVisible(), true);
        assert.equal(await page.locator('#detail-delete-btn').isVisible(), true);
        assert.equal(await page.locator('#view-whatsapp-btn').isVisible(), true);
        await page.locator('#edit-verification-editor input').first().fill('Detail draft');
        await page.keyboard.press('Escape');
        assert.match(await page.locator('#notification-message').innerText(), /sin guardar/);
        await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
        assert.equal(await page.locator('#view-order-modal').isVisible(), false);
        assert.equal(await page.locator('#nombre').inputValue(), 'Main draft');
        assert.equal(await page.evaluate(() => window.__ui.run('hasUnsavedChanges()')), true);
        await page.locator('#cancel-new-order').click();
        await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__ui.run('hasUnsavedChanges()')), false);
        await page.getByRole('button', { name: 'Ver orden 125', exact: true }).click();
        await page.locator('#detail-complete-btn').click();
        assert.equal(await page.locator('#complete-order-modal').isVisible(), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#detail-complete-btn').evaluate(node => node === document.activeElement), true);
        await page.keyboard.press('Escape');
        await noOverflow(page);
        assert.deepEqual(errors, []);
        assert.deepEqual(forbidden, []);
    } finally { await context.close(); }
});

test('compact verification sheet renders 12 one-line rows and fits one print page', async () => {
    const { page, context, errors, forbidden } = await openPage(390, true);
    try {
        await page.getByRole('button', { name: 'Ver orden 125', exact: true }).click();
        const sheet = page.locator('#view-order-content .verification-sheet');
        assert.equal(await sheet.count(), 1);
        assert.match(await sheet.locator('h3').innerText(), /^Planilla de verificación$/);
        assert.equal(await sheet.locator('.verification-row').count(), 12);
        // One line per item: every row is exactly one compact line tall and all equal.
        const heights = await sheet.locator('.verification-row').evaluateAll(nodes =>
            nodes.map(node => Math.round(node.getBoundingClientRect().height * 10) / 10));
        assert.equal(new Set(heights).size, 1, `rows differ in height: ${heights.join()}`);
        assert.ok(heights[0] <= 24, `rows are not single-line: ${heights[0]}px`);
        assert.equal(await sheet.locator('.verification-code').count(), 12);
        assert.equal(await sheet.locator('.verification-code[data-status=PEND]').count(), 12);
        assert.ok(await sheet.locator('.verification-item').first().isVisible());

        // A long note truncates on its single line while the full text stays reachable.
        const truncated = await page.evaluate(() => {
            document.body.insertAdjacentHTML('beforeend', window.__ui.run(
                'renderVerificationSummary({verification_checklist:{REGULADOR:{status:"OK",note:"Fuga".repeat(40)}},verification_files:[]})'));
            const row = document.body.lastElementChild.querySelector('.verification-row');
            const note = row.querySelector('.verification-note');
            const full = row.querySelector('.verification-note-full');
            const result = {
                sameLine: Math.abs(note.getBoundingClientRect().top - row.querySelector('.verification-item').getBoundingClientRect().top) < 6,
                clipped: note.scrollWidth > note.clientWidth,
                ariaHidden: note.getAttribute('aria-hidden'),
                fullText: full.textContent,
                fullHidden: getComputedStyle(full).position === 'absolute'
            };
            row.remove();
            return result;
        });
        assert.equal(truncated.sameLine, true, 'item, status and note stay on one line');
        assert.equal(truncated.clipped, true, 'long note truncates visually');
        assert.equal(truncated.ariaHidden, 'true');
        assert.equal(truncated.fullText, 'Fuga'.repeat(40), 'full escaped note stays available');
        assert.equal(truncated.fullHidden, true);
        // No per-row vertical padding survived the redesign.
        const padding = await sheet.locator('.verification-row').first().evaluate(node => getComputedStyle(node).padding);
        assert.equal(padding.replace(/\s/g, ''), '0px');
        assert.equal(await page.locator('#view-order-content .verification-note-full').count(), 0, 'empty notes add no hidden copy');
        await noOverflow(page);
        await page.screenshot({ path: join(screenshots, 'verification-sheet-390.png'), fullPage: true });
        await page.keyboard.press('Escape');
        assert.deepEqual(errors, []);
        assert.deepEqual(forbidden, []);
    } finally { await context.close(); }

    // The real print document, captured from printWorkOrder itself, must fit one A4 page.
    const printed = await openPage(1440, true);
    try {
        await printed.page.getByRole('button', { name: 'Ver orden 125', exact: true }).click();
        const printHtml = await printed.page.evaluate(() => {
            let markup = '';
            const realOpen = window.open;
            window.open = () => ({
                document: { write: chunk => { markup += chunk; }, close() {} },
                focus() {}, print() {}, close() {}
            });
            try { window.__ui.run('printWorkOrder(allOrders[0])'); } finally { window.open = realOpen; }
            return markup;
        });
        assert.match(printHtml, /class="verification-grid"/);
        assert.equal((printHtml.match(/class="verification-row"/g) || []).length, 12);

        const paper = await printed.context.newPage();
        await paper.setViewportSize({ width: 794, height: 1123 });
        await paper.emulateMedia({ media: 'print' });
        await paper.route('**/*', route => route.request().url().startsWith(`${origin}/`)
            ? route.continue() : route.abort());
        await paper.setContent(printHtml, { waitUntil: 'load' });
        await paper.emulateMedia({ media: 'print' });
        const sheetBox = await paper.locator('.verification-sheet').boundingBox();
        assert.ok(sheetBox, 'sheet rendered in the print document');
        assert.ok(sheetBox.height <= 300, `sheet too tall for one page: ${sheetBox.height}`);
        assert.equal(
            await paper.locator('.verification-sheet').evaluate(node => getComputedStyle(node).breakInside),
            'avoid',
            'the whole sheet must stay on one page'
        );
        assert.equal(
            await paper.locator('.verification-sheet').evaluate(node => getComputedStyle(node).pageBreakInside),
            'avoid'
        );
        assert.equal(
            await paper.locator('.verification-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length),
            2,
            'print keeps two columns'
        );
        await paper.pdf({ path: join(screenshots, 'verification-sheet.pdf'), format: 'A4', printBackground: true });
        const pages = readFileSync(join(screenshots, 'verification-sheet.pdf')).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || [];
        assert.equal(pages.length, 1, `the printed order must stay one page, saw ${pages.length}`);
        assert.deepEqual(printed.errors, []);
        assert.deepEqual(printed.forbidden, []);
    } finally { await printed.context.close(); }
});

test('real service worker at Pages subpath restores a fully network-blocked shell and read-only demo', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
    const forbidden = [], errors = [];
    await context.route('**/*', route => {
        if (route.request().url().startsWith(`${origin}/`)) return route.continue();
        forbidden.push(route.request().url());
        return route.abort();
    });
    try {
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${origin}/taller-ot-v2/`);
        await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10000 });
        assert.equal(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL), `${origin}/taller-ot-v2/sw.js`);
        // Seed unrelated and stale caches to exercise actual activation cleanup.
        await page.evaluate(async () => {
            await caches.open('another-app:v1');
            await caches.open('taller-ot-v2:old');
        });
        await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            await registration.unregister();
        });
        await page.reload();
        await page.waitForFunction(async () => !(await caches.keys()).includes('taller-ot-v2:old'));
        await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
        assert.ok((await page.evaluate(() => caches.keys())).includes('another-app:v1'));
        await context.setOffline(true);
        await page.goto(`${origin}/taller-ot-v2/?offline=1`);
        assert.equal(await page.locator('#setup-container').isVisible(), true);
        await page.getByRole('button', { name: 'Explorar demo' }).click();
        assert.equal(await page.locator('#stat-total').innerText(), '8');
        assert.match(await page.locator('#connection-status').innerText(), /Sin conexión/);
        await noOverflow(page);
        await page.locator('#filter-done').click();
        assert.match(await page.locator('#results-summary').innerText(), /3 órdenes/);
        await page.getByRole('button', { name: /^Ver orden \d+$/ }).first().click();
        assert.match(await page.getByRole('dialog', { name: 'Detalles de la orden', exact: true }).innerText(), /Datos sintéticos/);
        await page.keyboard.press('Escape');
        await page.locator('#new-order-btn').click();
        assert.match(await page.locator('#notification-message').innerText(), /solo lectura/);
        await page.keyboard.press('Escape');
        await page.screenshot({ path: join(screenshots, 'offline-subpath-390.png'), fullPage: true });
        await page.locator('#logout-btn').click();
        // A new page uses cached assets, not memory from the previous page.
        const fresh = await context.newPage();
        await fresh.goto(`${origin}/taller-ot-v2/index.html?offline=2`);
        await fresh.getByRole('button', { name: 'Explorar demo' }).click();
        assert.equal(await fresh.locator('#stat-total').innerText(), '8');
        const keys = await fresh.evaluate(async () => {
            const own = (await caches.keys()).filter(name => name.startsWith('taller-ot-v2:'));
            return (await Promise.all(own.map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat();
        });
        assert.equal(keys.length, 9);
        assert.ok(keys.every(url => url.startsWith(`${origin}/taller-ot-v2/`) && !url.includes('?')));
        assert.ok(!keys.some(url => /supabase\.co|work_orders|photos\/|token|customer/.test(url)));
        assert.deepEqual(errors, []);
        assert.deepEqual(forbidden, []);
    } finally { await context.close(); }
});
