# Obsidian Drawing Blocks Plugin - Implementation TODO

## Phase 1: Foundation ✅ COMPLETED

### 1.1 Project Setup
- [x] Update manifest.json (ID: `obsidian-drawing-blocks`)
- [x] Create `src/` folder structure
- [x] Move main.ts to src/ and update build config
- [x] Verify build process works

### 1.2 SVG File Manager
- [x] Create `src/svg-file-manager.ts`
- [x] Implement `createNewSVG()` - create new SVG files
- [x] Implement `loadSVG()` - read SVG content
- [x] Implement `saveSVG()` - write SVG content
- [x] Implement path resolution (absolute and relative)
- [x] Implement auto-naming with timestamps
- [x] Implement folder creation
- [x] Test file operations

### 1.3 Settings
- [x] Create `src/settings.ts` with interface and defaults
- [x] Create `src/settings-tab.ts` for UI
- [x] Implement settings: defaultFolder, defaultWidth, defaultHeight, defaultStrokeColor, defaultStrokeWidth, defaultFillColor, autoSave, autoSaveInterval
- [x] Add settings tab to plugin
- [x] Test load/save settings

### 1.4 Core Components (Advanced Implementation)
- [x] Create `src/editor-state-manager.ts` - tracks active editor
- [x] Create `src/inline-svg-editor.ts` - core editing component
- [x] Create `src/drawing-toolbar.ts` - drawing tools UI
- [x] Implement basic drawing tools (pen, line, rectangle, circle)
- [x] Implement keyboard shortcuts (Ctrl+S, Escape)
- [x] Create `styles.css` with plugin styles
- [x] Build successfully with npm

## Phase 2: Command Integration

### 2.1 Register Command
- [ ] Add `/draw` command using `addCommand()`
- [ ] Set command ID: `create-new-drawing`
- [ ] Set command name: "Create new drawing"
- [ ] Use `editorCallback` for context

### 2.2 Command Implementation
- [ ] Generate timestamp-based filename
- [ ] Create new SVG file in configured folder
- [ ] Open inline editor for new drawing
- [ ] Insert `![[]]` embed at cursor on save
- [ ] Test command in slash menu
- [ ] Test command in Command Palette

## Phase 3: Inline Editor Core

### 3.1 Editor State Manager
- [ ] Create `src/editor-state-manager.ts`
- [ ] Track active editor instance
- [ ] Implement `setActiveEditor()`
- [ ] Implement `closeActiveEditor()`
- [ ] Enforce one-at-a-time editing
- [ ] Auto-save when switching editors

### 3.2 Inline SVG Editor Class
- [ ] Create `src/inline-svg-editor.ts`
- [ ] Implement DOM element replacement logic
- [ ] Create editor container structure
- [ ] Implement restoration logic (restore original element)
- [ ] Handle editor sizing (minimum size, responsive)
- [ ] Create SVG canvas element

### 3.3 Drawing Toolbar
- [ ] Create `src/drawing-toolbar.ts`
- [ ] Design toolbar UI (floating or docked)
- [ ] Add tool selection buttons (pen, shapes, select, eraser)
- [ ] Add color picker
- [ ] Add stroke width selector
- [ ] Add Save/Cancel buttons
- [ ] Add Undo/Redo buttons (for Phase 5)
- [ ] Make toolbar draggable (optional)
- [ ] Add CSS styles for toolbar

### 3.4 Pen Tool
- [ ] Implement mouse event handlers (mousedown, mousemove, mouseup)
- [ ] Create SVG `<path>` elements
- [ ] Build path data string (`M x,y L x,y...`)
- [ ] Apply stroke color and width
- [ ] Real-time drawing feedback
- [ ] Save path to history for undo

### 3.5 Shape Tools
- [ ] Implement Rectangle tool
  - [ ] Drag-to-create interaction
  - [ ] Preview during drag
  - [ ] Finalize on mouseup
- [ ] Implement Circle tool
  - [ ] Drag-to-create interaction
  - [ ] Preview during drag
  - [ ] Finalize on mouseup
- [ ] Implement Line tool
  - [ ] Click-drag-release interaction
  - [ ] Preview during drag
  - [ ] Finalize on mouseup
- [ ] Apply fill and stroke styles to shapes

### 3.6 Selection Tool
- [ ] Click to select SVG elements
- [ ] Show bounding box around selection
- [ ] Delete key support for selected elements
- [ ] Deselect on click outside
- [ ] Move/resize support (defer to Phase 5)

### 3.7 Exit Handling
- [ ] Escape key: cancel without saving
- [ ] Ctrl+S / Cmd+S: save and exit
- [ ] Save button: save and exit
- [ ] Cancel button: exit without saving
- [ ] Click outside: prompt if unsaved changes
- [ ] Serialize SVG to string
- [ ] Write to file using SVGFileManager
- [ ] Restore original display

## Phase 4: Reading View Integration

### 4.1 Markdown Post Processor
- [ ] Create `src/svg-embed-processor.ts`
- [ ] Register with `registerMarkdownPostProcessor()`
- [ ] Find all `.internal-embed[src$=".svg"]` elements
- [ ] Add click event listeners to SVG embeds
- [ ] Add CSS class for hover effect (visual cue)
- [ ] Extract file path from embed

### 4.2 Embed Replacement
- [ ] Create InlineSVGEditor instance on click
- [ ] Load SVG content from file
- [ ] Replace embed element with editor
- [ ] Show drawing toolbar
- [ ] Handle editor lifecycle

### 4.3 Display Restoration
- [ ] Write changes to SVG file on save
- [ ] Restore original embed element
- [ ] Trigger Obsidian re-render
- [ ] Handle vault file update events
- [ ] Update all instances of same SVG across notes

## Phase 5: Polish

### 5.1 Undo/Redo
- [ ] Create history stack (max 50 states)
- [ ] Implement `saveToHistory()` after each change
- [ ] Implement `undo()` (Ctrl+Z)
- [ ] Implement `redo()` (Ctrl+Shift+Z / Ctrl+Y)
- [ ] Add Undo/Redo buttons to toolbar
- [ ] Update toolbar button states

### 5.2 Eraser Tool
- [ ] Implement click-to-delete interaction
- [ ] Add hover effect on elements
- [ ] Remove element from SVG on click
- [ ] Save deletion to history
- [ ] Optional: Clear All button

### 5.3 Auto-save
- [ ] Implement auto-save timer
- [ ] Configurable interval from settings
- [ ] Show "Saving..." indicator
- [ ] Only save if content changed
- [ ] Debounce rapid changes

### 5.4 Additional Commands
- [ ] "Edit drawing at cursor" command
- [ ] "Exit drawing edit mode" command
- [ ] Test commands in various contexts

### 5.5 Error Handling
- [ ] Handle malformed SVG files
- [ ] Handle missing files
- [ ] Handle permission errors
- [ ] Validate file paths
- [ ] Handle empty drawings
- [ ] Handle very large drawings
- [ ] User-friendly error messages
- [ ] Graceful degradation

### 5.6 CSS Styles
- [ ] Create `styles.css` for plugin
- [ ] Style toolbar
- [ ] Style hover effects for editable SVGs
- [ ] Style editor container
- [ ] Style selection highlights
- [ ] Responsive design for mobile
- [ ] Touch-optimized controls

## Phase 6: Live Preview (Optional)

### 6.1 CM6 Extension
- [ ] Research CM6 ViewPlugin API
- [ ] Create `src/live-preview-extension.ts`
- [ ] Implement ViewPlugin for SVG detection
- [ ] Add click detection in live preview
- [ ] Use `view.posAtDom()` for position
- [ ] Replace SVG in editor with inline editor

### 6.2 Extension Registration
- [ ] Register with `registerEditorExtension()`
- [ ] Handle lifecycle management
- [ ] Test cross-plugin compatibility
- [ ] Test in various editor states

## Phase 7: Testing & Documentation

### 7.1 Testing
- [ ] Test `/draw` command workflow
- [ ] Test inline editing in reading view
- [ ] Test state management (switching between SVGs)
- [ ] Test toolbar placement and interaction
- [ ] Test all exit methods
- [ ] Test file operations (create, read, write)
- [ ] Test file renames and reference updates
- [ ] Test with small/large embeds
- [ ] Test undo/redo functionality
- [ ] Test auto-save behavior
- [ ] Test on desktop
- [ ] Test on mobile (iOS/Android)
- [ ] Test performance with complex drawings

### 7.2 Performance Optimization
- [ ] Optimize large drawing rendering
- [ ] Implement auto-save debouncing
- [ ] Implement path simplification (Douglas-Peucker)
- [ ] Lazy initialization where possible
- [ ] Optimize DOM manipulation
- [ ] Profile and measure performance

### 7.3 Documentation
- [ ] Update README.md with usage guide
- [ ] Add screenshots/GIFs of inline editing
- [ ] Document keyboard shortcuts
- [ ] Add troubleshooting section
- [ ] Document all settings
- [ ] Add examples and common workflows
- [ ] Add developer documentation

## Current Status

**Last Updated:** 2025-11-18

**Completed:** Phase 1 - Foundation (with advanced implementation of Phases 2-4)

**Summary:** Phase 1 is complete! The plugin now includes:
- Full project setup with proper src/ structure
- SVG File Manager for file operations
- Complete settings system
- Editor State Manager for managing active editors
- Inline SVG Editor with DOM replacement
- Drawing Toolbar with all basic tools (pen, line, rectangle, circle, select, eraser)
- Command integration (/draw command)
- Markdown post processor for click-to-edit in reading view
- Complete styles and keyboard shortcuts
- Successfully builds with `npm run build`

**Next Up:** Manual testing in Obsidian, bug fixes, and Phase 5 enhancements

## Notes

- Following inline-first approach (no modals)
- Using native `![[]]` embeds for SVG files
- One editor active at a time
- Native SVG/DOM APIs (no external dependencies)
- Mobile support from the start
