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

        // The rect has no fill, so a click in its interior lands on the canvas
        // background; with the shape selected that drag must move it, not
        // clear the selection and start a marquee.
        const tBefore = shape.getAttribute("transform") ?? "";
        const ir = shape.getBoundingClientRect();
        const ic = { x: ir.left + ir.width / 2, y: ir.top + ir.height / 2 };
        firePointer(svg, "pointerdown", ic.x, ic.y);
        firePointer(window, "pointermove", ic.x + 25, ic.y + 15);
        firePointer(window, "pointerup", ic.x + 25, ic.y + 15);
        check(
            "drag inside unfilled selected shape moves it",
            core.selection.length === 1 && (shape.getAttribute("transform") ?? "") !== tBefore,
            `selection=${core.selection.length}, transform=${shape.getAttribute("transform")}`
        );

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
                // Obsidian's mobile theme pads buttons horizontally; icon-only
                // tool buttons must stay padding-free or the icon collapses.
                const toolIcon = mEl.querySelector(".svge-tool svg")?.getBoundingClientRect();
                check(
                    "tool icons keep full size under themed button padding",
                    (toolIcon?.width ?? 0) >= 18,
                    `icon=${Math.round(toolIcon?.width ?? 0)}px`
                );

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

        // ---- 19. Zoom: mouse wheel, pinch, reset; view-only ----
        {
            let zModal: SvgEditorModal | null = null;
            try {
                zModal = new SvgEditorModal(plugin.app, "", () => {});
                zModal.open();
                await sleep(150);
                const zCore = zModal.core;
                const zSvg = zCore.svgEl;
                const zr = zSvg.getBoundingClientRect();
                const zcx = zr.left + zr.width / 2;
                const zcy = zr.top + zr.height / 2;

                // Wheel over the canvas zooms in around the cursor.
                zSvg.dispatchEvent(
                    new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -300, clientX: zcx, clientY: zcy })
                );
                const wheelZoom = zCore.getZoom();
                const zrAfter = zSvg.getBoundingClientRect();
                check(
                    "mouse wheel zooms the canvas in",
                    wheelZoom > 1 && zrAfter.width > zr.width * 1.1,
                    `zoom=${wheelZoom.toFixed(2)}, ${Math.round(zr.width)}px → ${Math.round(zrAfter.width)}px`
                );

                // Zoom is display-only: nothing about it may reach the saved source.
                const zSrc = zCore.serialize(true);
                check(
                    "zoom stays out of the saved source",
                    !zSrc.includes("style=") && !zSrc.includes("svge") && zSrc.includes('width="480"'),
                    zSrc.split("\n")[0] ?? ""
                );

                // The % button resets to fit.
                const resetBtn = zModal.modalEl.querySelector<HTMLButtonElement>(".svge-zoom-value");
                resetBtn?.click();
                check(
                    "zoom reset button returns to 100%",
                    zCore.getZoom() === 1 && resetBtn?.textContent === "100%",
                    `zoom=${zCore.getZoom()}, label=${resetBtn?.textContent}`
                );

                // Pinch: a second finger cancels the in-progress draw and zooms.
                const preCount = zCore.contentChildren().length;
                zModal.setTool("rect");
                const t1: PointerEventInit = { pointerId: 21, pointerType: "touch", isPrimary: true };
                const t2: PointerEventInit = { pointerId: 22, pointerType: "touch", isPrimary: false };
                firePointer(zSvg, "pointerdown", zcx - 20, zcy, t1);
                firePointer(zSvg, "pointerdown", zcx + 20, zcy, t2);
                firePointer(window, "pointermove", zcx + 60, zcy, t2); // spread: 40px → 80px
                const pinchZoom = zCore.getZoom();
                check("pinch gesture zooms in", pinchZoom > 1.5, `zoom=${pinchZoom.toFixed(2)}`);
                firePointer(window, "pointerup", zcx + 60, zcy, t2);
                firePointer(window, "pointerup", zcx - 20, zcy, t1);
                check(
                    "second finger cancels the in-progress draw",
                    zCore.contentChildren().length === preCount,
                    `count=${zCore.contentChildren().length}`
                );

                // Drawing while zoomed still lands at the right SVG coordinates.
                zCore.setZoom(2);
                const zr2 = zSvg.getBoundingClientRect();
                const { w: docW } = zCore.getCanvasSize();
                firePointer(zSvg, "pointerdown", zr2.left + zr2.width * 0.25, zr2.top + zr2.height * 0.25);
                firePointer(window, "pointermove", zr2.left + zr2.width * 0.5, zr2.top + zr2.height * 0.5);
                firePointer(window, "pointerup", zr2.left + zr2.width * 0.5, zr2.top + zr2.height * 0.5);
                const zRect = zCore.contentChildren().find((c) => c.tagName === "rect");
                const zRectW = parseFloat(zRect?.getAttribute("width") ?? "0");
                check(
                    "drawing while zoomed maps to correct SVG coords",
                    Math.abs(zRectW - docW * 0.25) < 1,
                    `width=${zRectW}, expected≈${docW * 0.25}`
                );
            } finally {
                zModal?.close();
            }
        }

        // ---- 20. Pan: middle-button drag and two-finger drag ----
        {
            let pModal: SvgEditorModal | null = null;
            try {
                pModal = new SvgEditorModal(plugin.app, "", () => {});
                pModal.open();
                await sleep(150);
                const pCore = pModal.core;
                const pSvg = pCore.svgEl;
                const wrap = pSvg.parentElement as HTMLElement;
                pCore.setZoom(3); // overflow the wrap so there is somewhere to pan
                const wr = wrap.getBoundingClientRect();
                const wcx = wr.left + wr.width / 2;
                const wcy = wr.top + wr.height / 2;

                // Middle-button drag pans and must not draw.
                pModal.setTool("rect");
                const preShapes = pCore.contentChildren().length;
                const sl0 = wrap.scrollLeft;
                const st0 = wrap.scrollTop;
                firePointer(pSvg, "pointerdown", wcx, wcy, { button: 1, buttons: 4 });
                firePointer(window, "pointermove", wcx - 40, wcy - 30, { buttons: 4 });
                firePointer(window, "pointerup", wcx - 40, wcy - 30, { button: 1, buttons: 0 });
                check(
                    "middle-drag pans the zoomed canvas",
                    Math.abs(wrap.scrollLeft - (sl0 + 40)) < 2 && Math.abs(wrap.scrollTop - (st0 + 30)) < 2,
                    `scroll (${sl0},${st0}) → (${wrap.scrollLeft},${wrap.scrollTop})`
                );
                check(
                    "middle-drag does not draw",
                    pCore.contentChildren().length === preShapes,
                    `count=${pCore.contentChildren().length}`
                );

                // Two fingers moving together (constant spread) pan without zooming.
                const zBefore = pCore.getZoom();
                const sl1 = wrap.scrollLeft;
                const st1 = wrap.scrollTop;
                const ta: PointerEventInit = { pointerId: 31, pointerType: "touch", isPrimary: true };
                const tb: PointerEventInit = { pointerId: 32, pointerType: "touch", isPrimary: false };
                firePointer(pSvg, "pointerdown", wcx - 25, wcy, ta);
                firePointer(pSvg, "pointerdown", wcx + 25, wcy, tb);
                firePointer(window, "pointermove", wcx - 75, wcy - 20, ta);
                firePointer(window, "pointermove", wcx - 25, wcy - 20, tb);
                firePointer(window, "pointerup", wcx - 75, wcy - 20, ta);
                firePointer(window, "pointerup", wcx - 25, wcy - 20, tb);
                check(
                    "two-finger drag pans without zooming",
                    pCore.getZoom() === zBefore && wrap.scrollLeft > sl1 + 25 && wrap.scrollTop > st1 + 2,
                    `zoom=${pCore.getZoom().toFixed(2)}, scroll (${sl1},${st1}) → (${wrap.scrollLeft},${wrap.scrollTop})`
                );

                // Mode classes drive the landscape overlay layout.
                check(
                    "visual-mode layout class set",
                    pModal.modalEl.classList.contains("svge-mode-visual"),
                    pModal.modalEl.className
                );
                pModal.setMode("code");
                check(
                    "code-mode layout class set",
                    pModal.modalEl.classList.contains("svge-mode-code") &&
                        !pModal.modalEl.classList.contains("svge-mode-visual"),
                    pModal.modalEl.className
                );
            } finally {
                pModal?.close();
            }
        }

        // ---- 21. Resize handles on the selection box ----
        {
            let rModal: SvgEditorModal | null = null;
            try {
                rModal = new SvgEditorModal(plugin.app, "", () => {});
                rModal.open();
                await sleep(150);
                const rCore = rModal.core;
                const rSvg = rCore.svgEl;
                const rr = rSvg.getBoundingClientRect();
                rModal.setTool("rect");
                firePointer(rSvg, "pointerdown", rr.left + rr.width * 0.2, rr.top + rr.height * 0.2);
                firePointer(window, "pointermove", rr.left + rr.width * 0.4, rr.top + rr.height * 0.4);
                firePointer(window, "pointerup", rr.left + rr.width * 0.4, rr.top + rr.height * 0.4);
                const target = rCore.contentChildren()[0];

                rModal.setTool("select");
                const tr = target.getBoundingClientRect();
                firePointer(target, "pointerdown", tr.left + 1, tr.top + tr.height / 2);
                firePointer(window, "pointerup", tr.left + 1, tr.top + tr.height / 2);
                check(
                    "selection shows 8 resize handles",
                    rSvg.querySelectorAll(".svge-rdot").length === 8 && rSvg.querySelectorAll(".svge-rhit").length === 8,
                    `dots=${rSvg.querySelectorAll(".svge-rdot").length}, hits=${rSvg.querySelectorAll(".svge-rhit").length}`
                );

                const seHit = rSvg.querySelector<SVGRectElement>('.svge-rhit[data-dir="se"]')!;
                const eHit = rSvg.querySelector<SVGRectElement>('.svge-rhit[data-dir="e"]')!;
                check(
                    "handles show directional resize cursors",
                    getComputedStyle(seHit).cursor === "nwse-resize" && getComputedStyle(eHit).cursor === "ew-resize",
                    `se=${getComputedStyle(seHit).cursor}, e=${getComputedStyle(eHit).cursor}`
                );

                // Drag the SE corner outward by the shape's own size → ~2× both axes.
                const before = target.getBoundingClientRect();
                const hr = seHit.getBoundingClientRect();
                const hx = hr.left + hr.width / 2;
                const hy = hr.top + hr.height / 2;
                firePointer(seHit, "pointerdown", hx, hy);
                firePointer(window, "pointermove", hx + before.width, hy + before.height);
                firePointer(window, "pointerup", hx + before.width, hy + before.height);
                const after = target.getBoundingClientRect();
                check(
                    "corner drag scales both axes",
                    Math.abs(after.width - before.width * 2) < 8 && Math.abs(after.height - before.height * 2) < 8,
                    `${Math.round(before.width)}×${Math.round(before.height)} → ${Math.round(after.width)}×${Math.round(after.height)}`
                );
                check(
                    "resize keeps selection and uses a scale transform",
                    rCore.selection.length === 1 && (target.getAttribute("transform") ?? "").includes("scale"),
                    target.getAttribute("transform") ?? "(none)"
                );

                // Drag the east edge strip (off-center along the edge) inward:
                // width shrinks, height must not change.
                const b2 = target.getBoundingClientRect();
                const er = rSvg.querySelector<SVGRectElement>('.svge-rhit[data-dir="e"]')!.getBoundingClientRect();
                const ex = er.left + er.width / 2;
                const ey = er.top + er.height * 0.25;
                firePointer(rSvg.querySelector('.svge-rhit[data-dir="e"]')!, "pointerdown", ex, ey);
                firePointer(window, "pointermove", ex - b2.width / 2, ey);
                firePointer(window, "pointerup", ex - b2.width / 2, ey);
                const b3 = target.getBoundingClientRect();
                check(
                    "edge drag scales one axis only",
                    Math.abs(b3.height - b2.height) < 2 && b3.width < b2.width * 0.7,
                    `w ${Math.round(b2.width)}→${Math.round(b3.width)}, h ${Math.round(b2.height)}→${Math.round(b3.height)}`
                );

                // Both resizes undo back to the drawn size.
                rCore.undo();
                rCore.undo();
                const b4 = rCore.contentChildren()[0]?.getBoundingClientRect();
                check(
                    "undo reverts resizes",
                    !!b4 && Math.abs(b4.width - before.width) < 2 && Math.abs(b4.height - before.height) < 2,
                    `${Math.round(b4?.width ?? 0)}×${Math.round(b4?.height ?? 0)} vs ${Math.round(before.width)}×${Math.round(before.height)}`
                );
            } finally {
                rModal?.close();
            }
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
