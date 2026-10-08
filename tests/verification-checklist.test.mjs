import test from "node:test";
import assert from "node:assert/strict";
import { createApp, order, USER_A, USER_B } from "./browser-harness.mjs";

const malicious = `</td><img src=x onerror="globalThis.auditMarker=1"><script>alert('x')</script>'"`;

function fillRequiredOrder(app) {
    app.login(USER_A);
    app.get("order-number").value = "7";
    app.get("fecha").value = "2026-05-13";
    app.get("nombre").value = "Customer";
    app.get("telefono").value = "123";
    app.get("vehiculo").value = "Car";
    app.get("dominio").value = "abc123";
    app.get("novedades").value = "Repair";
}

test("creation payload carries optional canonical verification checklist and safe attachment paths", async () => {
    const app = await createApp();
    fillRequiredOrder(app);
    const uploads = [];
    let inserted;
    app.client.storage.from = (bucket) => ({
        upload: async (path, file, options) => {
            uploads.push({ bucket, path, file, options });
            return { data: { path }, error: null };
        },
        getPublicUrl: (path) => ({
            data: { publicUrl: `https://example.test/${path}` },
        }),
        remove: async () => ({ error: null }),
    });
    app.client.from = (table) => ({
        insert: async (rows) => {
            inserted = { table, rows };
            return { error: null };
        },
    });

    app.set("testNote", `Checked ${malicious}`);
    app.evaluate(`setVerificationChecklistItem('REGULADOR', 'OK', testNote)`);
    app.evaluate(`setVerificationChecklistItem('CABLEADO VALVULA', 'N/A', '')`);
    app.set("verificationSelectedFiles", [
        { name: "unsafe name<script>.PDF", type: "application/pdf" },
        {
            name: "sheet.xlsx",
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
    ]);

    await app.get("work-order-form").dispatch("submit");

    assert.equal(inserted.table, "work_orders");
    const row = inserted.rows[0];
    assert.equal(row.user_id, USER_A);
    assert.deepEqual(Object.keys(row.verification_checklist), [
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
    ]);
    assert.equal(row.verification_checklist.REGULADOR.status, "OK");
    assert.equal(
        row.verification_checklist.REGULADOR.note,
        `Checked ${malicious}`,
    );
    assert.equal(row.verification_checklist["FILTRO DE GAS"].status, null);
    assert.deepEqual(
        Array.from(row.verification_files),
        uploads.map((upload) => upload.path),
    );
    assert.ok(uploads.every((upload) => upload.bucket === "photos"));
    assert.ok(
        uploads.every((upload) =>
            upload.path.startsWith(`${USER_A}/verification/`),
        ),
    );
    assert.ok(uploads[0].path.endsWith(".pdf"));
    assert.ok(!uploads[0].path.includes("unsafe name"));
});

test("new order retains uploaded verification attachments when insert outcome is ambiguous", async () => {
    for (const insertResult of ["throw", "malformed"]) {
        const app = await createApp();
        fillRequiredOrder(app);
        const uploaded = [];
        const removals = [];
        app.client.storage.from = () => ({
            upload: async (path) => {
                uploaded.push(path);
                return { data: { path }, error: null };
            },
            getPublicUrl: (path) => ({
                data: { publicUrl: `https://example.test/${path}` },
            }),
            remove: async (paths) => {
                removals.push(paths);
                return { error: null };
            },
        });
        app.client.from = () => ({
            insert: async () => {
                if (insertResult === "throw")
                    throw new Error("network unknown");
                return null;
            },
        });
        app.set("verificationSelectedFiles", [
            { name: "check.pdf", type: "application/pdf" },
        ]);

        await app.get("work-order-form").dispatch("submit");

        assert.equal(uploaded.length, 1);
        assert.deepEqual(removals, []);
        assert.match(
            app.get("notification-message").textContent,
            /No se pudo confirmar|network unknown/,
        );
    }
});

test("new order stale-context insert outcome retains uploaded verification attachments", async () => {
    const app = await createApp();
    fillRequiredOrder(app);
    let uploaded;
    const removals = [];
    app.client.storage.from = () => ({
        upload: async (path) => {
            uploaded = path;
            return { data: { path }, error: null };
        },
        getPublicUrl: (path) => ({
            data: { publicUrl: `https://example.test/${path}` },
        }),
        remove: async (paths) => {
            removals.push(paths);
            return { error: null };
        },
    });
    app.client.from = () => ({
        insert: async () => {
            app.login(USER_B);
            return { error: null };
        },
    });
    app.set("verificationSelectedFiles", [
        { name: "check.pdf", type: "application/pdf" },
    ]);

    await app.get("work-order-form").dispatch("submit");

    assert.ok(uploaded);
    assert.deepEqual(removals, []);
});

test("new order explicit insert failure compensates verification attachments exactly once", async () => {
    const app = await createApp();
    fillRequiredOrder(app);
    let uploaded;
    const removals = [];
    app.client.storage.from = () => ({
        upload: async (path) => {
            uploaded = path;
            return { data: { path }, error: null };
        },
        getPublicUrl: (path) => ({
            data: { publicUrl: `https://example.test/${path}` },
        }),
        remove: async (paths) => {
            removals.push(paths);
            return { error: null };
        },
    });
    app.client.from = () => ({
        insert: async () => ({ error: { message: "insert rejected" } }),
    });
    app.set("verificationSelectedFiles", [
        { name: "check.pdf", type: "application/pdf" },
    ]);

    await app.get("work-order-form").dispatch("submit");

    assert.deepEqual(
        removals.map((paths) => Array.from(paths)),
        [[uploaded]],
    );
    assert.match(
        app.get("notification-message").textContent,
        /insert rejected/,
    );
});

test("verification attachments reject unsupported types before storage or persistence", async () => {
    const app = await createApp();
    fillRequiredOrder(app);
    let uploads = 0;
    let inserts = 0;
    app.client.storage.from = () => ({
        upload: async () => {
            uploads++;
            return { data: {}, error: null };
        },
    });
    app.client.from = () => ({
        insert: async () => {
            inserts++;
            return { error: null };
        },
    });
    app.set("verificationSelectedFiles", [
        { name: "payload.svg", type: "image/svg+xml" },
    ]);

    await app.get("work-order-form").dispatch("submit");

    assert.equal(uploads, 0);
    assert.equal(inserts, 0);
    assert.match(app.get("notification-message").textContent, /verificaci/i);
});

test("admin detail save persists verification for open and finalized orders", async () => {
    for (const status of ["Abierta", "Finalizada"]) {
        const app = await createApp();
        app.login(USER_A);
        let updatePayload;
        const filters = [];
        const chain = {
            update(payload) {
                updatePayload = { table: "work_orders", payload };
                return chain;
            },
            eq(key, value) {
                filters.push([key, value]);
                return filters.length >= 2
                    ? Promise.resolve({ error: null })
                    : chain;
            },
        };
        app.client.from = () => chain;
        app.set(
            "testOrder",
            order({
                status,
                verification_checklist: {
                    REGULADOR: { status: "NO OK", note: "late" },
                },
            }),
        );
        app.evaluate("viewOrder(testOrder)");

        await app.get("save-verification-btn").click();

        assert.equal(updatePayload.table, "work_orders");
        assert.equal(
            updatePayload.payload.verification_checklist.REGULADOR.status,
            "NO OK",
        );
        assert.deepEqual(filters, [
            ["id", order().id],
            ["user_id", USER_A],
        ]);
    }
});

test("admin detail can add and remove verification attachments safely", async () => {
    const app = await createApp();
    app.login(USER_A);
    const kept = `${USER_A}/verification/33333333-3333-4333-8333-333333333333.pdf`;
    const removed = `${USER_A}/verification/44444444-4444-4444-8444-444444444444.pdf`;
    let uploaded;
    const storage = { uploads: [], removals: [] };
    let updatePayload;
    app.client.storage.from = () => ({
        upload: async (path, file, options) => {
            uploaded = path;
            storage.uploads.push({ path, file, options });
            return { data: { path }, error: null };
        },
        getPublicUrl: (path) => ({
            data: { publicUrl: `https://example.test/${path}` },
        }),
        remove: async (paths) => {
            storage.removals.push(paths);
            return { error: null };
        },
    });
    let filters = 0;
    const chain = {
        update(payload) {
            updatePayload = payload;
            return chain;
        },
        eq() {
            filters++;
            return filters >= 2 ? Promise.resolve({ error: null }) : chain;
        },
    };
    app.client.from = () => chain;
    app.set("testOrder", order({ verification_files: [kept, removed] }));
    app.evaluate("viewOrder(testOrder)");

    await app.get("edit-verification-files").children[1].children[1].click();
    await app.get("edit-verification-files-input").dispatch("change", {
        target: {
            files: [{ name: "new.pdf", type: "application/pdf" }],
            value: "",
        },
    });
    await app.get("save-verification-btn").click();

    assert.deepEqual(Array.from(updatePayload.verification_files), [
        kept,
        uploaded,
    ]);
    assert.equal(storage.uploads.length, 1);
    assert.deepEqual(storage.removals, [], 'unlinking keeps objects recoverable by older backups');
});

test("admin detail retains verification uploads and removed existing attachments on ambiguous DB update", async () => {
    for (const updateResult of ["throw", "malformed"]) {
        const app = await createApp();
        app.login(USER_A);
        const removed = `${USER_A}/verification/44444444-4444-4444-8444-444444444444.pdf`;
        let uploaded;
        const removals = [];
        app.client.storage.from = () => ({
            upload: async (path) => {
                uploaded = path;
                return { data: { path }, error: null };
            },
            getPublicUrl: (path) => ({
                data: { publicUrl: `https://example.test/${path}` },
            }),
            remove: async (paths) => {
                removals.push(paths);
                return { error: null };
            },
        });
        let filters = 0;
        const chain = {
            update() {
                return chain;
            },
            eq() {
                filters++;
                if (filters < 2) return chain;
                if (updateResult === "throw")
                    throw new Error("network unknown");
                return Promise.resolve(null);
            },
        };
        app.client.from = () => chain;
        app.set("testOrder", order({ verification_files: [removed] }));
        app.evaluate("viewOrder(testOrder)");

        await app
            .get("edit-verification-files")
            .children[0].children[1].click();
        await app.get("edit-verification-files-input").dispatch("change", {
            target: {
                files: [{ name: "new.pdf", type: "application/pdf" }],
                value: "",
            },
        });
        await app.get("save-verification-btn").click();

        assert.ok(uploaded);
        assert.deepEqual(removals, []);
        assert.match(
            app.get("notification-message").textContent,
            /No se pudo guardar la planilla/,
        );
    }
});

test("admin detail retains verification uploads and removed existing attachments on stale-context DB update", async () => {
    const app = await createApp();
    app.login(USER_A);
    const removed = `${USER_A}/verification/44444444-4444-4444-8444-444444444444.pdf`;
    let uploaded;
    const removals = [];
    app.client.storage.from = () => ({
        upload: async (path) => {
            uploaded = path;
            return { data: { path }, error: null };
        },
        getPublicUrl: (path) => ({
            data: { publicUrl: `https://example.test/${path}` },
        }),
        remove: async (paths) => {
            removals.push(paths);
            return { error: null };
        },
    });
    let filters = 0;
    const chain = {
        update() {
            return chain;
        },
        eq() {
            filters++;
            if (filters < 2) return chain;
            app.login(USER_B);
            return Promise.resolve({ error: null });
        },
    };
    app.client.from = () => chain;
    app.set("testOrder", order({ verification_files: [removed] }));
    app.evaluate("viewOrder(testOrder)");

    await app.get("edit-verification-files").children[0].children[1].click();
    await app.get("edit-verification-files-input").dispatch("change", {
        target: {
            files: [{ name: "new.pdf", type: "application/pdf" }],
            value: "",
        },
    });
    await app.get("save-verification-btn").click();

    assert.ok(uploaded);
    assert.deepEqual(removals, []);
});

test("admin detail compensates newly uploaded verification attachments on explicit DB failure only", async () => {
    const app = await createApp();
    app.login(USER_A);
    const removed = `${USER_A}/verification/44444444-4444-4444-8444-444444444444.pdf`;
    let uploaded;
    const removals = [];
    app.client.storage.from = () => ({
        upload: async (path) => {
            uploaded = path;
            return { data: { path }, error: null };
        },
        getPublicUrl: (path) => ({
            data: { publicUrl: `https://example.test/${path}` },
        }),
        remove: async (paths) => {
            removals.push(paths);
            return { error: null };
        },
    });
    let filters = 0;
    const chain = {
        update() {
            return chain;
        },
        eq() {
            filters++;
            return filters >= 2
                ? Promise.resolve({ error: { message: "db rejected" } })
                : chain;
        },
    };
    app.client.from = () => chain;
    app.set("testOrder", order({ verification_files: [removed] }));
    app.evaluate("viewOrder(testOrder)");

    await app.get("edit-verification-files").children[0].children[1].click();
    await app.get("edit-verification-files-input").dispatch("change", {
        target: {
            files: [{ name: "new.pdf", type: "application/pdf" }],
            value: "",
        },
    });
    await app.get("save-verification-btn").click();

    assert.deepEqual(
        removals.map((paths) => Array.from(paths)),
        [[uploaded]],
    );
    assert.ok(
        !removals.flatMap((paths) => Array.from(paths)).includes(removed),
    );
    assert.match(app.get("notification-message").textContent, /db rejected/);
});

test("admin detail, public view, and printing render verification safely", async () => {
    const app = await createApp();
    app.login(USER_A);
    const checked = order({
        status: "Finalizada",
        verification_checklist: {
            REGULADOR: { status: "OK", note: malicious },
        },
        verification_files: [
            `${USER_A}/verification/22222222-2222-4222-8222-222222222222.pdf`,
            `${USER_A}/verification/${malicious}.xlsx`,
        ],
    });
    app.set("testOrder", checked);
    app.evaluate("viewOrder(testOrder); printWorkOrder(testOrder)");
    assert.ok(
        app
            .get("view-order-content")
            .innerHTML.includes("Planilla de verificación"),
    );
    assert.ok(app.get("view-order-content").innerHTML.includes("REGULADOR"));
    assert.ok(
        app
            .get("view-order-content")
            .innerHTML.includes(
                "22222222-2222-4222-8222-222222222222.pdf",
            ),
    );
    assert.ok(!app.get("view-order-content").innerHTML.includes(malicious));
    assert.ok(
        app.get("view-order-content").innerHTML.includes("&lt;script&gt;"),
    );
    const printOutput = app.calls.print.join("");
    assert.ok(printOutput.includes("Planilla de verificación"));
    assert.ok(
        printOutput.includes(
            "22222222-2222-4222-8222-222222222222.pdf",
        ),
    );
    assert.ok(!printOutput.includes(malicious));
    assert.ok(!printOutput.includes(`${malicious}.xlsx`));

    app.client.from = () => ({
        select() {
            return this;
        },
        eq() {
            return this;
        },
        single: async () => ({ data: checked, error: null }),
    });
    await app.evaluate(`showPublicOrderView('${checked.id}')`);
    assert.ok(
        app
            .get("pub-verification-content")
            .innerHTML.includes("Planilla de verificación"),
    );
    assert.ok(
        !app.get("pub-verification-content").innerHTML.includes(malicious),
    );
});

test("verification summary renders one compact line per item and prints on a single page", async () => {
    const app = await createApp();
    app.set("longNote", "Revisar ".concat("x".repeat(160)));
    app.set("maliciousNote", `Sin fuga ${malicious}`);
    const sheet = app.evaluate(
        "renderVerificationSummary({verification_checklist:{REGULADOR:{status:'OK',note:maliciousNote},CUNA:{status:'NO OK',note:longNote}},verification_files:[]})"
    );

    // One dense row per canonical item, two columns of rows, no per-row vertical padding.
    assert.equal((sheet.match(/<li class="verification-row"/g) || []).length, 12);
    assert.ok(sheet.includes('<ol class="verification-grid"'));
    assert.ok(!sheet.includes('py-1'));
    assert.ok(!/<div class="py-1"><dt>/.test(sheet));
    // Item, short status code and note share the same row.
    const firstRow = sheet.match(/<li class="verification-row">[\s\S]*?<\/li>/)[0];
    assert.ok(firstRow.includes('<span class="verification-item">REGULADOR</span>'));
    assert.ok(firstRow.includes('data-status="OK"'));
    assert.ok(firstRow.includes('verification-code'));
    assert.ok(firstRow.includes('verification-note'));
    assert.ok(!firstRow.includes('Pendiente'));
    assert.ok(firstRow.includes('aria-hidden="true"'), 'truncated note copy is decorative');
    assert.ok(firstRow.includes('verification-note-full'), 'full note stays available to assistive tech');
    assert.ok(!firstRow.includes(malicious));
    assert.ok(firstRow.includes('&lt;script&gt;'));
    assert.ok(sheet.includes('data-status="PEND"'), 'unset items use a pending code');
    assert.ok(sheet.includes('data-status="NO"'), 'NO OK renders a short code');
    assert.equal((sheet.match(/class="verification-code"/g) || []).length, 12);

    // The single renderer stays shared by detail, public and print surfaces.
    app.login(USER_A);
    app.set("testOrder", order());
    app.evaluate("viewOrder(testOrder); printWorkOrder(testOrder)");
    assert.equal(
        (app.get("view-order-content").innerHTML.match(/class="verification-row"/g) || []).length,
        12,
    );
    const printOutput = app.calls.print.join("");
    assert.equal((printOutput.match(/class="verification-row"/g) || []).length, 12);
    assert.ok(printOutput.includes("Planilla de verificación"));
});

test("print sheet keeps one page: page margin, no page break inside, compact spacing", async () => {
    const app = await createApp();
    const printCss = app.evaluate("VERIFICATION_PRINT_CSS");
    assert.match(printCss, /@page\s*\{\s*margin:/);
    assert.match(printCss, /break-inside:\s*avoid/);
    assert.match(printCss, /page-break-inside:\s*avoid/);
    assert.match(printCss, /grid-template-columns:\s*repeat\(2/);
    assert.match(printCss, /\.verification-note\s*\{[^}]*text-overflow:\s*ellipsis/);
    assert.match(printCss, /\.verification-code\s*\{[^}]*font-size:\s*9px/);

    app.login(USER_A);
    app.set("testOrder", order({ garantia: true, fotos: [] }));
    app.evaluate("printWorkOrder(testOrder)");
    const printOutput = app.calls.print.join("");
    assert.ok(printOutput.includes(printCss), 'print window injects the compact sheet CSS');
    // Order fields, flags and signatures are preserved next to the compact sheet.
    for (const preserved of [
        "ORDEN DE TRABAJO", "Cliente:", "Teléfono:", "Vehículo:", "Dominio:",
        "Novedades y Trabajos a Realizar", "Garantía:", "Oblea:", "Retención:",
        "Firma del Cliente", "Firma del Taller",
    ]) assert.ok(printOutput.includes(preserved), `print sheet lost ${preserved}`);
});

test("legacy orders normalize to an incomplete empty verification sheet", async () => {
    const app = await createApp();
    const normalized = app.evaluate(
        "normalizeVerificationChecklist(undefined)",
    );
    assert.equal(normalized.REGULADOR.status, null);
    assert.equal(normalized.REGULADOR.note, "");
    assert.equal(Object.keys(normalized).length, 12);
    assert.deepEqual(
        Array.from(app.evaluate("normalizeVerificationFiles(undefined)")),
        [],
    );
});

test('uncertain new-order retry is blocked before any additional uploads or compensation', async () => {
    const app = await createApp();
    fillRequiredOrder(app);
    let uploads = 0;
    let inserts = 0;
    let removals = 0;
    app.client.storage.from = () => ({
        upload: async path => { uploads++; return { data: { path }, error: null }; },
        getPublicUrl: path => ({ data: { publicUrl: `https://example.test/${path}` } }),
        remove: async () => { removals++; return { error: null }; }
    });
    app.client.from = () => ({ insert: async () => { inserts++; throw new Error('unknown'); } });
    app.set('verificationSelectedFiles', [{ name: 'first.pdf', type: 'application/pdf' }]);
    await app.get('work-order-form').dispatch('submit');
    app.evaluate("verificationSelectedFiles.push({ name: 'second.pdf', type: 'application/pdf' })");
    await app.get('work-order-form').dispatch('submit');
    assert.equal(uploads, 1);
    assert.equal(inserts, 1);
    assert.equal(removals, 0);
});
