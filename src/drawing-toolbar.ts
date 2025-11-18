import { DrawingBlocksSettings } from './settings';

export type DrawingTool = 'pen' | 'line' | 'rectangle' | 'circle' | 'select' | 'eraser';

/**
 * Drawing toolbar for the inline SVG editor
 */
export class DrawingToolbar {
	private toolbarEl: HTMLElement | null = null;
	private activeTool: DrawingTool = 'pen';
	private strokeColor: string;
	private strokeWidth: number;
	private fillColor: string;
	private drawingChangeCallback: (() => void) | null = null;

	// Drawing state
	private isDrawing = false;
	private currentElement: SVGElement | null = null;
	private startPoint: { x: number; y: number } | null = null;
	private pathData = '';

	// Selection state
	private selectedElement: SVGElement | null = null;
	private selectionBox: SVGRectElement | null = null;

	// Undo/redo state
	private history: string[] = [];
	private historyIndex = -1;
	private maxHistorySize = 50;

	constructor(
		private containerEl: HTMLElement,
		private svgElement: SVGSVGElement,
		private settings: DrawingBlocksSettings,
		private onSave: () => void,
		private onCancel: () => void
	) {
		this.strokeColor = settings.defaultStrokeColor;
		this.strokeWidth = settings.defaultStrokeWidth;
		this.fillColor = settings.defaultFillColor;

		this.setupDrawingListeners();

		// Initialize history with current state (without re-rendering)
		const serializer = new XMLSerializer();
		const svgString = serializer.serializeToString(this.svgElement);
		this.history.push(svgString);
		this.historyIndex = 0;
	}

	/**
	 * Render the toolbar UI
	 */
	render(): void {
		this.toolbarEl = document.createElement('div');
		this.toolbarEl.addClass('drawing-blocks-toolbar');
		this.toolbarEl.style.cssText = `
			position: absolute;
			top: 8px;
			left: 8px;
			background: var(--background-secondary);
			border: 1px solid var(--background-modifier-border);
			border-radius: 4px;
			padding: 8px;
			display: flex;
			gap: 8px;
			align-items: center;
			z-index: 1000;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		`;

		// Tool buttons
		const toolsGroup = this.createToolsGroup();
		this.toolbarEl.appendChild(toolsGroup);

		// Separator
		this.toolbarEl.appendChild(this.createSeparator());

		// Undo/Redo buttons
		const undoRedoGroup = this.createUndoRedoGroup();
		this.toolbarEl.appendChild(undoRedoGroup);

		// Separator
		this.toolbarEl.appendChild(this.createSeparator());

		// Color and width controls
		const controlsGroup = this.createControlsGroup();
		this.toolbarEl.appendChild(controlsGroup);

		// Separator
		this.toolbarEl.appendChild(this.createSeparator());

		// Save/Cancel buttons
		const actionsGroup = this.createActionsGroup();
		this.toolbarEl.appendChild(actionsGroup);

		this.containerEl.appendChild(this.toolbarEl);
	}

	/**
	 * Create the tools group (pen, shapes, etc.)
	 */
	private createToolsGroup(): HTMLElement {
		const group = document.createElement('div');
		group.style.display = 'flex';
		group.style.gap = '4px';

		const tools: { tool: DrawingTool; label: string; icon: string }[] = [
			{ tool: 'pen', label: 'Pen', icon: '✏️' },
			{ tool: 'line', label: 'Line', icon: '📏' },
			{ tool: 'rectangle', label: 'Rectangle', icon: '▭' },
			{ tool: 'circle', label: 'Circle', icon: '⭕' },
			{ tool: 'select', label: 'Select', icon: '👆' },
			{ tool: 'eraser', label: 'Eraser', icon: '🗑️' },
		];

		tools.forEach(({ tool, label, icon }) => {
			const btn = this.createToolButton(tool, label, icon);
			group.appendChild(btn);
		});

		return group;
	}

	/**
	 * Create a tool button
	 */
	private createToolButton(tool: DrawingTool, label: string, icon: string): HTMLElement {
		const btn = document.createElement('button');
		btn.textContent = icon;
		btn.title = label;
		btn.style.cssText = `
			padding: 6px 10px;
			border: 1px solid var(--background-modifier-border);
			background: var(--background-primary);
			border-radius: 3px;
			cursor: pointer;
			font-size: 16px;
		`;

		if (tool === this.activeTool) {
			btn.style.background = 'var(--interactive-accent)';
			btn.style.color = 'var(--text-on-accent)';
		}

		btn.addEventListener('click', () => {
			this.setActiveTool(tool);
		});

		return btn;
	}

	/**
	 * Create the undo/redo group
	 */
	private createUndoRedoGroup(): HTMLElement {
		const group = document.createElement('div');
		group.style.display = 'flex';
		group.style.gap = '4px';

		// Undo button
		const undoBtn = document.createElement('button');
		undoBtn.textContent = '↶';
		undoBtn.title = 'Undo (Ctrl+Z)';
		undoBtn.style.cssText = `
			padding: 6px 10px;
			border: 1px solid var(--background-modifier-border);
			background: var(--background-primary);
			border-radius: 3px;
			cursor: pointer;
			font-size: 18px;
		`;
		undoBtn.disabled = !this.canUndo();
		if (undoBtn.disabled) {
			undoBtn.style.opacity = '0.5';
			undoBtn.style.cursor = 'not-allowed';
		}
		undoBtn.addEventListener('click', () => this.undo());
		group.appendChild(undoBtn);

		// Redo button
		const redoBtn = document.createElement('button');
		redoBtn.textContent = '↷';
		redoBtn.title = 'Redo (Ctrl+Shift+Z)';
		redoBtn.style.cssText = `
			padding: 6px 10px;
			border: 1px solid var(--background-modifier-border);
			background: var(--background-primary);
			border-radius: 3px;
			cursor: pointer;
			font-size: 18px;
		`;
		redoBtn.disabled = !this.canRedo();
		if (redoBtn.disabled) {
			redoBtn.style.opacity = '0.5';
			redoBtn.style.cursor = 'not-allowed';
		}
		redoBtn.addEventListener('click', () => this.redo());
		group.appendChild(redoBtn);

		return group;
	}

	/**
	 * Create the controls group (color, width)
	 */
	private createControlsGroup(): HTMLElement {
		const group = document.createElement('div');
		group.style.display = 'flex';
		group.style.gap = '8px';
		group.style.alignItems = 'center';

		// Color picker
		const colorLabel = document.createElement('span');
		colorLabel.textContent = 'Color:';
		colorLabel.style.fontSize = '12px';
		group.appendChild(colorLabel);

		const colorInput = document.createElement('input');
		colorInput.type = 'color';
		colorInput.value = this.strokeColor;
		colorInput.style.cursor = 'pointer';
		colorInput.addEventListener('input', (e) => {
			this.strokeColor = (e.target as HTMLInputElement).value;
		});
		group.appendChild(colorInput);

		// Width selector
		const widthLabel = document.createElement('span');
		widthLabel.textContent = 'Width:';
		widthLabel.style.fontSize = '12px';
		group.appendChild(widthLabel);

		const widthInput = document.createElement('input');
		widthInput.type = 'number';
		widthInput.min = '1';
		widthInput.max = '20';
		widthInput.value = String(this.strokeWidth);
		widthInput.style.width = '50px';
		widthInput.addEventListener('input', (e) => {
			this.strokeWidth = parseInt((e.target as HTMLInputElement).value) || 2;
		});
		group.appendChild(widthInput);

		return group;
	}

	/**
	 * Create the actions group (save, cancel)
	 */
	private createActionsGroup(): HTMLElement {
		const group = document.createElement('div');
		group.style.display = 'flex';
		group.style.gap = '4px';

		// Save button
		const saveBtn = document.createElement('button');
		saveBtn.textContent = 'Save';
		saveBtn.style.cssText = `
			padding: 6px 12px;
			border: 1px solid var(--background-modifier-border);
			background: var(--interactive-accent);
			color: var(--text-on-accent);
			border-radius: 3px;
			cursor: pointer;
			font-weight: 500;
		`;
		saveBtn.addEventListener('click', () => this.onSave());
		group.appendChild(saveBtn);

		// Cancel button
		const cancelBtn = document.createElement('button');
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = `
			padding: 6px 12px;
			border: 1px solid var(--background-modifier-border);
			background: var(--background-primary);
			border-radius: 3px;
			cursor: pointer;
		`;
		cancelBtn.addEventListener('click', () => this.onCancel());
		group.appendChild(cancelBtn);

		return group;
	}

	/**
	 * Create a separator element
	 */
	private createSeparator(): HTMLElement {
		const separator = document.createElement('div');
		separator.style.cssText = `
			width: 1px;
			height: 24px;
			background: var(--background-modifier-border);
		`;
		return separator;
	}

	/**
	 * Set the active drawing tool
	 */
	private setActiveTool(tool: DrawingTool): void {
		this.activeTool = tool;
		this.render(); // Re-render to update active state
	}

	/**
	 * Set up mouse event listeners for drawing
	 */
	private setupDrawingListeners(): void {
		this.svgElement.addEventListener('mousedown', (e) => this.handleMouseDown(e));
		this.svgElement.addEventListener('mousemove', (e) => this.handleMouseMove(e));
		this.svgElement.addEventListener('mouseup', (e) => this.handleMouseUp(e));
		this.svgElement.addEventListener('mouseleave', (e) => this.handleMouseUp(e));

		// Add keyboard listener for delete key
		document.addEventListener('keydown', (e) => this.handleKeyDown(e));
	}

	/**
	 * Handle mouse down event
	 */
	private handleMouseDown(e: MouseEvent): void {
		const target = e.target as SVGElement;

		// Handle select tool
		if (this.activeTool === 'select') {
			this.handleSelectClick(target);
			return;
		}

		// Handle eraser tool
		if (this.activeTool === 'eraser') {
			this.handleEraserClick(target);
			return;
		}

		// Clear selection when starting to draw
		this.clearSelection();

		this.isDrawing = true;
		const point = this.getMousePosition(e);
		this.startPoint = point;

		if (this.activeTool === 'pen') {
			this.startPenDrawing(point);
		} else if (this.activeTool === 'line') {
			this.startLineDrawing(point);
		} else if (this.activeTool === 'rectangle') {
			this.startRectangleDrawing(point);
		} else if (this.activeTool === 'circle') {
			this.startCircleDrawing(point);
		}
	}

	/**
	 * Handle mouse move event
	 */
	private handleMouseMove(e: MouseEvent): void {
		if (!this.isDrawing) return;

		const point = this.getMousePosition(e);

		if (this.activeTool === 'pen') {
			this.continuePenDrawing(point);
		} else if (this.activeTool === 'line' && this.currentElement) {
			this.updateLine(point);
		} else if (this.activeTool === 'rectangle' && this.currentElement) {
			this.updateRectangle(point);
		} else if (this.activeTool === 'circle' && this.currentElement) {
			this.updateCircle(point);
		}
	}

	/**
	 * Handle mouse up event
	 */
	private handleMouseUp(_e: MouseEvent): void {
		if (this.isDrawing) {
			this.isDrawing = false;
			this.currentElement = null;
			this.startPoint = null;
			this.pathData = '';

			// Save to history
			this.saveToHistory();

			// Notify of change
			if (this.drawingChangeCallback) {
				this.drawingChangeCallback();
			}
		}
	}

	/**
	 * Get mouse position relative to SVG
	 */
	private getMousePosition(e: MouseEvent): { x: number; y: number } {
		const rect = this.svgElement.getBoundingClientRect();
		const viewBox = this.svgElement.viewBox.baseVal;

		const scaleX = viewBox.width / rect.width;
		const scaleY = viewBox.height / rect.height;

		return {
			x: (e.clientX - rect.left) * scaleX,
			y: (e.clientY - rect.top) * scaleY,
		};
	}

	/**
	 * Start drawing with pen tool
	 */
	private startPenDrawing(point: { x: number; y: number }): void {
		this.currentElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		this.pathData = `M ${point.x},${point.y}`;
		this.currentElement.setAttribute('d', this.pathData);
		this.currentElement.setAttribute('stroke', this.strokeColor);
		this.currentElement.setAttribute('stroke-width', String(this.strokeWidth));
		this.currentElement.setAttribute('fill', 'none');
		this.svgElement.appendChild(this.currentElement);
	}

	/**
	 * Continue drawing with pen tool
	 */
	private continuePenDrawing(point: { x: number; y: number }): void {
		if (this.currentElement) {
			this.pathData += ` L ${point.x},${point.y}`;
			this.currentElement.setAttribute('d', this.pathData);
		}
	}

	/**
	 * Start drawing a line
	 */
	private startLineDrawing(point: { x: number; y: number }): void {
		this.currentElement = document.createElementNS('http://www.w3.org/2000/svg', 'line');
		this.currentElement.setAttribute('x1', String(point.x));
		this.currentElement.setAttribute('y1', String(point.y));
		this.currentElement.setAttribute('x2', String(point.x));
		this.currentElement.setAttribute('y2', String(point.y));
		this.currentElement.setAttribute('stroke', this.strokeColor);
		this.currentElement.setAttribute('stroke-width', String(this.strokeWidth));
		this.svgElement.appendChild(this.currentElement);
	}

	/**
	 * Update line during drag
	 */
	private updateLine(point: { x: number; y: number }): void {
		if (this.currentElement) {
			this.currentElement.setAttribute('x2', String(point.x));
			this.currentElement.setAttribute('y2', String(point.y));
		}
	}

	/**
	 * Start drawing a rectangle
	 */
	private startRectangleDrawing(point: { x: number; y: number }): void {
		this.currentElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		this.currentElement.setAttribute('x', String(point.x));
		this.currentElement.setAttribute('y', String(point.y));
		this.currentElement.setAttribute('width', '0');
		this.currentElement.setAttribute('height', '0');
		this.currentElement.setAttribute('stroke', this.strokeColor);
		this.currentElement.setAttribute('stroke-width', String(this.strokeWidth));
		this.currentElement.setAttribute('fill', this.fillColor);
		this.svgElement.appendChild(this.currentElement);
	}

	/**
	 * Update rectangle during drag
	 */
	private updateRectangle(point: { x: number; y: number }): void {
		if (this.currentElement && this.startPoint) {
			const width = Math.abs(point.x - this.startPoint.x);
			const height = Math.abs(point.y - this.startPoint.y);
			const x = Math.min(point.x, this.startPoint.x);
			const y = Math.min(point.y, this.startPoint.y);

			this.currentElement.setAttribute('x', String(x));
			this.currentElement.setAttribute('y', String(y));
			this.currentElement.setAttribute('width', String(width));
			this.currentElement.setAttribute('height', String(height));
		}
	}

	/**
	 * Start drawing a circle
	 */
	private startCircleDrawing(point: { x: number; y: number }): void {
		this.currentElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		this.currentElement.setAttribute('cx', String(point.x));
		this.currentElement.setAttribute('cy', String(point.y));
		this.currentElement.setAttribute('r', '0');
		this.currentElement.setAttribute('stroke', this.strokeColor);
		this.currentElement.setAttribute('stroke-width', String(this.strokeWidth));
		this.currentElement.setAttribute('fill', this.fillColor);
		this.svgElement.appendChild(this.currentElement);
	}

	/**
	 * Update circle during drag
	 */
	private updateCircle(point: { x: number; y: number }): void {
		if (this.currentElement && this.startPoint) {
			const dx = point.x - this.startPoint.x;
			const dy = point.y - this.startPoint.y;
			const radius = Math.sqrt(dx * dx + dy * dy);

			this.currentElement.setAttribute('r', String(radius));
		}
	}

	/**
	 * Handle select tool click
	 */
	private handleSelectClick(target: SVGElement): void {
		// Don't select the SVG itself or the selection box
		if (target === this.svgElement || target === this.selectionBox) {
			this.clearSelection();
			return;
		}

		// Check if the target is a drawable element
		if (target.tagName === 'path' || target.tagName === 'line' ||
		    target.tagName === 'rect' || target.tagName === 'circle') {
			this.selectElement(target);
		} else {
			this.clearSelection();
		}
	}

	/**
	 * Select an element
	 */
	private selectElement(element: SVGElement): void {
		this.clearSelection();
		this.selectedElement = element;

		// Create selection box
		const bbox = (element as SVGGraphicsElement).getBBox();
		this.selectionBox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		this.selectionBox.setAttribute('x', String(bbox.x - 2));
		this.selectionBox.setAttribute('y', String(bbox.y - 2));
		this.selectionBox.setAttribute('width', String(bbox.width + 4));
		this.selectionBox.setAttribute('height', String(bbox.height + 4));
		this.selectionBox.setAttribute('fill', 'none');
		this.selectionBox.setAttribute('stroke', '#4299e1');
		this.selectionBox.setAttribute('stroke-width', '2');
		this.selectionBox.setAttribute('stroke-dasharray', '5,5');
		this.selectionBox.style.pointerEvents = 'none';
		this.svgElement.appendChild(this.selectionBox);
	}

	/**
	 * Clear current selection
	 */
	private clearSelection(): void {
		if (this.selectionBox) {
			this.selectionBox.remove();
			this.selectionBox = null;
		}
		this.selectedElement = null;
	}

	/**
	 * Handle eraser tool click
	 */
	private handleEraserClick(target: SVGElement): void {
		// Don't erase the SVG itself or the selection box
		if (target === this.svgElement || target === this.selectionBox) {
			return;
		}

		// Check if the target is a drawable element
		if (target.tagName === 'path' || target.tagName === 'line' ||
		    target.tagName === 'rect' || target.tagName === 'circle') {
			target.remove();
			this.saveToHistory();

			// Notify of change
			if (this.drawingChangeCallback) {
				this.drawingChangeCallback();
			}
		}
	}

	/**
	 * Handle keyboard events
	 */
	private handleKeyDown(e: KeyboardEvent): void {
		// Undo: Ctrl+Z (but not Ctrl+Shift+Z)
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			if (this.canUndo()) {
				e.preventDefault();
				this.undo();
			}
		}

		// Redo: Ctrl+Shift+Z or Ctrl+Y
		if (((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) ||
		    ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
			if (this.canRedo()) {
				e.preventDefault();
				this.redo();
			}
		}

		// Delete key: delete selected element
		if (e.key === 'Delete' || e.key === 'Backspace') {
			if (this.selectedElement) {
				e.preventDefault();
				this.selectedElement.remove();
				this.clearSelection();
				this.saveToHistory();

				// Notify of change
				if (this.drawingChangeCallback) {
					this.drawingChangeCallback();
				}
			}
		}
	}

	/**
	 * Save current SVG state to history
	 */
	private saveToHistory(): void {
		const serializer = new XMLSerializer();
		const svgString = serializer.serializeToString(this.svgElement);

		// Remove any future states (when undoing and then making a new change)
		this.history = this.history.slice(0, this.historyIndex + 1);

		// Add new state
		this.history.push(svgString);

		// Limit history size
		if (this.history.length > this.maxHistorySize) {
			this.history.shift();
		} else {
			this.historyIndex++;
		}
	}

	/**
	 * Check if undo is available
	 */
	private canUndo(): boolean {
		return this.historyIndex > 0;
	}

	/**
	 * Check if redo is available
	 */
	private canRedo(): boolean {
		return this.historyIndex < this.history.length - 1;
	}

	/**
	 * Undo the last action
	 */
	private undo(): void {
		if (!this.canUndo()) return;

		this.historyIndex--;
		this.restoreFromHistory();
		this.render();
	}

	/**
	 * Redo the last undone action
	 */
	private redo(): void {
		if (!this.canRedo()) return;

		this.historyIndex++;
		this.restoreFromHistory();
		this.render();
	}

	/**
	 * Restore SVG from history at current index
	 */
	private restoreFromHistory(): void {
		if (this.historyIndex < 0 || this.historyIndex >= this.history.length) {
			return;
		}

		const svgString = this.history[this.historyIndex];
		const parser = new DOMParser();
		const doc = parser.parseFromString(svgString, 'image/svg+xml');
		const newSvg = doc.querySelector('svg');

		if (newSvg) {
			// Clear current SVG content
			while (this.svgElement.firstChild) {
				this.svgElement.removeChild(this.svgElement.firstChild);
			}

			// Copy attributes
			Array.from(newSvg.attributes).forEach(attr => {
				this.svgElement.setAttribute(attr.name, attr.value);
			});

			// Copy children
			Array.from(newSvg.children).forEach(child => {
				this.svgElement.appendChild(child.cloneNode(true));
			});

			this.clearSelection();

			// Notify of change
			if (this.drawingChangeCallback) {
				this.drawingChangeCallback();
			}
		}
	}

	/**
	 * Register a callback for drawing changes
	 */
	onDrawingChange(callback: () => void): void {
		this.drawingChangeCallback = callback;
	}

	/**
	 * Clean up and destroy the toolbar
	 */
	destroy(): void {
		if (this.toolbarEl) {
			this.toolbarEl.remove();
			this.toolbarEl = null;
		}
		this.clearSelection();
	}
}
