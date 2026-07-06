/**
 * End-to-end self-test, runnable from the command palette (or the obsidian
 * CLI) inside a live vault. Opens the real editor modal, drives it with
 * synthetic pointer events, exercises code mode, block write-back and the
 * markdown renderer, then writes a PASS/FAIL report note.
 */

import { Component, MarkdownRenderer, Notice } from "obsidian";
import type SvgEditorPlugin from "./main";
import { SvgEditorModal } from "./modal";

interface Result {
    name: string;
    pass: boolean;
    detail: string;
}

const REPORT_PATH = "SVGE-SelfTest-Report.md";
const TARGET_PATH = "SVGE-SelfTest-Target.md";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
        const host = document.body.createDiv();
        host.style.position = "fixed";
        host.style.left = "-9999px";
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
        const host2 = document.body.createDiv();
        host2.style.position = "fixed";
        host2.style.left = "-9999px";
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
