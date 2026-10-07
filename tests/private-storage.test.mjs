import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp, deferred, order, USER_A, USER_B, ORDER_ID } from './browser-harness.mjs';

const photo = `${USER_A}/${ORDER_ID}.jpg`;
const attachment = `${USER_A}/verification/${ORDER_ID}.pdf`;
const signed = 'https://independent.example.test/storage/v1/object/sign/photos/' + photo + '?token=ephemeral';
const flush = () => new Promise(resolve => setImmediate(resolve));

function storage(app, overrides = {}) {
    const calls = { signs: [], downloads: [], removes: [], uploads: [] };
    app.client.storage.from = bucket => {
        assert.equal(bucket, 'photos');
        return {
            getPublicUrl() { throw Error('Public media is forbidden'); },
            upload: async path => { calls.uploads.push(path); return { data: { path }, error: null }; },
            createSignedUrl: async (path, ttl) => { calls.signs.push({ path, ttl }); return { data: { signedUrl: signed }, error: null }; },
            download: async path => { calls.downloads.push(path); return { data: new Blob(['private']), error: null }; },
            remove: async paths => { calls.removes.push([...paths]); return { error: null }; },
            ...overrides
        };
    };
    return calls;
}

test('private uploads return durable paths and reuse confirmed metadata without public URLs', async () => {
    const app = await createApp(); app.login();
    const calls = storage(app);
    app.set('testFiles', [{ blob: new Blob(['photo']) }]);
    const first = await app.evaluate('uploadFiles(testFiles, accountContext())');
    const second = await app.evaluate('uploadFiles(testFiles, accountContext())');
    assert.deepEqual([...first], calls.uploads);
    assert.deepEqual([...second], [...first]);
    assert.equal(calls.uploads.length, 1);
    assert.equal(app.evaluate('testFiles[0].uploaded'), true);
    assert.equal(app.evaluate('testFiles[0].uploadedUrl'), undefined);
});

test('signed photo cache uses TTL 300 and renews on access after expiry', async () => {
    const app = await createApp(); app.login();
    const calls = storage(app);
    assert.equal(await app.evaluate(`resolvePhotoUrl('${photo}')`), signed);
    assert.equal(await app.evaluate(`resolvePhotoUrl('${photo}')`), signed);
    assert.equal(calls.signs.length, 1);
    app.evaluate('Date.now = () => 9999999999999');
    assert.equal(await app.evaluate(`resolvePhotoUrl('${photo}')`), signed);
    assert.deepEqual(calls.signs, [{ path: photo, ttl: 300 }, { path: photo, ttl: 300 }]);
});

test('owner checks and strict legacy conversion block foreign media before signing or download', async () => {
    const app = await createApp(); app.login();
    const calls = storage(app);
    const legacy = `https://independent.example.test/storage/v1/object/public/photos/${photo}`;
    assert.equal(await app.evaluate(`resolvePhotoUrl('${legacy}')`), signed);
    for (const bad of [photo.replace(USER_A, USER_B), legacy.replace('independent', 'original'), legacy + '?token=x', legacy.replace('/photos/', '/other/'), legacy.replace(ORDER_ID, '%2e%2e')]) {
        await assert.rejects(app.evaluate(`resolvePhotoUrl(${JSON.stringify(bad)})`));
    }
    await assert.rejects(app.evaluate(`downloadVerificationFile('${attachment.replace(USER_A, USER_B)}')`));
    assert.equal(calls.signs.length, 1);
    assert.equal(calls.downloads.length, 0);
});

test('late signing after logout or view replacement cannot populate cache or stale DOM', async () => {
    for (const transition of ['clearSessionState()', 'viewOrder(testOrder)']) {
        const app = await createApp(); app.login();
        const pending = deferred();
        storage(app, { createSignedUrl: () => pending.promise });
        app.set('testOrder', order());
        app.evaluate(`renderPhotoGallery(document.getElementById('pub-galeria'), ['${photo}'])`);
        const oldImage = app.get('pub-galeria').children[0].children[0];
        app.evaluate(transition);
        pending.resolve({ data: { signedUrl: signed }, error: null });
        await flush();
        assert.equal(oldImage.src || '', '');
        assert.equal(app.evaluate('photoUrlCache.size'), 0);
    }
});

test('authenticated attachment downloads revoke temporary URLs and ignore late logout results', async () => {
    const app = await createApp(); app.login();
    const calls = storage(app);
    await app.evaluate(`downloadVerificationFile('${attachment}')`);
    assert.deepEqual(calls.downloads, [attachment]);
    assert.equal(app.calls.blobs.length, 1);
    assert.deepEqual(app.calls.revoked, [app.calls.blobs[0].url]);
    const pending = deferred(); storage(app, { download: () => pending.promise });
    const request = app.evaluate(`downloadVerificationFile('${attachment}')`);
    app.evaluate('clearSessionState()');
    pending.resolve({ data: new Blob(['late']), error: null });
    await request;
    assert.equal(app.calls.blobs.length, 1);
});

test('read failures preserve committed objects, show retry UI, and never export signed URLs', async () => {
    const app = await createApp(); app.login();
    const calls = storage(app, { createSignedUrl: async () => ({ error: { message: 'denied' } }), download: async () => ({ error: { message: 'denied' } }) });
    app.set('testOrder', order({ fotos: [photo], verification_files: [attachment] }));
    app.set('allOrders', [order({ fotos: [photo], verification_files: [attachment] })]);
    app.evaluate('viewOrder(testOrder)'); await flush();
    assert.match(app.get('detail-gallery').children[0].children[0].alt, /No se pudo/);
    await assert.rejects(app.evaluate(`downloadVerificationFile('${attachment}')`));
    await app.get('backup-btn').click();
    const backup = await app.calls.blobs.at(-1).blob.text();
    assert.ok(backup.includes(photo));
    assert.ok(!backup.includes('token=') && !backup.includes('blob:'));
    assert.deepEqual(calls.removes, []);
    app.evaluate('printWorkOrder(testOrder)');
    assert.ok(app.calls.print.join('').includes(`${ORDER_ID}.pdf`));
    assert.ok(!app.calls.print.join('').includes('/object/sign/') && !app.calls.print.join('').includes('<a href='));
});

test('backup converts only same-project public references and rejects signed or foreign references', async () => {
    const app = await createApp(); app.login();
    for (const [reference, valid] of [[photo, true], [`https://independent.example.test/storage/v1/object/public/photos/${photo}`, true], [signed, false], ['https://original.example.test/photo.jpg', false]]) {
        app.set('testBackup', [order({ fotos: [reference] })]);
        if (valid) assert.deepEqual([...app.evaluate(`normalizeBackup(testBackup, '${USER_A}')[0].fotos`)], [photo]);
        else assert.throws(() => app.evaluate(`normalizeBackup(testBackup, '${USER_A}')`));
    }
});

test('application source never uses public URL generation', () => {
    assert.ok(!readFileSync(new URL('../index.html', import.meta.url), 'utf8').includes('getPublicUrl'));
});
