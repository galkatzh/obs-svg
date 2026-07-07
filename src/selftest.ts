/**
 * End-to-end self-test, runnable from the command palette (or the obsidian
 * CLI) inside a live vault. Opens the real editor modal, drives it with
 * synthetic pointer events, exercises code mode, block write-back and the
 * markdown renderer, then writes a PASS/FAIL report note.
 */

import { Component, MarkdownRenderer, Notice, TFile } from "obsidian";
import type SvgEditorPlugin from "./main";
import { SvgEditorModal } from "./modal";

interface Result {
    name: string;
    pass: boolean;
    detail: string;
}

const REPORT_PATH = "SVGE-SelfTest-Report.md";
const TARGET_PATH = "SVGE-SelfTest-Target.md";

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** Offscreen container for render checks, styled via styles.css. */
const hiddenHost = (): HTMLElement => activeDocument.body.createDiv({ cls: "svge-selftest-host" });

function firePointer(target: EventTarget, type: string, x: number, y: number, opts: PointerEventInit = {}): void {
    target.dispatchEvent(
        new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            pointerId: 1,
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            ...opts,
        })
    );
}

export async function runSelfTest(plugin: SvgEditorPlugin): Promise<void> {
    const results: Result[] = [];
    const check = (name: string, pass: boolean, detail = "") => {
        results.push({ name, pass, detail });
    };

    let modal: SvgEditorModal | null = null;
    let savedSource = "";
    try {
        // ---- 1. Open the modal on a blank document ----
        modal = new SvgEditorModal(plugin.app, "", (src) => {
            savedSource = src;
        });
        modal.open();
        await sleep(150);
        const core = modal.core;
        const svg = core.svgEl;
        const rect = svg.getBoundingClientRect();
        check("modal canvas renders", rect.width > 50 && rect.height > 50, `${Math.round(rect.width)}×${Math.round(rect.height)}`);

        const pt = (fx: number, fy: number) => ({
            x: rect.left + rect.width * fx,
            y: rect.top + rect.height * fy,
        });
        const drag = (from: { x: number; y: number }, to: { x: number; y: number }) => {
            firePointer(svg, "pointerdown", from.x, from.y);
            firePointer(window, "pointermove", (from.x + to.x) / 2, (from.y + to.y) / 2);
            firePointer(window, "pointermove", to.x, to.y);
            firePointer(window, "pointerup", to.x, to.y);
        };

        // ---- 2. Draw one of each shape ----
        modal.setTool("rect");
        drag(pt(0.1, 0.1), pt(0.3, 0.3));
        check("rect tool draws <rect>", core.contentChildren().length === 1 && core.contentChildren()[0]?.tagName === "rect", core.contentChildren().map((c) => c.tagName).join(","));

        modal.setTool("circle");
        drag(pt(0.6, 0.5), pt(0.7, 0.5));
        modal.setTool("line");
        drag(pt(0.1, 0.8), pt(0.4, 0.9));
        modal.setTool("scribble");
        drag(pt(0.5, 0.8), pt(0.8, 0.85));
        const tags = core.contentChildren().map((c) => c.tagName).sort().join(",");
        check("all four shapes drawn", tags === "circle,line,path,rect", tags);

        // ---- 3. Select and move ----
        modal.setTool("select");
        const shape = core.contentChildren()[0];
        const sr = shape.getBoundingClientRect();
        const edge = { x: sr.left + 1, y: sr.top + sr.height / 2 }; // on the (unfilled) stroke
        firePointer(shape, "pointerdown", edge.x, edge.y);
        firePointer(window, "pointermove", edge.x + 30, edge.y + 20);
        firePointer(window, "pointerup", edge.x + 30, edge.y + 20);
        check("click selects shape", core.selection.length === 1, `selection=${core.selection.length}`);
        check("drag moves shape (transform set)", (shape.getAttribute("transform") ?? "").includes("translate"), shape.getAttribute("transform") ?? "(none)");

        // ---- 4. Style change applies to selection ----
        const before = shape.getAttribute("stroke");
        core.setStyle({ stroke: "#ff0000" });
        check("style change applies to selection", shape.getAttribute("stroke") === "#ff0000", `${before} → ${shape.getAttribute("stroke")}`);

        // ---- 5. Undo / redo ----
        core.undo();
        const strokeAfterUndo = core.contentChildren()[0]?.getAttribute("stroke");
        check("undo reverts style change", strokeAfterUndo === before, `stroke=${strokeAfterUndo}`);
        core.redo();
        const strokeAfterRedo = core.contentChildren()[0]?.getAttribute("stroke");
        check("redo re-applies style change", strokeAfterRedo === "#ff0000", `stroke=${strokeAfterRedo}`);

        // ---- 6. Delete + undo restore ----
        modal.setTool("select");
        core.selectAll();
        const countBefore = core.contentChildren().length;
        core.deleteSelection();
        check("delete selection empties canvas", core.contentChildren().length === 0, `${countBefore} → 0`);
        core.undo();
        check("undo restores deleted shapes", core.contentChildren().length === countBefore, `count=${core.contentChildren().length}`);

        // ---- 6b. Delete tool sweeps over shapes (press, drag across, release) ----
        modal.setTool("rect");
        drag(pt(0.05, 0.45), pt(0.15, 0.55));
        drag(pt(0.25, 0.45), pt(0.35, 0.55));
        const preSweep = core.contentChildren().length;
        const [r1, r2] = core.contentChildren().slice(-2);
        const b1 = r1.getBoundingClientRect();
        const b2 = r2.getBoundingClientRect();
        modal.setTool("delete");
        // Start on empty canvas, sweep across both rects' strokes, release on empty.
        firePointer(svg, "pointerdown", b1.left - 15, b1.top + b1.height / 2);
        firePointer(window, "pointermove", b1.left + 1, b1.top + b1.height / 2);
        firePointer(window, "pointermove", b2.left + 1, b2.top + b2.height / 2);
        firePointer(window, "pointerup", b2.right + 15, b2.top + b2.height / 2);
        check("delete tool sweep removes all swept shapes", core.contentChildren().length === preSweep - 2, `${preSweep} → ${core.contentChildren().length}`);
        core.undo();
        const restored = core.contentChildren();
        const sweptOpacityClean = restored
            .slice(-2)
            .every((el) => (el.getAttribute("opacity") ?? "1") === "1" || el.getAttribute("opacity") === null);
        check("undo restores swept shapes without fade", restored.length === preSweep && sweptOpacityClean, `count=${restored.length}`);
        // Redo the sweep so the canvas is back to the original shapes for the checks below.
        core.redo();
        check("redo re-applies sweep deletion", core.contentChildren().length === countBefore, `count=${core.contentChildren().length}`);

        // ---- 7. Code mode round-trip ----
        const toCode = modal.setMode("code");
        check("switch to code mode", toCode && modal.codeArea.value.includes("<svg"), modal.codeArea.value.slice(0, 60));
        modal.codeArea.value = modal.codeArea.value.replace(
            "</svg>",
            '  <rect x="5" y="5" width="20" height="20" fill="#00aa00"/>\n</svg>'
        );
        const backToVisual = modal.setMode("visual");
        check("code edits parse back into visual mode", backToVisual && core.contentChildren().length === countBefore + 1, `count=${core.contentChildren().length}`);

        // ---- 8. Invalid code is rejected without data loss ----
        modal.setMode("code");
        const goodCode = modal.codeArea.value;
        modal.codeArea.value = "<svg><rect</svg>";
        const rejected = !modal.setMode("visual");
        check("invalid code rejected (stays in code mode)", rejected && modal.mode === "code", `mode=${modal.mode}`);
        modal.codeArea.value = goodCode;
        modal.setMode("visual");

        // ---- 9. Canvas resize ----
        core.setCanvasSize(640, 480);
        check("canvas resize", core.serialize(true).includes('viewBox="0 0 640 480"'), core.serialize(true).split("\n")[0]);

        // ---- 10. Save produces parseable pretty source ----
        await modal.save();
        modal = null;
        check(
            "save returns svg source",
            savedSource.startsWith("<svg") && savedSource.includes("viewBox") && savedSource.split("\n").length > 2,
            savedSource.split("\n")[0] ?? ""
        );
        check(
            "no editor attrs leak into saved source",
            !savedSource.includes("data-tool") && !savedSource.includes("aspect-ratio") && !savedSource.includes("svge-"),
            savedSource.split("\n")[0] ?? ""
        );

        // ---- 11. Write-back into a real note ----
        const vault = plugin.app.vault;
        const existingTarget = vault.getAbstractFileByPath(TARGET_PATH);
        const targetBody = "# Self-test target\n\n```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\" viewBox=\"0 0 100 100\"><circle cx=\"50\" cy=\"50\" r=\"40\" stroke=\"#000000\" fill=\"none\"/></svg>\n```\n";
        if (existingTarget) {
            await vault.adapter.write(TARGET_PATH, targetBody);
        } else {
            await vault.create(TARGET_PATH, targetBody);
        }
        const oldInner = targetBody.split("\n")[3];
        const wrote = await plugin.replaceBlockInFile(TARGET_PATH, 2, 4, oldInner, savedSource);
        const newBody = await vault.adapter.read(TARGET_PATH);
        check("write-back replaces block body", wrote && newBody.includes(savedSource.split("\n")[0]) && newBody.includes("```svg"), `wrote=${wrote}`);

        // ---- 12. Stale line info falls back to content search ----
        const wrote2 = await plugin.replaceBlockInFile(TARGET_PATH, 0, 1, savedSource, savedSource + "\n<!-- fallback -->");
        const body2 = await vault.adapter.read(TARGET_PATH);
        check("stale section info falls back to search", wrote2 && body2.includes("<!-- fallback -->"), `wrote=${wrote2}`);

        // ---- 13. Markdown renderer produces an inline svg + edit button ----
        const host = hiddenHost();
        const comp = new Component();
        try {
            await MarkdownRenderer.render(
                plugin.app,
                "```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\"/></svg>\n```",
                host,
                TARGET_PATH,
                comp
            );
            await sleep(100);
            const block = host.querySelector(".svge-block");
            check("code block processor renders svg", !!block?.querySelector("svg circle"), block ? "block found" : "no .svge-block");
            check("edit button present on rendered block", !!block?.querySelector(".svge-edit-btn"), "");
        } finally {
            comp.unload();
            host.remove();
        }

        // ---- 14. Malicious svg is sanitized in preview ----
        const host2 = hiddenHost();
        const comp2 = new Component();
        try {
            await MarkdownRenderer.render(
                plugin.app,
                "```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\"><script>window.__svge_pwned=1</script><rect width=\"5\" height=\"5\" onclick=\"window.__svge_pwned=2\"/></svg>\n```",
                host2,
                TARGET_PATH,
                comp2
            );
            await sleep(100);
            const rendered = host2.querySelector(".svge-block svg");
            check(
                "scripts/handlers stripped from preview",
                !!rendered && !rendered.querySelector("script") && !rendered.querySelector("[onclick]"),
                rendered?.outerHTML.slice(0, 80) ?? "no svg"
            );
        } finally {
            comp2.unload();
            host2.remove();
        }

        // ---- 15. Mobile: compact layout, touch drawing, delete button, visible edit button ----
        // app.emulateMobile() reloads the whole app window, so the test never
        // toggles it. On a real/emulated mobile app the checks run against the
        // real UI; on desktop we simulate the one signal the plugin's mobile
        // behavior keys off (the is-mobile body class).
        const wasMobile = activeDocument.body.classList.contains("is-mobile");
        {
            let mModal: SvgEditorModal | null = null;
            try {
                if (!wasMobile) activeDocument.body.classList.add("is-mobile");
                check(
                    "mobile signal active",
                    activeDocument.body.classList.contains("is-mobile"),
                    wasMobile ? "real mobile UI" : "simulated via body class"
                );

                mModal = new SvgEditorModal(plugin.app, "", () => {});
                mModal.open();
                await sleep(150);
                const mEl = mModal.modalEl;
                check("compact layout class applied on mobile", mEl.classList.contains("svge-compact"), mEl.className);
                const mw = mEl.getBoundingClientRect().width;
                check("modal fills screen width on mobile", mw >= window.innerWidth * 0.95, `${Math.round(mw)} vs ${window.innerWidth}`);
                const tb = mEl.querySelector(".svge-toolbar")!.getBoundingClientRect();
                check("toolbar is horizontal on mobile", tb.width > tb.height, `${Math.round(tb.width)}×${Math.round(tb.height)}`);

                // Draw a rect with touch pointer events.
                const mCore = mModal.core;
                const mSvg = mCore.svgEl;
                const mr = mSvg.getBoundingClientRect();
                const touch = { pointerType: "touch" } as PointerEventInit;
                mModal.setTool("rect");
                firePointer(mSvg, "pointerdown", mr.left + mr.width * 0.2, mr.top + mr.height * 0.2, touch);
                firePointer(window, "pointermove", mr.left + mr.width * 0.5, mr.top + mr.height * 0.5, touch);
                firePointer(window, "pointerup", mr.left + mr.width * 0.5, mr.top + mr.height * 0.5, touch);
                check("touch pointer events draw a shape", mCore.contentChildren().length === 1, `count=${mCore.contentChildren().length}`);

                // Delete the shape via the on-screen button (no keyboard on mobile).
                mModal.setTool("select");
                mCore.selectAll();
                const delBtn = mEl.querySelector<HTMLButtonElement>('button[aria-label^="Delete selection"]');
                check("delete-selection button enables with selection", !!delBtn && !delBtn.disabled, delBtn ? `disabled=${delBtn.disabled}` : "button missing");
                delBtn?.click();
                check("delete-selection button removes shapes", mCore.contentChildren().length === 0, `count=${mCore.contentChildren().length}`);
                mModal.close();
                mModal = null;

                // Edit button on rendered blocks must be visible without hover.
                const host3 = hiddenHost();
                const comp3 = new Component();
                try {
                    await MarkdownRenderer.render(
                        plugin.app,
                        "```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><rect width=\"5\" height=\"5\"/></svg>\n```",
                        host3,
                        TARGET_PATH,
                        comp3
                    );
                    await sleep(100);
                    const editBtn = host3.querySelector(".svge-edit-btn");
                    const opacity = editBtn ? getComputedStyle(editBtn).opacity : "no button";
                    check("edit button visible without hover on mobile", opacity === "1", `opacity=${opacity}`);
                } finally {
                    comp3.unload();
                    host3.remove();
                }
            } finally {
                mModal?.close();
                if (!wasMobile) activeDocument.body.classList.remove("is-mobile");
            }
        }

        // ---- 16. Embedded .svg file editing ----
        const FILE_PATH = "SVGE-SelfTest-File.svg";
        const fileBody =
            '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="20" stroke="#000000" fill="none"/></svg>';
        const existingSvg = plugin.app.vault.getAbstractFileByPath(FILE_PATH);
        if (existingSvg instanceof TFile) {
            await plugin.app.vault.modify(existingSvg, fileBody);
        } else {
            await plugin.app.vault.create(FILE_PATH, fileBody);
        }
        const svgFile = plugin.app.vault.getAbstractFileByPath(FILE_PATH);
        check("svg file exists in vault", svgFile instanceof TFile, FILE_PATH);

        if (svgFile instanceof TFile) {
            let fModal: SvgEditorModal | null = null;
            try {
                fModal = await plugin.editSvgFile(svgFile);
                await sleep(150);
                const kids = fModal.core.contentChildren();
                check("svg file loads into editor", kids.length === 1 && kids[0].tagName === "circle", kids.map((k) => k.tagName).join(","));
                fModal.setMode("code");
                fModal.codeArea.value = fModal.codeArea.value.replace(
                    "</svg>",
                    '  <rect x="2" y="2" width="10" height="10" fill="#0000ff"/>\n</svg>'
                );
                await fModal.save();
                fModal = null;
                await sleep(100);
                const fileAfter = await plugin.app.vault.adapter.read(FILE_PATH);
                check(
                    "svg file save writes back to the file",
                    fileAfter.includes("<rect") && fileAfter.includes("<circle"),
                    fileAfter.split("\n")[0] ?? ""
                );
            } finally {
                fModal?.close();
            }

            // Rendered ![[file.svg]] embeds get an edit button that survives
            // Obsidian re-rendering the embed's content.
            const host4 = hiddenHost();
            const comp4 = new Component();
            comp4.load();
            try {
                await MarkdownRenderer.render(plugin.app, `![[${FILE_PATH}]]`, host4, TARGET_PATH, comp4);
                await sleep(150);
                const embedEl = host4.querySelector(".internal-embed");
                check(
                    "svg embed gets edit button",
                    !!embedEl?.querySelector(".svge-edit-btn"),
                    embedEl ? embedEl.className : "no .internal-embed rendered"
                );
                if (embedEl) {
                    embedEl.querySelector(".svge-edit-btn")?.remove();
                    await sleep(80);
                    check(
                        "embed edit button survives content replacement",
                        !!embedEl.querySelector(".svge-edit-btn"),
                        ""
                    );
                }
            } finally {
                comp4.unload();
                host4.remove();
            }
        }

        // ---- 17. Inline block ⇄ embedded file conversion ----
        const CONVERT_PATH = "SVGE-SelfTest-Convert.md";
        const blockSource =
            '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">\n  <circle cx="20" cy="20" r="15" stroke="#aa0000" fill="none"/>\n</svg>';
        const convertBody = `# Convert test\n\n\`\`\`svg\n${blockSource}\n\`\`\`\n`;
        const existingConvert = plugin.app.vault.getAbstractFileByPath(CONVERT_PATH);
        if (existingConvert instanceof TFile) {
            await plugin.app.vault.modify(existingConvert, convertBody);
        } else {
            await plugin.app.vault.create(CONVERT_PATH, convertBody);
        }

        // Block → embedded file (lines 2..6 are the fence block).
        const attachment = await plugin.convertBlockToEmbed(CONVERT_PATH, 2, 6, blockSource);
        const noteAfterOut = await plugin.app.vault.adapter.read(CONVERT_PATH);
        check(
            "block converts to embedded .svg file",
            !!attachment && noteAfterOut.includes("![[") && !noteAfterOut.includes("```svg"),
            attachment ? attachment.path : "no file created"
        );
        if (attachment) {
            const attContent = await plugin.app.vault.adapter.read(attachment.path);
            check("extracted file holds the block source", attContent.trim() === blockSource.trim(), attContent.split("\n")[0] ?? "");

            // Embedded file → inline block (give the metadata cache a beat to
            // index the just-created attachment).
            await sleep(150);
            const back = await plugin.convertEmbedToBlock(attachment.name, CONVERT_PATH);
            const noteAfterIn = await plugin.app.vault.adapter.read(CONVERT_PATH);
            check(
                "embed converts back to inline block",
                back && noteAfterIn.includes("```svg") && noteAfterIn.includes("<circle") && !noteAfterIn.includes("![["),
                noteAfterIn.split("\n")[2] ?? ""
            );
            check(
                "converted-back note keeps the .svg file",
                !!plugin.app.vault.getAbstractFileByPath(attachment.path),
                attachment.path
            );
            // Keep the vault tidy across repeated runs.
            await plugin.app.fileManager.trashFile(attachment);
        }

        // Convert buttons appear on rendered blocks and embeds.
        const host5 = hiddenHost();
        const comp5 = new Component();
        comp5.load();
        try {
            await MarkdownRenderer.render(
                plugin.app,
                `\`\`\`svg\n${blockSource}\n\`\`\`\n\n![[${FILE_PATH}]]\n`,
                host5,
                CONVERT_PATH,
                comp5
            );
            await sleep(150);
            check(
                "convert button on rendered block",
                !!host5.querySelector(".svge-block .svge-convert-btn"),
                ""
            );
            check(
                "convert button on rendered embed",
                !!host5.querySelector(".internal-embed .svge-convert-btn"),
                ""
            );
        } finally {
            comp5.unload();
            host5.remove();
        }

        // ---- 18. Live-preview-style embeds (no post-processor) get decorated ----
        // The document observer must pick up any .internal-embed that appears,
        // and replace stale buttons left by an earlier plugin instance.
        const lpHost = hiddenHost();
        try {
            const lpEmbed = lpHost.createEl("div", {
                cls: "internal-embed",
                attr: { src: FILE_PATH },
            });
            const staleBtn = lpEmbed.createEl("button", { cls: "svge-edit-btn" });
            await sleep(120);
            check(
                "observer decorates live-preview embeds",
                !!lpEmbed.querySelector(":scope > .svge-convert-btn") &&
                    !!lpEmbed.querySelector(":scope > .svge-edit-btn:not(.svge-convert-btn)"),
                lpEmbed.className
            );
            check("stale buttons from old plugin instance replaced", !staleBtn.isConnected, "");
        } finally {
            lpHost.remove();
        }
    } catch (e) {
        check("self-test crashed", false, e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e));
    } finally {
        modal?.close();
    }

    const passed = results.filter((r) => r.pass).length;
    const lines = [
        "# SVG Editor self-test report",
        "",
        `**${passed}/${results.length} checks passed** — ${passed === results.length ? "PASS" : "FAIL"}`,
        "",
        "| # | Check | Result | Detail |",
        "|---|-------|--------|--------|",
        ...results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.pass ? "✅ pass" : "❌ FAIL"} | ${r.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`),
        "",
    ];
    const report = lines.join("\n");
    const vault = plugin.app.vault;
    if (vault.getAbstractFileByPath(REPORT_PATH)) {
        await vault.adapter.write(REPORT_PATH, report);
    } else {
        await vault.create(REPORT_PATH, report);
    }
    new Notice(`SVG Editor self-test: ${passed}/${results.length} passed`);
}
