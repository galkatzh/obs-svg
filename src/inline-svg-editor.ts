import { App, Notice } from 'obsidian';
import { SVGFileManager } from './svg-file-manager';
import { DrawingToolbar } from './drawing-toolbar';
import { DrawingBlocksSettings } from './settings';

/**
 * Inline SVG editor that replaces an embed element with an editable canvas
 */
export class InlineSVGEditor {
	private containerEl: HTMLElement | null = null;
	private svgElement: SVGSVGElement | null = null;
	private toolbar: DrawingToolbar | null = null;
	private originalElement: HTMLElement | null = null;
	private parentElement: HTMLElement | null = null;
	private hasUnsavedChanges = false;
	private onSaveCallback: (() => void) | null = null;

	constructor(
		private app: App,
		private filePath: string,
		private svgFileManager: SVGFileManager,
		private settings: DrawingBlocksSettings,
		onSave?: () => void
	) {
		this.onSaveCallback = onSave || null;
	}

	/**
	 * Replace an existing element with the inline editor
	 */
	async replaceElement(element: HTMLElement): Promise<void> {
		this.originalElement = element;
		this.parentElement = element.parentElement;

		if (!this.parentElement) {
			new Notice('Cannot create editor: no parent element');
			return;
		}

		// Load the SVG content
		let svgContent: string;
		try {
			svgContent = await this.svgFileManager.loadSVG(this.filePath);
		} catch (error) {
			new Notice(`Error loading SVG: ${error.message}`);
			return;
		}

		// Create the editor container
		this.createEditorContainer();

		// Parse and insert the SVG
		this.loadSVGContent(svgContent);

		// Create and show the toolbar
		this.createToolbar();

		// Replace the original element
		this.parentElement.replaceChild(this.containerEl!, element);

		// Set up event listeners
		this.setupEventListeners();
	}

	/**
	 * Open the editor at a specific location (for new drawings)
	 */
	async open(parentEl: HTMLElement): Promise<void> {
		this.parentElement = parentEl;

		// Create empty SVG
		const svgContent = await this.svgFileManager.loadSVG(this.filePath);

		// Create the editor container
		this.createEditorContainer();

		// Parse and insert the SVG
		this.loadSVGContent(svgContent);

		// Create and show the toolbar
		this.createToolbar();

		// Add to parent
		parentEl.appendChild(this.containerEl!);

		// Set up event listeners
		this.setupEventListeners();
	}

	/**
	 * Create the editor container element
	 */
	private createEditorContainer(): void {
		this.containerEl = document.createElement('div');
		this.containerEl.addClass('drawing-blocks-editor');

		// Set minimum size
		this.containerEl.style.minWidth = '400px';
		this.containerEl.style.minHeight = '300px';
		this.containerEl.style.border = '2px solid var(--interactive-accent)';
		this.containerEl.style.borderRadius = '4px';
		this.containerEl.style.padding = '8px';
		this.containerEl.style.backgroundColor = 'var(--background-primary)';
		this.containerEl.style.position = 'relative';
	}

	/**
	 * Load SVG content into the editor
	 */
	private loadSVGContent(svgContent: string): void {
		const parser = new DOMParser();
		const doc = parser.parseFromString(svgContent, 'image/svg+xml');
		const svgEl = doc.querySelector('svg');

		if (svgEl) {
			this.svgElement = svgEl as unknown as SVGSVGElement;
			this.svgElement.style.width = '100%';
			this.svgElement.style.height = '100%';
			this.svgElement.style.cursor = 'crosshair';
			this.containerEl!.appendChild(this.svgElement);
		} else {
			new Notice('Invalid SVG content');
		}
	}

	/**
	 * Create and attach the drawing toolbar
	 */
	private createToolbar(): void {
		if (!this.containerEl || !this.svgElement) return;

		this.toolbar = new DrawingToolbar(
			this.containerEl,
			this.svgElement,
			this.settings,
			() => this.handleSave(),
			() => this.handleCancel()
		);

		this.toolbar.render();

		// Listen for drawing changes
		this.toolbar.onDrawingChange(() => {
			this.hasUnsavedChanges = true;
		});
	}

	/**
	 * Set up event listeners for keyboard shortcuts
	 */
	private setupEventListeners(): void {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Ctrl+S / Cmd+S: Save and close
			if ((e.ctrlKey || e.metaKey) && e.key === 's') {
				e.preventDefault();
				this.handleSave();
			}

			// Escape: Cancel
			if (e.key === 'Escape') {
				e.preventDefault();
				this.handleCancel();
			}
		};

		document.addEventListener('keydown', handleKeyDown);

		// Store cleanup function
		if (this.containerEl) {
			(this.containerEl as any)._keydownHandler = handleKeyDown;
		}
	}

	/**
	 * Save the current drawing
	 */
	async save(): Promise<void> {
		if (!this.svgElement) return;

		// Serialize the SVG
		const serializer = new XMLSerializer();
		const svgString = serializer.serializeToString(this.svgElement);

		// Add XML declaration
		const fullSvgContent = `<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`;

		// Save to file
		try {
			await this.svgFileManager.saveSVG(this.filePath, fullSvgContent);
			this.hasUnsavedChanges = false;
		} catch (error) {
			new Notice(`Error saving drawing: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Handle save button click
	 */
	private async handleSave(): Promise<void> {
		await this.save();
		new Notice('Drawing saved!');

		// Call the save callback if provided
		if (this.onSaveCallback) {
			this.onSaveCallback();
		}

		this.close();
	}

	/**
	 * Handle cancel button click
	 */
	private handleCancel(): void {
		if (this.hasUnsavedChanges) {
			// Use native confirm for now - could be replaced with Obsidian modal in future
			const confirmed = confirm('You have unsaved changes. Discard changes and close?');
			if (!confirmed) return;
		}

		this.close();
	}

	/**
	 * Close the editor and restore the original element
	 */
	close(): void {
		// Clean up event listeners
		if (this.containerEl && (this.containerEl as any)._keydownHandler) {
			document.removeEventListener('keydown', (this.containerEl as any)._keydownHandler);
		}

		// Clean up toolbar
		if (this.toolbar) {
			this.toolbar.destroy();
			this.toolbar = null;
		}

		// Restore original element if it exists
		if (this.originalElement && this.parentElement && this.containerEl) {
			this.parentElement.replaceChild(this.originalElement, this.containerEl);
		} else if (this.containerEl) {
			// Just remove the editor if no original element
			this.containerEl.remove();
		}

		// Clear references
		this.containerEl = null;
		this.svgElement = null;
		this.originalElement = null;
		this.parentElement = null;
	}

	/**
	 * Get the file path being edited
	 */
	getFilePath(): string {
		return this.filePath;
	}
}
