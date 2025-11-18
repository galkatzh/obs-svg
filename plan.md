# Obsidian Drawing Blocks Plugin - Implementation Plan

## Overview

This plugin enables users to create and edit SVG drawings directly within their Obsidian notes using **inline editing**. Every drawing is stored as an SVG file in the vault and embedded using Obsidian's native `![[file.svg]]` syntax. Click any SVG to edit it in place—no modals, no context switching.

## Core Features

1. **Native SVG Embedding**: Use standard `![[drawing.svg]]` syntax to embed SVG drawings
2. **Inline Editing**: Click any displayed SVG to edit it directly in place
3. **Slash Command Creation**: Use `/draw` command to create new drawings quickly
4. **Persistent Storage**: All edits are saved back to the SVG file
5. **Drawing Tools**: Pen, shapes, eraser, selection, deletion
6. **One-at-a-Time Editing**: Only one SVG can be edited simultaneously to prevent confusion

## Design Philosophy

### Native `![[]]` Embeds

**Why native embeds instead of code blocks?**
- **Zero learning curve**: Users already know `![[]]` syntax
- **File tracking**: Obsidian automatically tracks references
- **Graph view**: Drawings appear as connections
- **Backlinks**: See which notes reference a drawing
- **Refactoring**: File renames auto-update all references
- **Standard markdown**: Works in any Obsidian vault

### Inline Editing

**Why inline instead of modal editing?**
- **No context switching**: Edit exactly where you see the SVG
- **Natural interaction**: Click to edit, save to exit
- **Better UX**: Proven successful by plugins like ob-table-enhancer
- **Seamless workflow**: Feels like native Obsidian behavior

**Proven feasible**: The ob-table-enhancer plugin demonstrates successful inline editing in Obsidian using DOM replacement and state management.

### Slash Commands

**Why `/draw` command?**
- **Quick creation**: Type `/draw` anywhere
- **Natural workflow**: Matches Obsidian's content insertion patterns
- **Auto-integrated**: Standard `addCommand()` automatically appears in `/` menu
- **Discoverable**: Shows in command palette and slash menu

## Inline Editing Challenges & Solutions

**Challenge 1: Toolbar Placement**
- **Solution**: Floating toolbar positioned above/beside SVG, or fixed at top of editor container
- **Options**: Draggable floating, fixed-top, or auto-positioned based on available space

**Challenge 2: Exit Detection**
- **Solution**: Multiple exit methods for flexibility
  - Escape key (cancel without saving)
  - Ctrl/Cmd+S (save and exit)
  - Save/Cancel buttons in toolbar
  - Click outside with confirmation if unsaved changes

**Challenge 3: Multiple Simultaneous Edits**
- **Solution**: Only one SVG editable at a time
- Clicking another SVG auto-saves current editor and opens new one
- EditorStateManager tracks active editor instance

**Challenge 4: Small Embed Sizes**
- **Solution**: Temporarily expand embed during editing
- Minimum editor size enforced for usability
- Responsive sizing based on viewport

**Challenge 5: Mobile Support**
- **Solution**: Responsive design with touch-optimized toolbar
- Larger touch targets for tools
- Consider simplified toolbar on small screens

## Architecture

### Plugin Structure

```
DrawingBlocksPlugin (extends Plugin)
├── Command: "Create new drawing" (auto-appears in /draw menu)
├── SVGEmbedProcessor (adds click handlers to SVG embeds)
├── InlineSVGEditor (replaces embed with editable canvas)
├── DrawingToolbar (floating toolbar with drawing tools)
├── SVGFileManager (handles all SVG file I/O)
├── EditorStateManager (tracks active editor, prevents concurrent edits)
└── Settings (plugin configuration)

Optional for Phase 6:
└── SVGLivePreviewExtension (CM6 extension for live preview mode)
```

**Key Concept**: `InlineSVGEditor` replaces the SVG embed element directly in the DOM, creating an in-place editing experience without modals or context switching.

### Key Components

#### A. Slash Command Integration
**Purpose**: Quick drawing creation via `/draw` command

**Implementation**: Standard `addCommand()` with `editorCallback`
- Automatically appears in `/` menu (no custom code needed)
- Creates new SVG file when triggered
- Opens inline editor for new drawing
- Inserts `![[]]` embed at cursor on save

#### B. SVG Embed Processor (Reading View)
**Purpose**: Add click handlers to SVG embeds in reading view

**Implementation**: `registerMarkdownPostProcessor()`
- Finds all `.internal-embed[src$=".svg"]` elements
- Adds click event listener to entire embed
- Adds visual cue (CSS class for hover effect)
- Triggers inline editor on click

#### C. Inline SVG Editor
**Purpose**: Core in-place editing component

**Features**:
- Replaces static SVG display with editable canvas
- Floating/docked toolbar for drawing tools
- Multiple exit methods (Ctrl+S, Escape, buttons, click-outside)
- Auto-saves or confirms on exit
- Restores original display after save/cancel

**Drawing Tools**:
- Pen (freehand paths)
- Line, Rectangle, Circle (basic shapes)
- Select (move/resize elements)
- Eraser (delete elements)
- Clear (clear canvas)

#### D. SVG File Manager
**Purpose**: All SVG file I/O operations

**Responsibilities**:
- Create new SVG files with unique names
- Read/parse SVG content
- Write/serialize SVG changes
- Manage file paths (absolute and relative)
- Handle folder creation

#### E. Drawing Toolbar
**Purpose**: UI for tool selection and options

**Features**:
- Tool buttons (pen, shapes, select, eraser)
- Color picker and stroke width
- Undo/Redo
- Save/Cancel buttons
- Compact, draggable or docked design

#### F. Editor State Manager
**Purpose**: Prevent concurrent editing

**Responsibilities**:
- Track currently active editor instance
- Enforce one-at-a-time editing
- Auto-save current editor when switching to new one
- Clean up on plugin unload

#### G. Live Preview Extension (Optional - Phase 6)
**Purpose**: Support inline editing in live preview mode

**Implementation**: CM6 ViewPlugin with decorations
- More complex than reading view
- Can be deferred to later phase

### User Workflows

#### Workflow 1: Create New Drawing
1. User types `/draw` in editor
2. Selects "Create new drawing" from slash menu
3. Plugin creates SVG file (e.g., `drawings/drawing-2024-01-15-143022.svg`)
4. Inline editor opens with blank canvas
5. User draws on canvas
6. On save:
   - SVG saved to file
   - `![[drawings/drawing-2024-01-15-143022.svg]]` inserted at cursor
   - Editor closes, embed appears

#### Workflow 2: Edit Existing SVG (Reading View)
1. User sees embedded SVG: `![[drawings/my-drawing.svg]]`
2. SVG displays with subtle hover effect indicating editability
3. User clicks SVG
4. SVG replaced with inline editor + toolbar
5. User edits drawing
6. User saves (Ctrl+S or Save button)
7. Changes written to file
8. Editor reverts to static SVG display

**No context switching—edit exactly where you see it.**

#### Workflow 3: Edit in Live Preview (Optional - Phase 6)
Same as Workflow 2, but in live preview mode. Requires CM6 extension.

## Technical Implementation

### SVG File Format
Standard XML format with drawing elements:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <path d="M 10,10 L 50,50" stroke="black" stroke-width="2" fill="none"/>
  <rect x="100" y="100" width="50" height="50" fill="blue" stroke="black"/>
  <circle cx="200" cy="200" r="30" fill="red"/>
</svg>
```

### Drawing Implementation
Use native DOM/SVG APIs:

**Mouse Events**: `mousedown` → `mousemove` → `mouseup`

**Path Drawing** (Pen tool):
```typescript
onMouseDown(e: MouseEvent) {
  currentPath = createElementNS("http://www.w3.org/2000/svg", "path");
  pathData = `M ${e.offsetX},${e.offsetY}`;
  currentPath.setAttribute("d", pathData);
  svgElement.appendChild(currentPath);
}

onMouseMove(e: MouseEvent) {
  if (currentPath) {
    pathData += ` L ${e.offsetX},${e.offsetY}`;
    currentPath.setAttribute("d", pathData);
  }
}

onMouseUp() {
  currentPath = null;
  saveToHistory(); // For undo/redo
}
```

### File Management
**Naming**: `drawing-{timestamp}.svg` (e.g., `drawing-2024-01-15-143022.svg`)
**Location**: Configurable folder (default: `drawings/`)
**Paths**: Support absolute and relative paths

### Settings
```typescript
interface DrawingBlocksSettings {
  defaultFolder: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultStrokeColor: string;
  defaultStrokeWidth: number;
  autoSave: boolean;
  autoSaveInterval: number;
}
```

## Implementation Phases

### Phase 1: Foundation
**Goal**: Basic infrastructure and file management

1. **Project setup**
   - Update manifest.json (ID: `obsidian-drawing-blocks`)
   - Create `src/` folder structure
   - Use native SVG APIs (no external dependencies)

2. **SVG File Manager**
   - Read/write operations using Vault API
   - Path resolution (absolute and relative)
   - Auto-naming with timestamps
   - Folder creation

3. **Settings**
   - Settings interface and defaults
   - Settings tab UI
   - Load/save with `loadData()` and `saveData()`

### Phase 2: Command Integration
**Goal**: `/draw` slash command for creating drawings

4. **Register command**
   - Use `addCommand()` with `editorCallback`
   - Name: "Create new drawing"
   - Auto-appears in `/` menu

5. **Command implementation**
   - Create new SVG file
   - Generate timestamp-based filename
   - Open inline editor
   - Insert `![[]]` embed on save

6. **Test integration**
   - Verify `/draw` appears in slash menu
   - Test Command Palette integration
   - Verify editor context requirement

### Phase 3: Inline Editor Core
**Goal**: In-place editing component with drawing tools

7. **InlineSVGEditor class**
   - DOM element replacement
   - Container creation
   - Restoration logic

8. **EditorStateManager**
   - Track active editor instance
   - Enforce one-at-a-time editing
   - Auto-close when switching

9. **Drawing toolbar**
   - Floating/docked UI
   - Tool selection buttons
   - Color picker, stroke width
   - Save/Cancel buttons
   - Optional: draggable

10. **Pen tool**
    - Mouse event handlers
    - SVG `<path>` creation
    - Real-time drawing
    - Stroke styling

11. **Shape tools**
    - Rectangle, Circle, Line tools
    - Drag-to-create interaction
    - Preview during drag
    - Finalize on mouseup

12. **Selection tool**
    - Click to select elements
    - Bounding box highlight
    - Delete key support
    - Optional: move/resize (defer to Phase 5)

13. **Exit handling**
    - Escape (cancel), Ctrl+S (save)
    - Save/Cancel buttons
    - Click-outside with confirmation
    - SVG serialization and file write

### Phase 4: Reading View Integration
**Goal**: Click-to-edit for SVG embeds in reading view

14. **Markdown post processor**
    - Register with `registerMarkdownPostProcessor()`
    - Find `.internal-embed[src$=".svg"]`
    - Add click listeners
    - Add hover visual cue

15. **Embed replacement**
    - Create InlineSVGEditor on click
    - Load SVG content
    - Replace embed element
    - Show toolbar

16. **Display restoration**
    - Write changes on save
    - Restore original embed
    - Trigger re-render
    - Handle file update events

### Phase 5: Polish
**Goal**: Advanced features and refinements

17. **Undo/Redo**
    - History stack (50 states max)
    - Ctrl+Z / Ctrl+Shift+Z
    - Toolbar buttons

18. **Eraser tool**
    - Click to delete elements
    - Hover feedback
    - Optional: clear all button

19. **Auto-save**
    - Configurable interval
    - "Saving..." indicator
    - Only save if changed

20. **Additional commands**
    - "Edit drawing at cursor"
    - "Exit drawing edit mode"

21. **Error handling**
    - Malformed SVG files
    - Missing files
    - Permission errors
    - Path validation
    - Edge cases (empty, large drawings)

### Phase 6: Live Preview (Optional)
**Goal**: Inline editing in live preview mode

22. **CM6 extension**
    - ViewPlugin implementation
    - Click detection
    - `view.posAtDom()` usage
    - Editor replacement and restoration

23. **Extension registration**
    - `registerEditorExtension()`
    - Lifecycle management
    - Cross-plugin compatibility testing

### Phase 7: Testing & Documentation
**Goal**: Ensure quality and usability

24. **Comprehensive testing**
    - `/draw` command workflows
    - Inline editing in reading view
    - State management (switching SVGs)
    - Toolbar placement and interaction
    - Exit methods and confirmations
    - File operations and renames
    - Edge cases (small/large embeds)
    - Undo/redo functionality
    - Auto-save behavior

25. **Performance optimization**
    - Large drawing rendering
    - Auto-save debouncing
    - Path simplification
    - Lazy initialization
    - DOM manipulation efficiency

26. **Documentation**
    - README with usage guide
    - Screenshots/GIFs of inline editing
    - Keyboard shortcuts reference
    - Troubleshooting section
    - Settings documentation

## Code Examples

### Plugin Registration
```typescript
export default class DrawingBlocksPlugin extends Plugin {
  settings: DrawingBlocksSettings;
  svgFileManager: SVGFileManager;
  editorStateManager: EditorStateManager;

  async onload() {
    await this.loadSettings();
    this.svgFileManager = new SVGFileManager(this.app, this.settings);
    this.editorStateManager = new EditorStateManager();

    // Slash command (auto-appears in / menu)
    this.addCommand({
      id: 'create-new-drawing',
      name: 'Create new drawing',
      editorCallback: async (editor, view) => {
        await this.createNewDrawing(editor, view);
      }
    });

    // Reading view click handlers
    this.registerMarkdownPostProcessor(this.processSVGEmbeds.bind(this));

    // Settings tab
    this.addSettingTab(new DrawingBlocksSettingTab(this.app, this));
  }
}
```

### Command Implementation
```typescript
async createNewDrawing(editor: Editor, view: MarkdownView) {
  const timestamp = moment().format('YYYY-MM-DD-HHmmss');
  const filePath = `${this.settings.defaultFolder}/drawing-${timestamp}.svg`;

  await this.svgFileManager.createNewSVG(filePath);
  const cursor = editor.getCursor();

  // Open inline editor
  const inlineEditor = new InlineSVGEditor(
    this.app,
    filePath,
    this.svgFileManager,
    () => {
      editor.replaceRange(`![[${filePath}]]\n`, cursor);
      new Notice('Drawing saved!');
    }
  );
  inlineEditor.open(document.body); // Opens at appropriate location
}
```

### Markdown Post Processor
```typescript
processSVGEmbeds(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
  const embeds = el.querySelectorAll('.internal-embed[src$=".svg"]');

  embeds.forEach((embed: HTMLElement) => {
    const src = embed.getAttribute('src');
    if (!src) return;

    // Add visual cue
    embed.addClass('svg-editable');

    // Click to edit
    embed.addEventListener('click', (e) => {
      e.preventDefault();
      this.openInlineEditor(embed, src);
    });
  });
}

openInlineEditor(element: HTMLElement, filePath: string) {
  // Close any existing editor first
  this.editorStateManager.closeActiveEditor();

  const editor = new InlineSVGEditor(
    this.app,
    filePath,
    this.svgFileManager,
    () => {
      // Restore display after save
      this.app.workspace.trigger('svg-updated', filePath);
    }
  );

  // Replace element with editor
  editor.replaceElement(element);
  this.editorStateManager.setActiveEditor(editor);
}
```

### Vault Operations
```typescript
// Read SVG
async loadSVG(filePath: string): Promise<string> {
  const file = this.app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    return await this.app.vault.read(file);
  }
  throw new Error('File not found');
}

// Write SVG
async saveSVG(filePath: string, content: string): Promise<void> {
  const file = this.app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    await this.app.vault.modify(file, content);
  } else {
    await this.app.vault.create(filePath, content);
  }
}
```

## UI/UX Guidelines

### Visual Feedback
- Loading indicator for large SVGs
- Save status ("Saving..." / "Saved")
- Highlight active tool in toolbar
- Hover effect on editable SVGs

### Keyboard Shortcuts
- **Ctrl+Z**: Undo
- **Ctrl+Shift+Z** or **Ctrl+Y**: Redo
- **Delete**: Remove selected element
- **Escape**: Cancel and close editor
- **Ctrl+S**: Save and close editor

### Responsive Design
- Adapt to different screen sizes
- Touch-optimized toolbar for mobile
- Minimum usable editor size enforced
- Graceful degradation on small screens

### Accessibility
- ARIA labels on all interactive elements
- Keyboard navigation support
- High color contrast
- Focus indicators

## Technical Challenges

### Real-time Drawing Performance
**Issue**: Complex paths may cause lag
**Solutions**:
- Use `requestAnimationFrame` for smooth rendering
- Path simplification (Douglas-Peucker algorithm)
- Debounce frequent updates
- Consider canvas-based preview with SVG export

### Multi-Note Updates
**Issue**: Same SVG displayed in multiple notes needs to update
**Solutions**:
- Use `this.app.vault.on('modify')` event
- Reload displays when file changes
- Custom events for re-rendering
- Cache busting with query params

### DOM Element Detection
**Issue**: Finding SVG embeds reliably
**Solutions**:
- Reading view: `.internal-embed[src$=".svg"]`
- Live preview: CM6 syntax tree
- Handle `![[file.svg|alt]]` syntax
- Support relative paths and aliases

### CM6 Extension Complexity
**Issue**: Live preview support is complex
**Solutions**:
- Make it optional (Phase 6)
- Start with reading view only
- Reference existing plugins
- Use `ViewPlugin.fromClass()` pattern
- Thorough testing for compatibility

## Future Enhancements

### Advanced Drawing Tools
- Text insertion
- Polygon and Bezier curve tools
- Image insertion and manipulation
- Advanced path editing

### Layers
- Multiple layers for organization
- Layer visibility toggles
- Layer ordering (z-index management)

### Export Options
- Export as PNG/JPG/PDF
- Copy to clipboard
- Data URI embedding option

### Templates & Libraries
- Predefined canvas templates
- Shape libraries and stamps
- Custom presets

### Collaboration
- Conflict resolution for synced vaults
- Change history and diff view

## Testing Strategy

### Automated Tests
- SVGFileManager (CRUD operations, path resolution)
- Filename generation (uniqueness, timestamps)
- SVG serialization/deserialization

### Integration Tests
- `/draw` command workflow
- Embed insertion after save
- Post processor SVG detection
- Editor lifecycle (open/edit/save/close)

### Manual Test Scenarios
- **Create**: `/draw` → draw → save → verify embed
- **Edit (Reading View)**: Click SVG → inline editor appears → edit → save → display restored
- **Edit (Live Preview)**: Same workflow in live preview (Phase 6)
- **Tools**: All drawing tools functional
- **Toolbar**: Positioning, dragging, tool selection
- **Exit Methods**: All methods work correctly
- **State**: Switch between SVGs, verify auto-close
- **Undo/Redo**: History management
- **Multi-Note**: Edit SVG, verify updates everywhere
- **File Ops**: Folder structures, relative paths, renames
- **Edge Cases**: Empty/large drawings, malformed SVG, tiny embeds

## Success Criteria

### MVP Requirements (Phases 1-5)
✅ Create drawings via `/draw` command
✅ Embed with native `![[file.svg]]` syntax
✅ Click any SVG to edit inline (no modal)
✅ Drawing tools: pen, shapes, select, eraser
✅ Save changes to SVG file
✅ Only one editor active at a time
✅ Seamless edit/save/exit workflow
✅ File renames update all references (native behavior)
✅ Drawings in graph view
✅ Good performance with reasonable drawings

### Optional Enhancements (Phase 6+)
✅ Live preview inline editing
✅ Undo/redo functionality
✅ Auto-save capability

## Summary

This plan outlines a **inline-first** approach to building the Obsidian Drawing Blocks plugin.

### Core Decisions

**Native `![[]]` Embeds**
- Leverages Obsidian's built-in systems
- Zero learning curve for users
- Full integration with graph, backlinks, refactoring

**Inline Editing**
- Edit in place, no context switching
- Proven viable (ob-table-enhancer plugin)
- Superior UX worth the extra complexity

**Slash Commands**
- `/draw` auto-appears in menu via `addCommand()`
- Natural Obsidian workflow
- No custom code needed

### Implementation Approach

**MVP Path**: Phases 1-4 deliver core inline editing in reading view
**Polish**: Phase 5 adds undo/redo, auto-save, error handling
**Optional**: Phase 6 adds live preview support

**Technology**:
- Native DOM/SVG APIs (no dependencies)
- Obsidian APIs: `addCommand()`, post processors, Vault API
- DOM replacement with `replaceWith()`
- Optional CM6 for live preview

This delivers **exceptional UX** through **thoughtful implementation**, creating a plugin that feels native to Obsidian while providing powerful inline SVG editing capabilities.
