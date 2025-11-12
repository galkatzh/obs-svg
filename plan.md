# Obsidian Drawing Blocks Plugin - Implementation Plan

## Overview

This plugin will enable users to create and edit SVG drawings directly within their Obsidian notes. Every drawing block is essentially an editable SVG image that can be created inline or imported from existing SVG files in the vault.

## Core Features

1. **Drawing Blocks**: Insert custom code blocks (```drawing) that render as editable SVG canvases
2. **SVG File Editing**: Click on any displayed SVG image in a note to edit it
3. **Persistent Storage**: All edits are saved back to the SVG file
4. **Drawing Tools**: Basic drawing capabilities (pen, shapes, eraser, selection, deletion)

## Architecture

### 1. Main Plugin Structure

```
DrawingBlocksPlugin (extends Plugin)
├── SVGEditor (class for SVG editing UI)
├── DrawingToolbar (drawing tools interface)
├── SVGFileManager (handles SVG file I/O)
└── Settings (plugin configuration)
```

### 2. Key Components

#### A. Code Block Processor
- **Purpose**: Render ```drawing code blocks as editable SVG canvases
- **API**: `registerMarkdownCodeBlockProcessor('drawing', handler)`
- **Functionality**:
  - Parse code block content to determine if it references an existing SVG file or is a new drawing
  - Create an editable SVG container in the DOM
  - Load existing SVG content if specified
  - Attach event listeners for editing

**Code Block Syntax**:
```
```drawing
file: drawings/my-drawing.svg
width: 800
height: 600
```
```

or for new drawings:
```
```drawing
width: 800
height: 600
```
```

#### B. Markdown Post Processor
- **Purpose**: Make SVG images in notes editable
- **API**: `registerMarkdownPostProcessor(handler)`
- **Functionality**:
  - Find all `<img>` tags with `.svg` sources
  - Add "Edit" button overlay or click handler
  - Open SVG editor when clicked

#### C. SVG Editor Component
- **Purpose**: Core editing interface for SVG content
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

#### D. SVG File Manager
- **Purpose**: Handle all file operations for SVG files
- **API Usage**:
  - `this.app.vault.read(file)` - Read SVG content
  - `this.app.vault.modify(file, data)` - Save changes to existing SVG
  - `this.app.vault.create(path, data)` - Create new SVG file
  - `this.app.vault.getAbstractFileByPath(path)` - Get TFile reference

**Responsibilities**:
- Parse SVG XML to DOM
- Serialize SVG DOM back to XML string
- Manage file paths and references
- Handle file creation with unique names (auto-increment if name exists)

#### E. Drawing Toolbar
- **Purpose**: UI for selecting drawing tools and options
- **Features**:
  - Tool selection buttons
  - Color picker for stroke/fill
  - Stroke width selector
  - Undo/Redo buttons

### 3. User Workflows

#### Workflow 1: Create New Drawing Block
1. User inserts ```drawing code block in note
2. Plugin renders empty SVG canvas with toolbar
3. User draws on canvas
4. On save, plugin creates new SVG file in configured folder (default: `drawings/`)
5. Plugin updates code block to reference the new file path

#### Workflow 2: Edit Existing Drawing from Code Block
1. Code block references existing SVG file
2. Plugin loads and displays SVG with edit button
3. User clicks edit button
4. Editor opens with existing content
5. User makes changes and saves
6. Changes written back to SVG file

#### Workflow 3: Edit SVG Image in Note
1. User has embedded SVG image: `![drawing](drawings/my-drawing.svg)`
2. Plugin adds edit capability to the image
3. User clicks edit icon/button
4. Editor opens with SVG content
5. User makes changes and saves
6. Changes written back to the file

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
   - Create basic file structure for components
   - Install any needed dependencies

2. **Implement SVG File Manager**
   - Create `SVGFileManager` class
   - Implement read/write operations using Vault API
   - Add path resolution logic
   - Add file creation with auto-naming

3. **Create basic Settings**
   - Implement settings interface
   - Add settings tab with basic options
   - Load/save settings

### Phase 2: Code Block Processor (Core Feature)
4. **Register code block processor**
   - Use `registerMarkdownCodeBlockProcessor('drawing', handler)`
   - Parse code block content
   - Create container DOM element

5. **Implement basic SVG display**
   - Load SVG content from file (if specified)
   - Render SVG in the code block container
   - Add "Edit" button

### Phase 3: SVG Editor (Core Feature)
6. **Create SVG Editor Modal**
   - Extend Modal class
   - Create editor UI layout (canvas + toolbar)
   - Load SVG content into editor

7. **Implement drawing toolbar**
   - Create toolbar UI
   - Add tool selection buttons
   - Add color picker and stroke width controls

8. **Implement basic drawing - Pen tool**
   - Add mouse event handlers
   - Create SVG path elements on canvas
   - Render real-time drawing

9. **Implement shape tools**
   - Rectangle tool
   - Circle tool
   - Line tool

10. **Implement selection tool**
    - Select SVG elements by clicking
    - Highlight selected elements
    - Delete selected elements (Delete key)

11. **Implement save functionality**
    - Serialize SVG DOM to XML string
    - Save to file using SVGFileManager
    - Update code block if needed (new file created)

### Phase 4: Image Editing
12. **Implement markdown post processor**
    - Use `registerMarkdownPostProcessor(handler)`
    - Find SVG image elements
    - Add edit button/overlay

13. **Connect images to editor**
    - Open editor when edit button clicked
    - Load SVG file content
    - Save changes back to file

### Phase 5: Polish & Advanced Features
14. **Implement undo/redo**
    - Maintain history stack of SVG states
    - Add undo/redo buttons
    - Handle Ctrl+Z / Ctrl+Y shortcuts

15. **Add eraser tool**
    - Delete individual elements by clicking

16. **Implement auto-save**
    - Periodic saves while editing
    - Configurable interval

17. **Add view-only mode**
    - Render drawings in reading view
    - No edit button in reading view (or show with proper check)

18. **Error handling and edge cases**
    - Handle malformed SVG files
    - Handle missing files
    - Handle permission errors

### Phase 6: Testing & Refinement
19. **Testing**
    - Test with various SVG files
    - Test file creation and updates
    - Test across different notes and folders
    - Test undo/redo functionality

20. **Performance optimization**
    - Optimize rendering for large drawings
    - Debounce auto-save
    - Lazy-load editor components

21. **Documentation**
    - Update README.md with usage instructions
    - Add examples
    - Document keyboard shortcuts

## Key Obsidian APIs to Use

### Plugin Registration
```typescript
export default class DrawingBlocksPlugin extends Plugin {
  settings: DrawingBlocksSettings;

  async onload() {
    await this.loadSettings();

    // Register code block processor
    this.registerMarkdownCodeBlockProcessor('drawing', this.processDrawingBlock.bind(this));

    // Register post processor for SVG images
    this.registerMarkdownPostProcessor(this.processSVGImages.bind(this));

    // Add commands
    this.addCommand({
      id: 'insert-drawing-block',
      name: 'Insert drawing block',
      editorCallback: this.insertDrawingBlock.bind(this)
    });

    // Add settings tab
    this.addSettingTab(new DrawingBlocksSettingTab(this.app, this));
  }
}
```

### Code Block Processor
```typescript
processDrawingBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
  // Parse source for parameters (file path, width, height)
  const params = this.parseDrawingBlockParams(source);

  // Create container
  const container = el.createDiv({ cls: 'drawing-block-container' });

  // If file exists, load and display
  if (params.file) {
    this.loadAndDisplaySVG(params.file, container, ctx);
  } else {
    // Show empty canvas with edit button to create new
    this.createNewDrawingPlaceholder(container, ctx);
  }

  // Add edit button
  const editBtn = container.createEl('button', { text: 'Edit' });
  editBtn.addEventListener('click', () => {
    this.openEditor(params, ctx);
  });
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

### Challenge 2: SVG File Updates in Real-time
**Issue**: Multiple notes showing same SVG need to update when edited
**Solution**:
- Use Obsidian's file event system: `this.registerEvent(this.app.vault.on('modify', callback))`
- Reload SVG displays when underlying file changes
- Add version tracking or checksums

### Challenge 3: Code Block Updates After Creating New File
**Issue**: Need to update code block content after creating new SVG file
**Solution**:
- This is challenging as code block processors don't easily allow modifying source
- Alternative: Show file path in UI, let user manually update the code block
- Or: Provide command to "save drawing reference" that inserts the path

### Challenge 4: Editing in Source Mode
**Issue**: User might edit in source mode and mess up code block syntax
**Solution**:
- Validate code block parameters
- Show helpful error messages
- Provide default values for missing parameters

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
   - Test SVGFileManager methods
   - Test parameter parsing
   - Test SVG serialization/deserialization

2. **Integration Tests**
   - Test file creation and updates
   - Test code block rendering
   - Test editor save functionality

3. **Manual Testing Scenarios**
   - Create new drawing in note
   - Edit existing SVG file
   - Use all drawing tools
   - Test undo/redo
   - Test with multiple notes referencing same SVG
   - Test with different folder structures

## Success Criteria

The plugin will be considered successful when:
1. Users can insert drawing blocks in notes
2. Users can draw using basic tools (pen, shapes)
3. Drawings are saved as SVG files in the vault
4. Users can edit existing SVG images
5. Changes persist across Obsidian restarts
6. The plugin performs well with reasonable-sized drawings
7. The UI is intuitive and easy to use

## Conclusion

This plan provides a structured approach to building the Obsidian Drawing Blocks plugin. By following the phased implementation approach, we'll build a solid foundation and progressively add features. The core functionality (code blocks + editor + file management) should be prioritized, with advanced features added later based on user feedback and needs.
