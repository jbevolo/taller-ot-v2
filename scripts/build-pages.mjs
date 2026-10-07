import { readFile, writeFile, copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from '@tailwindcss/node';

// Deployment public configuration is opt-in, build-time only, and never read from local
// config.js. Absent environment means the published shell stays disconnected, exactly as
// before. Only the new project's public origin and public publishable key are accepted;
// privileged material fails closed and its value is never echoed.
const URL_NAME = 'TALLER_OT_SUPABASE_URL';
const EXPECTED_NAME = 'TALLER_OT_EXPECTED_SUPABASE_URL';
const KEY_NAME = 'TALLER_OT_SUPABASE_PUBLISHABLE_KEY';

export function resolvePublicConfig(env = {}) {
    const origin = (env[URL_NAME] ?? '').trim();
    const expected = (env[EXPECTED_NAME] ?? '').trim();
    const key = (env[KEY_NAME] ?? '').trim();
    if (!origin && !expected && !key) return { supabaseUrl: '', supabaseKey: '' };
    if (!origin || !key || !expected) {
        throw Error(`Cloud activation needs ${URL_NAME}, ${EXPECTED_NAME} and ${KEY_NAME} together.`);
    }
    if (key.startsWith('sb_secret_') || key.split('.').length === 3 || key.includes('\n')) {
        throw Error(`Cloud activation rejected: ${KEY_NAME} must be a public publishable key.`);
    }
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
        throw Error(`Cloud activation rejected: ${KEY_NAME} must be a public publishable key.`);
    }
    let project;
    try { project = new URL(origin); } catch { throw Error(`Cloud activation rejected: ${URL_NAME} is not a valid HTTPS URL.`); }
    if (project.protocol !== 'https:' || project.username || project.password ||
        project.pathname !== '/' || project.search || project.hash ||
        !/^[a-z0-9-]+\.supabase\.co$/i.test(project.hostname)) {
        throw Error(`Cloud activation rejected: ${URL_NAME} must be a bare HTTPS Supabase project origin.`);
    }
    let target;
    try { target = new URL(expected); } catch { throw Error(`Cloud activation rejected: ${EXPECTED_NAME} is not a valid HTTPS URL.`); }
    if (target.origin !== project.origin) {
        throw Error(`Cloud activation rejected: target project does not match the expected origin.`);
    }
    return { supabaseUrl: project.origin, supabaseKey: key };
}

async function build() {
const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
// Validate before any destructive step: rejected activation leaves dist/ untouched.
const publicConfig = resolvePublicConfig(process.env);
// Fixed output directory only; never recursively copy the repository or local config.
await rm(dist, { recursive: true, force: true });
await mkdir(new URL('assets/', dist), { recursive: true });
await mkdir(new URL('icons/', dist), { recursive: true });
const allowlist = [
    'index.html', 'styles.css', 'manifest.json', 'sw.js', 'config.example.js',
    'assets/icons.css', 'icons/icon-192.png', 'icons/icon-512.png'
];
for (const path of allowlist) await copyFile(new URL(path, root), new URL(path, dist));
// Both values are pre-validated character sets, so single-quoted literals cannot be broken.
await writeFile(new URL('config.js', dist),
    `window.TALLER_CONFIG = Object.freeze({ supabaseUrl: '${publicConfig.supabaseUrl}', supabaseKey: '${publicConfig.supabaseKey}' });\n`);
// One explicit source, including complete class strings in the inline application.
// No globbing/watch dependency tree and no scanning customer/configuration files.
const source = await readFile(new URL('index.html', root), 'utf8');
const candidates = [...new Set(source.match(/[^\s"'`<>;{}]+/g))];
const compiler = await compile(await readFile(new URL('assets/tailwind.css', root), 'utf8'), {
    base: fileURLToPath(new URL('assets/', root)), onDependency() {}
});
await writeFile(new URL('assets/utilities.css', dist), compiler.build(candidates));
const pkg = JSON.parse(await readFile(new URL('node_modules/@supabase/supabase-js/package.json', root)));
if (pkg.version !== '2.117.3') throw Error('Unexpected Supabase bundle version');
await copyFile(new URL('node_modules/@supabase/supabase-js/dist/umd/supabase.js', root),
    new URL('assets/supabase.js', dist));
// Only the project origin is ever logged; key values never appear in output.
console.log(publicConfig.supabaseUrl
    ? `Built public shell in dist/ activated for ${publicConfig.supabaseUrl} (explicit allowlist).`
    : 'Built disconnected public shell in dist/ (explicit allowlist).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await build();
