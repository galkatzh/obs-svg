/**
 * SvgEditorCore — framework-free visual SVG editing engine.
 *
 * Owns the <svg> editing surface: tools (select/line/circle/rect/scribble/
 * delete), selection + move, style application, undo/redo history and
 * (de)serialization. UI chrome (toolbars, inputs) lives in modal.ts and
 * drives this class through its public API.
 */

export const SVG_NS = "http://www.w3.org/2000/svg";

export const DEFAULT_WIDTH = 480;
export const DEFAULT_HEIGHT = 320;

export interface Point {
    x: number;
    y: number;
}

export type Tool = "select" | "line" | "circle" | "rect" | "scribble" | "delete";

export interface ShapeStyle {
    stroke: string;
    strokeWidth: number;
    fill: string;
    fillTransparent: boolean;
    opacity: number;
}

export function emptySvgSource(w = DEFAULT_WIDTH, h = DEFAULT_HEIGHT): string {
    return `<svg xmlns="${SVG_NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n</svg>`;
}

const FORBIDDEN_TAGS = new Set(["script", "foreignobject", "iframe", "embed", "object"]);

/** Strip scripts, event handlers and javascript: URLs from a parsed SVG tree. */
export function sanitizeSvgTree(root: Element): void {
    const doomed: Element[] = [];
    const walk = (el: Element) => {
        if (FORBIDDEN_TAGS.has(el.tagName.toLowerCase())) {
            doomed.push(el);
            return;
        }
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            if (name.startsWith("on")) {
                el.removeAttribute(attr.name);
            } else if (
                (name === "href" || name === "xlink:href") &&
                attr.value.trim().toLowerCase().startsWith("javascript:")
            ) {
                el.removeAttribute(attr.name);
            }
        }
        for (const child of Array.from(el.children)) walk(child);
    };
    walk(root);
    doomed.forEach((el) => el.remove());
}

/** Parse and sanitize SVG source. Throws with a readable message on bad input. */
export function parseSvgSource(source: string): SVGSVGElement {
    const doc = new DOMParser().parseFromString(source, "image/svg+xml");
    const err = doc.querySelector("parsererror");
    if (err) {
        const msg = (err.textContent ?? "Invalid SVG").split("\n").find((l) => l.includes("error")) ?? "Invalid SVG";
        throw new Error(msg.trim());
    }
    const root = doc.documentElement;
    if (root.tagName.toLowerCase() !== "svg") {
        throw new Error(`Root element is <${root.tagName}>, expected <svg>`);
    }
    sanitizeSvgTree(root);
    return root as unknown as SVGSVGElement;
}

/** Indent an XML string, one element per line. Whitespace-only text is collapsed. */
export function prettyPrintXml(xml: string): string {
    const withBreaks = xml.replace(/>\s*</g, ">\n<").trim();
    let indent = 0;
    const out: string[] = [];
    for (const line of withBreaks.split("\n")) {
        const isClosing = /^<\//.test(line);
        const isSelfContained =
            /\/>$/.test(line) || /^<[^>]+>[^<]*<\/[^>]+>$/.test(line) || /^<[?!]/.test(line);
        if (isClosing) indent = Math.max(0, indent - 1);
        out.push("  ".repeat(indent) + line);
        if (!isClosing && !isSelfContained && /^</.test(line)) indent++;
    }
    return out.join("\n");
}

interface DrawState {
    kind: Tool;
    el?: SVGGraphicsElement;
    start: Point;
    points?: Point[];
    moveTargets?: { el: SVGGraphicsElement; baseTransform: string | null }[];
    moved?: boolean;
    marqueeEl?: SVGRectElement;
    /** Shapes marked during a delete sweep, with their original opacity attribute. */
    deleteMarks?: Map<SVGGraphicsElement, string | null>;
}

// Sweep-to-delete: how much to fade a marked shape, and the floor so it stays visible.
const DELETE_FADE_FACTOR = 0.6;
const DELETE_MIN_OPACITY = 0.15;

// View zoom bounds (zoom is display-only and never touches the saved SVG).
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

interface PinchState {
    startDist: number;
    startZoom: number;
    lastCenter: Point;
}

export class SvgEditorCore {
    svgEl: SVGSVGElement;
    private overlayEl: SVGGElement;

    private vb = { x: 0, y: 0, w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT };
    /** Root <svg> attributes preserved verbatim from the loaded source. */
    private rootAttrs = new Map<string, string>();

    tool: Tool = "select";
    style: ShapeStyle = {
        stroke: "#000000",
        strokeWidth: 2,
        fill: "#ffffff",
        fillTransparent: true,
        opacity: 1,
    };

    selection: SVGGraphicsElement[] = [];

    private states: string[] = [];
    private stateIndex = -1;
    private draw: DrawState | null = null;

    onSelectionChange: (sel: SVGGraphicsElement[]) => void = () => {};
    onHistoryChange: (canUndo: boolean, canRedo: boolean) => void = () => {};
    onStatus: (msg: string) => void = () => {};
    onSizeChange: (w: number, h: number) => void = () => {};
    onZoomChange: (zoom: number) => void = () => {};

    private boundPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
    private boundPointerUp = (e: PointerEvent) => this.handlePointerUp(e);
    private boundWheel = (e: WheelEvent) => this.handleWheel(e);
    /** Pointer that started the current gesture; other touches are ignored. */
    private activePointerId = -1;
    private windowHooked = false;

    /** Display-only zoom factor; 1 = fit to container. */
    private zoom = 1;
    /** Live client positions of touch pointers on the canvas (pinch tracking). */
    private touches = new Map<number, Point>();
    private pinch: PinchState | null = null;
    /** Middle-button drag pan: the pointer driving it and its last position. */
    private pan: { pointerId: number; last: Point } | null = null;

    constructor(private containerEl: HTMLElement) {
        this.svgEl = containerEl.doc.createElementNS(SVG_NS, "svg");
        this.svgEl.classList.add("svge-canvas");
        this.overlayEl = containerEl.doc.createElementNS(SVG_NS, "g");
        this.overlayEl.setAttribute("data-svge-overlay", "");
        this.svgEl.appendChild(this.overlayEl);
        containerEl.appendChild(this.svgEl);

        this.svgEl.addEventListener("pointerdown", (e) => this.handlePointerDown(e));
        // On the wrap (not the svg) so panning works from the padding area too.
        containerEl.addEventListener("pointerdown", (e) => this.handlePanStart(e));
        containerEl.addEventListener("wheel", this.boundWheel, { passive: false });
        this.applyViewBox();
    }

    destroy(): void {
        this.containerEl.removeEventListener("wheel", this.boundWheel);
        this.windowHooked = false;
        this.svgEl.win.removeEventListener("pointermove", this.boundPointerMove);
        this.svgEl.win.removeEventListener("pointerup", this.boundPointerUp);
        this.svgEl.win.removeEventListener("pointercancel", this.boundPointerUp);
        this.svgEl.remove();
    }

    private hookWindow(): void {
        if (this.windowHooked) return;
        this.windowHooked = true;
        this.svgEl.win.addEventListener("pointermove", this.boundPointerMove);
        this.svgEl.win.addEventListener("pointerup", this.boundPointerUp);
        this.svgEl.win.addEventListener("pointercancel", this.boundPointerUp);
    }

    private unhookWindowIfIdle(): void {
        if (!this.windowHooked || this.draw || this.pinch || this.pan || this.touches.size > 0) return;
        this.windowHooked = false;
        this.svgEl.win.removeEventListener("pointermove", this.boundPointerMove);
        this.svgEl.win.removeEventListener("pointerup", this.boundPointerUp);
        this.svgEl.win.removeEventListener("pointercancel", this.boundPointerUp);
    }

    // ------------------------------------------------------------------
    // Loading / serialization
    // ------------------------------------------------------------------

    /** Load SVG source, replacing all content and resetting history. */
    load(source: string): void {
        this.restoreFromSource(source.trim() ? source : emptySvgSource());
        this.states = [this.serialize(false)];
        this.stateIndex = 0;
        this.notifyHistory();
    }

    /** Replace content from code-mode text; recorded as a single undoable step. */
    loadFromCode(source: string): void {
        this.restoreFromSource(source.trim() ? source : emptySvgSource());
        this.commit();
    }

    private restoreFromSource(source: string): void {
        const parsed = parseSvgSource(source);

        // Canvas geometry: prefer viewBox, fall back to width/height attrs.
        const vbAttr = parsed.getAttribute("viewBox");
        const wAttr = parseFloat(parsed.getAttribute("width") ?? "");
        const hAttr = parseFloat(parsed.getAttribute("height") ?? "");
        if (vbAttr) {
            const p = vbAttr.trim().split(/[\s,]+/).map(parseFloat);
            if (p.length === 4 && p.every((n) => isFinite(n))) {
                this.vb = { x: p[0], y: p[1], w: p[2], h: p[3] };
            }
        } else if (isFinite(wAttr) && isFinite(hAttr) && wAttr > 0 && hAttr > 0) {
            this.vb = { x: 0, y: 0, w: wAttr, h: hAttr };
        } else {
            this.vb = { x: 0, y: 0, w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT };
        }

        this.rootAttrs.clear();
        for (const attr of Array.from(parsed.attributes)) {
            const n = attr.name.toLowerCase();
            if (n === "xmlns" || n === "width" || n === "height" || n === "viewbox" || n.startsWith("xmlns:")) {
                continue;
            }
            this.rootAttrs.set(attr.name, attr.value);
        }

        // Swap in the parsed content, keeping the overlay group on top.
        this.contentChildren().forEach((el) => el.remove());
        for (const child of Array.from(parsed.childNodes)) {
            this.svgEl.insertBefore(this.svgEl.doc.importNode(child, true), this.overlayEl);
        }

        this.clearSelection();
        this.applyViewBox();
        this.onSizeChange(this.vb.w, this.vb.h);
    }

    /** Serialize current content (overlay excluded) back to SVG source. */
    serialize(pretty = true): string {
        const clone = this.svgEl.cloneNode(true) as SVGSVGElement;
        clone.querySelector("[data-svge-overlay]")?.remove();
        // Editor-internal presentation attributes must not leak into the note;
        // any user-authored root attributes are restored from rootAttrs below.
        clone.removeAttribute("class");
        clone.removeAttribute("style");
        clone.removeAttribute("data-tool");
        clone.setAttribute("xmlns", SVG_NS);
        clone.setAttribute("width", String(this.vb.w));
        clone.setAttribute("height", String(this.vb.h));
        clone.setAttribute("viewBox", `${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}`);
        for (const [k, v] of this.rootAttrs) clone.setAttribute(k, v);
        const raw = new XMLSerializer().serializeToString(clone);
        return pretty ? prettyPrintXml(raw) : raw;
    }

    /** Top-level editable elements (everything except the editor overlay). */
    contentChildren(): SVGGraphicsElement[] {
        return Array.from(this.svgEl.children).filter(
            (el) => el !== this.overlayEl
        ) as SVGGraphicsElement[];
    }

    private applyViewBox(): void {
        this.svgEl.setAttribute("viewBox", `${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}`);
        // Keep the on-screen canvas proportional to the document.
        this.svgEl.style.aspectRatio = `${this.vb.w} / ${this.vb.h}`;
    }

    getCanvasSize(): { w: number; h: number } {
        return { w: this.vb.w, h: this.vb.h };
    }

    setCanvasSize(w: number, h: number): void {
        if (!(w > 0) || !(h > 0)) return;
        this.vb.w = w;
        this.vb.h = h;
        this.applyViewBox();
        this.refreshSelectionBoxes();
        this.commit();
        this.onStatus(`Canvas resized to ${w} × ${h}`);
    }

    // ------------------------------------------------------------------
    // Zoom (display-only; never serialized)
    // ------------------------------------------------------------------

    getZoom(): number {
        return this.zoom;
    }

    zoomBy(factor: number, focus?: Point): void {
        this.setZoom(this.zoom * factor, focus);
    }

    resetZoom(): void {
        this.setZoom(1);
    }

    /**
     * Set the view zoom, keeping the SVG point under `focus` (client coords,
     * defaults to the container center) stationary on screen.
     */
    setZoom(zoom: number, focus?: Point): void {
        const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
        if (z === this.zoom) return;
        const rect = this.svgEl.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) return; // hidden canvas

        const wrap = this.containerEl;
        const wrapRect = wrap.getBoundingClientRect();
        const fx = focus?.x ?? wrapRect.left + wrap.clientWidth / 2;
        const fy = focus?.y ?? wrapRect.top + wrap.clientHeight / 2;
        const anchor = this.clientToSvg(fx, fy);

        const baseW = rect.width / this.zoom;
        const baseH = rect.height / this.zoom;
        this.zoom = z;
        if (z === 1) {
            // Back to fit-to-container sizing.
            this.svgEl.classList.remove("svge-zoomed");
            this.svgEl.style.removeProperty("width");
            this.svgEl.style.removeProperty("height");
        } else {
            this.svgEl.classList.add("svge-zoomed");
            this.svgEl.style.width = `${baseW * z}px`;
            this.svgEl.style.height = `${baseH * z}px`;
        }

        // Scroll so the anchor point stays under the cursor/pinch center.
        const after = this.svgToClient(anchor);
        wrap.scrollLeft += after.x - fx;
        wrap.scrollTop += after.y - fy;

        this.onZoomChange(z);
        this.onStatus(`Zoom ${Math.round(z * 100)}%`);
    }

    private handleWheel(e: WheelEvent): void {
        e.preventDefault();
        const scale = e.deltaMode === 1 ? 0.05 : 0.0015; // line- vs pixel-based wheels
        this.zoomBy(Math.exp(-e.deltaY * scale), { x: e.clientX, y: e.clientY });
    }

    private handlePinchMove(): void {
        const pinch = this.pinch!;
        const [a, b] = Array.from(this.touches.values());
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        // Two-finger drag pans the scrollable canvas.
        this.containerEl.scrollLeft -= center.x - pinch.lastCenter.x;
        this.containerEl.scrollTop -= center.y - pinch.lastCenter.y;
        pinch.lastCenter = center;
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        this.setZoom(pinch.startZoom * (dist / pinch.startDist), center);
    }

    /** Middle-button drag pans the view (display-only, like zoom). */
    private handlePanStart(e: PointerEvent): void {
        if (e.button !== 1 || this.pan || this.pinch) return;
        this.cancelDraw();
        this.pan = { pointerId: e.pointerId, last: { x: e.clientX, y: e.clientY } };
        this.containerEl.classList.add("svge-panning");
        this.hookWindow();
        e.preventDefault();
    }

    private endPan(): void {
        this.pan = null;
        this.containerEl.classList.remove("svge-panning");
        this.unhookWindowIfIdle();
    }

    // ------------------------------------------------------------------
    // History
    // ------------------------------------------------------------------

    private commit(): void {
        const snapshot = this.serialize(false);
        if (this.states[this.stateIndex] === snapshot) return;
        this.states = this.states.slice(0, this.stateIndex + 1);
        this.states.push(snapshot);
        if (this.states.length > 100) this.states.shift();
        this.stateIndex = this.states.length - 1;
        this.notifyHistory();
    }

    canUndo(): boolean {
        return this.stateIndex > 0;
    }

    canRedo(): boolean {
        return this.stateIndex < this.states.length - 1;
    }

    undo(): void {
        if (!this.canUndo()) return;
        this.stateIndex--;
        this.restoreFromSource(this.states[this.stateIndex]);
        this.notifyHistory();
        this.onStatus("Undo");
    }

    redo(): void {
        if (!this.canRedo()) return;
        this.stateIndex++;
        this.restoreFromSource(this.states[this.stateIndex]);
        this.notifyHistory();
        this.onStatus("Redo");
    }

    private notifyHistory(): void {
        this.onHistoryChange(this.canUndo(), this.canRedo());
    }

    // ------------------------------------------------------------------
    // Tools & style
    // ------------------------------------------------------------------

    setTool(tool: Tool): void {
        this.tool = tool;
        if (tool !== "select") this.clearSelection();
        this.svgEl.dataset.tool = tool;
        const hints: Record<Tool, string> = {
            select: "Select — click or drag a box; drag shapes to move",
            line: "Line — drag from start to end",
            circle: "Circle — drag outward from the center",
            rect: "Rectangle — drag corner to corner",
            scribble: "Scribble — draw freehand",
            delete: "Delete — click or sweep over shapes to remove them",
        };
        this.onStatus(hints[tool]);
    }

    /** Update default style; applies to the current selection when present. */
    setStyle(partial: Partial<ShapeStyle>): void {
        Object.assign(this.style, partial);
        if (this.selection.length === 0) return;
        for (const el of this.selection) {
            if (partial.stroke !== undefined) el.setAttribute("stroke", partial.stroke);
            if (partial.strokeWidth !== undefined) el.setAttribute("stroke-width", String(partial.strokeWidth));
            if (partial.fill !== undefined || partial.fillTransparent !== undefined) {
                el.setAttribute("fill", this.style.fillTransparent ? "none" : this.style.fill);
            }
            if (partial.opacity !== undefined) el.setAttribute("opacity", String(partial.opacity));
        }
        this.refreshSelectionBoxes();
        this.commit();
    }

    /** Read style attributes from a shape (for reflecting a selection in the UI). */
    readShapeStyle(el: SVGGraphicsElement): Partial<ShapeStyle> {
        const out: Partial<ShapeStyle> = {};
        const stroke = el.getAttribute("stroke");
        if (stroke && /^#[0-9a-f]{6}$/i.test(stroke)) out.stroke = stroke;
        const sw = parseFloat(el.getAttribute("stroke-width") ?? "");
        if (isFinite(sw)) out.strokeWidth = sw;
        const fill = el.getAttribute("fill");
        if (fill === "none") out.fillTransparent = true;
        else if (fill && /^#[0-9a-f]{6}$/i.test(fill)) {
            out.fillTransparent = false;
            out.fill = fill;
        }
        const op = parseFloat(el.getAttribute("opacity") ?? "");
        if (isFinite(op)) out.opacity = op;
        return out;
    }

    private applyStyleAttrs(el: SVGGraphicsElement): void {
        el.setAttribute("stroke", this.style.stroke);
        el.setAttribute("stroke-width", String(this.style.strokeWidth));
        el.setAttribute("fill", this.style.fillTransparent ? "none" : this.style.fill);
        el.setAttribute("stroke-linecap", "round");
        el.setAttribute("stroke-linejoin", "round");
        if (this.style.opacity < 1) el.setAttribute("opacity", String(this.style.opacity));
    }

    // ------------------------------------------------------------------
    // Selection
    // ------------------------------------------------------------------

    clearSelection(): void {
        if (this.selection.length === 0) return;
        this.selection = [];
        this.refreshSelectionBoxes();
        this.onSelectionChange(this.selection);
    }

    selectAll(): void {
        this.selection = this.contentChildren();
        this.refreshSelectionBoxes();
        this.onSelectionChange(this.selection);
    }

    deleteSelection(): void {
        if (this.selection.length === 0) return;
        const n = this.selection.length;
        this.selection.forEach((el) => el.remove());
        this.selection = [];
        this.refreshSelectionBoxes();
        this.onSelectionChange(this.selection);
        this.commit();
        this.onStatus(`Deleted ${n} shape${n === 1 ? "" : "s"}`);
    }

    clearAll(): void {
        this.contentChildren().forEach((el) => el.remove());
        this.clearSelection();
        this.commit();
        this.onStatus("Canvas cleared");
    }

    /** Walk up from an event target to the top-level shape that owns it. */
    private topLevelShapeFor(target: EventTarget | null): SVGGraphicsElement | null {
        let node = target instanceof Element ? target : null;
        while (node && node.parentElement !== (this.svgEl as unknown as Element)) {
            node = node.parentElement;
        }
        if (!node || node === (this.overlayEl as unknown as Element)) return null;
        return node as unknown as SVGGraphicsElement;
    }

    /** Bounding box of an element in SVG user coordinates (transform-aware). */
    private svgBBox(el: Element): { x: number; y: number; w: number; h: number } {
        const r = el.getBoundingClientRect();
        const a = this.clientToSvg(r.left, r.top);
        const b = this.clientToSvg(r.right, r.bottom);
        return {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            w: Math.abs(b.x - a.x),
            h: Math.abs(b.y - a.y),
        };
    }

    private refreshSelectionBoxes(): void {
        for (const box of Array.from(this.overlayEl.querySelectorAll(".svge-selbox"))) box.remove();
        for (const el of this.selection) {
            const bb = this.svgBBox(el);
            const pad = 2;
            const rect = this.svgEl.doc.createElementNS(SVG_NS, "rect");
            rect.setAttribute("class", "svge-selbox");
            rect.setAttribute("x", String(bb.x - pad));
            rect.setAttribute("y", String(bb.y - pad));
            rect.setAttribute("width", String(bb.w + pad * 2));
            rect.setAttribute("height", String(bb.h + pad * 2));
            this.overlayEl.appendChild(rect);
        }
    }

    // ------------------------------------------------------------------
    // Pointer interaction
    // ------------------------------------------------------------------

    private clientToSvg(cx: number, cy: number): Point {
        const ctm = this.svgEl.getScreenCTM();
        if (ctm) {
            const pt = new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
            return { x: pt.x, y: pt.y };
        }
        const r = this.svgEl.getBoundingClientRect();
        return {
            x: this.vb.x + ((cx - r.left) / (r.width || 1)) * this.vb.w,
            y: this.vb.y + ((cy - r.top) / (r.height || 1)) * this.vb.h,
        };
    }

    private svgToClient(p: Point): Point {
        const ctm = this.svgEl.getScreenCTM();
        if (ctm) {
            const pt = new DOMPoint(p.x, p.y).matrixTransform(ctm);
            return { x: pt.x, y: pt.y };
        }
        const r = this.svgEl.getBoundingClientRect();
        return {
            x: r.left + ((p.x - this.vb.x) / (this.vb.w || 1)) * r.width,
            y: r.top + ((p.y - this.vb.y) / (this.vb.h || 1)) * r.height,
        };
    }

    private eventPoint(e: PointerEvent): Point {
        return this.clientToSvg(e.clientX, e.clientY);
    }

    private handlePointerDown(e: PointerEvent): void {
        if (e.pointerType === "touch") {
            this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            this.hookWindow();
            if (this.touches.size === 2) {
                // Second finger: abort any in-progress gesture and pinch-zoom instead.
                this.cancelDraw();
                const [a, b] = Array.from(this.touches.values());
                this.pinch = {
                    startDist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
                    startZoom: this.zoom,
                    lastCenter: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                };
                e.preventDefault();
                return;
            }
            if (this.touches.size > 2) {
                e.preventDefault();
                return;
            }
        }
        // Primary button/finger only; a second touch must not start a new gesture.
        if (e.button !== 0 || !e.isPrimary || this.draw || this.pinch || this.pan) return;
        const p = this.eventPoint(e);

        if (this.tool === "delete") {
            // Press-and-sweep: every shape the pointer passes over is faded and
            // queued; all queued shapes are removed together on release.
            this.draw = { kind: "delete", start: p, deleteMarks: new Map() };
            this.markForDeletion(this.draw, e.target);
            this.onStatus("Sweep over shapes to delete, release to confirm");
        } else if (this.tool === "select") {
            const shape = this.topLevelShapeFor(e.target);
            if (shape) {
                if (e.shiftKey) {
                    if (this.selection.includes(shape)) {
                        this.selection = this.selection.filter((s) => s !== shape);
                        this.refreshSelectionBoxes();
                        this.onSelectionChange(this.selection);
                        return;
                    }
                    this.selection.push(shape);
                } else if (!this.selection.includes(shape)) {
                    this.selection = [shape];
                }
                this.refreshSelectionBoxes();
                this.onSelectionChange(this.selection);
                this.draw = {
                    kind: "select",
                    start: p,
                    moved: false,
                    moveTargets: this.selection.map((el) => ({
                        el,
                        baseTransform: el.getAttribute("transform"),
                    })),
                };
            } else {
                if (!e.shiftKey) this.clearSelection();
                const marquee = this.svgEl.doc.createElementNS(SVG_NS, "rect");
                marquee.setAttribute("class", "svge-marquee");
                marquee.setAttribute("x", String(p.x));
                marquee.setAttribute("y", String(p.y));
                this.overlayEl.appendChild(marquee);
                this.draw = { kind: "select", start: p, marqueeEl: marquee };
            }
        } else {
            // Drawing tools: create the shape and grow it while dragging.
            let el: SVGGraphicsElement;
            switch (this.tool) {
                case "line": {
                    el = this.svgEl.doc.createElementNS(SVG_NS, "line");
                    el.setAttribute("x1", String(round(p.x)));
                    el.setAttribute("y1", String(round(p.y)));
                    el.setAttribute("x2", String(round(p.x)));
                    el.setAttribute("y2", String(round(p.y)));
                    break;
                }
                case "circle": {
                    el = this.svgEl.doc.createElementNS(SVG_NS, "circle");
                    el.setAttribute("cx", String(round(p.x)));
                    el.setAttribute("cy", String(round(p.y)));
                    el.setAttribute("r", "0");
                    break;
                }
                case "rect": {
                    el = this.svgEl.doc.createElementNS(SVG_NS, "rect");
                    el.setAttribute("x", String(round(p.x)));
                    el.setAttribute("y", String(round(p.y)));
                    el.setAttribute("width", "0");
                    el.setAttribute("height", "0");
                    break;
                }
                default: {
                    el = this.svgEl.doc.createElementNS(SVG_NS, "path");
                    el.setAttribute("d", `M${round(p.x)},${round(p.y)}`);
                    break;
                }
            }
            this.applyStyleAttrs(el);
            this.svgEl.insertBefore(el, this.overlayEl);
            this.draw = { kind: this.tool, el, start: p, points: [p] };
        }

        if (this.draw) {
            this.activePointerId = e.pointerId;
            this.hookWindow();
            e.preventDefault();
        }
    }

    /** Abort the in-progress gesture, undoing any provisional DOM changes. */
    private cancelDraw(): void {
        const d = this.draw;
        this.draw = null;
        this.activePointerId = -1;
        if (!d) return;
        if (d.kind === "delete") {
            for (const [el, original] of d.deleteMarks ?? []) {
                if (original === null) el.removeAttribute("opacity");
                else el.setAttribute("opacity", original);
            }
        } else if (d.kind === "select") {
            d.marqueeEl?.remove();
            for (const t of d.moveTargets ?? []) {
                if (t.baseTransform === null) t.el.removeAttribute("transform");
                else t.el.setAttribute("transform", t.baseTransform);
            }
            this.refreshSelectionBoxes();
        } else {
            d.el?.remove();
        }
    }

    /** Queue the shape under the pointer for deletion and fade it as feedback. */
    private markForDeletion(d: DrawState, target: EventTarget | null): void {
        const shape = this.topLevelShapeFor(target);
        if (!shape || !d.deleteMarks || d.deleteMarks.has(shape)) return;
        const original = shape.getAttribute("opacity");
        d.deleteMarks.set(shape, original);
        const base = parseFloat(original ?? "1");
        const faded = Math.max(DELETE_MIN_OPACITY, (Number.isFinite(base) ? base : 1) * DELETE_FADE_FACTOR);
        shape.setAttribute("opacity", String(faded));
    }

    private handlePointerMove(e: PointerEvent): void {
        if (this.pan && e.pointerId === this.pan.pointerId) {
            this.containerEl.scrollLeft -= e.clientX - this.pan.last.x;
            this.containerEl.scrollTop -= e.clientY - this.pan.last.y;
            this.pan.last = { x: e.clientX, y: e.clientY };
            return;
        }
        if (this.touches.has(e.pointerId)) {
            this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (this.pinch && this.touches.size >= 2) {
                this.handlePinchMove();
                return;
            }
        }
        if (!this.draw || e.pointerId !== this.activePointerId) return;
        const p = this.eventPoint(e);
        const d = this.draw;

        switch (d.kind) {
            case "delete": {
                // Moves are captured on window, so resolve the hovered element
                // from the pointer position rather than the event target.
                this.markForDeletion(d, this.svgEl.doc.elementFromPoint(e.clientX, e.clientY));
                break;
            }
            case "select": {
                if (d.marqueeEl) {
                    d.marqueeEl.setAttribute("x", String(Math.min(d.start.x, p.x)));
                    d.marqueeEl.setAttribute("y", String(Math.min(d.start.y, p.y)));
                    d.marqueeEl.setAttribute("width", String(Math.abs(p.x - d.start.x)));
                    d.marqueeEl.setAttribute("height", String(Math.abs(p.y - d.start.y)));
                } else if (d.moveTargets) {
                    const dx = p.x - d.start.x;
                    const dy = p.y - d.start.y;
                    if (Math.abs(dx) + Math.abs(dy) > 0.01) d.moved = true;
                    for (const t of d.moveTargets) {
                        const move = `translate(${round(dx)} ${round(dy)})`;
                        t.el.setAttribute("transform", t.baseTransform ? `${move} ${t.baseTransform}` : move);
                    }
                    this.refreshSelectionBoxes();
                }
                break;
            }
            case "line": {
                d.el!.setAttribute("x2", String(round(p.x)));
                d.el!.setAttribute("y2", String(round(p.y)));
                break;
            }
            case "circle": {
                const r = Math.hypot(p.x - d.start.x, p.y - d.start.y);
                d.el!.setAttribute("r", String(round(r)));
                break;
            }
            case "rect": {
                d.el!.setAttribute("x", String(round(Math.min(d.start.x, p.x))));
                d.el!.setAttribute("y", String(round(Math.min(d.start.y, p.y))));
                d.el!.setAttribute("width", String(round(Math.abs(p.x - d.start.x))));
                d.el!.setAttribute("height", String(round(Math.abs(p.y - d.start.y))));
                break;
            }
            case "scribble": {
                d.points!.push(p);
                d.el!.setAttribute("d", pathFromPoints(d.points!));
                break;
            }
        }
    }

    private handlePointerUp(e: PointerEvent): void {
        if (this.pan && e.pointerId === this.pan.pointerId) {
            this.endPan();
            return;
        }
        if (this.touches.delete(e.pointerId) && this.pinch && this.touches.size < 2) {
            this.pinch = null;
        }
        if (e.pointerId !== this.activePointerId) {
            this.unhookWindowIfIdle();
            return;
        }
        this.activePointerId = -1;
        const d = this.draw;
        this.draw = null;
        this.unhookWindowIfIdle();
        if (!d) return;

        if (d.kind === "delete") {
            this.markForDeletion(d, this.svgEl.doc.elementFromPoint(e.clientX, e.clientY));
            const marks = d.deleteMarks!;
            if (marks.size > 0) {
                for (const el of marks.keys()) el.remove();
                this.selection = this.selection.filter((s) => !marks.has(s));
                this.refreshSelectionBoxes();
                this.onSelectionChange(this.selection);
                this.commit();
            }
            this.onStatus(marks.size > 0 ? `Deleted ${marks.size} shape${marks.size === 1 ? "" : "s"}` : "Nothing deleted");
            return;
        }

        if (d.kind === "select") {
            if (d.marqueeEl) {
                const mx = parseFloat(d.marqueeEl.getAttribute("x") ?? "0");
                const my = parseFloat(d.marqueeEl.getAttribute("y") ?? "0");
                const mw = parseFloat(d.marqueeEl.getAttribute("width") ?? "0");
                const mh = parseFloat(d.marqueeEl.getAttribute("height") ?? "0");
                d.marqueeEl.remove();
                if (mw > 1 || mh > 1) {
                    const hits = this.contentChildren().filter((el) => {
                        const bb = this.svgBBox(el);
                        return bb.x < mx + mw && bb.x + bb.w > mx && bb.y < my + mh && bb.y + bb.h > my;
                    });
                    this.selection = e.shiftKey
                        ? [...this.selection, ...hits.filter((h) => !this.selection.includes(h))]
                        : hits;
                    this.refreshSelectionBoxes();
                    this.onSelectionChange(this.selection);
                    this.onStatus(`${this.selection.length} shape${this.selection.length === 1 ? "" : "s"} selected`);
                }
            } else if (d.moved) {
                this.commit();
                this.onStatus("Moved");
            }
            return;
        }

        // Finalize a drawn shape; discard degenerate click-without-drag shapes.
        const el = d.el!;
        const degenerate =
            (d.kind === "line" &&
                Math.hypot(
                    parseFloat(el.getAttribute("x2") ?? "0") - parseFloat(el.getAttribute("x1") ?? "0"),
                    parseFloat(el.getAttribute("y2") ?? "0") - parseFloat(el.getAttribute("y1") ?? "0")
                ) < 0.5) ||
            (d.kind === "circle" && parseFloat(el.getAttribute("r") ?? "0") < 0.5) ||
            (d.kind === "rect" &&
                parseFloat(el.getAttribute("width") ?? "0") < 0.5 &&
                parseFloat(el.getAttribute("height") ?? "0") < 0.5) ||
            (d.kind === "scribble" && (d.points?.length ?? 0) < 2);

        if (degenerate) {
            el.remove();
            return;
        }
        this.commit();
        this.onStatus(`${d.kind.charAt(0).toUpperCase() + d.kind.slice(1)} added`);
    }
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

/** Build a smoothed path string from scribble points (quadratic mid-point smoothing). */
export function pathFromPoints(points: Point[]): string {
    if (points.length === 0) return "";
    let d = `M${round(points[0].x)},${round(points[0].y)}`;
    if (points.length === 1) return d;
    for (let i = 1; i < points.length; i++) {
        const pt = points[i];
        if (i === 1) {
            d += ` L${round(pt.x)},${round(pt.y)}`;
        } else {
            const prev = points[i - 1];
            const midX = (prev.x + pt.x) / 2;
            const midY = (prev.y + pt.y) / 2;
            d += ` Q${round(prev.x)},${round(prev.y)} ${round(midX)},${round(midY)}`;
        }
    }
    if (points.length > 2) {
        const last = points[points.length - 1];
        d += ` L${round(last.x)},${round(last.y)}`;
    }
    return d;
}
