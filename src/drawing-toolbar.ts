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
	}

	/**
	 * Handle mouse down event
	 */
	private handleMouseDown(e: MouseEvent): void {
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
	}
}
