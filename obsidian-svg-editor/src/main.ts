/**
 * SVG Editor plugin entry point.
 *
 * Renders ```svg code blocks inline and lets you edit them in a visual
 * editor (with a raw-code mode) that writes changes back into the note.
 */

import {
    Editor,
    MarkdownPostProcessorContext,
    MarkdownRenderChild,
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

        // Embedded .svg files (![[drawing.svg]]): edit button on rendered embeds.
        this.registerMarkdownPostProcessor((el, ctx) => {
            for (const embed of Array.from(el.querySelectorAll<HTMLElement>(".internal-embed"))) {
                const src = embed.getAttribute("src");
                if (!src || !isSvgLink(src)) continue;
                ctx.addChild(new SvgEmbedDecorator(this, embed, src, ctx.sourcePath));
            }
        });

        // Live preview renders embeds outside the post-processor pipeline:
        // double-click an embedded svg image to edit it, in any mode.
        this.registerDomEvent(document, "dblclick", (evt) => {
            const embed = (evt.target as HTMLElement | null)?.closest?.(".internal-embed");
            if (!(embed instanceof HTMLElement)) return;
            const src = embed.getAttribute("src");
            if (!src || !isSvgLink(src)) return;
            evt.preventDefault();
            void this.editSvgFileBySrc(src, this.app.workspace.getActiveFile()?.path ?? "");
        });

        // File explorer and link context menus.
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (file instanceof TFile && file.extension.toLowerCase() === "svg") {
                    menu.addItem((item) =>
                        item
                            .setTitle("Edit in SVG Editor")
                            .setIcon("pencil")
                            .onClick(() => void this.editSvgFile(file))
                    );
                }
            })
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
    // Embedded .svg file editing
    // ------------------------------------------------------------------

    /** Resolve an embed/link target like "drawing.svg#hash" and open it. */
    async editSvgFileBySrc(src: string, sourcePath: string): Promise<SvgEditorModal | null> {
        const linkpath = src.split("#")[0].trim();
        const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
        if (!file) {
            new Notice(`SVG Editor: cannot resolve "${linkpath}".`);
            return null;
        }
        return this.editSvgFile(file);
    }

    /** Open the editor on a vault .svg file; Save writes the file back. */
    async editSvgFile(file: TFile): Promise<SvgEditorModal> {
        const source = await this.app.vault.read(file);
        const modal = new SvgEditorModal(this.app, source, async (newSource) => {
            await this.app.vault.process(file, () => newSource);
            this.refreshEmbedsOf(file);
        });
        modal.open();
        return modal;
    }

    /** Re-point every rendered <img> of this file at its new content. */
    private refreshEmbedsOf(file: TFile): void {
        const fresh = this.app.vault.getResourcePath(file);
        const base = fresh.split("?")[0];
        for (const img of Array.from(document.querySelectorAll<HTMLImageElement>("img"))) {
            if (img.src.split("?")[0] === base) img.src = fresh;
        }
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

function isSvgLink(src: string): boolean {
    return /\.svg$/i.test(src.split("#")[0].trim());
}

/**
 * Keeps an edit button on a rendered ![[file.svg]] embed. Obsidian replaces
 * the embed's children when the image loads, so the button is re-added
 * whenever the embed's content changes.
 */
class SvgEmbedDecorator extends MarkdownRenderChild {
    private observer: MutationObserver | null = null;

    constructor(
        private plugin: SvgEditorPlugin,
        containerEl: HTMLElement,
        private src: string,
        private sourcePath: string
    ) {
        super(containerEl);
    }

    onload(): void {
        this.decorate();
        this.observer = new MutationObserver(() => this.decorate());
        this.observer.observe(this.containerEl, { childList: true });
    }

    onunload(): void {
        this.observer?.disconnect();
        this.observer = null;
    }

    private decorate(): void {
        const el = this.containerEl;
        if (el.querySelector(":scope > .svge-edit-btn")) return;
        el.addClass("svge-file-embed");
        const btn = el.createEl("button", {
            cls: "svge-edit-btn",
            attr: { "aria-label": "Edit SVG file" },
        });
        setIcon(btn, "pencil");
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void this.plugin.editSvgFileBySrc(this.src, this.sourcePath);
        });
    }
}
