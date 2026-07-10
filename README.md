# Obsidian SVG Editor

An Obsidian plugin that turns ```` ```svg ```` code blocks and embedded `.svg` files into inline drawings you can edit **visually** — modeled on the vanilla-JS Javascript-SVG-editor — with a **code mode** for editing the raw SVG source.

## Features

- Renders ```` ```svg ```` fenced code blocks as inline SVG in reading and live-preview modes (sanitized: scripts, event handlers and `javascript:` URLs are stripped).
- Hover a rendered block and click the pencil button (or double-click) to open the editor; **Save** writes the SVG back into the note.
- **Embedded `.svg` files** — `![[drawing.svg]]` embeds get the same pencil button in reading mode; double-clicking an embedded svg image works in any mode, and `.svg` files get an **Edit in SVG Editor** entry in the file explorer's context menu. Save writes the `.svg` file back and refreshes every visible embed of it.
- **Convert between the two** — a second hover button on each: on an inline block it saves the drawing as a `.svg` file in the vault (named after the note, placed per your attachment settings) and replaces the block with an embed link; on an embed it inlines the file's source as a ```` ```svg ```` block (the `.svg` file is kept).
- **Visual mode**
  - Tools: select & move (`V`), line (`L`), circle (`C`), rectangle (`R`), freehand scribble (`P`), delete (`X` — click a shape, or press and sweep over several; they fade as they're marked and are removed on release)
  - Click / shift-click / marquee (rubber-band) selection; drag to move; resize by dragging the selection box's edges or corner/edge handles; `Delete` removes the selection; `Ctrl/Cmd+A` selects all
  - Stroke color & width, fill color with "none" toggle, opacity — applied to new shapes or to the current selection
  - Undo / redo (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`), clear canvas, canvas size controls
  - **Zoom & pan** — mouse wheel over the canvas zooms around the cursor and middle-button drag pans; on touch screens pinch to zoom and drag with two fingers to pan (a second finger cancels the stroke in progress). Plus zoom buttons and `Ctrl/Cmd+=` / `Ctrl/Cmd+-` / `Ctrl/Cmd+0`. Zoom and pan are view-only and never change the saved SVG.
- **Code mode** — edit the SVG source in a textarea; parse errors are shown and rejected without losing your drawing. Switching tabs keeps both views in sync.
- `Ctrl/Cmd+Enter` saves from either mode.
- **Mobile friendly** — works on Obsidian mobile: touch drawing (single-finger gestures; two fingers pinch-zoom and pan), a full-screen editor with a horizontal toolbar and finger-sized buttons on phones/narrow windows, an on-screen delete-selection button, and an always-visible edit button on rendered blocks (no hover on touch screens). In landscape (or any short window) the header, tool strip and properties bar float translucently over the canvas so the drawing gets the full screen height.

## Commands

| Command | What it does |
|---|---|
| `SVG Editor: Insert new SVG drawing` | Opens a blank editor; Save inserts a ```` ```svg ```` block at the cursor |
| `SVG Editor: Edit SVG block at cursor` | Opens the editor for the fenced ```` ```svg ```` block under the cursor (source mode) |
| `SVG Editor: Run self-test (writes a report note)` | End-to-end test that drives the real UI with synthetic pointer events and writes `SVGE-SelfTest-Report.md` |
| `SVG Editor: Toggle mobile emulation (dev — reloads the app)` | Desktop only: flips Obsidian's built-in mobile emulation to test the mobile UI. The app window reloads and the setting persists until toggled back |

## Install (manual)

```bash
npm install
npm run build   # or: node esbuild.config.mjs production
mkdir -p "<vault>/.obsidian/plugins/svg-editor"
cp manifest.json main.js styles.css "<vault>/.obsidian/plugins/svg-editor/"
```

Then enable **SVG Editor** in *Settings → Community plugins* (or `obsidian plugin:enable id=svg-editor` with the obsidian CLI).

## Releases

Versioned releases are automated: pushing a tag that matches `manifest.json`'s
version builds the plugin in CI and publishes a GitHub release with
`manifest.json`, `main.js` and `styles.css` attached (what BRAT and the
community directory consume). To cut a release:

```bash
npm version patch        # or minor/major — also syncs manifest.json + versions.json
git push && git push --tags
```

## Development / testing with the obsidian CLI

```bash
node esbuild.config.mjs production
cp main.js styles.css "<vault>/.obsidian/plugins/svg-editor/"
obsidian vault=<name> plugin:reload id=svg-editor
obsidian vault=<name> command id=svg-editor:self-test
obsidian vault=<name> read path=SVGE-SelfTest-Report.md
```

The self-test opens the real modal, draws each shape with synthetic pointer events, exercises select/move, sweep-to-delete, styling, undo/redo, code-mode round-trips, invalid-code rejection, canvas resize, save, write-back into a real note (including the stale-line fallback search), the markdown renderer, sanitization, the mobile behavior (compact layout, touch drawing, delete button, visible edit button), `.svg` file editing (load, save back to the file, embed decoration), zoom (wheel, pinch, reset, coordinate mapping while zoomed, and that zoom never leaks into the saved source), and panning (middle-button drag, two-finger drag) — and reports PASS/FAIL per check. The mobile checks run against the real mobile UI when the app is mobile/emulated, and against a simulated `is-mobile` body class on desktop; the test itself never toggles emulation because `app.emulateMobile()` reloads the app window.

## Layout

- `src/editor.ts` — `SvgEditorCore`: framework-free canvas engine (tools, selection, history, (de)serialization, sanitization)
- `src/modal.ts` — `SvgEditorModal`: the dialog with Visual/Code tabs, toolbar, style controls
- `src/main.ts` — plugin entry: ```` ```svg ```` block processor, note write-back, commands
- `src/selftest.ts` — in-app end-to-end test
- `styles.css` — all styling, themed with Obsidian CSS variables
