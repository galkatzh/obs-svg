/**
 * SvgEditorModal — the editing dialog.
 *
 * Wraps SvgEditorCore with UI chrome: mode tabs (Visual / Code), tool
 * buttons, style controls, undo/redo, canvas size and Save/Cancel.
 */

import { App, Modal, Notice, Platform, setIcon } from "obsidian";
import { emptySvgSource, SvgEditorCore, Tool } from "./editor";

const TOOLS: { tool: Tool; icon: string; label: string; key: string }[] = [
    { tool: "select", icon: "mouse-pointer", label: "Select & move", key: "v" },
    { tool: "line", icon: "minus", label: "Line", key: "l" },
    { tool: "circle", icon: "circle", label: "Circle", key: "c" },
    { tool: "rect", icon: "square", label: "Rectangle", key: "r" },
    { tool: "scribble", icon: "pencil", label: "Scribble (freehand)", key: "p" },
    { tool: "delete", icon: "eraser", label: "Delete shape", key: "x" },
];

export class SvgEditorModal extends Modal {
    core!: SvgEditorCore;
    mode: "visual" | "code" = "visual";

    private visualEl!: HTMLElement;
    private codeEl!: HTMLElement;
    codeArea!: HTMLTextAreaElement;
    private codeErrorEl!: HTMLElement;
    private tabButtons: Record<string, HTMLElement> = {};
    private toolButtons: Partial<Record<Tool, HTMLElement>> = {};
    private statusEl!: HTMLElement;
    private undoBtn!: HTMLButtonElement;
    private redoBtn!: HTMLButtonElement;
    private widthInput!: HTMLInputElement;
    private heightInput!: HTMLInputElement;
    private strokeInput!: HTMLInputElement;
    private strokeWidthInput!: HTMLInputElement;
    private strokeWidthValue!: HTMLElement;
    private fillInput!: HTMLInputElement;
    private fillTransparentInput!: HTMLInputElement;
    private opacityInput!: HTMLInputElement;
    private opacityValue!: HTMLElement;
    private selectionNoteEl!: HTMLElement;
    private deleteSelBtn!: HTMLButtonElement;

    /** Compact layout: phones/tablets, or a narrow desktop window. */
    private compactQuery = window.matchMedia("(max-width: 640px)");
    private updateCompact = (): void => {
        this.modalEl.toggleClass(
            "svge-compact",
            Platform.isMobile || document.body.classList.contains("is-mobile") || this.compactQuery.matches
        );
    };

    constructor(
        app: App,
        private initialSource: string,
        private onSaveCb: (source: string) => void | Promise<void>
    ) {
        super(app);
    }

    onOpen(): void {
        this.modalEl.addClass("svge-modal");
        this.updateCompact();
        this.compactQuery.addEventListener("change", this.updateCompact);
        const { contentEl } = this;
        contentEl.addClass("svge-content");

        // ----- Header: title, mode tabs, spacer, canvas size, actions -----
        const header = contentEl.createDiv({ cls: "svge-header" });
        header.createDiv({ cls: "svge-title", text: "SVG Editor" });

        const tabs = header.createDiv({ cls: "svge-tabs" });
        for (const m of ["visual", "code"] as const) {
            const btn = tabs.createEl("button", {
                cls: "svge-tab",
                text: m === "visual" ? "Visual" : "Code",
            });
            btn.addEventListener("click", () => this.setMode(m));
            this.tabButtons[m] = btn;
        }

        header.createDiv({ cls: "svge-spacer" });

        const sizeWrap = header.createDiv({ cls: "svge-size", attr: { "aria-label": "Canvas size" } });
        this.widthInput = sizeWrap.createEl("input", {
            type: "number",
            attr: { min: "10", max: "10000", placeholder: "W" },
        });
        sizeWrap.createSpan({ text: "×" });
        this.heightInput = sizeWrap.createEl("input", {
            type: "number",
            attr: { min: "10", max: "10000", placeholder: "H" },
        });
        const applySize = () => {
            const w = parseFloat(this.widthInput.value);
            const h = parseFloat(this.heightInput.value);
            if (w > 0 && h > 0) this.core.setCanvasSize(w, h);
        };
        this.widthInput.addEventListener("change", applySize);
        this.heightInput.addEventListener("change", applySize);

        const actions = header.createDiv({ cls: "svge-actions" });
        const cancelBtn = actions.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener("click", () => this.close());
        const saveBtn = actions.createEl("button", { cls: "mod-cta", text: "Save" });
        saveBtn.addEventListener("click", () => void this.save());

        // ----- Body -----
        const body = contentEl.createDiv({ cls: "svge-body" });

        // Visual mode: toolbar | canvas, props bar underneath.
        this.visualEl = body.createDiv({ cls: "svge-visual" });
        const main = this.visualEl.createDiv({ cls: "svge-main" });

        const toolbar = main.createDiv({ cls: "svge-toolbar" });
        for (const t of TOOLS) {
            const btn = toolbar.createEl("button", {
                cls: "svge-tool",
                attr: { "aria-label": `${t.label} (${t.key.toUpperCase()})`, "data-tool": t.tool },
            });
            setIcon(btn, t.icon);
            btn.addEventListener("click", () => this.setTool(t.tool));
            this.toolButtons[t.tool] = btn;
        }

        const canvasWrap = main.createDiv({ cls: "svge-canvas-wrap" });

        const props = this.visualEl.createDiv({ cls: "svge-props" });
        this.selectionNoteEl = props.createDiv({ cls: "svge-selection-note" });

        const strokeGroup = props.createDiv({ cls: "svge-prop-group", attr: { "aria-label": "Stroke" } });
        strokeGroup.createSpan({ cls: "svge-prop-label", text: "Stroke" });
        this.strokeInput = strokeGroup.createEl("input", { type: "color" });
        this.strokeInput.value = "#000000";
        this.strokeInput.addEventListener("input", () =>
            this.core.setStyle({ stroke: this.strokeInput.value })
        );
        this.strokeWidthInput = strokeGroup.createEl("input", {
            type: "range",
            attr: { min: "1", max: "50", step: "1" },
        });
        this.strokeWidthInput.value = "2";
        this.strokeWidthValue = strokeGroup.createSpan({ cls: "svge-prop-value", text: "2" });
        this.strokeWidthInput.addEventListener("input", () => {
            this.strokeWidthValue.setText(this.strokeWidthInput.value);
            this.core.setStyle({ strokeWidth: parseFloat(this.strokeWidthInput.value) });
        });

        const fillGroup = props.createDiv({ cls: "svge-prop-group", attr: { "aria-label": "Fill" } });
        fillGroup.createSpan({ cls: "svge-prop-label", text: "Fill" });
        this.fillInput = fillGroup.createEl("input", { type: "color" });
        this.fillInput.value = "#ffffff";
        this.fillInput.addEventListener("input", () => {
            this.fillTransparentInput.checked = false;
            this.core.setStyle({ fill: this.fillInput.value, fillTransparent: false });
        });
        const transparentLabel = fillGroup.createEl("label", { cls: "svge-checkbox" });
        this.fillTransparentInput = transparentLabel.createEl("input", { type: "checkbox" });
        this.fillTransparentInput.checked = true;
        transparentLabel.createSpan({ text: "none" });
        this.fillTransparentInput.addEventListener("change", () =>
            this.core.setStyle({ fillTransparent: this.fillTransparentInput.checked })
        );

        const opacityGroup = props.createDiv({ cls: "svge-prop-group", attr: { "aria-label": "Opacity" } });
        opacityGroup.createSpan({ cls: "svge-prop-label", text: "Opacity" });
        this.opacityInput = opacityGroup.createEl("input", {
            type: "range",
            attr: { min: "0", max: "100", step: "1" },
        });
        this.opacityInput.value = "100";
        this.opacityValue = opacityGroup.createSpan({ cls: "svge-prop-value", text: "100" });
        this.opacityInput.addEventListener("input", () => {
            this.opacityValue.setText(this.opacityInput.value);
            this.core.setStyle({ opacity: parseFloat(this.opacityInput.value) / 100 });
        });

        const histGroup = props.createDiv({ cls: "svge-prop-group svge-hist" });
        this.deleteSelBtn = histGroup.createEl("button", { attr: { "aria-label": "Delete selection (Del)" } });
        setIcon(this.deleteSelBtn, "delete");
        this.deleteSelBtn.disabled = true;
        this.deleteSelBtn.addEventListener("click", () => this.core.deleteSelection());
        this.undoBtn = histGroup.createEl("button", { attr: { "aria-label": "Undo (Ctrl+Z)" } });
        setIcon(this.undoBtn, "undo-2");
        this.undoBtn.addEventListener("click", () => this.core.undo());
        this.redoBtn = histGroup.createEl("button", { attr: { "aria-label": "Redo (Ctrl+Shift+Z)" } });
        setIcon(this.redoBtn, "redo-2");
        this.redoBtn.addEventListener("click", () => this.core.redo());
        const clearBtn = histGroup.createEl("button", { attr: { "aria-label": "Clear canvas" } });
        setIcon(clearBtn, "trash-2");
        clearBtn.addEventListener("click", () => this.core.clearAll());

        // Code mode: plain source editing.
        this.codeEl = body.createDiv({ cls: "svge-code" });
        this.codeArea = this.codeEl.createEl("textarea", {
            cls: "svge-code-area",
            attr: { spellcheck: "false", placeholder: "<svg …>" },
        });
        this.codeErrorEl = this.codeEl.createDiv({ cls: "svge-code-error" });

        this.statusEl = contentEl.createDiv({ cls: "svge-status", text: "Ready" });

        // ----- Core wiring -----
        this.core = new SvgEditorCore(canvasWrap);
        this.core.onStatus = (msg) => this.statusEl.setText(msg);
        this.core.onHistoryChange = (canUndo, canRedo) => {
            this.undoBtn.disabled = !canUndo;
            this.redoBtn.disabled = !canRedo;
        };
        this.core.onSizeChange = (w, h) => {
            this.widthInput.value = String(w);
            this.heightInput.value = String(h);
        };
        this.core.onSelectionChange = (sel) => this.reflectSelection(sel);

        try {
            this.core.load(this.initialSource.trim() ? this.initialSource : emptySvgSource());
            this.setMode("visual");
        } catch (e) {
            // Unparseable source: fall back to code mode so nothing is lost.
            this.core.load(emptySvgSource());
            this.setMode("code");
            this.codeArea.value = this.initialSource;
            this.showCodeError(e instanceof Error ? e.message : String(e));
        }
        this.setTool("select");

        this.scope.register(["Mod"], "z", (evt) => {
            if (this.mode !== "visual") return true;
            evt.preventDefault();
            this.core.undo();
            return false;
        });
        this.scope.register(["Mod", "Shift"], "z", (evt) => {
            if (this.mode !== "visual") return true;
            evt.preventDefault();
            this.core.redo();
            return false;
        });
        this.scope.register(["Mod"], "y", (evt) => {
            if (this.mode !== "visual") return true;
            evt.preventDefault();
            this.core.redo();
            return false;
        });
        this.scope.register(["Mod"], "a", () => {
            if (this.mode !== "visual") return true;
            this.core.selectAll();
            return false;
        });
        this.scope.register(["Mod"], "Enter", () => {
            void this.save();
            return false;
        });

        this.modalEl.addEventListener("keydown", (evt) => this.handleKeydown(evt));
    }

    private handleKeydown(evt: KeyboardEvent): void {
        if (this.mode !== "visual") return;
        const target = evt.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
            return;
        }
        if (evt.key === "Delete" || evt.key === "Backspace") {
            this.core.deleteSelection();
            evt.preventDefault();
            return;
        }
        if (evt.metaKey || evt.ctrlKey || evt.altKey) return;
        const tool = TOOLS.find((t) => t.key === evt.key.toLowerCase());
        if (tool) {
            this.setTool(tool.tool);
            evt.preventDefault();
        }
    }

    setTool(tool: Tool): void {
        this.core.setTool(tool);
        for (const [name, btn] of Object.entries(this.toolButtons)) {
            btn.toggleClass("is-active", name === tool);
        }
    }

    /** Reflect the current selection into the style controls. */
    private reflectSelection(sel: SVGGraphicsElement[]): void {
        this.deleteSelBtn.disabled = sel.length === 0;
        if (sel.length === 0) {
            this.selectionNoteEl.setText("");
            return;
        }
        this.selectionNoteEl.setText(
            sel.length === 1 ? "1 shape — edits apply to it" : `${sel.length} shapes — edits apply to all`
        );
        if (sel.length !== 1) return;
        const s = this.core.readShapeStyle(sel[0]);
        if (s.stroke) this.strokeInput.value = s.stroke;
        if (s.strokeWidth !== undefined) {
            this.strokeWidthInput.value = String(s.strokeWidth);
            this.strokeWidthValue.setText(String(s.strokeWidth));
        }
        if (s.fillTransparent !== undefined) this.fillTransparentInput.checked = s.fillTransparent;
        if (s.fill) this.fillInput.value = s.fill;
        const opacity = s.opacity ?? 1;
        this.opacityInput.value = String(Math.round(opacity * 100));
        this.opacityValue.setText(String(Math.round(opacity * 100)));
    }

    setMode(mode: "visual" | "code"): boolean {
        if (mode === "code" && this.mode !== "code") {
            this.codeArea.value = this.core.serialize(true);
        }
        if (mode === "visual" && this.mode === "code") {
            if (!this.applyCode()) return false;
        }
        this.mode = mode;
        this.visualEl.style.display = mode === "visual" ? "" : "none";
        this.codeEl.style.display = mode === "code" ? "" : "none";
        this.tabButtons["visual"].toggleClass("is-active", mode === "visual");
        this.tabButtons["code"].toggleClass("is-active", mode === "code");
        this.statusEl.setText(mode === "code" ? "Editing SVG source" : "Ready");
        if (mode === "code") this.codeArea.focus();
        return true;
    }

    /** Parse the code pane back into the canvas. Returns false on parse errors. */
    applyCode(): boolean {
        try {
            this.core.loadFromCode(this.codeArea.value);
            this.showCodeError(null);
            return true;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.showCodeError(msg);
            new Notice(`SVG Editor: ${msg}`);
            return false;
        }
    }

    private showCodeError(msg: string | null): void {
        this.codeErrorEl.setText(msg ?? "");
        this.codeErrorEl.toggleClass("is-visible", !!msg);
    }

    async save(): Promise<void> {
        if (this.mode === "code" && !this.applyCode()) return;
        const source = this.core.serialize(true);
        try {
            await this.onSaveCb(source);
        } finally {
            this.close();
        }
    }

    onClose(): void {
        this.compactQuery.removeEventListener("change", this.updateCompact);
        this.core?.destroy();
        this.contentEl.empty();
    }
}
