import { readFile, writeFile, copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile } from '@tailwindcss/node';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
// Fixed output directory only; never recursively copy the repository or local config.
await rm(dist, { recursive: true, force: true });
await mkdir(new URL('assets/', dist), { recursive: true });
await mkdir(new URL('icons/', dist), { recursive: true });
const allowlist = [
    'index.html', 'styles.css', 'manifest.json', 'sw.js', 'config.example.js',
    'assets/icons.css', 'icons/icon-192.png', 'icons/icon-512.png'
];
for (const path of allowlist) await copyFile(new URL(path, root), new URL(path, dist));
// Publication remains disconnected even when a developer has a populated local config.
await writeFile(new URL('config.js', dist), "window.TALLER_CONFIG = Object.freeze({ supabaseUrl: '', supabaseKey: '' });\n");
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
console.log('Built disconnected public shell in dist/ (explicit allowlist).');
