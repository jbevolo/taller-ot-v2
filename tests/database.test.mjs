import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const USER_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const migration = readFileSync(
    new URL("../database/safe-order-operations.sql", import.meta.url),
    "utf8",
);
const order = (overrides = {}) => ({
    id: ORDER_ID,
    user_id: USER_A,
    order_number: 1,
    fecha: "2026-05-13",
    nombre: "Customer",
    telefono: "12345678",
    vehiculo: "Car",
    dominio: "AAA123",
    novedades: "Repair",
    garantia: false,
    oblea: false,
    ph: false,
    nv: false,
    retencion: false,
    mangueras: false,
    fotos: [],
    status: "Abierta",
    monto_cobrado: null,
    forma_pago: "",
    notas_extra: "",
    ...overrides,
});
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${quote(JSON.stringify(value))}::jsonb`;
const verificationChecklist = (overrides = {}) =>
    Object.fromEntries(
        [
            "REGULADOR",
            "MANGUERAS GNC",
            "FILTRO DE GAS",
            "CAÑO ALTA PRESION",
            "MANGUERAS AGUA",
            "CUNA",
            "CILINDRO",
            "VALVULA CILINDRO",
            "RETENCION",
            "NIPLES Y VIROLAS",
            "SISTEMA VENTEO",
            "CABLEADO VALVULA",
        ].map((item) => [
            item,
            { status: null, note: "", ...(overrides[item] || {}) },
        ]),
    );
const restore = (orders, owner = USER_A) =>
    `select public.restore_work_orders(${json(orders)}, '${owner}');`;
const photos = (add = [], remove = [], id = ORDER_ID, owner = USER_A) =>
    `select public.change_order_photos('${id}', ${json(add)}, ${json(remove)}, '${owner}');`;
const asOwner = (sql, owner = USER_A) =>
    `set role authenticated; set request.jwt.claim.sub = '${owner}'; ${sql}`;

test("local PostgreSQL proves restore transaction rollback and ownership boundaries", {
    timeout: 60000,
}, async (t) => {
    for (const binary of ["initdb", "pg_ctl", "psql"]) {
        try {
            execFileSync(binary, ["--version"], { stdio: "pipe" });
        } catch {
            t.skip(
                `${binary} unavailable; real PostgreSQL rollback verification is blocked`,
            );
            return;
        }
    }

    const directory = mkdtempSync(join(tmpdir(), "opencode", "taller-ot-pg-"));
    const dataDirectory = join(directory, "data");
    const env = Object.fromEntries(
        Object.entries(process.env).filter(
            ([key]) => !key.startsWith("PG") && key !== "DATABASE_URL",
        ),
    );
    Object.assign(env, {
        PGHOST: directory,
        PGPORT: "55439",
        PGUSER: "postgres",
        PGDATABASE: "postgres",
        PGPASSFILE: "/dev/null",
        PGCONNECT_TIMEOUT: "5",
    });
    const args = [
        "-X",
        "-q",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        directory,
        "-p",
        "55439",
        "-U",
        "postgres",
        "-d",
        "postgres",
    ];
    const sql = (input) =>
        execFileSync("psql", args, {
            input,
            encoding: "utf8",
            env,
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
    const asyncSQL = (input, ready) => {
        const child = spawn("psql", args, {
            env,
            stdio: ["pipe", "pipe", "pipe"],
        });
        let output = "";
        let errors = "";
        let announced = false;
        child.stdout.on("data", (chunk) => {
            output += chunk;
            if (!announced && output.includes("LOCK_HELD")) {
                announced = true;
                ready?.();
            }
        });
        child.stderr.on("data", (chunk) => {
            errors += chunk;
        });
        child.stdin.end(input);
        return new Promise((resolve, reject) => {
            child.on("error", reject);
            child.on("exit", (code) =>
                code === 0 ? resolve(output) : reject(new Error(errors)),
            );
        });
    };
    let started = false;

    try {
        execFileSync(
            "initdb",
            [
                "-D",
                dataDirectory,
                "-U",
                "postgres",
                "-A",
                "trust",
                "--no-locale",
                "-E",
                "UTF8",
            ],
            { stdio: "pipe", env },
        );
        execFileSync(
            "pg_ctl",
            [
                "-D",
                dataDirectory,
                "-l",
                join(directory, "postgres.log"),
                "-o",
                `-F -k '${directory}' -p 55439 -c listen_addresses='' -c unix_socket_permissions=0700`,
                "-w",
                "start",
            ],
            { stdio: "pipe", env },
        );
        started = true;

        await t.test(
            "migration fails safely when schema prerequisites are absent",
            () => {
                assert.throws(
                    () => sql(migration),
                    /Existing public.work_orders/,
                );
            },
        );

        sql(`
            create role anon nologin;
            create role authenticated nologin;
            create schema auth;
            create function auth.uid() returns uuid language sql stable as
            $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
            grant usage on schema auth to authenticated, anon;
            create table public.work_orders (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null,
                order_number integer not null check (order_number > 0),
                fecha date not null,
                nombre text not null check (nombre <> 'constraint-failure'),
                telefono text not null,
                vehiculo text not null,
                dominio text not null,
                novedades text not null,
                garantia boolean not null default false,
                oblea boolean not null default false,
                ph boolean not null default false,
                nv boolean not null default false,
                retencion boolean not null default false,
                mangueras boolean not null default false,
                fotos text[] not null default '{}',
                status text not null check (status in ('Abierta', 'Finalizada')),
                monto_cobrado numeric check (monto_cobrado >= 0),
                forma_pago text not null,
                notas_extra text not null,
                created_at timestamptz not null default now()
            );
            alter table public.work_orders enable row level security;
            create policy owner_access on public.work_orders to authenticated
                using (user_id = auth.uid()) with check (user_id = auth.uid());
            grant select, insert, update, delete on public.work_orders to authenticated;
        `);

        await t.test(
            "migration is idempotent, invoker-only, and grants only authenticated execution",
            () => {
                const tablePermissions = sql(
                    `select relacl::text from pg_class where oid = 'public.work_orders'::regclass;`,
                );
                sql(migration);
                sql(migration);
                assert.equal(
                    sql(
                        `select relacl::text from pg_class where oid = 'public.work_orders'::regclass;`,
                    ),
                    tablePermissions,
                );
                assert.equal(
                    sql(`select atttypid = 'jsonb'::regtype from pg_attribute
                where attrelid = 'public.work_orders'::regclass and attname = 'verification_checklist';`),
                    "t",
                );
                assert.equal(
                    sql(`select atttypid = 'text[]'::regtype from pg_attribute
                where attrelid = 'public.work_orders'::regclass and attname = 'verification_files';`),
                    "t",
                );
                assert.equal(
                    sql(`select count(*) from pg_constraint where conrelid = 'public.work_orders'::regclass
                and conname in ('work_orders_verification_checklist_valid', 'work_orders_verification_files_valid');`),
                    "2",
                );
                assert.equal(
                    sql(`select not prosecdef from pg_proc where oid =
                'public.restore_work_orders(jsonb,uuid)'::regprocedure;`),
                    "t",
                );
                assert.equal(
                    sql(`select has_function_privilege('anon',
                'public.restore_work_orders(jsonb,uuid)', 'execute');`),
                    "f",
                );
                assert.equal(
                    sql(`select has_function_privilege('authenticated',
                'public.restore_work_orders(jsonb,uuid)', 'execute');`),
                    "t",
                );
                assert.equal(
                    sql(`select not prosecdef from pg_proc where oid =
                'public.change_order_photos(uuid,jsonb,jsonb,uuid)'::regprocedure;`),
                    "t",
                );
                assert.equal(
                    sql(`select has_function_privilege('anon',
                'public.change_order_photos(uuid,jsonb,jsonb,uuid)', 'execute');`),
                    "f",
                );
                assert.equal(
                    sql(`select has_function_privilege('authenticated',
                'public.change_order_photos(uuid,jsonb,jsonb,uuid)', 'execute');`),
                    "t",
                );
                assert.throws(
                    () => sql(`set role anon; ${restore([order()])}`),
                    /permission denied/,
                );
                assert.throws(
                    () => sql(`set role anon; ${photos()}`),
                    /permission denied/,
                );
            },
        );

        await t.test(
            "restore preserves stable IDs, dependents, defaults, and other owners",
            () => {
                sql(asOwner(restore([order()])));
                const other = order({
                    id: "22222222-2222-4222-8222-222222222222",
                    user_id: USER_B,
                });
                sql(asOwner(restore([other], USER_B), USER_B));
                sql(`create table order_notes (order_id uuid references work_orders(id) on delete cascade);
                insert into order_notes values ('${ORDER_ID}');`);
                const restored = order({ nombre: "Restored customer" });
                sql(asOwner(restore([restored])));
                assert.equal(
                    sql(
                        `select nombre from work_orders where id = '${ORDER_ID}';`,
                    ),
                    "Restored customer",
                );
                assert.equal(sql("select count(*) from order_notes;"), "1");
                assert.equal(
                    sql(
                        `select count(*) from work_orders where user_id = '${USER_B}';`,
                    ),
                    "1",
                );
                assert.equal(
                    sql(
                        `select created_at is not null from work_orders where id = '${ORDER_ID}';`,
                    ),
                    "t",
                );
            },
        );

        await t.test(
            "restore persists verification sheet and direct writes reject malformed values",
            () => {
                const file = `${USER_A}/verification/11111111-1111-4111-8111-111111111111.pdf`;
                sql(
                    asOwner(
                        restore([
                            order({
                                verification_checklist: verificationChecklist({
                                    REGULADOR: { status: "OK", note: "safe" },
                                }),
                                verification_files: [file],
                            }),
                        ]),
                    ),
                );
                assert.equal(
                    sql(`select verification_checklist->'REGULADOR'->>'status'
                from work_orders where id = '${ORDER_ID}';`),
                    "OK",
                );
                assert.equal(
                    sql(
                        `select verification_files[1] from work_orders where id = '${ORDER_ID}';`,
                    ),
                    file,
                );
                assert.throws(
                    () =>
                        sql(
                            asOwner(`update work_orders set verification_checklist =
                '{"REGULADOR":{"status":"OK","note":"missing keys"}}'::jsonb where id = '${ORDER_ID}';`),
                        ),
                    /verification_checklist|check constraint/,
                );
                assert.throws(
                    () =>
                        sql(
                            asOwner(`update work_orders set verification_checklist =
                ${json({ ...verificationChecklist(), REGULADOR: { status: "BAD", note: "" } })} where id = '${ORDER_ID}';`),
                        ),
                    /verification_checklist|check constraint/,
                );
                assert.throws(
                    () =>
                        sql(
                            asOwner(`update work_orders set verification_files =
                array['${USER_A}/verification/not-a-uuid.svg'] where id = '${ORDER_ID}';`),
                        ),
                    /verification_files|check constraint/,
                );
                assert.equal(
                    sql(
                        asOwner(`update work_orders set verification_checklist = '{}'::jsonb,
                verification_files = '{}' where id = '${ORDER_ID}'; select verification_files = '{}' from work_orders where id = '${ORDER_ID}';`),
                    ),
                    "t",
                );
            },
        );

        await t.test(
            "a late constraint failure rolls back earlier upserts and owner-scoped deletion",
            () => {
                const before = sql(
                    "select jsonb_agg(to_jsonb(w) order by id) from work_orders w;",
                );
                const failingSecond = order({
                    id: "33333333-3333-4333-8333-333333333333",
                    order_number: 2,
                    nombre: "constraint-failure",
                });
                assert.throws(
                    () =>
                        sql(
                            asOwner(
                                restore([
                                    order({ nombre: "must-roll-back" }),
                                    failingSecond,
                                ]),
                            ),
                        ),
                    /check constraint/,
                );
                assert.equal(
                    sql(
                        "select jsonb_agg(to_jsonb(w) order by id) from work_orders w;",
                    ),
                    before,
                );
            },
        );

        await t.test(
            "malformed, duplicate, foreign-owner, and foreign-ID inputs leave rows unchanged",
            () => {
                const before = sql(
                    "select jsonb_agg(to_jsonb(w) order by id) from work_orders w;",
                );
                const cases = [
                    [],
                    [order(), order()],
                    [order({ user_id: USER_B })],
                    [order({ id: "22222222-2222-4222-8222-222222222222" })],
                    [{ ...order(), unknown: true }],
                ];
                for (const invalid of cases) {
                    assert.throws(() => sql(asOwner(restore(invalid))));
                    assert.equal(
                        sql(
                            "select jsonb_agg(to_jsonb(w) order by id) from work_orders w;",
                        ),
                        before,
                    );
                }
                assert.throws(
                    () => sql(asOwner(restore([order()], USER_B))),
                    /owner mismatch/,
                );
                assert.equal(
                    sql(
                        "select jsonb_agg(to_jsonb(w) order by id) from work_orders w;",
                    ),
                    before,
                );
            },
        );

        await t.test("photo deltas are idempotent and owner-bound", () => {
            const a = "https://example.test/a.jpg";
            const b = "https://example.test/b.jpg";
            assert.deepEqual(JSON.parse(sql(asOwner(photos([a, b])))), [a, b]);
            assert.deepEqual(JSON.parse(sql(asOwner(photos([a])))), [a, b]);
            assert.deepEqual(JSON.parse(sql(asOwner(photos([], [a])))), [b]);
            assert.deepEqual(JSON.parse(sql(asOwner(photos([], [a])))), [b]);
            assert.throws(
                () => sql(asOwner(photos([], [], ORDER_ID, USER_B))),
                /owner mismatch/,
            );
            assert.throws(
                () =>
                    sql(
                        asOwner(
                            photos(
                                [],
                                [],
                                "22222222-2222-4222-8222-222222222222",
                            ),
                        ),
                    ),
                /not found or not owned/,
            );
        });

        async function runConcurrent(firstDelta, secondDelta) {
            sql(
                `update work_orders set fotos = array['https://example.test/base.jpg'] where id = '${ORDER_ID}';`,
            );
            let announce;
            const locked = new Promise((resolve) => {
                announce = resolve;
            });
            const first = asyncSQL(
                `begin; ${asOwner(firstDelta)}
                \\echo LOCK_HELD
                select pg_sleep(0.3); commit;`,
                announce,
            );
            await Promise.race([
                locked,
                first.then(() => {
                    throw new Error("Lock marker missing");
                }),
            ]);
            const second = asyncSQL(asOwner(secondDelta));
            await Promise.all([first, second]);
            return JSON.parse(sql(asOwner(photos())));
        }

        await t.test(
            "concurrent add/add deltas serialize without lost updates",
            async () => {
                const result = await runConcurrent(
                    photos(["https://example.test/a.jpg"]),
                    photos(["https://example.test/b.jpg"]),
                );
                assert.deepEqual(result, [
                    "https://example.test/base.jpg",
                    "https://example.test/a.jpg",
                    "https://example.test/b.jpg",
                ]);
            },
        );

        await t.test(
            "concurrent add/remove deltas serialize without restoring removed URLs",
            async () => {
                const result = await runConcurrent(
                    photos(
                        ["https://example.test/a.jpg"],
                        ["https://example.test/base.jpg"],
                    ),
                    photos(["https://example.test/b.jpg"]),
                );
                assert.deepEqual(result, [
                    "https://example.test/a.jpg",
                    "https://example.test/b.jpg",
                ]);
            },
        );
        await t.test('durable photo paths require the authenticated owner in restore and deltas', () => {
            const path = `${USER_A}/${ORDER_ID}.jpg`;
            sql(asOwner(restore([order({ fotos: [path] })])));
            assert.deepEqual(JSON.parse(sql(asOwner(photos([path])))), [path]);
            for (const invalid of [`${USER_B}/${ORDER_ID}.jpg`, `${USER_A}/../${ORDER_ID}.jpg`, `${USER_A}%2f${ORDER_ID}.jpg`]) {
                assert.throws(() => sql(asOwner(restore([order({ fotos: [invalid] })]))));
                assert.throws(() => sql(asOwner(photos([invalid]))));
            }
            assert.throws(() => sql(asOwner(restore([order({ verification_files: [`${USER_B}/verification/${ORDER_ID}.pdf`] })]))));
        });

        await t.test('self-contained private bootstrap executes with simulated Supabase and enforces isolation', () => {
            // Only this test-created cluster is reset; never an ambient database.
            sql(`drop table public.work_orders cascade;
                drop function public.restore_work_orders(jsonb, uuid);
                drop function public.change_order_photos(uuid, jsonb, jsonb, uuid);
                drop function public.verification_checklist_is_valid(jsonb);
                drop function public.verification_files_are_valid(text[]);
                drop function if exists public.owner_media_path_is_valid(text, uuid, boolean);
                create table auth.users (id uuid primary key);
                insert into auth.users values ('${USER_A}'), ('${USER_B}');
                create schema storage;
                create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
                create table storage.objects (id uuid default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
                alter table storage.objects enable row level security;
                grant usage on schema storage to authenticated, anon;
                grant select, insert, delete on storage.objects to authenticated, anon;`);
            const bootstrap = readFileSync(new URL('../database/bootstrap-private-cloud.sql', import.meta.url), 'utf8');
            sql(`create policy unexpected on storage.objects for select to anon using (true);`);
            assert.throws(() => sql(bootstrap), /Unexpected Storage policies/);
            assert.equal(sql(`select to_regclass('public.work_orders') is null;`), 't');
            sql('drop policy unexpected on storage.objects;');
            sql(`insert into storage.buckets values ('photos', 'photos', true, null, null);`);
            assert.throws(() => sql(bootstrap), /Existing photos bucket/);
            sql(`delete from storage.buckets;`);
            sql(bootstrap);
            assert.equal(sql(`select public from storage.buckets where id = 'photos';`), 'f');
            assert.equal(sql(`select file_size_limit from storage.buckets where id = 'photos';`), '20971520');
            assert.deepEqual(JSON.parse(sql(`select to_json(allowed_mime_types) from storage.buckets where id = 'photos';`)), [
                'image/jpeg', 'image/png', 'application/pdf', 'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ]);
            assert.equal(sql(`select count(*) from pg_policy where polrelid = 'storage.objects'::regclass
                and polroles = array['authenticated'::regrole::oid] and polcmd in ('a', 'r', 'd');`), '3');
            assert.equal(sql(`select has_table_privilege('anon', 'work_orders', 'SELECT, INSERT, UPDATE, DELETE');`), 'f');
            assert.throws(() => sql(bootstrap), /Existing work_orders/);
            const path = `${USER_A}/${ORDER_ID}.jpg`;
            sql(asOwner(restore([order({ fotos: [path] })])));
            assert.throws(() => sql(bootstrap), /Existing work_orders/);
            assert.equal(sql(asOwner('select count(*) from work_orders;')), '1');
            assert.equal(sql(asOwner('select count(*) from work_orders;', USER_B)), '0');
            assert.throws(() => sql(`set role anon; select * from work_orders;`), /permission denied/);
            assert.throws(() => sql(`set role anon; ${photos()}`), /permission denied/);
            for (const invalid of ['https://foreign.test/photo.jpg', `${USER_B}/${ORDER_ID}.jpg`, `${USER_A}%2f${ORDER_ID}.jpg`, `${USER_A}/../${ORDER_ID}.jpg`]) {
                assert.throws(() => sql(asOwner(restore([order({ fotos: [invalid] })]))));
                assert.throws(() => sql(asOwner(photos([invalid]))));
                assert.throws(() => sql(asOwner(`update work_orders set fotos = array[${quote(invalid)}];`)));
            }
            assert.throws(() => sql(asOwner(photos([], ['https://foreign.test/photo.jpg']))));
            assert.throws(() => sql(asOwner(`update work_orders set fotos = array[null]::text[];`)));
            assert.throws(() => sql(asOwner(`update work_orders set user_id = '${USER_B}';`)));
            assert.throws(() => sql(asOwner(`update work_orders set verification_files = array['${USER_B}/verification/${ORDER_ID}.pdf'];`)));
            const attachment = `${USER_A}/verification/${ORDER_ID}.pdf`;
            sql(asOwner(restore([order({ fotos: [path], verification_files: [attachment] })])));
            sql(asOwner(`insert into storage.objects(bucket_id, name) values ('photos', '${attachment}');`));
            sql(asOwner(`insert into storage.objects(bucket_id, name) values ('photos', '${path}');`));
            assert.equal(sql(asOwner('select count(*) from storage.objects;', USER_B)), '0');
            assert.equal(sql(`set role anon; select count(*) from storage.objects;`), '0');
            assert.throws(() => sql(`set role anon; insert into storage.objects(bucket_id, name) values ('photos', '${path}');`));
            assert.throws(() => sql(asOwner(`insert into storage.objects(bucket_id, name) values ('photos', '${USER_B}/${ORDER_ID}.jpg');`)));
            assert.throws(() => sql(asOwner(`insert into storage.objects(bucket_id, name) values ('photos', '${USER_A}/../bad.jpg');`)));
            assert.equal(sql(asOwner(`delete from storage.objects returning name;`, USER_B)), '');
            assert.deepEqual(sql(asOwner(`delete from storage.objects returning name;`)).split('\n').sort(), [attachment, path].sort());
        });
    } finally {
        if (started) {
            execFileSync(
                "pg_ctl",
                ["-D", dataDirectory, "-m", "immediate", "-w", "stop"],
                { stdio: "pipe", env },
            );
        }
        rmSync(directory, { recursive: true, force: true });
    }
});
