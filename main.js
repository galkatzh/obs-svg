var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SvgEditorPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/editor.ts
var SVG_NS = "http://www.w3.org/2000/svg";
var DEFAULT_WIDTH = 480;
var DEFAULT_HEIGHT = 320;
function emptySvgSource(w = DEFAULT_WIDTH, h = DEFAULT_HEIGHT) {
  return `<svg xmlns="${SVG_NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
</svg>`;
}
var FORBIDDEN_TAGS = /* @__PURE__ */ new Set(["script", "foreignobject", "iframe", "embed", "object"]);
function sanitizeSvgTree(root) {
  const doomed = [];
  const walk = (el) => {
    if (FORBIDDEN_TAGS.has(el.tagName.toLowerCase())) {
      doomed.push(el);
      return;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      } else if ((name === "href" || name === "xlink:href") && attr.value.trim().toLowerCase().startsWith("javascript:")) {
        el.removeAttribute(attr.name);
      }
    }
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(root);
  doomed.forEach((el) => el.remove());
}
function parseSvgSource(source) {
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
  return root;
}
function prettyPrintXml(xml) {
  const withBreaks = xml.replace(/>\s*</g, ">\n<").trim();
  let indent = 0;
  const out = [];
  for (const line of withBreaks.split("\n")) {
    const isClosing = /^<\//.test(line);
    const isSelfContained = /\/>$/.test(line) || /^<[^>]+>[^<]*<\/[^>]+>$/.test(line) || /^<[?!]/.test(line);
    if (isClosing) indent = Math.max(0, indent - 1);
    out.push("  ".repeat(indent) + line);
    if (!isClosing && !isSelfContained && /^</.test(line)) indent++;
  }
  return out.join("\n");
}
var DELETE_FADE_FACTOR = 0.6;
var DELETE_MIN_OPACITY = 0.15;
var SELBOX_PAD = 2;
var HANDLE_DOT_PX = 7;
var HANDLE_HIT_PX = 14;
var HANDLE_EDGE_PX = 10;
var RESIZE_CURSORS = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize"
};
var MIN_ZOOM = 0.25;
var MAX_ZOOM = 8;
var SvgEditorCore = class {
  constructor(containerEl) {
    this.containerEl = containerEl;
    this.vb = { x: 0, y: 0, w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT };
    /** Root <svg> attributes preserved verbatim from the loaded source. */
    this.rootAttrs = /* @__PURE__ */ new Map();
    this.tool = "select";
    this.style = {
      stroke: "#000000",
      strokeWidth: 2,
      fill: "#ffffff",
      fillTransparent: true,
      opacity: 1
    };
    this.selection = [];
    this.states = [];
    this.stateIndex = -1;
    this.draw = null;
    this.onSelectionChange = () => {
    };
    this.onHistoryChange = () => {
    };
    this.onStatus = () => {
    };
    this.onSizeChange = () => {
    };
    this.onZoomChange = () => {
    };
    this.boundPointerMove = (e) => this.handlePointerMove(e);
    this.boundPointerUp = (e) => this.handlePointerUp(e);
    this.boundWheel = (e) => this.handleWheel(e);
    /** Pointer that started the current gesture; other touches are ignored. */
    this.activePointerId = -1;
    this.windowHooked = false;
    /** Display-only zoom factor; 1 = fit to container. */
    this.zoom = 1;
    /** Live client positions of touch pointers on the canvas (pinch tracking). */
    this.touches = /* @__PURE__ */ new Map();
    this.pinch = null;
    /** Middle-button drag pan: the pointer driving it and its last position. */
    this.pan = null;
    this.svgEl = containerEl.doc.createElementNS(SVG_NS, "svg");
    this.svgEl.classList.add("svge-canvas");
    this.overlayEl = containerEl.doc.createElementNS(SVG_NS, "g");
    this.overlayEl.setAttribute("data-svge-overlay", "");
    this.svgEl.appendChild(this.overlayEl);
    containerEl.appendChild(this.svgEl);
    this.svgEl.addEventListener("pointerdown", (e) => this.handlePointerDown(e));
    containerEl.addEventListener("pointerdown", (e) => this.handlePanStart(e));
    containerEl.addEventListener("wheel", this.boundWheel, { passive: false });
    this.applyViewBox();
  }
  destroy() {
    this.containerEl.removeEventListener("wheel", this.boundWheel);
    this.windowHooked = false;
    this.svgEl.win.removeEventListener("pointermove", this.boundPointerMove);
    this.svgEl.win.removeEventListener("pointerup", this.boundPointerUp);
    this.svgEl.win.removeEventListener("pointercancel", this.boundPointerUp);
    this.svgEl.remove();
  }
  hookWindow() {
    if (this.windowHooked) return;
    this.windowHooked = true;
    this.svgEl.win.addEventListener("pointermove", this.boundPointerMove);
    this.svgEl.win.addEventListener("pointerup", this.boundPointerUp);
    this.svgEl.win.addEventListener("pointercancel", this.boundPointerUp);
  }
  unhookWindowIfIdle() {
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
  load(source) {
    this.restoreFromSource(source.trim() ? source : emptySvgSource());
    this.states = [this.serialize(false)];
    this.stateIndex = 0;
    this.notifyHistory();
  }
  /** Replace content from code-mode text; recorded as a single undoable step. */
  loadFromCode(source) {
    this.restoreFromSource(source.trim() ? source : emptySvgSource());
    this.commit();
  }
  restoreFromSource(source) {
    const parsed = parseSvgSource(source);
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
    this.contentChildren().forEach((el) => el.remove());
    for (const child of Array.from(parsed.childNodes)) {
      this.svgEl.insertBefore(this.svgEl.doc.importNode(child, true), this.overlayEl);
    }
    this.clearSelection();
    this.applyViewBox();
    this.onSizeChange(this.vb.w, this.vb.h);
  }
  /** Serialize current content (overlay excluded) back to SVG source. */
  serialize(pretty = true) {
    const clone = this.svgEl.cloneNode(true);
    clone.querySelector("[data-svge-overlay]")?.remove();
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
  contentChildren() {
    return Array.from(this.svgEl.children).filter(
      (el) => el !== this.overlayEl
    );
  }
  applyViewBox() {
    this.svgEl.setAttribute("viewBox", `${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}`);
    this.svgEl.style.aspectRatio = `${this.vb.w} / ${this.vb.h}`;
  }
  getCanvasSize() {
    return { w: this.vb.w, h: this.vb.h };
  }
  setCanvasSize(w, h) {
    if (!(w > 0) || !(h > 0)) return;
    this.vb.w = w;
    this.vb.h = h;
    this.applyViewBox();
    this.refreshSelectionBoxes();
    this.commit();
    this.onStatus(`Canvas resized to ${w} \xD7 ${h}`);
  }
  // ------------------------------------------------------------------
  // Zoom (display-only; never serialized)
  // ------------------------------------------------------------------
  getZoom() {
    return this.zoom;
  }
  zoomBy(factor, focus) {
    this.setZoom(this.zoom * factor, focus);
  }
  resetZoom() {
    this.setZoom(1);
  }
  /**
   * Set the view zoom, keeping the SVG point under `focus` (client coords,
   * defaults to the container center) stationary on screen.
   */
  setZoom(zoom, focus) {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    if (z === this.zoom) return;
    const rect = this.svgEl.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    const wrap = this.containerEl;
    const wrapRect = wrap.getBoundingClientRect();
    const fx = focus?.x ?? wrapRect.left + wrap.clientWidth / 2;
    const fy = focus?.y ?? wrapRect.top + wrap.clientHeight / 2;
    const anchor = this.clientToSvg(fx, fy);
    const baseW = rect.width / this.zoom;
    const baseH = rect.height / this.zoom;
    this.zoom = z;
    if (z === 1) {
      this.svgEl.classList.remove("svge-zoomed");
      this.svgEl.style.removeProperty("width");
      this.svgEl.style.removeProperty("height");
    } else {
      this.svgEl.classList.add("svge-zoomed");
      this.svgEl.style.width = `${baseW * z}px`;
      this.svgEl.style.height = `${baseH * z}px`;
    }
    const after = this.svgToClient(anchor);
    wrap.scrollLeft += after.x - fx;
    wrap.scrollTop += after.y - fy;
    this.refreshSelectionBoxes();
    this.onZoomChange(z);
    this.onStatus(`Zoom ${Math.round(z * 100)}%`);
  }
  handleWheel(e) {
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 0.05 : 15e-4;
    this.zoomBy(Math.exp(-e.deltaY * scale), { x: e.clientX, y: e.clientY });
  }
  handlePinchMove() {
    const pinch = this.pinch;
    const [a, b] = Array.from(this.touches.values());
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.containerEl.scrollLeft -= center.x - pinch.lastCenter.x;
    this.containerEl.scrollTop -= center.y - pinch.lastCenter.y;
    pinch.lastCenter = center;
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    this.setZoom(pinch.startZoom * (dist / pinch.startDist), center);
  }
  /** Middle-button drag pans the view (display-only, like zoom). */
  handlePanStart(e) {
    if (e.button !== 1 || this.pan || this.pinch) return;
    this.cancelDraw();
    this.pan = { pointerId: e.pointerId, last: { x: e.clientX, y: e.clientY } };
    this.containerEl.classList.add("svge-panning");
    this.hookWindow();
    e.preventDefault();
  }
  endPan() {
    this.pan = null;
    this.containerEl.classList.remove("svge-panning");
    this.unhookWindowIfIdle();
  }
  // ------------------------------------------------------------------
  // History
  // ------------------------------------------------------------------
  commit() {
    const snapshot = this.serialize(false);
    if (this.states[this.stateIndex] === snapshot) return;
    this.states = this.states.slice(0, this.stateIndex + 1);
    this.states.push(snapshot);
    if (this.states.length > 100) this.states.shift();
    this.stateIndex = this.states.length - 1;
    this.notifyHistory();
  }
  canUndo() {
    return this.stateIndex > 0;
  }
  canRedo() {
    return this.stateIndex < this.states.length - 1;
  }
  undo() {
    if (!this.canUndo()) return;
    this.stateIndex--;
    this.restoreFromSource(this.states[this.stateIndex]);
    this.notifyHistory();
    this.onStatus("Undo");
  }
  redo() {
    if (!this.canRedo()) return;
    this.stateIndex++;
    this.restoreFromSource(this.states[this.stateIndex]);
    this.notifyHistory();
    this.onStatus("Redo");
  }
  notifyHistory() {
    this.onHistoryChange(this.canUndo(), this.canRedo());
  }
  // ------------------------------------------------------------------
  // Tools & style
  // ------------------------------------------------------------------
  setTool(tool) {
    this.tool = tool;
    if (tool !== "select") this.clearSelection();
    this.svgEl.dataset.tool = tool;
    const hints = {
      select: "Select \u2014 click or drag a box; drag shapes to move, handles to resize",
      line: "Line \u2014 drag from start to end",
      circle: "Circle \u2014 drag outward from the center",
      rect: "Rectangle \u2014 drag corner to corner",
      scribble: "Scribble \u2014 draw freehand",
      delete: "Delete \u2014 click or sweep over shapes to remove them"
    };
    this.onStatus(hints[tool]);
  }
  /** Update default style; applies to the current selection when present. */
  setStyle(partial) {
    Object.assign(this.style, partial);
    if (this.selection.length === 0) return;
    for (const el of this.selection) {
      if (partial.stroke !== void 0) el.setAttribute("stroke", partial.stroke);
      if (partial.strokeWidth !== void 0) el.setAttribute("stroke-width", String(partial.strokeWidth));
      if (partial.fill !== void 0 || partial.fillTransparent !== void 0) {
        el.setAttribute("fill", this.style.fillTransparent ? "none" : this.style.fill);
      }
      if (partial.opacity !== void 0) el.setAttribute("opacity", String(partial.opacity));
    }
    this.refreshSelectionBoxes();
    this.commit();
  }
  /** Read style attributes from a shape (for reflecting a selection in the UI). */
  readShapeStyle(el) {
    const out = {};
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
  applyStyleAttrs(el) {
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
  clearSelection() {
    if (this.selection.length === 0) return;
    this.selection = [];
    this.refreshSelectionBoxes();
    this.onSelectionChange(this.selection);
  }
  selectAll() {
    this.selection = this.contentChildren();
    this.refreshSelectionBoxes();
    this.onSelectionChange(this.selection);
  }
  deleteSelection() {
    if (this.selection.length === 0) return;
    const n = this.selection.length;
    this.selection.forEach((el) => el.remove());
    this.selection = [];
    this.refreshSelectionBoxes();
    this.onSelectionChange(this.selection);
    this.commit();
    this.onStatus(`Deleted ${n} shape${n === 1 ? "" : "s"}`);
  }
  clearAll() {
    this.contentChildren().forEach((el) => el.remove());
    this.clearSelection();
    this.commit();
    this.onStatus("Canvas cleared");
  }
  /** Walk up from an event target to the top-level shape that owns it. */
  topLevelShapeFor(target) {
    let node = target instanceof Element ? target : null;
    while (node && node.parentElement !== this.svgEl) {
      node = node.parentElement;
    }
    if (!node || node === this.overlayEl) return null;
    return node;
  }
  /** Bounding box of an element in SVG user coordinates (transform-aware). */
  svgBBox(el) {
    const r = el.getBoundingClientRect();
    const a = this.clientToSvg(r.left, r.top);
    const b = this.clientToSvg(r.right, r.bottom);
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y)
    };
  }
  /** Whether a point (svg coords) falls inside any selected shape's selection box. */
  selectionAt(p) {
    return this.selection.some((el) => {
      const bb = this.svgBBox(el);
      return p.x >= bb.x - SELBOX_PAD && p.x <= bb.x + bb.w + SELBOX_PAD && p.y >= bb.y - SELBOX_PAD && p.y <= bb.y + bb.h + SELBOX_PAD;
    });
  }
  /** Union of the selected shapes' bounding boxes (svg coords, no padding). */
  selectionUnionBox() {
    if (this.selection.length === 0) return null;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const el of this.selection) {
      const bb = this.svgBBox(el);
      x1 = Math.min(x1, bb.x);
      y1 = Math.min(y1, bb.y);
      x2 = Math.max(x2, bb.x + bb.w);
      y2 = Math.max(y2, bb.y + bb.h);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  refreshSelectionBoxes() {
    const stale = this.overlayEl.querySelectorAll(".svge-selbox, .svge-rhit, .svge-rdot");
    for (const box of Array.from(stale)) box.remove();
    for (const el of this.selection) {
      const bb = this.svgBBox(el);
      const pad = SELBOX_PAD;
      const rect = this.svgEl.doc.createElementNS(SVG_NS, "rect");
      rect.setAttribute("class", "svge-selbox");
      rect.setAttribute("x", String(bb.x - pad));
      rect.setAttribute("y", String(bb.y - pad));
      rect.setAttribute("width", String(bb.w + pad * 2));
      rect.setAttribute("height", String(bb.h + pad * 2));
      this.overlayEl.appendChild(rect);
    }
    this.drawResizeHandles();
  }
  /** Resize handles around the selection: edge hit strips, corner hit
   *  squares and the visible indicator dots. */
  drawResizeHandles() {
    if (this.tool !== "select") return;
    const u = this.selectionUnionBox();
    if (!u) return;
    const b = {
      x: u.x - SELBOX_PAD,
      y: u.y - SELBOX_PAD,
      w: u.w + SELBOX_PAD * 2,
      h: u.h + SELBOX_PAD * 2
    };
    const mk = (cls, dir, x, y, w, h) => {
      const r = this.svgEl.doc.createElementNS(SVG_NS, "rect");
      r.setAttribute("class", cls);
      r.setAttribute("data-dir", dir);
      r.setAttribute("x", String(x));
      r.setAttribute("y", String(y));
      r.setAttribute("width", String(w));
      r.setAttribute("height", String(h));
      this.overlayEl.appendChild(r);
    };
    if (this.selection.length > 1) {
      const outline = this.svgEl.doc.createElementNS(SVG_NS, "rect");
      outline.setAttribute("class", "svge-selbox");
      outline.setAttribute("x", String(b.x));
      outline.setAttribute("y", String(b.y));
      outline.setAttribute("width", String(b.w));
      outline.setAttribute("height", String(b.h));
      this.overlayEl.appendChild(outline);
    }
    const scale = this.svgEl.getScreenCTM()?.a || 1;
    const edge = HANDLE_EDGE_PX / scale;
    const hit = HANDLE_HIT_PX / scale;
    const dot = HANDLE_DOT_PX / scale;
    mk("svge-rhit", "n", b.x, b.y - edge / 2, b.w, edge);
    mk("svge-rhit", "s", b.x, b.y + b.h - edge / 2, b.w, edge);
    mk("svge-rhit", "w", b.x - edge / 2, b.y, edge, b.h);
    mk("svge-rhit", "e", b.x + b.w - edge / 2, b.y, edge, b.h);
    const xs = [["w", b.x], ["", b.x + b.w / 2], ["e", b.x + b.w]];
    const ys = [["n", b.y], ["", b.y + b.h / 2], ["s", b.y + b.h]];
    for (const [ny, cy] of ys) {
      for (const [nx, cx] of xs) {
        const dir = ny + nx;
        if (!dir) continue;
        if (dir.length === 2) mk("svge-rhit", dir, cx - hit / 2, cy - hit / 2, hit, hit);
        mk("svge-rdot", dir, cx - dot / 2, cy - dot / 2, dot, dot);
      }
    }
  }
  // ------------------------------------------------------------------
  // Pointer interaction
  // ------------------------------------------------------------------
  clientToSvg(cx, cy) {
    const ctm = this.svgEl.getScreenCTM();
    if (ctm) {
      const pt = new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
      return { x: pt.x, y: pt.y };
    }
    const r = this.svgEl.getBoundingClientRect();
    return {
      x: this.vb.x + (cx - r.left) / (r.width || 1) * this.vb.w,
      y: this.vb.y + (cy - r.top) / (r.height || 1) * this.vb.h
    };
  }
  svgToClient(p) {
    const ctm = this.svgEl.getScreenCTM();
    if (ctm) {
      const pt = new DOMPoint(p.x, p.y).matrixTransform(ctm);
      return { x: pt.x, y: pt.y };
    }
    const r = this.svgEl.getBoundingClientRect();
    return {
      x: r.left + (p.x - this.vb.x) / (this.vb.w || 1) * r.width,
      y: r.top + (p.y - this.vb.y) / (this.vb.h || 1) * r.height
    };
  }
  eventPoint(e) {
    return this.clientToSvg(e.clientX, e.clientY);
  }
  handlePointerDown(e) {
    if (e.pointerType === "touch") {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.hookWindow();
      if (this.touches.size === 2) {
        this.cancelDraw();
        const [a, b] = Array.from(this.touches.values());
        this.pinch = {
          startDist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
          startZoom: this.zoom,
          lastCenter: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        };
        e.preventDefault();
        return;
      }
      if (this.touches.size > 2) {
        e.preventDefault();
        return;
      }
    }
    if (e.button !== 0 || !e.isPrimary || this.draw || this.pinch || this.pan) return;
    const p = this.eventPoint(e);
    if (this.tool === "delete") {
      this.draw = { kind: "delete", start: p, deleteMarks: /* @__PURE__ */ new Map() };
      this.markForDeletion(this.draw, e.target);
      this.onStatus("Sweep over shapes to delete, release to confirm");
    } else if (this.tool === "select") {
      const handleDir = e.target instanceof Element ? e.target.closest(".svge-rhit")?.getAttribute("data-dir") : null;
      const shape = this.topLevelShapeFor(e.target);
      if (handleDir && this.selection.length > 0) {
        this.draw = {
          kind: "resize",
          start: p,
          moved: false,
          resizeDir: handleDir,
          resizeBox: this.selectionUnionBox(),
          moveTargets: this.selection.map((el) => ({
            el,
            baseTransform: el.getAttribute("transform")
          }))
        };
        this.svgEl.style.cursor = RESIZE_CURSORS[handleDir] ?? "";
      } else if (shape) {
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
            baseTransform: el.getAttribute("transform")
          }))
        };
      } else if (!e.shiftKey && this.selectionAt(p)) {
        this.draw = {
          kind: "select",
          start: p,
          moved: false,
          moveTargets: this.selection.map((el) => ({
            el,
            baseTransform: el.getAttribute("transform")
          }))
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
      let el;
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
  cancelDraw() {
    const d = this.draw;
    this.draw = null;
    this.activePointerId = -1;
    if (!d) return;
    if (d.kind === "delete") {
      for (const [el, original] of d.deleteMarks ?? []) {
        if (original === null) el.removeAttribute("opacity");
        else el.setAttribute("opacity", original);
      }
    } else if (d.kind === "select" || d.kind === "resize") {
      if (d.kind === "resize") this.svgEl.style.removeProperty("cursor");
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
  markForDeletion(d, target) {
    const shape = this.topLevelShapeFor(target);
    if (!shape || !d.deleteMarks || d.deleteMarks.has(shape)) return;
    const original = shape.getAttribute("opacity");
    d.deleteMarks.set(shape, original);
    const base = parseFloat(original ?? "1");
    const faded = Math.max(DELETE_MIN_OPACITY, (Number.isFinite(base) ? base : 1) * DELETE_FADE_FACTOR);
    shape.setAttribute("opacity", String(faded));
  }
  handlePointerMove(e) {
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
        this.markForDeletion(d, this.svgEl.doc.elementFromPoint(e.clientX, e.clientY));
        break;
      }
      case "resize": {
        const box = d.resizeBox;
        const dir = d.resizeDir;
        const min = 1;
        let sx = 1;
        let sy = 1;
        let ax = 0;
        let ay = 0;
        if (dir.includes("e")) {
          ax = box.x;
          sx = Math.max(min, p.x - box.x) / (box.w || 1);
        }
        if (dir.includes("w")) {
          ax = box.x + box.w;
          sx = Math.max(min, box.x + box.w - p.x) / (box.w || 1);
        }
        if (dir.includes("s")) {
          ay = box.y;
          sy = Math.max(min, p.y - box.y) / (box.h || 1);
        }
        if (dir.includes("n")) {
          ay = box.y + box.h;
          sy = Math.max(min, box.y + box.h - p.y) / (box.h || 1);
        }
        d.moved = true;
        for (const t of d.moveTargets) {
          const resize = `translate(${round(ax)} ${round(ay)}) scale(${round4(sx)} ${round4(sy)}) translate(${round(-ax)} ${round(-ay)})`;
          t.el.setAttribute("transform", t.baseTransform ? `${resize} ${t.baseTransform}` : resize);
        }
        this.refreshSelectionBoxes();
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
        d.el.setAttribute("x2", String(round(p.x)));
        d.el.setAttribute("y2", String(round(p.y)));
        break;
      }
      case "circle": {
        const r = Math.hypot(p.x - d.start.x, p.y - d.start.y);
        d.el.setAttribute("r", String(round(r)));
        break;
      }
      case "rect": {
        d.el.setAttribute("x", String(round(Math.min(d.start.x, p.x))));
        d.el.setAttribute("y", String(round(Math.min(d.start.y, p.y))));
        d.el.setAttribute("width", String(round(Math.abs(p.x - d.start.x))));
        d.el.setAttribute("height", String(round(Math.abs(p.y - d.start.y))));
        break;
      }
      case "scribble": {
        d.points.push(p);
        d.el.setAttribute("d", pathFromPoints(d.points));
        break;
      }
    }
  }
  handlePointerUp(e) {
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
      const marks = d.deleteMarks;
      if (marks.size > 0) {
        for (const el2 of marks.keys()) el2.remove();
        this.selection = this.selection.filter((s) => !marks.has(s));
        this.refreshSelectionBoxes();
        this.onSelectionChange(this.selection);
        this.commit();
      }
      this.onStatus(marks.size > 0 ? `Deleted ${marks.size} shape${marks.size === 1 ? "" : "s"}` : "Nothing deleted");
      return;
    }
    if (d.kind === "resize") {
      this.svgEl.style.removeProperty("cursor");
      if (d.moved) {
        this.commit();
        this.onStatus("Resized");
      }
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
          const hits = this.contentChildren().filter((el2) => {
            const bb = this.svgBBox(el2);
            return bb.x < mx + mw && bb.x + bb.w > mx && bb.y < my + mh && bb.y + bb.h > my;
          });
          this.selection = e.shiftKey ? [...this.selection, ...hits.filter((h) => !this.selection.includes(h))] : hits;
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
    const el = d.el;
    const degenerate = d.kind === "line" && Math.hypot(
      parseFloat(el.getAttribute("x2") ?? "0") - parseFloat(el.getAttribute("x1") ?? "0"),
      parseFloat(el.getAttribute("y2") ?? "0") - parseFloat(el.getAttribute("y1") ?? "0")
    ) < 0.5 || d.kind === "circle" && parseFloat(el.getAttribute("r") ?? "0") < 0.5 || d.kind === "rect" && parseFloat(el.getAttribute("width") ?? "0") < 0.5 && parseFloat(el.getAttribute("height") ?? "0") < 0.5 || d.kind === "scribble" && (d.points?.length ?? 0) < 2;
    if (degenerate) {
      el.remove();
      return;
    }
    this.commit();
    this.onStatus(`${d.kind.charAt(0).toUpperCase() + d.kind.slice(1)} added`);
  }
};
function round(n) {
  return Math.round(n * 100) / 100;
}
function round4(n) {
  return Math.round(n * 1e4) / 1e4;
}
function pathFromPoints(points) {
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

// src/modal.ts
var import_obsidian = require("obsidian");
var TOOLS = [
  { tool: "select", icon: "mouse-pointer", label: "Select & move", key: "v" },
  { tool: "line", icon: "minus", label: "Line", key: "l" },
  { tool: "circle", icon: "circle", label: "Circle", key: "c" },
  { tool: "rect", icon: "square", label: "Rectangle", key: "r" },
  { tool: "scribble", icon: "pencil", label: "Scribble (freehand)", key: "p" },
  { tool: "delete", icon: "eraser", label: "Delete shape", key: "x" }
];
var SvgEditorModal = class extends import_obsidian.Modal {
  constructor(app, initialSource, onSaveCb) {
    super(app);
    this.initialSource = initialSource;
    this.onSaveCb = onSaveCb;
    this.mode = "visual";
    this.tabButtons = {};
    this.toolButtons = {};
    /** Compact layout: phones/tablets, or a narrow/short desktop window. */
    this.compactQuery = activeWindow.matchMedia("(max-width: 640px), (max-height: 500px)");
    this.updateCompact = () => {
      this.modalEl.toggleClass(
        "svge-compact",
        import_obsidian.Platform.isMobile || activeDocument.body.classList.contains("is-mobile") || this.compactQuery.matches
      );
    };
  }
  onOpen() {
    this.modalEl.addClass("svge-modal");
    this.updateCompact();
    this.compactQuery.addEventListener("change", this.updateCompact);
    const { contentEl } = this;
    contentEl.addClass("svge-content");
    const header = contentEl.createDiv({ cls: "svge-header" });
    header.createDiv({ cls: "svge-title", text: "SVG Editor" });
    const tabs = header.createDiv({ cls: "svge-tabs" });
    for (const m of ["visual", "code"]) {
      const btn = tabs.createEl("button", {
        cls: "svge-tab",
        text: m === "visual" ? "Visual" : "Code"
      });
      btn.addEventListener("click", () => this.setMode(m));
      this.tabButtons[m] = btn;
    }
    header.createDiv({ cls: "svge-spacer" });
    const sizeWrap = header.createDiv({ cls: "svge-size", attr: { "aria-label": "Canvas size" } });
    this.widthInput = sizeWrap.createEl("input", {
      type: "number",
      attr: { min: "10", max: "10000", placeholder: "W" }
    });
    sizeWrap.createSpan({ text: "\xD7" });
    this.heightInput = sizeWrap.createEl("input", {
      type: "number",
      attr: { min: "10", max: "10000", placeholder: "H" }
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
    const body = contentEl.createDiv({ cls: "svge-body" });
    this.visualEl = body.createDiv({ cls: "svge-visual" });
    const main = this.visualEl.createDiv({ cls: "svge-main" });
    const toolbar = main.createDiv({ cls: "svge-toolbar" });
    for (const t of TOOLS) {
      const btn = toolbar.createEl("button", {
        cls: "svge-tool clickable-icon",
        attr: { "aria-label": `${t.label} (${t.key.toUpperCase()})`, "data-tool": t.tool }
      });
      (0, import_obsidian.setIcon)(btn, t.icon);
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
    this.strokeInput.addEventListener(
      "input",
      () => this.core.setStyle({ stroke: this.strokeInput.value })
    );
    this.strokeWidthInput = strokeGroup.createEl("input", {
      type: "range",
      attr: { min: "1", max: "50", step: "1" }
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
    this.fillTransparentInput.addEventListener(
      "change",
      () => this.core.setStyle({ fillTransparent: this.fillTransparentInput.checked })
    );
    const opacityGroup = props.createDiv({ cls: "svge-prop-group", attr: { "aria-label": "Opacity" } });
    opacityGroup.createSpan({ cls: "svge-prop-label", text: "Opacity" });
    this.opacityInput = opacityGroup.createEl("input", {
      type: "range",
      attr: { min: "0", max: "100", step: "1" }
    });
    this.opacityInput.value = "100";
    this.opacityValue = opacityGroup.createSpan({ cls: "svge-prop-value", text: "100" });
    this.opacityInput.addEventListener("input", () => {
      this.opacityValue.setText(this.opacityInput.value);
      this.core.setStyle({ opacity: parseFloat(this.opacityInput.value) / 100 });
    });
    const zoomGroup = props.createDiv({ cls: "svge-prop-group svge-zoom", attr: { "aria-label": "Zoom" } });
    const zoomOutBtn = zoomGroup.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Zoom out (Ctrl+-)" } });
    (0, import_obsidian.setIcon)(zoomOutBtn, "zoom-out");
    zoomOutBtn.addEventListener("click", () => this.core.zoomBy(1 / 1.25));
    this.zoomValueBtn = zoomGroup.createEl("button", {
      cls: "svge-zoom-value",
      text: "100%",
      attr: { "aria-label": "Reset zoom (Ctrl+0)" }
    });
    this.zoomValueBtn.addEventListener("click", () => this.core.resetZoom());
    const zoomInBtn = zoomGroup.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Zoom in (Ctrl+=)" } });
    (0, import_obsidian.setIcon)(zoomInBtn, "zoom-in");
    zoomInBtn.addEventListener("click", () => this.core.zoomBy(1.25));
    const histGroup = props.createDiv({ cls: "svge-prop-group svge-hist" });
    this.deleteSelBtn = histGroup.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Delete selection (Del)" } });
    (0, import_obsidian.setIcon)(this.deleteSelBtn, "delete");
    this.deleteSelBtn.disabled = true;
    this.deleteSelBtn.addEventListener("click", () => this.core.deleteSelection());
    this.undoBtn = histGroup.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Undo (Ctrl+Z)" } });
    (0, import_obsidian.setIcon)(this.undoBtn, "undo-2");
    this.undoBtn.addEventListener("click", () => this.core.undo());
    this.redoBtn = histGroup.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Redo (Ctrl+Shift+Z)" } });
    (0, import_obsidian.setIcon)(this.redoBtn, "redo-2");
    this.redoBtn.addEventListener("click", () => this.core.redo());
    const clearBtn = histGroup.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Clear canvas" } });
    (0, import_obsidian.setIcon)(clearBtn, "trash-2");
    clearBtn.addEventListener("click", () => this.core.clearAll());
    this.codeEl = body.createDiv({ cls: "svge-code" });
    this.codeArea = this.codeEl.createEl("textarea", {
      cls: "svge-code-area",
      attr: { spellcheck: "false", placeholder: "<svg \u2026>" }
    });
    this.codeErrorEl = this.codeEl.createDiv({ cls: "svge-code-error" });
    this.statusEl = contentEl.createDiv({ cls: "svge-status", text: "Ready" });
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
    this.core.onZoomChange = (z) => this.zoomValueBtn.setText(`${Math.round(z * 100)}%`);
    try {
      this.core.load(this.initialSource.trim() ? this.initialSource : emptySvgSource());
      this.setMode("visual");
    } catch (e) {
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
    this.scope.register(["Mod"], "=", () => {
      if (this.mode !== "visual") return true;
      this.core.zoomBy(1.25);
      return false;
    });
    this.scope.register(["Mod"], "-", () => {
      if (this.mode !== "visual") return true;
      this.core.zoomBy(1 / 1.25);
      return false;
    });
    this.scope.register(["Mod"], "0", () => {
      if (this.mode !== "visual") return true;
      this.core.resetZoom();
      return false;
    });
    this.modalEl.addEventListener("keydown", (evt) => this.handleKeydown(evt));
  }
  handleKeydown(evt) {
    if (this.mode !== "visual") return;
    const target = evt.target;
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
  setTool(tool) {
    this.core.setTool(tool);
    for (const [name, btn] of Object.entries(this.toolButtons)) {
      btn.toggleClass("is-active", name === tool);
    }
  }
  /** Reflect the current selection into the style controls. */
  reflectSelection(sel) {
    this.deleteSelBtn.disabled = sel.length === 0;
    if (sel.length === 0) {
      this.selectionNoteEl.setText("");
      return;
    }
    this.selectionNoteEl.setText(
      sel.length === 1 ? "1 shape \u2014 edits apply to it" : `${sel.length} shapes \u2014 edits apply to all`
    );
    if (sel.length !== 1) return;
    const s = this.core.readShapeStyle(sel[0]);
    if (s.stroke) this.strokeInput.value = s.stroke;
    if (s.strokeWidth !== void 0) {
      this.strokeWidthInput.value = String(s.strokeWidth);
      this.strokeWidthValue.setText(String(s.strokeWidth));
    }
    if (s.fillTransparent !== void 0) this.fillTransparentInput.checked = s.fillTransparent;
    if (s.fill) this.fillInput.value = s.fill;
    const opacity = s.opacity ?? 1;
    this.opacityInput.value = String(Math.round(opacity * 100));
    this.opacityValue.setText(String(Math.round(opacity * 100)));
  }
  setMode(mode) {
    if (mode === "code" && this.mode !== "code") {
      this.codeArea.value = this.core.serialize(true);
    }
    if (mode === "visual" && this.mode === "code") {
      if (!this.applyCode()) return false;
    }
    this.mode = mode;
    this.modalEl.toggleClass("svge-mode-visual", mode === "visual");
    this.modalEl.toggleClass("svge-mode-code", mode === "code");
    this.visualEl.style.display = mode === "visual" ? "" : "none";
    this.codeEl.style.display = mode === "code" ? "" : "none";
    this.tabButtons["visual"].toggleClass("is-active", mode === "visual");
    this.tabButtons["code"].toggleClass("is-active", mode === "code");
    this.statusEl.setText(mode === "code" ? "Editing SVG source" : "Ready");
    if (mode === "code") this.codeArea.focus();
    return true;
  }
  /** Parse the code pane back into the canvas. Returns false on parse errors. */
  applyCode() {
    try {
      this.core.loadFromCode(this.codeArea.value);
      this.showCodeError(null);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.showCodeError(msg);
      new import_obsidian.Notice(`SVG Editor: ${msg}`);
      return false;
    }
  }
  showCodeError(msg) {
    this.codeErrorEl.setText(msg ?? "");
    this.codeErrorEl.toggleClass("is-visible", !!msg);
  }
  async save() {
    if (this.mode === "code" && !this.applyCode()) return;
    const source = this.core.serialize(true);
    try {
      await this.onSaveCb(source);
    } finally {
      this.close();
    }
  }
  onClose() {
    this.compactQuery.removeEventListener("change", this.updateCompact);
    this.core?.destroy();
    this.contentEl.empty();
  }
};

// src/selftest.ts
var import_obsidian2 = require("obsidian");
var REPORT_PATH = "SVGE-SelfTest-Report.md";
var TARGET_PATH = "SVGE-SelfTest-Target.md";
var sleep = (ms) => new Promise((r) => window.setTimeout(r, ms));
var hiddenHost = () => activeDocument.body.createDiv({ cls: "svge-selftest-host" });
function firePointer(target, type, x, y, opts = {}) {
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
      ...opts
    })
  );
}
async function runSelfTest(plugin) {
  const results = [];
  const check = (name, pass, detail = "") => {
    results.push({ name, pass, detail });
  };
  let modal = null;
  let savedSource = "";
  try {
    modal = new SvgEditorModal(plugin.app, "", (src) => {
      savedSource = src;
    });
    modal.open();
    await sleep(150);
    const core = modal.core;
    const svg = core.svgEl;
    const rect = svg.getBoundingClientRect();
    check("modal canvas renders", rect.width > 50 && rect.height > 50, `${Math.round(rect.width)}\xD7${Math.round(rect.height)}`);
    const pt = (fx, fy) => ({
      x: rect.left + rect.width * fx,
      y: rect.top + rect.height * fy
    });
    const drag = (from, to) => {
      firePointer(svg, "pointerdown", from.x, from.y);
      firePointer(window, "pointermove", (from.x + to.x) / 2, (from.y + to.y) / 2);
      firePointer(window, "pointermove", to.x, to.y);
      firePointer(window, "pointerup", to.x, to.y);
    };
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
    modal.setTool("select");
    const shape = core.contentChildren()[0];
    const sr = shape.getBoundingClientRect();
    const edge = { x: sr.left + 1, y: sr.top + sr.height / 2 };
    firePointer(shape, "pointerdown", edge.x, edge.y);
    firePointer(window, "pointermove", edge.x + 30, edge.y + 20);
    firePointer(window, "pointerup", edge.x + 30, edge.y + 20);
    check("click selects shape", core.selection.length === 1, `selection=${core.selection.length}`);
    check("drag moves shape (transform set)", (shape.getAttribute("transform") ?? "").includes("translate"), shape.getAttribute("transform") ?? "(none)");
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
    const before = shape.getAttribute("stroke");
    core.setStyle({ stroke: "#ff0000" });
    check("style change applies to selection", shape.getAttribute("stroke") === "#ff0000", `${before} \u2192 ${shape.getAttribute("stroke")}`);
    core.undo();
    const strokeAfterUndo = core.contentChildren()[0]?.getAttribute("stroke");
    check("undo reverts style change", strokeAfterUndo === before, `stroke=${strokeAfterUndo}`);
    core.redo();
    const strokeAfterRedo = core.contentChildren()[0]?.getAttribute("stroke");
    check("redo re-applies style change", strokeAfterRedo === "#ff0000", `stroke=${strokeAfterRedo}`);
    modal.setTool("select");
    core.selectAll();
    const countBefore = core.contentChildren().length;
    core.deleteSelection();
    check("delete selection empties canvas", core.contentChildren().length === 0, `${countBefore} \u2192 0`);
    core.undo();
    check("undo restores deleted shapes", core.contentChildren().length === countBefore, `count=${core.contentChildren().length}`);
    modal.setTool("rect");
    drag(pt(0.05, 0.45), pt(0.15, 0.55));
    drag(pt(0.25, 0.45), pt(0.35, 0.55));
    const preSweep = core.contentChildren().length;
    const [r1, r2] = core.contentChildren().slice(-2);
    const b1 = r1.getBoundingClientRect();
    const b2 = r2.getBoundingClientRect();
    modal.setTool("delete");
    firePointer(svg, "pointerdown", b1.left - 15, b1.top + b1.height / 2);
    firePointer(window, "pointermove", b1.left + 1, b1.top + b1.height / 2);
    firePointer(window, "pointermove", b2.left + 1, b2.top + b2.height / 2);
    firePointer(window, "pointerup", b2.right + 15, b2.top + b2.height / 2);
    check("delete tool sweep removes all swept shapes", core.contentChildren().length === preSweep - 2, `${preSweep} \u2192 ${core.contentChildren().length}`);
    core.undo();
    const restored = core.contentChildren();
    const sweptOpacityClean = restored.slice(-2).every((el) => (el.getAttribute("opacity") ?? "1") === "1" || el.getAttribute("opacity") === null);
    check("undo restores swept shapes without fade", restored.length === preSweep && sweptOpacityClean, `count=${restored.length}`);
    core.redo();
    check("redo re-applies sweep deletion", core.contentChildren().length === countBefore, `count=${core.contentChildren().length}`);
    const toCode = modal.setMode("code");
    check("switch to code mode", toCode && modal.codeArea.value.includes("<svg"), modal.codeArea.value.slice(0, 60));
    modal.codeArea.value = modal.codeArea.value.replace(
      "</svg>",
      '  <rect x="5" y="5" width="20" height="20" fill="#00aa00"/>\n</svg>'
    );
    const backToVisual = modal.setMode("visual");
    check("code edits parse back into visual mode", backToVisual && core.contentChildren().length === countBefore + 1, `count=${core.contentChildren().length}`);
    modal.setMode("code");
    const goodCode = modal.codeArea.value;
    modal.codeArea.value = "<svg><rect</svg>";
    const rejected = !modal.setMode("visual");
    check("invalid code rejected (stays in code mode)", rejected && modal.mode === "code", `mode=${modal.mode}`);
    modal.codeArea.value = goodCode;
    modal.setMode("visual");
    core.setCanvasSize(640, 480);
    check("canvas resize", core.serialize(true).includes('viewBox="0 0 640 480"'), core.serialize(true).split("\n")[0]);
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
    const vault2 = plugin.app.vault;
    const existingTarget = vault2.getAbstractFileByPath(TARGET_PATH);
    const targetBody = '# Self-test target\n\n```svg\n<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" stroke="#000000" fill="none"/></svg>\n```\n';
    if (existingTarget) {
      await vault2.adapter.write(TARGET_PATH, targetBody);
    } else {
      await vault2.create(TARGET_PATH, targetBody);
    }
    const oldInner = targetBody.split("\n")[3];
    const wrote = await plugin.replaceBlockInFile(TARGET_PATH, 2, 4, oldInner, savedSource);
    const newBody = await vault2.adapter.read(TARGET_PATH);
    check("write-back replaces block body", wrote && newBody.includes(savedSource.split("\n")[0]) && newBody.includes("```svg"), `wrote=${wrote}`);
    const wrote2 = await plugin.replaceBlockInFile(TARGET_PATH, 0, 1, savedSource, savedSource + "\n<!-- fallback -->");
    const body2 = await vault2.adapter.read(TARGET_PATH);
    check("stale section info falls back to search", wrote2 && body2.includes("<!-- fallback -->"), `wrote=${wrote2}`);
    const host = hiddenHost();
    const comp = new import_obsidian2.Component();
    try {
      await import_obsidian2.MarkdownRenderer.render(
        plugin.app,
        '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>\n```',
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
    const host2 = hiddenHost();
    const comp2 = new import_obsidian2.Component();
    try {
      await import_obsidian2.MarkdownRenderer.render(
        plugin.app,
        '```svg\n<svg xmlns="http://www.w3.org/2000/svg"><script>window.__svge_pwned=1<\/script><rect width="5" height="5" onclick="window.__svge_pwned=2"/></svg>\n```',
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
    const wasMobile = activeDocument.body.classList.contains("is-mobile");
    {
      let mModal = null;
      try {
        if (!wasMobile) activeDocument.body.classList.add("is-mobile");
        check(
          "mobile signal active",
          activeDocument.body.classList.contains("is-mobile"),
          wasMobile ? "real mobile UI" : "simulated via body class"
        );
        mModal = new SvgEditorModal(plugin.app, "", () => {
        });
        mModal.open();
        await sleep(150);
        const mEl = mModal.modalEl;
        check("compact layout class applied on mobile", mEl.classList.contains("svge-compact"), mEl.className);
        const mw = mEl.getBoundingClientRect().width;
        check("modal fills screen width on mobile", mw >= window.innerWidth * 0.95, `${Math.round(mw)} vs ${window.innerWidth}`);
        const tb = mEl.querySelector(".svge-toolbar").getBoundingClientRect();
        check("toolbar is horizontal on mobile", tb.width > tb.height, `${Math.round(tb.width)}\xD7${Math.round(tb.height)}`);
        const toolIcon = mEl.querySelector(".svge-tool svg")?.getBoundingClientRect();
        check(
          "tool icons keep full size under themed button padding",
          (toolIcon?.width ?? 0) >= 18,
          `icon=${Math.round(toolIcon?.width ?? 0)}px`
        );
        const mCore = mModal.core;
        const mSvg = mCore.svgEl;
        const mr = mSvg.getBoundingClientRect();
        const touch = { pointerType: "touch" };
        mModal.setTool("rect");
        firePointer(mSvg, "pointerdown", mr.left + mr.width * 0.2, mr.top + mr.height * 0.2, touch);
        firePointer(window, "pointermove", mr.left + mr.width * 0.5, mr.top + mr.height * 0.5, touch);
        firePointer(window, "pointerup", mr.left + mr.width * 0.5, mr.top + mr.height * 0.5, touch);
        check("touch pointer events draw a shape", mCore.contentChildren().length === 1, `count=${mCore.contentChildren().length}`);
        mModal.setTool("select");
        mCore.selectAll();
        const delBtn = mEl.querySelector('button[aria-label^="Delete selection"]');
        check("delete-selection button enables with selection", !!delBtn && !delBtn.disabled, delBtn ? `disabled=${delBtn.disabled}` : "button missing");
        delBtn?.click();
        check("delete-selection button removes shapes", mCore.contentChildren().length === 0, `count=${mCore.contentChildren().length}`);
        mModal.close();
        mModal = null;
        const host3 = hiddenHost();
        const comp3 = new import_obsidian2.Component();
        try {
          await import_obsidian2.MarkdownRenderer.render(
            plugin.app,
            '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>\n```',
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
    const FILE_PATH = "SVGE-SelfTest-File.svg";
    const fileBody = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="20" stroke="#000000" fill="none"/></svg>';
    const existingSvg = plugin.app.vault.getAbstractFileByPath(FILE_PATH);
    if (existingSvg instanceof import_obsidian2.TFile) {
      await plugin.app.vault.modify(existingSvg, fileBody);
    } else {
      await plugin.app.vault.create(FILE_PATH, fileBody);
    }
    const svgFile = plugin.app.vault.getAbstractFileByPath(FILE_PATH);
    check("svg file exists in vault", svgFile instanceof import_obsidian2.TFile, FILE_PATH);
    if (svgFile instanceof import_obsidian2.TFile) {
      let fModal = null;
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
      const host4 = hiddenHost();
      const comp4 = new import_obsidian2.Component();
      comp4.load();
      try {
        await import_obsidian2.MarkdownRenderer.render(plugin.app, `![[${FILE_PATH}]]`, host4, TARGET_PATH, comp4);
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
    const CONVERT_PATH = "SVGE-SelfTest-Convert.md";
    const blockSource = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">\n  <circle cx="20" cy="20" r="15" stroke="#aa0000" fill="none"/>\n</svg>';
    const convertBody = `# Convert test

\`\`\`svg
${blockSource}
\`\`\`
`;
    const existingConvert = plugin.app.vault.getAbstractFileByPath(CONVERT_PATH);
    if (existingConvert instanceof import_obsidian2.TFile) {
      await plugin.app.vault.modify(existingConvert, convertBody);
    } else {
      await plugin.app.vault.create(CONVERT_PATH, convertBody);
    }
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
      await plugin.app.fileManager.trashFile(attachment);
    }
    const host5 = hiddenHost();
    const comp5 = new import_obsidian2.Component();
    comp5.load();
    try {
      await import_obsidian2.MarkdownRenderer.render(
        plugin.app,
        `\`\`\`svg
${blockSource}
\`\`\`

![[${FILE_PATH}]]
`,
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
    const lpHost = hiddenHost();
    try {
      const lpEmbed = lpHost.createEl("div", {
        cls: "internal-embed",
        attr: { src: FILE_PATH }
      });
      const staleBtn = lpEmbed.createEl("button", { cls: "svge-edit-btn" });
      await sleep(120);
      check(
        "observer decorates live-preview embeds",
        !!lpEmbed.querySelector(":scope > .svge-convert-btn") && !!lpEmbed.querySelector(":scope > .svge-edit-btn:not(.svge-convert-btn)"),
        lpEmbed.className
      );
      check("stale buttons from old plugin instance replaced", !staleBtn.isConnected, "");
    } finally {
      lpHost.remove();
    }
    {
      let zModal = null;
      try {
        zModal = new SvgEditorModal(plugin.app, "", () => {
        });
        zModal.open();
        await sleep(150);
        const zCore = zModal.core;
        const zSvg = zCore.svgEl;
        const zr = zSvg.getBoundingClientRect();
        const zcx = zr.left + zr.width / 2;
        const zcy = zr.top + zr.height / 2;
        zSvg.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -300, clientX: zcx, clientY: zcy })
        );
        const wheelZoom = zCore.getZoom();
        const zrAfter = zSvg.getBoundingClientRect();
        check(
          "mouse wheel zooms the canvas in",
          wheelZoom > 1 && zrAfter.width > zr.width * 1.1,
          `zoom=${wheelZoom.toFixed(2)}, ${Math.round(zr.width)}px \u2192 ${Math.round(zrAfter.width)}px`
        );
        const zSrc = zCore.serialize(true);
        check(
          "zoom stays out of the saved source",
          !zSrc.includes("style=") && !zSrc.includes("svge") && zSrc.includes('width="480"'),
          zSrc.split("\n")[0] ?? ""
        );
        const resetBtn = zModal.modalEl.querySelector(".svge-zoom-value");
        resetBtn?.click();
        check(
          "zoom reset button returns to 100%",
          zCore.getZoom() === 1 && resetBtn?.textContent === "100%",
          `zoom=${zCore.getZoom()}, label=${resetBtn?.textContent}`
        );
        const preCount = zCore.contentChildren().length;
        zModal.setTool("rect");
        const t1 = { pointerId: 21, pointerType: "touch", isPrimary: true };
        const t2 = { pointerId: 22, pointerType: "touch", isPrimary: false };
        firePointer(zSvg, "pointerdown", zcx - 20, zcy, t1);
        firePointer(zSvg, "pointerdown", zcx + 20, zcy, t2);
        firePointer(window, "pointermove", zcx + 60, zcy, t2);
        const pinchZoom = zCore.getZoom();
        check("pinch gesture zooms in", pinchZoom > 1.5, `zoom=${pinchZoom.toFixed(2)}`);
        firePointer(window, "pointerup", zcx + 60, zcy, t2);
        firePointer(window, "pointerup", zcx - 20, zcy, t1);
        check(
          "second finger cancels the in-progress draw",
          zCore.contentChildren().length === preCount,
          `count=${zCore.contentChildren().length}`
        );
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
          `width=${zRectW}, expected\u2248${docW * 0.25}`
        );
      } finally {
        zModal?.close();
      }
    }
    {
      let pModal = null;
      try {
        pModal = new SvgEditorModal(plugin.app, "", () => {
        });
        pModal.open();
        await sleep(150);
        const pCore = pModal.core;
        const pSvg = pCore.svgEl;
        const wrap = pSvg.parentElement;
        pCore.setZoom(3);
        const wr = wrap.getBoundingClientRect();
        const wcx = wr.left + wr.width / 2;
        const wcy = wr.top + wr.height / 2;
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
          `scroll (${sl0},${st0}) \u2192 (${wrap.scrollLeft},${wrap.scrollTop})`
        );
        check(
          "middle-drag does not draw",
          pCore.contentChildren().length === preShapes,
          `count=${pCore.contentChildren().length}`
        );
        const zBefore = pCore.getZoom();
        const sl1 = wrap.scrollLeft;
        const st1 = wrap.scrollTop;
        const ta = { pointerId: 31, pointerType: "touch", isPrimary: true };
        const tb = { pointerId: 32, pointerType: "touch", isPrimary: false };
        firePointer(pSvg, "pointerdown", wcx - 25, wcy, ta);
        firePointer(pSvg, "pointerdown", wcx + 25, wcy, tb);
        firePointer(window, "pointermove", wcx - 75, wcy - 20, ta);
        firePointer(window, "pointermove", wcx - 25, wcy - 20, tb);
        firePointer(window, "pointerup", wcx - 75, wcy - 20, ta);
        firePointer(window, "pointerup", wcx - 25, wcy - 20, tb);
        check(
          "two-finger drag pans without zooming",
          pCore.getZoom() === zBefore && wrap.scrollLeft > sl1 + 25 && wrap.scrollTop > st1 + 2,
          `zoom=${pCore.getZoom().toFixed(2)}, scroll (${sl1},${st1}) \u2192 (${wrap.scrollLeft},${wrap.scrollTop})`
        );
        check(
          "visual-mode layout class set",
          pModal.modalEl.classList.contains("svge-mode-visual"),
          pModal.modalEl.className
        );
        pModal.setMode("code");
        check(
          "code-mode layout class set",
          pModal.modalEl.classList.contains("svge-mode-code") && !pModal.modalEl.classList.contains("svge-mode-visual"),
          pModal.modalEl.className
        );
      } finally {
        pModal?.close();
      }
    }
    {
      let rModal = null;
      try {
        rModal = new SvgEditorModal(plugin.app, "", () => {
        });
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
        const seHit = rSvg.querySelector('.svge-rhit[data-dir="se"]');
        const eHit = rSvg.querySelector('.svge-rhit[data-dir="e"]');
        check(
          "handles show directional resize cursors",
          getComputedStyle(seHit).cursor === "nwse-resize" && getComputedStyle(eHit).cursor === "ew-resize",
          `se=${getComputedStyle(seHit).cursor}, e=${getComputedStyle(eHit).cursor}`
        );
        const before2 = target.getBoundingClientRect();
        const hr = seHit.getBoundingClientRect();
        const hx = hr.left + hr.width / 2;
        const hy = hr.top + hr.height / 2;
        firePointer(seHit, "pointerdown", hx, hy);
        firePointer(window, "pointermove", hx + before2.width, hy + before2.height);
        firePointer(window, "pointerup", hx + before2.width, hy + before2.height);
        const after = target.getBoundingClientRect();
        check(
          "corner drag scales both axes",
          Math.abs(after.width - before2.width * 2) < 8 && Math.abs(after.height - before2.height * 2) < 8,
          `${Math.round(before2.width)}\xD7${Math.round(before2.height)} \u2192 ${Math.round(after.width)}\xD7${Math.round(after.height)}`
        );
        check(
          "resize keeps selection and uses a scale transform",
          rCore.selection.length === 1 && (target.getAttribute("transform") ?? "").includes("scale"),
          target.getAttribute("transform") ?? "(none)"
        );
        const b22 = target.getBoundingClientRect();
        const er = rSvg.querySelector('.svge-rhit[data-dir="e"]').getBoundingClientRect();
        const ex = er.left + er.width / 2;
        const ey = er.top + er.height * 0.25;
        firePointer(rSvg.querySelector('.svge-rhit[data-dir="e"]'), "pointerdown", ex, ey);
        firePointer(window, "pointermove", ex - b22.width / 2, ey);
        firePointer(window, "pointerup", ex - b22.width / 2, ey);
        const b3 = target.getBoundingClientRect();
        check(
          "edge drag scales one axis only",
          Math.abs(b3.height - b22.height) < 2 && b3.width < b22.width * 0.7,
          `w ${Math.round(b22.width)}\u2192${Math.round(b3.width)}, h ${Math.round(b22.height)}\u2192${Math.round(b3.height)}`
        );
        rCore.undo();
        rCore.undo();
        const b4 = rCore.contentChildren()[0]?.getBoundingClientRect();
        check(
          "undo reverts resizes",
          !!b4 && Math.abs(b4.width - before2.width) < 2 && Math.abs(b4.height - before2.height) < 2,
          `${Math.round(b4?.width ?? 0)}\xD7${Math.round(b4?.height ?? 0)} vs ${Math.round(before2.width)}\xD7${Math.round(before2.height)}`
        );
      } finally {
        rModal?.close();
      }
    }
  } catch (e) {
    check("self-test crashed", false, e instanceof Error ? `${e.message}
${e.stack ?? ""}` : String(e));
  } finally {
    modal?.close();
  }
  const passed = results.filter((r) => r.pass).length;
  const lines = [
    "# SVG Editor self-test report",
    "",
    `**${passed}/${results.length} checks passed** \u2014 ${passed === results.length ? "PASS" : "FAIL"}`,
    "",
    "| # | Check | Result | Detail |",
    "|---|-------|--------|--------|",
    ...results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.pass ? "\u2705 pass" : "\u274C FAIL"} | ${r.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`),
    ""
  ];
  const report = lines.join("\n");
  const vault = plugin.app.vault;
  if (vault.getAbstractFileByPath(REPORT_PATH)) {
    await vault.adapter.write(REPORT_PATH, report);
  } else {
    await vault.create(REPORT_PATH, report);
  }
  new import_obsidian2.Notice(`SVG Editor self-test: ${passed}/${results.length} passed`);
}

// src/main.ts
var SvgEditorPlugin = class extends import_obsidian3.Plugin {
  async onload() {
    this.registerMarkdownCodeBlockProcessor(
      "svg",
      (source, el, ctx) => this.renderSvgBlock(source, el, ctx)
    );
    this.registerMarkdownPostProcessor((el, ctx) => {
      for (const embed of Array.from(el.querySelectorAll(".internal-embed"))) {
        const src = embed.getAttribute("src");
        if (!src || !isSvgLink(src)) continue;
        ctx.addChild(new SvgEmbedDecorator(this, embed, src, ctx.sourcePath));
      }
    });
    const embedObserver = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        if (mut.target.instanceOf(HTMLElement) && mut.target.matches(".internal-embed")) {
          this.maybeDecorateEmbed(mut.target);
        }
        for (const node of Array.from(mut.addedNodes)) {
          if (!node.instanceOf(HTMLElement)) continue;
          if (node.matches(".internal-embed")) this.maybeDecorateEmbed(node);
          for (const embed of Array.from(node.querySelectorAll(".internal-embed"))) {
            this.maybeDecorateEmbed(embed);
          }
        }
      }
    });
    embedObserver.observe(activeDocument.body, { childList: true, subtree: true });
    this.register(() => embedObserver.disconnect());
    this.app.workspace.onLayoutReady(() => {
      for (const embed of Array.from(activeDocument.querySelectorAll(".internal-embed"))) {
        this.maybeDecorateEmbed(embed);
      }
    });
    this.register(() => {
      for (const btn of Array.from(activeDocument.querySelectorAll(".svge-file-embed > .svge-edit-btn"))) btn.remove();
      for (const el of Array.from(activeDocument.querySelectorAll(".svge-file-embed"))) el.removeClass("svge-file-embed");
    });
    this.registerDomEvent(activeDocument, "dblclick", (evt) => {
      const embed = evt.target?.closest?.(".internal-embed");
      if (!embed?.instanceOf(HTMLElement)) return;
      const src = embed.getAttribute("src");
      if (!src || !isSvgLink(src)) return;
      evt.preventDefault();
      void this.editSvgFileBySrc(src, this.app.workspace.getActiveFile()?.path ?? "");
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof import_obsidian3.TFile && file.extension.toLowerCase() === "svg") {
          menu.addItem(
            (item) => item.setTitle("Edit in SVG Editor").setIcon("pencil").onClick(() => void this.editSvgFile(file))
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
          editor.replaceRange(`${prefix}\`\`\`svg
${newSource}
\`\`\`
`, cur);
        }).open();
      }
    });
    this.addCommand({
      id: "edit-svg-at-cursor",
      name: "Edit SVG block at cursor",
      editorCallback: (editor) => this.editBlockAtCursor(editor)
    });
    this.addCommand({
      id: "self-test",
      name: "Run self-test (writes a report note)",
      callback: () => void runSelfTest(this)
    });
    this.addCommand({
      id: "toggle-mobile-emulation",
      name: "Toggle mobile emulation (dev \u2014 reloads the app)",
      checkCallback: (checking) => {
        const anyApp = this.app;
        if (typeof anyApp.emulateMobile !== "function") return false;
        if (!checking) anyApp.emulateMobile(!activeDocument.body.classList.contains("is-mobile"));
        return true;
      }
    });
  }
  // ------------------------------------------------------------------
  // Reading / live-preview rendering of ```svg blocks
  // ------------------------------------------------------------------
  renderSvgBlock(source, el, ctx) {
    el.addClass("svge-block");
    let parsedOk = false;
    if (source.trim()) {
      try {
        const svg = parseSvgSource(source);
        el.appendChild(el.doc.importNode(svg, true));
        parsedOk = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        el.createDiv({ cls: "svge-block-error", text: `Invalid SVG: ${msg}` });
      }
    } else {
      el.createDiv({ cls: "svge-block-empty", text: "Empty SVG \u2014 click to draw" });
    }
    const openEditor = () => {
      const info = ctx.getSectionInfo(el);
      if (!info) {
        new import_obsidian3.Notice("SVG Editor: cannot locate this block in the note (try editing in source mode).");
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
        if (!ok) new import_obsidian3.Notice("SVG Editor: could not write changes back \u2014 the note changed under us.");
      }).open();
    };
    const btn = el.createEl("button", {
      cls: "svge-edit-btn",
      attr: { "aria-label": "Edit SVG" }
    });
    (0, import_obsidian3.setIcon)(btn, "pencil");
    btn.addEventListener("click", openEditor);
    el.addEventListener("dblclick", openEditor);
    if (parsedOk) {
      const convertBtn = el.createEl("button", {
        cls: "svge-edit-btn svge-convert-btn",
        attr: { "aria-label": "Convert to embedded .svg file" }
      });
      (0, import_obsidian3.setIcon)(convertBtn, "file-output");
      convertBtn.addEventListener("click", () => {
        const info = ctx.getSectionInfo(el);
        if (!info) {
          new import_obsidian3.Notice("SVG Editor: cannot locate this block in the note.");
          return;
        }
        void this.convertBlockToEmbed(ctx.sourcePath, info.lineStart, info.lineEnd, source);
      });
    }
  }
  /**
   * Replace the body of the ```svg block spanning [lineStart, lineEnd]
   * (fence lines inclusive). Falls back to searching for a unique block
   * whose body matches oldSource if the recorded lines have drifted.
   */
  async replaceBlockInFile(path, lineStart, lineEnd, oldSource, newSource) {
    return this.rewriteBlock(path, lineStart, lineEnd, oldSource, (lines, s, e) => [
      ...lines.slice(0, s + 1),
      ...newSource.split("\n"),
      ...lines.slice(e)
    ]);
  }
  /**
   * Locate the ```svg block spanning [lineStart, lineEnd] (with the same
   * stale-line fallback as replaceBlockInFile) and rebuild the note's lines.
   */
  async rewriteBlock(path, lineStart, lineEnd, oldSource, rebuild) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian3.TFile)) return false;
    let ok = false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split("\n");
      const openFenceRe = /^\s*(`{3,}|~{3,})\s*svg\s*$/i;
      const matchesAt = (s2, e2) => s2 >= 0 && e2 < lines.length && e2 > s2 && openFenceRe.test(lines[s2]) && lines.slice(s2 + 1, e2).join("\n").trim() === oldSource.trim();
      let s = lineStart;
      let e = lineEnd;
      if (!matchesAt(s, e)) {
        const candidates = [];
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
      return rebuild(lines, s, e).join("\n");
    });
    return ok;
  }
  // ------------------------------------------------------------------
  // Embedded .svg file editing
  // ------------------------------------------------------------------
  /** Resolve an embed/link target like "drawing.svg#hash" and open it. */
  async editSvgFileBySrc(src, sourcePath) {
    const linkpath = src.split("#")[0].trim();
    const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (!file) {
      new import_obsidian3.Notice(`SVG Editor: cannot resolve "${linkpath}".`);
      return null;
    }
    return this.editSvgFile(file);
  }
  /** Open the editor on a vault .svg file; Save writes the file back. */
  async editSvgFile(file) {
    const source = await this.app.vault.read(file);
    const modal = new SvgEditorModal(this.app, source, async (newSource) => {
      await this.app.vault.process(file, () => newSource);
      this.refreshEmbedsOf(file);
    });
    modal.open();
    return modal;
  }
  /** Decorate an .internal-embed element if it embeds an .svg file. */
  maybeDecorateEmbed(el) {
    const src = el.getAttribute("src");
    if (!src || !isSvgLink(src)) return;
    this.decorateSvgEmbed(el, src, () => this.app.workspace.getActiveFile()?.path ?? "");
  }
  /**
   * Add the edit + convert buttons to an svg embed. Idempotent; also
   * replaces stale buttons left behind by an earlier plugin instance.
   */
  decorateSvgEmbed(el, src, getSourcePath) {
    if (el.querySelector(":scope > .svge-convert-btn")) return;
    for (const stale of Array.from(el.querySelectorAll(":scope > .svge-edit-btn"))) stale.remove();
    el.addClass("svge-file-embed");
    const editBtn = el.createEl("button", {
      cls: "svge-edit-btn",
      attr: { "aria-label": "Edit SVG file" }
    });
    (0, import_obsidian3.setIcon)(editBtn, "pencil");
    editBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.editSvgFileBySrc(src, getSourcePath());
    });
    const convertBtn = el.createEl("button", {
      cls: "svge-edit-btn svge-convert-btn",
      attr: { "aria-label": "Convert to inline svg block" }
    });
    (0, import_obsidian3.setIcon)(convertBtn, "code");
    convertBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.convertEmbedToBlock(src, getSourcePath());
    });
  }
  // ------------------------------------------------------------------
  // Inline block ⇄ embedded file conversion
  // ------------------------------------------------------------------
  /**
   * Save an inline ```svg block as a vault .svg file and replace the whole
   * block (fences included) with an embed link. Returns the created file.
   */
  async convertBlockToEmbed(sourcePath, lineStart, lineEnd, source) {
    let file;
    try {
      file = await this.createSvgAttachment(source, sourcePath);
    } catch (e) {
      new import_obsidian3.Notice(`SVG Editor: could not create the .svg file: ${e instanceof Error ? e.message : e}`);
      return null;
    }
    const embed = this.embedLinkFor(file, sourcePath);
    const ok = await this.rewriteBlock(sourcePath, lineStart, lineEnd, source, (lines, s, e) => [
      ...lines.slice(0, s),
      embed,
      ...lines.slice(e + 1)
    ]);
    if (!ok) {
      await this.app.fileManager.trashFile(file);
      new import_obsidian3.Notice("SVG Editor: could not rewrite the note \u2014 the block changed under us.");
      return null;
    }
    new import_obsidian3.Notice(`Saved to ${file.path}`);
    return file;
  }
  /**
   * Replace an ![[file.svg]] embed in the note with an inline ```svg block
   * containing the file's source. The .svg file itself is kept.
   */
  async convertEmbedToBlock(src, sourcePath) {
    const linkpath = src.split("#")[0].trim();
    const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (!file) {
      new import_obsidian3.Notice(`SVG Editor: cannot resolve "${linkpath}".`);
      return false;
    }
    const note = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(note instanceof import_obsidian3.TFile)) {
      new import_obsidian3.Notice("SVG Editor: cannot locate the containing note.");
      return false;
    }
    const source = (await this.app.vault.read(file)).trim();
    let converted = false;
    let total = 0;
    await this.app.vault.process(note, (data) => {
      const re = /!\[\[([^\]]+)\]\]/g;
      const hits = [];
      for (let m = re.exec(data); m; m = re.exec(data)) {
        const target = m[1].split(/[|#]/)[0].trim();
        const resolved = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
        if (resolved?.path === file.path) hits.push({ start: m.index, end: m.index + m[0].length });
      }
      total = hits.length;
      if (total === 0) return data;
      converted = true;
      const { start, end } = hits[0];
      const block = `\`\`\`svg
${source}
\`\`\``;
      const lineStart = data.lastIndexOf("\n", start - 1) + 1;
      const lineEnd = data.indexOf("\n", end);
      const line = data.slice(lineStart, lineEnd === -1 ? data.length : lineEnd);
      const alone = line.trim() === data.slice(start, end);
      return data.slice(0, start) + (alone ? block : `
${block}
`) + data.slice(end);
    });
    if (!converted) {
      new import_obsidian3.Notice("SVG Editor: could not find this embed's link in the note.");
    } else {
      new import_obsidian3.Notice(
        total > 1 ? `Converted the first of ${total} embeds of this file (the .svg file was kept).` : `Converted to an inline svg block (${file.path} was kept).`
      );
    }
    return converted;
  }
  /** Pick an attachment path for a new drawing next to the note's attachments. */
  async createSvgAttachment(source, sourcePath) {
    const noteName = sourcePath.split("/").pop()?.replace(/\.md$/i, "") || "Drawing";
    const fm = this.app.fileManager;
    let path;
    if (typeof fm.getAvailablePathForAttachment === "function") {
      path = await fm.getAvailablePathForAttachment(`${noteName} drawing.svg`, sourcePath);
    } else {
      let i = 0;
      do {
        path = `${noteName} drawing${i ? ` ${i}` : ""}.svg`;
        i++;
      } while (this.app.vault.getAbstractFileByPath(path));
    }
    return this.app.vault.create(path, source);
  }
  /** An embed link to the file, respecting the user's link format. */
  embedLinkFor(file, sourcePath) {
    const link = this.app.fileManager.generateMarkdownLink(file, sourcePath);
    return link.startsWith("!") ? link : `!${link}`;
  }
  /** Re-point every rendered <img> of this file at its new content. */
  refreshEmbedsOf(file) {
    const fresh = this.app.vault.getResourcePath(file);
    const base = fresh.split("?")[0];
    for (const img of Array.from(activeDocument.querySelectorAll("img"))) {
      if (img.src.split("?")[0] === base) img.src = fresh;
    }
  }
  // ------------------------------------------------------------------
  // Source-mode editing
  // ------------------------------------------------------------------
  editBlockAtCursor(editor) {
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
      new import_obsidian3.Notice("SVG Editor: cursor is not inside a ```svg code block.");
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
      new import_obsidian3.Notice("SVG Editor: cursor is not inside a ```svg code block.");
      return;
    }
    const source = editor.getRange({ line: open + 1, ch: 0 }, { line: close, ch: 0 }).replace(/\n$/, "");
    new SvgEditorModal(this.app, source, (newSource) => {
      editor.replaceRange(`${newSource}
`, { line: open + 1, ch: 0 }, { line: close, ch: 0 });
    }).open();
  }
};
function isSvgLink(src) {
  return /\.svg$/i.test(src.split("#")[0].trim());
}
var SvgEmbedDecorator = class extends import_obsidian3.MarkdownRenderChild {
  constructor(plugin, containerEl, src, sourcePath) {
    super(containerEl);
    this.plugin = plugin;
    this.src = src;
    this.sourcePath = sourcePath;
    this.observer = null;
  }
  onload() {
    this.decorate();
    this.observer = new MutationObserver(() => this.decorate());
    this.observer.observe(this.containerEl, { childList: true });
  }
  onunload() {
    this.observer?.disconnect();
    this.observer = null;
  }
  decorate() {
    this.plugin.decorateSvgEmbed(this.containerEl, this.src, () => this.sourcePath);
  }
};
