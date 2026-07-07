/**
 * SVG Editor plugin entry point.
 *
 * Renders ```svg code blocks inline and lets you edit them in a visual
 * editor (with a raw-code mode) that writes changes back into the note.
 */

import {
    Editor,
    MarkdownPostProcessorContext,
    Notice,
    Plugin,
    TFile,
    setIcon,
} from "obsidian";
import { parseSvgSource } from "./editor";
import { SvgEditorModal } from "./modal";
import { runSelfTest } from "./selftest";

export default class SvgEditorPlugin extends Plugin {
    async onload(): Promise<void> {
        this.registerMarkdownCodeBlockProcessor("svg", (source, el, ctx) =>
            this.renderSvgBlock(source, el, ctx)
        );

        this.addCommand({
            id: "insert-svg-drawing",
            name: "Insert new SVG drawing",
            editorCallback: (editor) => {
                new SvgEditorModal(this.app, "", (newSource) => {
                    const cur = editor.getCursor();
                    const prefix = cur.ch === 0 ? "" : "\n";
                    editor.replaceRange(`${prefix}\`\`\`svg\n${newSource}\n\`\`\`\n`, cur);
                }).open();
            },
        });

        this.addCommand({
            id: "edit-svg-at-cursor",
            name: "Edit SVG block at cursor",
            editorCallback: (editor) => this.editBlockAtCursor(editor),
        });

        this.addCommand({
            id: "self-test",
            name: "Run self-test (writes a report note)",
            callback: () => void runSelfTest(this),
        });

        this.addCommand({
            id: "toggle-mobile-emulation",
            name: "Toggle mobile emulation (dev — reloads the app)",
            checkCallback: (checking) => {
                const anyApp = this.app as unknown as { emulateMobile?: (on: boolean) => void };
                if (typeof anyApp.emulateMobile !== "function") return false;
                if (!checking) anyApp.emulateMobile(!document.body.classList.contains("is-mobile"));
                return true;
            },
        });
    }

    // ------------------------------------------------------------------
    // Reading / live-preview rendering of ```svg blocks
    // ------------------------------------------------------------------

    private renderSvgBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
        el.addClass("svge-block");
        if (source.trim()) {
            try {
                const svg = parseSvgSource(source);
                el.appendChild(document.importNode(svg, true));
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                el.createDiv({ cls: "svge-block-error", text: `Invalid SVG: ${msg}` });
            }
        } else {
            el.createDiv({ cls: "svge-block-empty", text: "Empty SVG — click to draw" });
        }

        const openEditor = () => {
            const info = ctx.getSectionInfo(el);
            if (!info) {
                new Notice("SVG Editor: cannot locate this block in the note (try editing in source mode).");
                return;
            }
            new SvgEditorModal(this.app, source, async (newSource) => {
                const ok = await this.replaceBlockInFile(
                    ctx.sourcePath,
                    info.lineStart,
                    info.lineEnd,
                    source,
                    newSource
                );
                if (!ok) new Notice("SVG Editor: could not write changes back — the note changed under us.");
            }).open();
        };

        const btn = el.createEl("button", {
            cls: "svge-edit-btn",
            attr: { "aria-label": "Edit SVG" },
        });
        setIcon(btn, "pencil");
        btn.addEventListener("click", openEditor);
        el.addEventListener("dblclick", openEditor);
    }

    /**
     * Replace the body of the ```svg block spanning [lineStart, lineEnd]
     * (fence lines inclusive). Falls back to searching for a unique block
     * whose body matches oldSource if the recorded lines have drifted.
     */
    async replaceBlockInFile(
        path: string,
        lineStart: number,
        lineEnd: number,
        oldSource: string,
        newSource: string
    ): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return false;

        let ok = false;
        await this.app.vault.process(file, (data) => {
            const lines = data.split("\n");
            const openFenceRe = /^\s*(`{3,}|~{3,})\s*svg\s*$/i;

            const matchesAt = (s: number, e: number): boolean =>
                s >= 0 &&
                e < lines.length &&
                e > s &&
                openFenceRe.test(lines[s]) &&
                lines.slice(s + 1, e).join("\n").trim() === oldSource.trim();

            let s = lineStart;
            let e = lineEnd;
            if (!matchesAt(s, e)) {
                const candidates: [number, number][] = [];
                for (let i = 0; i < lines.length; i++) {
                    const m = lines[i].match(openFenceRe);
                    if (!m) continue;
                    const fenceChar = m[1][0];
                    const fenceLen = m[1].length;
                    for (let j = i + 1; j < lines.length; j++) {
                        const t = lines[j].trim();
                        if (t.length >= fenceLen && [...t].every((c) => c === fenceChar)) {
                            if (matchesAt(i, j)) candidates.push([i, j]);
                            break;
                        }
                    }
                }
                if (candidates.length !== 1) return data;
                [s, e] = candidates[0];
            }

            ok = true;
            return [...lines.slice(0, s + 1), ...newSource.split("\n"), ...lines.slice(e)].join("\n");
        });
        return ok;
    }

    // ------------------------------------------------------------------
    // Source-mode editing
    // ------------------------------------------------------------------

    private editBlockAtCursor(editor: Editor): void {
        const cur = editor.getCursor().line;
        const openFenceRe = /^\s*(`{3,}|~{3,})\s*svg\s*$/i;

        let open = -1;
        let fenceChar = "";
        let fenceLen = 0;
        for (let i = cur; i >= 0; i--) {
            const m = editor.getLine(i).match(openFenceRe);
            if (m) {
                open = i;
                fenceChar = m[1][0];
                fenceLen = m[1].length;
                break;
            }
        }
        if (open === -1) {
            new Notice("SVG Editor: cursor is not inside a ```svg code block.");
            return;
        }

        let close = -1;
        for (let j = open + 1; j < editor.lineCount(); j++) {
            const t = editor.getLine(j).trim();
            if (t.length >= fenceLen && [...t].every((c) => c === fenceChar)) {
                close = j;
                break;
            }
        }
        if (close === -1 || cur > close) {
            new Notice("SVG Editor: cursor is not inside a ```svg code block.");
            return;
        }

        const source = editor
            .getRange({ line: open + 1, ch: 0 }, { line: close, ch: 0 })
            .replace(/\n$/, "");
        new SvgEditorModal(this.app, source, (newSource) => {
            editor.replaceRange(`${newSource}\n`, { line: open + 1, ch: 0 }, { line: close, ch: 0 });
        }).open();
    }
}
