# Obsidian SVG Editor

An Obsidian plugin that turns ```` ```svg ```` code blocks into inline drawings you can edit **visually** — modeled on the vanilla-JS [Javascript-SVG-editor](../Javascript-SVG-editor) — with a **code mode** for editing the raw SVG source.

## Features

- Renders ```` ```svg ```` fenced code blocks as inline SVG in reading and live-preview modes (sanitized: scripts, event handlers and `javascript:` URLs are stripped).
- Hover a rendered block and click the pencil button (or double-click) to open the editor; **Save** writes the SVG back into the note.
- **Visual mode**
  - Tools: select & move (`V`), line (`L`), circle (`C`), rectangle (`R`), freehand scribble (`P`), delete (`X` — click a shape, or press and sweep over several; they fade as they're marked and are removed on release)
  - Click / shift-click / marquee (rubber-band) selection; drag to move; `Delete` removes the selection; `Ctrl/Cmd+A` selects all
  - Stroke color & width, fill color with "none" toggle, opacity — applied to new shapes or to the current selection
  - Undo / redo (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`), clear canvas, canvas size controls
- **Code mode** — edit the SVG source in a textarea; parse errors are shown and rejected without losing your drawing. Switching tabs keeps both views in sync.
- `Ctrl/Cmd+Enter` saves from either mode.
- **Mobile friendly** — works on Obsidian mobile: touch drawing (single-finger gestures; extra touches are ignored), a full-screen editor with a horizontal toolbar and finger-sized buttons on phones/narrow windows, an on-screen delete-selection button, and an always-visible edit button on rendered blocks (no hover on touch screens).

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

## Development / testing with the obsidian CLI

```bash
node esbuild.config.mjs production
cp main.js styles.css "<vault>/.obsidian/plugins/svg-editor/"
obsidian vault=<name> plugin:reload id=svg-editor
obsidian vault=<name> command id=svg-editor:self-test
obsidian vault=<name> read path=SVGE-SelfTest-Report.md
```

The self-test opens the real modal, draws each shape with synthetic pointer events, exercises select/move, sweep-to-delete, styling, undo/redo, code-mode round-trips, invalid-code rejection, canvas resize, save, write-back into a real note (including the stale-line fallback search), the markdown renderer, sanitization, and the mobile behavior (compact layout, touch drawing, delete button, visible edit button) — and reports PASS/FAIL per check. The mobile checks run against the real mobile UI when the app is mobile/emulated, and against a simulated `is-mobile` body class on desktop; the test itself never toggles emulation because `app.emulateMobile()` reloads the app window.

## Layout

- `src/editor.ts` — `SvgEditorCore`: framework-free canvas engine (tools, selection, history, (de)serialization, sanitization)
- `src/modal.ts` — `SvgEditorModal`: the dialog with Visual/Code tabs, toolbar, style controls
- `src/main.ts` — plugin entry: ```` ```svg ```` block processor, note write-back, commands
- `src/selftest.ts` — in-app end-to-end test
- `styles.css` — all styling, themed with Obsidian CSS variables
