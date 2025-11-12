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

**Technical Feasibility**: ✅ **Straightforward**
- Use `registerEditorSuggest` API (available since v0.12.7)
- Extend `EditorSuggest` class with `onTrigger()` and `getSuggestions()`
- Well-supported with many example implementations in community plugins

### Comparison with Code Block Approach

| Aspect | `![[file.svg]]` + `/draw` | ````drawing` code blocks |
|--------|---------------------------|-------------------------|
| User Learning Curve | None (native syntax) | Must learn custom syntax |
| File References | Tracked by Obsidian | Not tracked |
| Graph View | Shows connections | Doesn't appear |
| Refactoring | Auto-updates | Manual updates needed |
| Creation UX | Quick slash command | Manual code block typing |
| Implementation | More complex (2 systems) | Simpler (1 system) |
| Live Preview | Requires CM6 extension | Built-in support |
| **Overall** | **Better UX, more work** | **Simpler code, worse UX** |

**Decision**: Use `![[]]` + `/draw` approach for better user experience despite increased implementation complexity.

## Architecture

### 1. Main Plugin Structure

```
DrawingBlocksPlugin (extends Plugin)
├── DrawSuggest (EditorSuggest for /draw command)
├── SVGEmbedProcessor (Markdown post processor for reading view)
├── SVGLivePreviewExtension (CodeMirror 6 extension for live preview)
├── SVGEditor (Modal for SVG editing UI)
├── DrawingToolbar (drawing tools interface)
├── SVGFileManager (handles SVG file I/O)
└── Settings (plugin configuration)
```

### 2. Key Components

#### A. Slash Command Suggestor (`DrawSuggest`)
- **Purpose**: Provide `/draw` command for creating new drawings
- **API**: Extends `EditorSuggest` class, registered via `registerEditorSuggest()`
- **Key Methods**:
  - `onTrigger(cursor, editor, file)`: Detects when user types `/draw`
  - `getSuggestions(context)`: Returns drawing creation options
  - `selectSuggestion(suggestion, evt)`: Creates new SVG file and inserts `![[]]` embed

**Implementation Example**:
```typescript
class DrawSuggest extends EditorSuggest<DrawingSuggestion> {
  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line).substring(0, cursor.ch);

    // Check if line ends with /draw or /draw [partial text]
    const match = line.match(/\/draw(\s+\S*)?$/);
    if (!match) return null;

    const queryStart = line.lastIndexOf('/draw');
    return {
      start: { line: cursor.line, ch: queryStart },
      end: cursor,
      query: match[1]?.trim() || ''
    };
  }

  getSuggestions(context: EditorSuggestContext): DrawingSuggestion[] {
    return [
      { type: 'new', name: 'New blank drawing' },
      { type: 'template', name: 'New from template', templates: ['diagram', 'sketch'] }
    ];
  }

  selectSuggestion(suggestion: DrawingSuggestion, evt: MouseEvent | KeyboardEvent) {
    // Create new SVG file, open editor, insert ![[]] on save
  }
}
```

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

#### D. SVG Editor Component
- **Purpose**: Core editing interface for SVG content (Modal-based)
- **Implementation**: Extends Obsidian's `Modal` class
- **Features**:
  - Canvas area displaying the SVG
  - Drawing toolbar (tools selection)
  - Save/Cancel buttons
  - Real-time preview of changes

**Drawing Tools**:
1. **Pen/Pencil**: Freehand drawing (creates `<path>` elements)
2. **Line**: Draw straight lines (creates `<line>` elements)
3. **Rectangle**: Draw rectangles (creates `<rect>` elements)
4. **Circle**: Draw circles (creates `<circle>` elements)
5. **Select**: Select and move/resize elements
6. **Eraser**: Delete individual elements
7. **Clear**: Clear entire canvas

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
- **Purpose**: UI for selecting drawing tools and options
- **Features**:
  - Tool selection buttons
  - Color picker for stroke/fill
  - Stroke width selector
  - Undo/Redo buttons

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

#### Workflow 2: Edit Existing SVG Embed (Reading View)
1. User has embedded SVG: `![[drawings/my-drawing.svg]]`
2. In reading view, drawing displays with "Edit" button overlay
3. User clicks edit button
4. Editor modal opens with existing SVG content
5. User makes changes and clicks save
6. Changes written back to SVG file
7. All embeds of this SVG auto-refresh to show changes

#### Workflow 3: Edit Existing SVG Embed (Live Preview)
1. User has embedded SVG: `![[drawings/my-drawing.svg]]`
2. In live preview mode, wiki link shows rendered SVG with edit button
3. User clicks edit button (or uses command palette)
4. Editor modal opens with existing SVG content
5. User makes changes and saves
6. Changes written back to file
7. Live preview updates automatically

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

### Phase 2: Slash Command for Drawing Creation
4. **Implement DrawSuggest class**
   - Extend `EditorSuggest<DrawingSuggestion>`
   - Implement `onTrigger()` to detect `/draw` pattern
   - Implement `getSuggestions()` to return creation options
   - Implement `selectSuggestion()` to handle user selection

5. **Register slash command**
   - Use `this.registerEditorSuggest(new DrawSuggest(this))`
   - Test `/draw` trigger in editor
   - Verify suggestion popup appears

6. **Connect slash command to file creation**
   - Create new SVG file when suggestion selected
   - Generate unique filename with timestamp
   - Store in configured default folder
   - Keep reference to editor and cursor position for later insertion

### Phase 3: SVG Editor (Core Feature)
7. **Create SVG Editor Modal**
   - Extend Modal class
   - Create editor UI layout (canvas area + toolbar area)
   - Add SVG container element
   - Load SVG content into editor (empty or from file)
   - Style modal for full-screen or large size

8. **Implement drawing toolbar**
   - Create toolbar UI with button grid
   - Add tool selection buttons (pen, line, rect, circle, select, eraser)
   - Add color picker for stroke color
   - Add stroke width selector (slider or input)
   - Highlight currently selected tool

9. **Implement basic drawing - Pen tool**
   - Add mouse event handlers (mousedown, mousemove, mouseup)
   - Create SVG `<path>` elements on canvas
   - Build path data string with M (move) and L (line) commands
   - Render real-time drawing as user moves mouse
   - Apply current stroke color and width

10. **Implement shape tools**
    - **Rectangle tool**: Draw `<rect>` with drag interaction
    - **Circle tool**: Draw `<circle>` with drag interaction
    - **Line tool**: Draw `<line>` with two-point interaction
    - Preview shape while dragging before finalizing

11. **Implement selection tool**
    - Select SVG elements by clicking
    - Highlight selected element with bounding box or outline
    - Enable Delete key to remove selected element
    - Optional: Add move/resize handles (can defer to Phase 5)

12. **Implement save functionality**
    - Serialize SVG DOM to XML string
    - Save to file using SVGFileManager
    - If new drawing (from `/draw` command):
      - Insert `![[filepath]]` at saved cursor position
      - Replace `/draw` text with the embed
    - Close modal after successful save
    - Show success notification

### Phase 4: Reading View - SVG Embed Editing
13. **Implement markdown post processor**
    - Use `registerMarkdownPostProcessor(handler)`
    - Find internal embed elements with `.svg` extension
    - Check if embed is for SVG file (look for `.internal-embed[src$=".svg"]`)
    - Extract file path from embed element

14. **Add edit buttons to SVG embeds**
    - Create edit button overlay on SVG embeds
    - Position button over or near the SVG
    - Style button to be visible but not intrusive
    - Add click handler to open editor

15. **Connect embeds to editor**
    - Extract SVG file path from embed
    - Open editor modal with SVG content loaded
    - Enable save to update the existing file
    - Trigger vault refresh to update all embeds after save

### Phase 5: Polish & Advanced Features
16. **Implement undo/redo**
    - Maintain history stack of SVG states (snapshots after each action)
    - Add undo/redo buttons to toolbar
    - Handle Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) keyboard shortcuts
    - Limit history stack size (e.g., last 50 actions)

17. **Add eraser tool**
    - Enable clicking on elements to delete them
    - Show visual feedback on hover
    - Optional: Add "clear all" button with confirmation

18. **Implement auto-save**
    - Periodic saves while editing (configurable interval)
    - Show "saving..." indicator
    - Only auto-save if changes detected since last save

19. **Add command palette commands**
    - "Create new drawing" command (alternative to `/draw`)
    - "Edit drawing at cursor" command (if cursor on SVG embed)
    - Commands show up in command palette for discoverability

20. **Error handling and edge cases**
    - Handle malformed SVG files gracefully
    - Handle missing files (show error message)
    - Handle permission errors (read-only files)
    - Validate file paths before operations
    - Handle edge cases (empty drawings, very large drawings)

### Phase 6: Live Preview Support (Optional, Advanced)
21. **Implement CodeMirror 6 extension**
    - Create ViewPlugin for live preview
    - Detect SVG wiki links in syntax tree
    - Add decorations (edit button widgets) to SVG embeds
    - Handle click events to open editor
    - Test in live preview mode

22. **Register editor extension**
    - Use `this.registerEditorExtension([svgEditExtension])`
    - Ensure extension works across all editor instances
    - Handle extension lifecycle (cleanup on plugin unload)

### Phase 7: Testing & Refinement
23. **Comprehensive testing**
    - Test `/draw` command in different contexts
    - Test editing SVGs in reading view
    - Test with various SVG files (simple, complex, malformed)
    - Test file creation and updates
    - Test across different notes and folders
    - Test undo/redo functionality
    - Test auto-save behavior
    - Test with file renames (backlinks should update)

24. **Performance optimization**
    - Optimize rendering for large drawings (many elements)
    - Debounce auto-save to avoid excessive writes
    - Optimize path simplification for smoother pen tool
    - Consider lazy-loading editor components

25. **Documentation**
    - Update README.md with comprehensive usage instructions
    - Add screenshots/GIFs demonstrating workflows
    - Document all keyboard shortcuts
    - Add troubleshooting section
    - Document settings and their effects

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

    // Register slash command for creating drawings
    this.registerEditorSuggest(new DrawSuggest(this));

    // Register post processor for SVG embeds (reading view)
    this.registerMarkdownPostProcessor(this.processSVGEmbeds.bind(this));

    // Optional: Register CM6 extension for live preview (Phase 6)
    // this.registerEditorExtension([createSVGEditExtension(this)]);

    // Add command palette commands
    this.addCommand({
      id: 'create-new-drawing',
      name: 'Create new drawing',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.createNewDrawing(editor, view);
      }
    });

    this.addCommand({
      id: 'edit-drawing-at-cursor',
      name: 'Edit drawing at cursor',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.editDrawingAtCursor(editor, view);
      }
    });

    // Add settings tab
    this.addSettingTab(new DrawingBlocksSettingTab(this.app, this));
  }
}
```

### Slash Command (EditorSuggest)
```typescript
class DrawSuggest extends EditorSuggest<DrawingSuggestion> {
  plugin: DrawingBlocksPlugin;

  constructor(plugin: DrawingBlocksPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line).substring(0, cursor.ch);

    // Match /draw or /draw followed by optional text
    const match = line.match(/\/draw(\s+\S*)?$/);
    if (!match) return null;

    const queryStart = line.lastIndexOf('/draw');
    return {
      start: { line: cursor.line, ch: queryStart },
      end: cursor,
      query: match[1]?.trim() || ''
    };
  }

  getSuggestions(context: EditorSuggestContext): DrawingSuggestion[] {
    return [
      { type: 'blank', label: 'New blank drawing', icon: '📝' },
      { type: 'template', label: 'New from template', icon: '📋' }
    ];
  }

  selectSuggestion(suggestion: DrawingSuggestion, evt: MouseEvent | KeyboardEvent) {
    // Get editor context
    const editor = this.context.editor;
    const start = this.context.start;
    const end = this.context.end;

    // Create new SVG file
    const filePath = await this.plugin.svgFileManager.createNewSVG();

    // Open editor
    const svgEditor = new SVGEditorModal(
      this.plugin.app,
      filePath,
      this.plugin.svgFileManager,
      (savedPath: string) => {
        // On save callback: insert embed at cursor
        editor.replaceRange(`![[${savedPath}]]`, start, end);
      }
    );
    svgEditor.open();
  }
}
```

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
   - **Creation**: Type `/draw`, select option, draw, save, verify embed inserted
   - **Editing (Reading View)**: Open note with SVG embed, click edit, modify, save, verify changes
   - **Editing (Live Preview)**: Same as above but in live preview mode (Phase 6)
   - **Tools**: Test all drawing tools (pen, line, rect, circle, select, eraser)
   - **Undo/Redo**: Make changes, undo, redo, verify state
   - **Multiple Embeds**: Edit SVG referenced in multiple notes, verify all update
   - **File Operations**: Test with different folder structures, relative paths
   - **Edge Cases**: Empty drawings, very large drawings, malformed SVG files
   - **Obsidian Features**: Test with file rename (backlinks update), graph view, search

## Success Criteria

The plugin will be considered successful when:
1. ✅ Users can create drawings using `/draw` command
2. ✅ Drawings are embedded with native `![[file.svg]]` syntax
3. ✅ Users can draw using basic tools (pen, shapes, select, eraser)
4. ✅ Drawings are saved as standard SVG files in the vault
5. ✅ Users can edit any SVG embed by clicking edit button (reading view)
6. ✅ Changes persist across Obsidian restarts and sync properly
7. ✅ File renames automatically update all embeds (native Obsidian behavior)
8. ✅ Drawings appear in graph view as connections
9. ✅ The plugin performs well with reasonable-sized drawings
10. ✅ The UI is intuitive and requires no documentation for basic use

## Conclusion

This updated plan provides a comprehensive approach to building the Obsidian Drawing Blocks plugin using **native Obsidian embed syntax** (`![[]]`) and **slash commands** (`/draw`) for the best user experience.

### Key Decisions Summary:

1. **Use `![[file.svg]]` instead of code blocks**
   - Better UX: Native syntax users already know
   - Better integration: Graph view, backlinks, file rename support
   - Slightly more complex implementation (worth it for UX gains)

2. **Use `/draw` slash command for creation**
   - Natural workflow matching Obsidian patterns
   - Discoverable and easy to use
   - Straightforward implementation with EditorSuggest API

3. **Phased Implementation**
   - **MVP (Phases 1-4)**: Slash command + Reading view editing + Basic tools
   - **Polish (Phase 5)**: Undo/redo, auto-save, error handling
   - **Advanced (Phase 6)**: Live preview support (optional)
   - **Refinement (Phase 7)**: Testing, optimization, documentation

4. **Technical Stack**
   - **No external dependencies**: Use native DOM/SVG APIs
   - **Obsidian APIs**: EditorSuggest, Markdown Post Processor, Vault API
   - **Optional CM6**: For live preview support (Phase 6)

### Implementation Priority:

**Start with these in order:**
1. SVG File Manager (Phase 1)
2. Slash Command (`/draw`) (Phase 2)
3. SVG Editor Modal (Phase 3)
4. Reading View Embed Editing (Phase 4)

Live preview support (CM6 extension) is optional and can be deferred to Phase 6 or later, allowing the plugin to be useful sooner with simpler implementation.

This approach balances **excellent UX** with **pragmatic implementation**, leveraging Obsidian's native features while adding powerful drawing capabilities.
