# CLAUDE.md

Obsidian plugin that renders ```` ```svg ```` code blocks and embedded `.svg` files as inline drawings with a visual editor. See README.md for features and the source layout.

## Build & test

- `npm run build` — typecheck (`tsc --noEmit`) + esbuild bundle to `main.js`.
- The only test suite is the in-app self-test (`src/selftest.ts`), run in a live vault:

  ```bash
  cp main.js styles.css manifest.json "<vault>/.obsidian/plugins/svg-editor/"
  obsidian vault=<name> plugin:reload id=svg-editor
  obsidian vault=<name> command id=svg-editor:self-test
  obsidian vault=<name> read path=SVGE-SelfTest-Report.md
  ```

  New features get a section in the self-test.

## Conventions

- **Prefer Obsidian's native APIs over raw DOM/web APIs whenever possible**:
  - `createEl` / `createDiv` / `createSpan` / `createSvg` (available on every `Node`) instead of `document.createElement` / `createElementNS`.
  - `el.doc` / `el.win` instead of the `document` / `window` globals, and `activeDocument` / `activeWindow` when there is no element to anchor to — required for pop-out window support.
  - `setIcon` for icons, `Notice` for toasts, `this.scope.register` for modal hotkeys, and the `vault` / `fileManager` APIs for file access.
- Version bumps touch `manifest.json`, `package.json` and `versions.json` together; releases are cut by pushing a matching tag (CI does the rest).
