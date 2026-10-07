import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
// Default deployment builds must ignore any ambient activation environment.
const clean = { ...process.env };
for (const name of ['TALLER_OT_SUPABASE_URL', 'TALLER_OT_EXPECTED_SUPABASE_URL',
    'TALLER_OT_SUPABASE_PUBLISHABLE_KEY']) delete clean[name];

test('shell dependencies are relative and icons are genuine PNGs with declared dimensions', async () => {
    const html = await read('index.html');
    assert.doesNotMatch(html, /(?:src|href)="https:\/\/(?:cdn\.|fonts\.|cdnjs\.)/);
    assert.doesNotMatch(html, /cdn\.tailwindcss\.com/);
    const manifest = JSON.parse(await read('manifest.json'));
    assert.equal(manifest.scope, './');
    assert.equal(manifest.start_url, './');
    assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
    for (const icon of manifest.icons) {
        assert.equal(icon.type, 'image/png');
        const bytes = await readFile(new URL(icon.src, root));
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        const size = Number(icon.sizes.split('x')[0]);
        assert.equal(bytes.readUInt32BE(16), size);
        assert.equal(bytes.readUInt32BE(20), size);
    }
});

async function worker() {
    const handlers = {}, deleted = [], cached = [], matches = [];
    const scope = 'https://jbevolo.github.io/taller-ot-v2/';
    const sandbox = {
        URL, console,
        self: { registration: { scope }, location: { origin: 'https://jbevolo.github.io' },
            addEventListener: (name, handler) => { handlers[name] = handler; },
            clients: { claim: async () => {} } },
        caches: {
            open: async name => ({ addAll: async paths => cached.push({ name, paths }),
                match: async path => { matches.push(path); return { shell: true }; } }),
            keys: async () => ['taller-ot-v2:old', 'another-app:v1', 'taller-ot-v1'],
            delete: async name => { deleted.push(name); return true; }
        },
        fetch: async () => { throw Error('Offline'); }
    };
    vm.runInNewContext(await read('sw.js'), sandbox);
    return { handlers, deleted, cached, matches, scope };
}

test('worker precaches only local shell and deletes only its own cache namespace', async () => {
    const { handlers, cached, deleted, scope } = await worker();
    let pending;
    handlers.install({ waitUntil: task => { pending = task; } });
    await pending;
    assert.match(cached[0].name, /^taller-ot-v2:/);
    assert.equal(cached[0].name, 'taller-ot-v2:shell-v2');
    for (const path of cached[0].paths) assert.ok(new URL(path, scope).href.startsWith(scope));
    handlers.activate({ waitUntil: task => { pending = task; } });
    await pending;
    assert.deepEqual(deleted, ['taller-ot-v2:old']);
});

test('worker ignores customer/cloud/auth traffic and safely falls back for query navigation', async () => {
    const { handlers, matches, scope } = await worker();
    for (const request of [
        { url: 'https://synthetic.supabase.co/rest/v1/work_orders', method: 'GET' },
        { url: 'https://synthetic.supabase.co/storage/v1/object/public/photos/owner/a.jpg', method: 'GET' },
        { url: scope + 'customer.jpg', method: 'GET' },
        { url: scope + 'config.js?token=private', method: 'GET' },
        { url: scope + 'index.html', method: 'POST' },
        { url: scope + 'index.html', method: 'GET', headers: { has: () => true } },
        { url: 'https://jbevolo.github.io/another-app/', method: 'GET', mode: 'navigate' }
    ]) {
        let handled = false;
        handlers.fetch({ request, respondWith: () => { handled = true; } });
        assert.equal(handled, false, request.url);
    }
    let response;
    handlers.fetch({ request: { url: scope + '?id=synthetic&token=never-cache', method: 'GET', mode: 'navigate' },
        respondWith: task => { response = task; } });
    assert.ok(response);
    assert.equal((await response).shell, true);
    assert.deepEqual(matches, [scope + 'index.html']);
});

test('build emits an explicit public allowlist with empty configuration, never repository contents', async () => {
    build(clean);
    const files = await readdir(new URL('dist/', root), { recursive: true });
    assert.deepEqual(files.sort(), [
        'assets', 'assets/icons.css', 'assets/supabase.js', 'assets/utilities.css',
        'config.example.js', 'config.js', 'icons', 'icons/icon-192.png', 'icons/icon-512.png',
        'index.html', 'manifest.json', 'styles.css', 'sw.js'
    ].sort());
    assert.doesNotMatch(files.join('\n'), /tests|database|docs|backup|odd|\.git|node_modules/);
    const config = await read('dist/config.js');
    assert.match(config, /supabaseUrl:\s*''/);
    assert.match(config, /supabaseKey:\s*''/);
    assert.ok(files.includes('assets/supabase.js'));
    assert.ok(files.includes('assets/utilities.css'));
    const html = await read('dist/index.html');
    for (const match of html.split('</head>')[0].matchAll(/(?:src|href)="([^"#]+)"/g)) {
        const path = match[1];
        if (path.startsWith('https://') || path === './') continue;
        assert.ok(files.includes(path), `Missing artifact asset: ${path}`);
    }
    assert.doesNotMatch(html, /sb_secret_[A-Za-z0-9]{10,}|service_role["']\s*:\s*["'][^"']+/);
    assert.match(await read('dist/assets/supabase.js'), /createClient/);
});

const build = env => execFileSync(process.execPath, ['scripts/build-pages.mjs'], { cwd: root, env });

const attempt = env => {
    try { return { output: execFileSync(process.execPath, ['scripts/build-pages.mjs'],
        { cwd: root, env, stdio: 'pipe' }).toString() }; }
    catch (error) { return { failed: true, output: `${error.stderr ?? ''}${error.stdout ?? ''}` }; }
};

test('activated build writes only the declared public values, and the default build restores disconnected', async () => {
    const partial = attempt({ ...clean, TALLER_OT_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' });
    assert.equal(partial.failed, true);
    assert.match(partial.output, /activation/i);
    assert.match(await read('dist/config.js'), /supabaseUrl:\s*''/);
    const env = {
        ...clean,
        TALLER_OT_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
        TALLER_OT_EXPECTED_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
        TALLER_OT_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_fixture_only'
    };
    build(env);
    assert.match(await read('dist/config.js'),
        /supabaseUrl:\s*'https:\/\/abcdefghijklmnopqrst\.supabase\.co'/);
    assert.match(await read('dist/config.js'), /supabaseKey:\s*'sb_publishable_synthetic_fixture_only'/);
    assert.deepEqual((await readdir(new URL('dist/', root), { recursive: true })).sort(), [
        'assets', 'assets/icons.css', 'assets/supabase.js', 'assets/utilities.css',
        'config.example.js', 'config.js', 'icons', 'icons/icon-192.png', 'icons/icon-512.png',
        'index.html', 'manifest.json', 'styles.css', 'sw.js'
    ].sort());
    build(clean);
    assert.match(await read('dist/config.js'), /supabaseUrl:\s*''[\s\S]*supabaseKey:\s*''/);
    assert.doesNotMatch(await read('dist/config.js'), /supabase\.co/);
});

test('build refuses privileged keys without echoing them into the artifact or output', async () => {
    const rejected = attempt({ ...clean, TALLER_OT_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
        TALLER_OT_EXPECTED_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
        TALLER_OT_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic_fixture' });
    assert.equal(rejected.failed, true);
    assert.match(rejected.output, /activation/i);
    assert.doesNotMatch(rejected.output, /sb_secret_synthetic_fixture/);
    // Rejected activation is non-destructive: the previous disconnected artifact survives.
    assert.match(await read('dist/config.js'), /supabaseUrl:\s*''/);
    build(clean);
});

test('Pages workflow activates only on main push from repository secrets, never a literal key', async () => {
    const workflow = await read('.github/workflows/pages.yml');
    assert.match(workflow, /secrets\.TALLER_OT_SUPABASE_PUBLISHABLE_KEY/);
    assert.match(workflow, /vars\.TALLER_OT_SUPABASE_URL|secrets\.TALLER_OT_SUPABASE_URL/);
    assert.match(workflow, /if:.*github\.ref == 'refs\/heads\/main'/);
    assert.doesNotMatch(workflow, /sb_publishable_|sb_secret_|eyJhbGci|supabase\.co/);
    assert.match(workflow, /permissions:\s*\n\s+contents: read/);
    assert.doesNotMatch(workflow, /id-token: write[\s\S]*build:/);
});
