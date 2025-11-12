# Obsidian Drawing Blocks Plugin - Implementation Plan

## Overview

This plugin will enable users to create and edit SVG drawings directly within their Obsidian notes. Every drawing is stored as an SVG file in the vault and can be embedded using Obsidian's native `![[file.svg]]` syntax, making all SVG images editable by default.

## Core Features

1. **Native SVG Embedding**: Use standard `![[drawing.svg]]` syntax to embed SVG drawings
2. **Inline Editing**: Click on any displayed SVG image to edit it directly
3. **Slash Command Creation**: Use `/draw` command to create new drawings quickly
4. **Persistent Storage**: All edits are saved back to the SVG file
5. **Drawing Tools**: Basic drawing capabilities (pen, shapes, eraser, selection, deletion)

## Design Philosophy Update

After researching Obsidian's APIs, we've determined that using **native embed syntax `![[]]`** combined with a **slash command for creation** provides the best user experience:

### Why `![[]]` Instead of Code Blocks?

**Advantages**:
- **Native Integration**: Leverages Obsidian's built-in file linking and embedding system
- **Consistency**: Users already know `![[]]` syntax for images, PDFs, and other embeds
- **Refactoring Support**: File renames automatically update all references
- **Graph View**: Drawings show up in the graph view as connections
- **Backlinks**: Can see which notes reference a drawing
- **Simplicity**: No custom syntax to learn
- **Works Everywhere**: Standard markdown embed syntax works in any Obsidian vault

**Technical Feasibility**: ✅ **Fully Feasible**
- **Reading View**: Use `registerMarkdownPostProcessor` to intercept rendered SVG embeds
- **Live Preview**: Use `registerEditorExtension` with CodeMirror 6 ViewPlugin for live edit buttons
- Both approaches are well-documented and used by existing plugins

### Why Slash Command `/draw` Instead of Code Blocks?

**Advantages**:
- **Quick Creation**: Type `/draw` anywhere to create a new drawing
- **Natural Workflow**: Matches how users insert other content in Obsidian
- **Flexible**: Can insert the `![[]]` reference immediately or let user place it
- **Discoverable**: Shows up in command palette and slash menu

**Technical Feasibility**: ✅ **Very Simple - No Custom Code Needed!**
- Obsidian's native **Slash commands core plugin** automatically shows all commands from the command palette
- Simply use standard `addCommand()` API with a name like "Create new drawing"
- Command automatically appears when users type `/` (if slash commands plugin enabled)
- No need for custom EditorSuggest implementation!

### Comparison with Code Block Approach

| Aspect | `![[file.svg]]` + `/draw` | ````drawing` code blocks |
|--------|---------------------------|-------------------------|
| User Learning Curve | None (native syntax) | Must learn custom syntax |
| File References | Tracked by Obsidian | Not tracked |
| Graph View | Shows connections | Doesn't appear |
| Refactoring | Auto-updates | Manual updates needed |
| Creation UX | Native `/` menu | Manual code block typing |
| Slash Command | Auto-integrated via addCommand | Requires EditorSuggest |
| Implementation | Standard addCommand() | Custom code block processor |
| Live Preview | Requires CM6 extension | Built-in support |
| **Overall** | **Better UX, similar complexity** | **Simpler rendering, worse UX** |

**Decision**: Use `![[]]` + native slash commands approach for superior user experience with similar implementation effort.

## Inline Editing vs Modal Editing

After researching inline editing capabilities in Obsidian, we've determined that **inline editing IS feasible** and would provide an even better user experience.

### Proof of Concept: Table Enhancer Plugin

The **ob-table-enhancer** plugin demonstrates successful inline editing in Obsidian:
- Intercepts click events on rendered tables
- Makes table cells `contenteditable` on click
- Uses `EditorView.posAtDom()` to map DOM elements to source locations
- Syncs changes back to markdown source
- Exits edit mode on Enter/Escape or click outside

### Inline SVG Editing Approach

For SVG editing specifically, we would:

**Instead of opening a modal**, we replace the displayed SVG with an interactive editor in the same location:

1. **Click to edit**: User clicks on SVG embed
2. **Replace display**: SVG display is replaced with SVG canvas + toolbar
3. **Edit in place**: User draws/edits directly where SVG was displayed
4. **Save & revert**: On save, changes sync to file and display reverts to static SVG

### Technical Implementation for Inline Editing

#### Reading View (Markdown Post Processor)
```typescript
registerMarkdownPostProcessor((el, ctx) => {
  const embeds = el.querySelectorAll('.internal-embed[src$=".svg"]');

  embeds.forEach((embed: HTMLElement) => {
    const src = embed.getAttribute('src');
    if (!src) return;

    // Add click handler to entire embed (not just button)
    embed.addEventListener('click', (e) => {
      e.preventDefault();

      // Replace embed with inline editor
      this.replaceWithInlineEditor(embed, src, () => {
        // On save: revert to display mode
        this.revertToDisplay(embed, src);
      });
    });

    // Optional: Add visual cue that it's editable
    embed.addClass('svg-editable');
  });
});
```

#### Live Preview (CM6 ViewPlugin)
```typescript
const svgEditExtension = ViewPlugin.fromClass(class {
  constructor(view: EditorView) {
    // Add click handler to SVG embeds
    view.dom.addEventListener('click', this.handleClick.bind(this), { capture: true });
  }

  handleClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const svgEmbed = target.closest('.cm-embed-block[data-file$=".svg"]');

    if (svgEmbed) {
      event.preventDefault();

      // Get file path and position
      const filePath = svgEmbed.getAttribute('data-file');
      const pos = view.posAtDom(svgEmbed);

      // Replace with inline editor
      this.replaceWithInlineEditor(svgEmbed, filePath, pos);
    }
  }
});
```

### Inline Editor Component Structure

```typescript
class InlineSVGEditor {
  container: HTMLElement;
  originalElement: HTMLElement;
  svgCanvas: SVGElement;
  toolbar: HTMLElement;

  constructor(replaceTarget: HTMLElement, filePath: string, onSave: () => void) {
    // Store original element for restoration
    this.originalElement = replaceTarget;

    // Create editor container
    this.container = createDiv({ cls: 'inline-svg-editor' });

    // Create toolbar (floating or inline)
    this.toolbar = this.createToolbar();

    // Load and create editable SVG canvas
    this.svgCanvas = this.createEditableSVG(filePath);

    // Assemble UI
    this.container.appendChild(this.toolbar);
    this.container.appendChild(this.svgCanvas);

    // Replace original element
    replaceTarget.replaceWith(this.container);

    // Handle exit events
    this.setupExitHandlers(onSave);
  }

  setupExitHandlers(onSave: () => void) {
    // Save on Ctrl+S
    this.container.addEventListener('keydown', (e) => {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.save();
        onSave();
      }
      // Exit on Escape
      if (e.key === 'Escape') {
        this.exit(false);
      }
    });

    // Optional: Exit on click outside
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target as Node)) {
        this.exit(true); // Auto-save on click outside
      }
    }, { once: true });
  }

  exit(save: boolean) {
    if (save) this.save();
    // Restore original element
    this.container.replaceWith(this.originalElement);
  }
}
```

### Comparison: Inline vs Modal Editing

| Aspect | Inline Editing | Modal Editing |
|--------|----------------|---------------|
| **UX** | Superior - edit where you see it | Good - dedicated space |
| **Context** | No context switching | Switch to modal |
| **Implementation** | More complex | Simpler |
| **State Management** | Track active editor per embed | Single modal instance |
| **Multiple Edits** | Need to handle multiple concurrent | Only one at a time |
| **Toolbar Placement** | Challenging (overlay/float) | Easy (inside modal) |
| **Screen Space** | Limited to embed size | Full control of size |
| **Exit Handling** | Must detect click outside | Simple close button |
| **Mobile Support** | More challenging | Easier |
| **Overall Complexity** | **Higher** | **Lower** |

### Recommended Approach

**Option 1: Start with Modal (Faster MVP)**
- Phase 1-4: Implement modal-based editing
- Phase 6+: Add inline editing as enhancement
- Users can choose preferred mode in settings

**Option 2: Inline-First (Better UX from start)**
- Implement inline editing from the beginning
- Accept longer development time
- Superior end-user experience

**Recommendation**: Start with **inline editing** since we're building from scratch anyway. The UX benefits outweigh the additional complexity, and we avoid rewriting later.

### Inline Editing Challenges & Solutions

**Challenge 1: Toolbar Placement**
- **Solution**: Floating toolbar that appears above/beside SVG, or fixed toolbar at top of editor container

**Challenge 2: Exit Detection**
- **Solution**: Combination of escape key, explicit save/cancel buttons, and click-outside detection (with confirmation if unsaved changes)

**Challenge 3: Multiple Simultaneous Edits**
- **Solution**: Only allow one SVG to be edited at a time; clicking another SVG auto-saves and closes current editor

**Challenge 4: Small Embed Sizes**
- **Solution**: Temporarily expand embed size during editing, or provide "edit full-size" option that opens modal

**Challenge 5: Mobile Support**
- **Solution**: Inline editing for tablet/desktop, automatically use modal on mobile screens

## Architecture

### 1. Main Plugin Structure (Inline Editing)

```
DrawingBlocksPlugin (extends Plugin)
├── Command: "Create new drawing" (registered via addCommand)
├── SVGEmbedProcessor (Markdown post processor - adds click handlers)
├── SVGLivePreviewExtension (CM6 extension - adds click handlers, optional)
├── InlineSVGEditor (Inline editor that replaces embed in place)
├── DrawingToolbar (floating/overlay toolbar for drawing tools)
├── SVGFileManager (handles SVG file I/O)
├── EditorStateManager (tracks which SVG is currently being edited)
└── Settings (plugin configuration)
```

**Key Change**: Instead of opening a Modal, we use `InlineSVGEditor` which replaces the SVG embed element directly in the DOM, allowing editing in place.

### 2. Key Components

#### A. Native Slash Command Integration
- **Purpose**: Provide command for creating new drawings that appears in `/` menu
- **API**: Standard `addCommand()` with `editorCallback`
- **Auto-integration**: Automatically appears in slash commands menu (no custom code needed!)
- **Command Name**: "Create new drawing" (users type `/draw` or `/create` to find it)

**Implementation Example**:
```typescript
// In plugin onload()
this.addCommand({
  id: 'create-new-drawing',
  name: 'Create new drawing',
  editorCallback: async (editor: Editor, view: MarkdownView) => {
    // Create new SVG file
    const filePath = await this.svgFileManager.createNewSVG();

    // Open editor modal
    const modal = new SVGEditorModal(
      this.app,
      filePath,
      this.svgFileManager,
      (savedPath: string) => {
        // On save: insert embed at cursor
        const cursor = editor.getCursor();
        editor.replaceRange(`![[${savedPath}]]`, cursor);
      }
    );
    modal.open();
  }
});
```

**How it works**:
1. User types `/` in editor → Obsidian shows slash commands menu
2. User types `draw` or `new` → Command appears in filtered list
3. User selects command → Our `editorCallback` executes
4. SVG file created, editor opens, on save embed is inserted

#### B. Reading View - Markdown Post Processor
- **Purpose**: Add edit buttons to SVG embeds in reading view
- **API**: `registerMarkdownPostProcessor(handler)`
- **View Support**: Reading view only (not live preview)
- **Functionality**:
  - Find all SVG embed containers (internal embeds `![[file.svg]]`)
  - Add "Edit" button overlay
  - Extract file path from embed
  - Open SVG editor when clicked

**Implementation Example**:
```typescript
registerMarkdownPostProcessor((el, ctx) => {
  // Find SVG embeds - Obsidian renders ![[file.svg]] as internal embeds
  const embeds = el.querySelectorAll('.internal-embed[src$=".svg"]');

  embeds.forEach((embed) => {
    const src = embed.getAttribute('src');
    if (!src) return;

    // Create edit button overlay
    const editButton = embed.createEl('button', {
      cls: 'svg-edit-button',
      text: '✏️ Edit'
    });

    editButton.addEventListener('click', (e) => {
      e.preventDefault();
      this.openSVGEditor(src);
    });
  });
});
```

#### C. Live Preview - CodeMirror 6 Extension
- **Purpose**: Add edit buttons to SVG embeds in live preview mode
- **API**: `registerEditorExtension()` with CM6 ViewPlugin
- **View Support**: Live preview and source mode
- **Complexity**: More complex than post processor, requires CM6 knowledge
- **Functionality**:
  - Create ViewPlugin that monitors document changes
  - Detect SVG embed widgets in the editor
  - Add decorations (edit buttons) to SVG embeds
  - Handle click events to open editor

**Implementation Example**:
```typescript
import { ViewPlugin, EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

const svgEditExtension = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  buildDecorations(view: EditorView): DecorationSet {
    const widgets: Range<Decoration>[] = [];

    // Iterate through syntax tree to find wiki links
    for (let { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from, to,
        enter: (node) => {
          // Look for wiki link nodes: [[file.svg]]
          if (node.name === 'hmd-internal-link') {
            const text = view.state.doc.sliceString(node.from, node.to);
            if (text.endsWith('.svg]]')) {
              // Add edit button widget
              const widget = Decoration.widget({
                widget: new EditButtonWidget(text),
                side: 1
              });
              widgets.push(widget.range(node.to));
            }
          }
        }
      });
    }

    return Decoration.set(widgets);
  }
}, {
  decorations: v => v.decorations
});

// Register in plugin
this.registerEditorExtension([svgEditExtension]);
```

**Note**: Live preview support is **optional for MVP** and can be added in Phase 5+ to reduce initial complexity.

#### D. Inline SVG Editor Component
- **Purpose**: Core editing interface that replaces SVG embed in place
- **Implementation**: Custom component that replaces DOM element
- **Features**:
  - Replaces static SVG display with editable SVG canvas
  - Floating/overlay toolbar for drawing tools
  - Auto-save on exit or explicit save button
  - Handles keyboard shortcuts (Ctrl+S, Escape)
  - Detects click outside to exit edit mode
  - Restores original display on exit

**Editing Workflow**:
1. User clicks SVG embed → Editor replaces the embed element
2. Toolbar appears (floating above or fixed at top)
3. User draws/edits directly on the SVG
4. On save: Changes written to file, editor reverts to display
5. On cancel: No changes, editor reverts to display

**Drawing Tools**:
1. **Pen/Pencil**: Freehand drawing (creates `<path>` elements)
2. **Line**: Draw straight lines (creates `<line>` elements)
3. **Rectangle**: Draw rectangles (creates `<rect>` elements)
4. **Circle**: Draw circles (creates `<circle>` elements)
5. **Select**: Select and move/resize elements
6. **Eraser**: Delete individual elements
7. **Clear**: Clear entire canvas

**Exit Triggers**:
- Escape key (cancel without saving)
- Ctrl/Cmd+S (save and exit)
- Save button (save and exit)
- Cancel button (exit without saving)
- Click outside editor (save and exit with confirmation)

#### E. SVG File Manager
- **Purpose**: Handle all file operations for SVG files
- **API Usage**:
  - `this.app.vault.read(file)` - Read SVG content
  - `this.app.vault.modify(file, data)` - Save changes to existing SVG
  - `this.app.vault.create(path, data)` - Create new SVG file
  - `this.app.vault.getAbstractFileByPath(path)` - Get TFile reference
  - `this.app.vault.getMarkdownFiles()` - List markdown files for backlink updates

**Responsibilities**:
- Parse SVG XML to DOM
- Serialize SVG DOM back to XML string
- Manage file paths and references
- Handle file creation with unique names (auto-increment if name exists)
- Generate proper file paths relative to current note or in default folder

#### F. Drawing Toolbar
- **Purpose**: Floating/overlay UI for selecting drawing tools
- **Implementation**: Positioned relative to active editor (floating or docked)
- **Features**:
  - Tool selection buttons
  - Color picker for stroke/fill
  - Stroke width selector
  - Undo/Redo buttons
  - Save/Cancel buttons
  - Compact design for minimal intrusion

**Placement Options**:
- **Floating**: Appears above SVG, can be dragged
- **Top-docked**: Fixed at top of editor container
- **Side-docked**: Fixed to left/right side
- **Setting**: User can choose preferred placement

#### G. Editor State Manager
- **Purpose**: Track which SVG is currently being edited (prevent multiple simultaneous edits)
- **Responsibilities**:
  - Store reference to currently active inline editor
  - Ensure only one SVG is edited at a time
  - Handle switching between editors (auto-save current, open new)
  - Clean up editor state on plugin unload

### 3. User Workflows

#### Workflow 1: Create New Drawing with `/draw` Command
1. User types `/draw` in editor
2. Slash command suggestion appears
3. User selects "New blank drawing"
4. Plugin creates new SVG file (e.g., `drawings/drawing-2024-01-15-143022.svg`)
5. SVG editor modal opens with blank canvas
6. User draws on canvas
7. On save:
   - SVG content is saved to the file
   - `![[drawings/drawing-2024-01-15-143022.svg]]` is inserted at cursor position
   - Modal closes
8. Drawing appears embedded in the note

**Alternative**: User can also create SVG file manually and embed with `![[path/to/file.svg]]`

#### Workflow 2: Edit Existing SVG Embed (Reading View - Inline)
1. User has embedded SVG: `![[drawings/my-drawing.svg]]`
2. In reading view, SVG displays normally (with subtle visual cue it's editable)
3. User **clicks directly on the SVG** (no separate button needed!)
4. SVG display is replaced with inline editor in the same location
5. Toolbar appears (floating or docked above)
6. User draws/edits directly
7. User presses Ctrl+S or clicks Save button
8. Changes written back to SVG file
9. Editor reverts to static SVG display showing updated drawing

**Key advantage**: No context switching, edit exactly where you see it!

#### Workflow 3: Edit Existing SVG Embed (Live Preview - Inline)
1. User has embedded SVG: `![[drawings/my-drawing.svg]]`
2. In live preview mode, SVG renders inline with the text
3. User **clicks directly on the rendered SVG**
4. SVG embed is replaced with inline editor
5. Toolbar appears
6. User draws/edits directly
7. User saves (Ctrl+S or Save button)
8. Changes written to file
9. Live preview updates automatically to show static SVG

**Note**: Workflow 3 requires CodeMirror 6 extension (Phase 6, optional for MVP)

## Technical Implementation Details

### 1. SVG Data Structure

SVG files will be standard XML format:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <!-- Drawing elements go here -->
  <path d="M 10,10 L 50,50" stroke="black" stroke-width="2" fill="none"/>
  <rect x="100" y="100" width="50" height="50" fill="blue" stroke="black"/>
  <circle cx="200" cy="200" r="30" fill="red"/>
</svg>
```

### 2. Editor Implementation

The editor will be implemented as a Modal or a custom view:

**Option A: Modal (Recommended for MVP)**
- Extends `Modal` class
- Displays over current note
- Simpler to implement
- Full-screen or large dialog

**Option B: Inline Editor**
- Replaces code block temporarily
- More complex state management
- Better user experience (no context switch)

**Recommendation**: Start with Modal (Option A), migrate to inline if needed.

### 3. Drawing Implementation

Use native DOM/SVG APIs for drawing:

**Mouse Event Handling**:
```typescript
- mousedown: Start drawing/selection
- mousemove: Continue drawing path
- mouseup: Finish drawing/selection
```

**Path Drawing Example**:
```typescript
let currentPath: SVGPathElement;
let pathData = "";

onMouseDown(e: MouseEvent) {
  currentPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pathData = `M ${e.offsetX},${e.offsetY}`;
  currentPath.setAttribute("d", pathData);
  currentPath.setAttribute("stroke", this.currentColor);
  currentPath.setAttribute("stroke-width", this.strokeWidth);
  currentPath.setAttribute("fill", "none");
  this.svgElement.appendChild(currentPath);
}

onMouseMove(e: MouseEvent) {
  if (currentPath) {
    pathData += ` L ${e.offsetX},${e.offsetY}`;
    currentPath.setAttribute("d", pathData);
  }
}

onMouseUp() {
  currentPath = null;
  this.saveToHistory(); // For undo/redo
}
```

### 4. File Management

**Auto-naming Convention**:
- New drawings: `drawing-{timestamp}.svg` or `drawing-{n}.svg`
- Stored in configured folder (default: `drawings/`)
- Create folder if it doesn't exist

**File Path Resolution**:
- Support absolute paths from vault root
- Support relative paths from current note's folder

### 5. Settings

Plugin settings should include:
```typescript
interface DrawingBlocksSettings {
  defaultFolder: string;        // Default folder for new drawings
  defaultWidth: number;          // Default canvas width
  defaultHeight: number;         // Default canvas height
  defaultStrokeColor: string;    // Default drawing color
  defaultStrokeWidth: number;    // Default line width
  autoSave: boolean;             // Auto-save while editing
  autoSaveInterval: number;      // Auto-save interval (ms)
}
```

## Implementation Steps

### Phase 1: Basic Infrastructure (Foundation)
1. **Setup project structure**
   - Rename plugin classes and update manifest.json
   - Update plugin ID to `obsidian-drawing-blocks`
   - Create file structure: `src/` folder for components
   - No external dependencies needed initially (use native SVG APIs)

2. **Implement SVG File Manager**
   - Create `SVGFileManager` class
   - Implement read/write operations using Vault API
   - Add path resolution logic (absolute and relative paths)
   - Add file creation with auto-naming (timestamp-based)
   - Implement folder creation if default folder doesn't exist

3. **Create basic Settings**
   - Implement `DrawingBlocksSettings` interface
   - Add settings tab with options:
     - Default folder for new drawings
     - Default canvas dimensions
     - Default stroke color and width
   - Load/save settings using `loadData()` and `saveData()`

### Phase 2: Command Registration (Native Slash Command Integration)
4. **Register "Create new drawing" command**
   - Use `this.addCommand()` with `editorCallback`
   - Set command name to "Create new drawing" (shows up when typing `/draw`)
   - Command automatically appears in slash commands menu (if core plugin enabled)
   - Also available via Command Palette (Ctrl/Cmd+P)

5. **Implement command callback**
   - Create new SVG file using SVGFileManager
   - Generate unique filename with timestamp
   - Store in configured default folder
   - Store reference to editor and cursor position for embed insertion

6. **Test command integration**
   - Test typing `/` in editor to see if command appears
   - Test typing `/draw` or `/create` to filter command
   - Verify command also appears in Command Palette
   - Test that command only available when editor is active

### Phase 3: Inline SVG Editor (Core Feature)
7. **Create InlineSVGEditor class**
   - Create component that can replace any DOM element
   - Store reference to original element for restoration
   - Create container div with `inline-svg-editor` class
   - Handle element replacement with `replaceWith()`
   - Implement cleanup and restoration logic

8. **Implement editor state manager**
   - Create EditorStateManager singleton
   - Track currently active editor instance
   - Implement "close current, open new" logic
   - Prevent multiple simultaneous edits

9. **Implement drawing toolbar (floating UI)**
   - Create compact, floating toolbar
   - Position above/beside SVG editor
   - Add tool selection buttons (pen, line, rect, circle, select, eraser)
   - Add color picker and stroke width selector
   - Add Save/Cancel buttons
   - Make toolbar draggable (optional)

10. **Implement basic drawing - Pen tool**
    - Add mouse event handlers to SVG canvas
    - Create SVG `<path>` elements on mousedown/move/up
    - Build path data string with M (move) and L (line) commands
    - Render real-time drawing as user moves mouse
    - Apply current stroke color and width

11. **Implement shape tools**
    - **Rectangle tool**: Draw `<rect>` with drag interaction
    - **Circle tool**: Draw `<circle>` with drag interaction
    - **Line tool**: Draw `<line>` with two-point interaction
    - Preview shape while dragging before finalizing

12. **Implement selection tool**
    - Select SVG elements by clicking
    - Highlight selected element with bounding box
    - Enable Delete key to remove selected element
    - Optional: Add move/resize handles (can defer to Phase 5)

13. **Implement exit handling**
    - Escape key: Cancel and revert to display
    - Ctrl+S: Save and revert to display
    - Save button: Save and revert
    - Cancel button: Revert without saving
    - Click outside: Show confirmation, then save and revert
    - Serialize SVG DOM to XML and save to file

### Phase 4: Reading View - Inline SVG Embed Editing
14. **Implement markdown post processor with click handlers**
    - Use `registerMarkdownPostProcessor(handler)`
    - Find internal embed elements with `.svg` extension
    - Add click event listener to entire embed
    - Add subtle visual cue (hover effect, cursor change)
    - Extract file path on click

15. **Implement embed-to-editor replacement**
    - On click: Create InlineSVGEditor instance
    - Pass embed element as replacement target
    - Load SVG content into editor
    - Editor replaces embed in DOM
    - Show toolbar

16. **Implement editor-to-display restoration**
    - On save: Write changes to SVG file
    - Restore original embed element
    - Trigger re-render of SVG to show changes
    - Use Obsidian's file update events to refresh

### Phase 5: Polish & Advanced Features
17. **Implement undo/redo**
    - Maintain history stack of SVG states (snapshots after each action)
    - Add undo/redo buttons to toolbar
    - Handle Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) keyboard shortcuts
    - Limit history stack size (e.g., last 50 actions)

18. **Add eraser tool**
    - Enable clicking on elements to delete them
    - Show visual feedback on hover
    - Optional: Add "clear all" button with confirmation

19. **Implement auto-save**
    - Periodic saves while editing (configurable interval)
    - Show "saving..." indicator in toolbar
    - Only auto-save if changes detected since last save

20. **Add command palette commands**
    - "Edit drawing at cursor" command (alternative to clicking)
    - "Exit drawing edit mode" command (alternative to save/cancel buttons)
    - Commands show up in command palette for discoverability

21. **Error handling and edge cases**
    - Handle malformed SVG files gracefully
    - Handle missing files (show error message)
    - Handle permission errors (read-only files)
    - Validate file paths before operations
    - Handle edge cases (empty drawings, very large drawings)

### Phase 6: Live Preview Support (Optional, Advanced)
22. **Implement CodeMirror 6 extension**
    - Create ViewPlugin for live preview
    - Add click handler to detect SVG embeds in live preview
    - Use `view.posAtDom()` to track embed location
    - On click: Replace embed with InlineSVGEditor
    - Handle restoration after save
    - Test in live preview mode

23. **Register editor extension**
    - Use `this.registerEditorExtension([svgEditExtension])`
    - Ensure extension works across all editor instances
    - Handle extension lifecycle (cleanup on plugin unload)
    - Test interaction with other CM6 plugins

### Phase 7: Testing & Refinement
24. **Comprehensive testing**
    - Test `/draw` command in different contexts
    - Test editing SVGs in reading view
    - Test with various SVG files (simple, complex, malformed)
    - Test file creation and updates
    - Test across different notes and folders
    - Test undo/redo functionality
    - Test auto-save behavior
    - Test with file renames (backlinks should update)
    - **Test inline editing**: Click to edit, toolbar appearance, save/cancel, exit handling
    - **Test state management**: Switching between multiple SVGs
    - **Test click outside**: Confirmation dialog, auto-save behavior
    - **Test toolbar placement**: Floating positioning, draggability
    - **Test edge cases**: Very small embeds, very large embeds, nested containers

25. **Performance optimization**
    - Optimize rendering for large drawings (many elements)
    - Debounce auto-save to avoid excessive writes
    - Optimize path simplification for smoother pen tool
    - Optimize inline editor initialization (lazy loading)
    - Minimize DOM manipulation during edit/display transitions

26. **Documentation**
    - Update README.md with comprehensive usage instructions
    - Add screenshots/GIFs demonstrating inline editing workflow
    - Document all keyboard shortcuts (Ctrl+S, Escape, etc.)
    - Add troubleshooting section
    - Document settings and their effects
    - Explain inline editing behavior (click to edit, auto-save, etc.)

## Key Obsidian APIs to Use

### Plugin Registration
```typescript
export default class DrawingBlocksPlugin extends Plugin {
  settings: DrawingBlocksSettings;
  svgFileManager: SVGFileManager;

  async onload() {
    await this.loadSettings();

    // Initialize file manager
    this.svgFileManager = new SVGFileManager(this.app, this.settings);

    // Register command for creating drawings (automatically appears in slash commands!)
    this.addCommand({
      id: 'create-new-drawing',
      name: 'Create new drawing',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.createNewDrawing(editor, view);
      }
    });

    // Optional: Add command for editing drawing at cursor
    this.addCommand({
      id: 'edit-drawing-at-cursor',
      name: 'Edit drawing at cursor',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.editDrawingAtCursor(editor, view);
      }
    });

    // Register post processor for SVG embeds (reading view)
    this.registerMarkdownPostProcessor(this.processSVGEmbeds.bind(this));

    // Optional: Register CM6 extension for live preview (Phase 6)
    // this.registerEditorExtension([createSVGEditExtension(this)]);

    // Add settings tab
    this.addSettingTab(new DrawingBlocksSettingTab(this.app, this));
  }
}
```

### Command Implementation (Auto-integrated with Slash Commands)
```typescript
async createNewDrawing(editor: Editor, view: MarkdownView) {
  try {
    // Create new SVG file with timestamp
    const timestamp = moment().format('YYYY-MM-DD-HHmmss');
    const fileName = `drawing-${timestamp}.svg`;
    const folder = this.settings.defaultFolder || 'drawings';
    const filePath = `${folder}/${fileName}`;

    // Ensure folder exists
    await this.svgFileManager.ensureFolderExists(folder);

    // Create empty SVG file
    await this.svgFileManager.createNewSVG(filePath);

    // Store cursor position for later
    const cursor = editor.getCursor();

    // Open SVG editor modal
    const modal = new SVGEditorModal(
      this.app,
      filePath,
      this.svgFileManager,
      (savedPath: string) => {
        // On save callback: insert embed at cursor
        editor.replaceRange(`![[${savedPath}]]\n`, cursor);
        new Notice('Drawing saved and embedded!');
      }
    );
    modal.open();
  } catch (error) {
    new Notice(`Failed to create drawing: ${error.message}`);
    console.error('Error creating drawing:', error);
  }
}
```

**Note**: This command automatically appears in the slash commands menu when users type `/`. No custom EditorSuggest needed!

### Markdown Post Processor (Reading View)
```typescript
processSVGEmbeds(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
  // Find all internal embed elements with .svg extension
  const embeds = el.querySelectorAll('.internal-embed[src$=".svg"]');

  embeds.forEach((embed: HTMLElement) => {
    const src = embed.getAttribute('src');
    if (!src) return;

    // Create edit button container
    const buttonContainer = embed.createDiv({ cls: 'svg-edit-button-container' });

    // Add edit button
    const editButton = buttonContainer.createEl('button', {
      cls: 'svg-edit-button',
      text: '✏️ Edit',
      attr: { 'aria-label': 'Edit SVG drawing' }
    });

    editButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openSVGEditor(src);
    });
  });
}

openSVGEditor(filePath: string) {
  const modal = new SVGEditorModal(
    this.app,
    filePath,
    this.svgFileManager,
    () => {
      // On save: trigger re-render of all embeds
      this.app.workspace.trigger('svg-updated', filePath);
    }
  );
  modal.open();
}
```

### Vault Operations
```typescript
// Read SVG file
async loadSVG(filePath: string): Promise<string> {
  const file = this.app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    return await this.app.vault.read(file);
  }
  throw new Error('File not found');
}

// Save SVG file
async saveSVG(filePath: string, content: string): Promise<void> {
  const file = this.app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    await this.app.vault.modify(file, content);
  } else {
    await this.app.vault.create(filePath, content);
  }
}
```

## UI/UX Considerations

1. **Visual Feedback**
   - Show loading indicator while loading large SVGs
   - Show save status (saving... / saved)
   - Highlight selected tool in toolbar

2. **Keyboard Shortcuts**
   - Ctrl+Z: Undo
   - Ctrl+Y: Redo
   - Delete: Remove selected element
   - Escape: Cancel/close editor
   - Ctrl+S: Save

3. **Responsive Design**
   - Editor should work on different screen sizes
   - Toolbar should be accessible
   - Consider mobile support (future)

4. **Accessibility**
   - Add proper ARIA labels
   - Support keyboard navigation
   - Ensure good color contrast

## Potential Challenges & Solutions

### Challenge 1: Real-time Drawing Performance
**Issue**: Drawing complex paths with mouse may lag
**Solution**:
- Use requestAnimationFrame for smooth rendering
- Simplify paths (reduce points) using algorithms like Douglas-Peucker
- Debounce frequent updates
- Consider using canvas for preview with SVG export

### Challenge 2: SVG File Updates in Real-time
**Issue**: Multiple notes showing same SVG need to update when edited
**Solution**:
- Use Obsidian's file event system: `this.registerEvent(this.app.vault.on('modify', callback))`
- Reload SVG displays when underlying file changes
- Consider using custom events to trigger re-renders
- Cache busting for SVG embeds (append timestamp query param)

### Challenge 3: Detecting SVG Embeds in DOM
**Issue**: Finding the right DOM elements for SVG embeds can be tricky
**Solution**:
- In reading view: Look for `.internal-embed[src$=".svg"]` elements
- In live preview: Use CodeMirror syntax tree to find wiki links
- Test with both `![[file.svg]]` and `![[file.svg|alt text]]` syntax
- Handle edge cases like relative paths and aliases

### Challenge 4: Inserting Embed After Drawing Creation
**Issue**: Need to insert `![[]]` embed at original cursor position after modal closes
**Solution**:
- Store editor reference and cursor position when opening modal
- Use editor.replaceRange() to replace `/draw` text with embed
- Handle case where user moved cursor while drawing (use stored position)
- Show notification if insertion fails

### Challenge 5: CodeMirror 6 Extension Complexity
**Issue**: CM6 extensions are complex and require understanding of the syntax tree
**Solution**:
- Make live preview support optional (Phase 6)
- Start with reading view only (simpler markdown post processor)
- Reference existing plugins (obsidian-cm6-attributes) for examples
- Use ViewPlugin.fromClass() pattern
- Test thoroughly as CM6 updates can break extensions

## Future Enhancements (Post-MVP)

1. **Advanced Drawing Tools**
   - Text insertion
   - Polygon tool
   - Bezier curves
   - Image insertion

2. **Layers Support**
   - Multiple layers for organization
   - Layer visibility toggle
   - Layer ordering (bring to front/back)

3. **Export Options**
   - Export as PNG/JPG
   - Export to clipboard
   - Embed as data URI option

4. **Collaborative Editing**
   - Real-time collaboration (if vault is synced)
   - Conflict resolution

5. **Templates**
   - Predefined canvas templates
   - Shape libraries
   - Custom presets

6. **Mobile Support**
   - Touch-based drawing
   - Simplified toolbar for mobile
   - Gesture support

## Testing Strategy

1. **Unit Tests**
   - Test SVGFileManager methods (create, read, write)
   - Test file path resolution (absolute, relative)
   - Test unique filename generation
   - Test SVG serialization/deserialization

2. **Integration Tests**
   - Test `/draw` command trigger and suggestion flow
   - Test file creation from slash command
   - Test embed insertion after save
   - Test markdown post processor detection of SVG embeds
   - Test editor open/save workflow

3. **Manual Testing Scenarios**
   - **Creation**: Type `/draw`, draw in inline editor, save, verify embed inserted
   - **Inline Editing (Reading View)**: Click SVG embed directly, verify editor replaces display, draw, save, verify display restored
   - **Inline Editing (Live Preview)**: Click SVG embed in live preview, verify inline editor works (Phase 6)
   - **Tools**: Test all drawing tools (pen, line, rect, circle, select, eraser)
   - **Toolbar**: Test toolbar positioning, dragging, tool selection
   - **Exit Methods**: Test all exit methods (Ctrl+S, Escape, Save button, Cancel button, click outside)
   - **State Management**: Click one SVG, then click another, verify first auto-closes
   - **Undo/Redo**: Make changes, undo, redo, verify state
   - **Multiple Embeds**: Edit SVG referenced in multiple notes, verify all update
   - **File Operations**: Test with different folder structures, relative paths
   - **Edge Cases**: Empty drawings, very large drawings, malformed SVG files, very small embeds
   - **Obsidian Features**: Test with file rename (backlinks update), graph view, search

## Success Criteria

The plugin will be considered successful when:
1. ✅ Users can create drawings using `/draw` command
2. ✅ Drawings are embedded with native `![[file.svg]]` syntax
3. ✅ Users can draw using basic tools (pen, shapes, select, eraser)
4. ✅ Drawings are saved as standard SVG files in the vault
5. ✅ **Users can edit any SVG by clicking directly on it (inline editing)**
6. ✅ **Editor appears exactly where the SVG was displayed (no modal/context switch)**
7. ✅ Changes persist across Obsidian restarts and sync properly
8. ✅ File renames automatically update all embeds (native Obsidian behavior)
9. ✅ Drawings appear in graph view as connections
10. ✅ The plugin performs well with reasonable-sized drawings
11. ✅ **Editing feels natural and intuitive (click to edit, save to exit)**
12. ✅ **Only one SVG can be edited at a time (no confusion)**

## Conclusion

This updated plan provides a comprehensive approach to building the Obsidian Drawing Blocks plugin using **native Obsidian embed syntax** (`![[]]`), **slash commands** (`/draw`), and **inline editing** for the best possible user experience.

### Key Decisions Summary:

1. **Use `![[file.svg]]` instead of code blocks**
   - Better UX: Native syntax users already know
   - Better integration: Graph view, backlinks, file rename support
   - Slightly more complex implementation (worth it for UX gains)

2. **Use native slash commands integration**
   - Natural workflow matching Obsidian patterns
   - Commands registered via `addCommand()` automatically appear in `/` menu
   - Zero custom code needed - Obsidian handles everything!

3. **Use inline editing instead of modals**
   - **Superior UX**: Edit exactly where you see the SVG (no context switching)
   - **Proven feasible**: ob-table-enhancer plugin demonstrates this works
   - **Natural interaction**: Click SVG to edit, save to exit
   - **More complex**: Requires state management, exit handling, toolbar positioning
   - **Worth it**: Better user experience from day one

4. **Phased Implementation**
   - **MVP (Phases 1-4)**: Slash command + Inline editing (reading view) + Basic tools
   - **Polish (Phase 5)**: Undo/redo, auto-save, error handling
   - **Advanced (Phase 6)**: Live preview inline editing (optional)
   - **Refinement (Phase 7)**: Testing, optimization, documentation

5. **Technical Stack**
   - **No external dependencies**: Use native DOM/SVG APIs
   - **Obsidian APIs**: `addCommand()`, Markdown Post Processor, Vault API
   - **DOM manipulation**: Element replacement with `replaceWith()`
   - **Native integration**: Slash commands via Obsidian's core plugin
   - **Optional CM6**: For live preview support (Phase 6)

### Implementation Priority:

**Start with these in order:**
1. SVG File Manager (Phase 1)
2. Command Registration (Phase 2) - Simple `addCommand()` call
3. **Inline SVG Editor** (Phase 3) - Core inline editing component
4. Reading View Inline Editing (Phase 4) - Click handlers and integration

Live preview support (CM6 extension) is optional and can be deferred to Phase 6 or later, allowing the plugin to be useful sooner with simpler implementation.

### Key Design Choices:

**Inline Editing Over Modal**: While modals are simpler to implement, inline editing provides a significantly better user experience by eliminating context switching. The ob-table-enhancer plugin proves this approach is viable in Obsidian.

**Native Integration**: Using native slash commands and `![[]]` embeds means the plugin feels like a natural part of Obsidian rather than a third-party addition.

**Simplicity First**: Start with core inline editing in reading view (easier), then add live preview support later (harder).

This approach delivers **exceptional UX** through **thoughtful implementation**, leveraging Obsidian's native features while pushing the boundaries with inline editing capabilities.
