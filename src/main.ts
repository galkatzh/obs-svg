import { App, Editor, MarkdownView, MarkdownPostProcessorContext, Notice, Plugin } from 'obsidian';
import { DrawingBlocksSettings, DEFAULT_SETTINGS } from './settings';
import { DrawingBlocksSettingTab } from './settings-tab';
import { SVGFileManager } from './svg-file-manager';
import { EditorStateManager } from './editor-state-manager';
import { InlineSVGEditor } from './inline-svg-editor';

export default class DrawingBlocksPlugin extends Plugin {
	settings: DrawingBlocksSettings;
	svgFileManager: SVGFileManager;
	editorStateManager: EditorStateManager;

	async onload() {
		await this.loadSettings();

		// Initialize managers
		this.svgFileManager = new SVGFileManager(this.app, this.settings);
		this.editorStateManager = new EditorStateManager();

		// Register /draw command
		this.addCommand({
			id: 'create-new-drawing',
			name: 'Create new drawing',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				await this.createNewDrawing(editor, view);
			}
		});

		// Register markdown post processor for click-to-edit in reading view
		this.registerMarkdownPostProcessor(this.processSVGEmbeds.bind(this));

		// Add settings tab
		this.addSettingTab(new DrawingBlocksSettingTab(this.app, this));

		console.log('Drawing Blocks plugin loaded');
	}

	onunload() {
		// Close any active editors
		this.editorStateManager.closeActiveEditor();
		console.log('Drawing Blocks plugin unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Create a new drawing via the /draw command
	 */
	async createNewDrawing(editor: Editor, _view: MarkdownView) {
		// Generate file path
		const filePath = this.svgFileManager.generateFilePath();

		// Create the SVG file
		try {
			await this.svgFileManager.createNewSVG(filePath);
		} catch (error) {
			new Notice(`Error creating drawing: ${error.message}`);
			return;
		}

		// Get cursor position
		const cursor = editor.getCursor();

		// Create inline editor
		const inlineEditor = new InlineSVGEditor(
			this.app,
			filePath,
			this.svgFileManager,
			this.settings,
			() => {
				// On save callback: insert embed at cursor
				editor.replaceRange(`![[${filePath}]]\n`, cursor);
				this.editorStateManager.clearActiveEditor();
			}
		);

		// Open the editor (we'll need to find a good place to attach it)
		// For now, we'll create a modal-like overlay
		const editorContainer = document.body.createDiv('drawing-blocks-modal-overlay');
		editorContainer.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background: rgba(0, 0, 0, 0.5);
			display: flex;
			align-items: center;
			justify-content: center;
			z-index: 10000;
		`;

		const editorWrapper = editorContainer.createDiv('drawing-blocks-modal');
		editorWrapper.style.cssText = `
			background: var(--background-primary);
			border-radius: 8px;
			padding: 16px;
			max-width: 90vw;
			max-height: 90vh;
			overflow: auto;
		`;

		await inlineEditor.open(editorWrapper);
		this.editorStateManager.setActiveEditor(inlineEditor);

		// Override the close method to also remove the overlay
		const originalClose = inlineEditor.close.bind(inlineEditor);
		inlineEditor.close = () => {
			originalClose();
			editorContainer.remove();
			this.editorStateManager.clearActiveEditor();
		};
	}

	/**
	 * Process SVG embeds in markdown to add click-to-edit functionality
	 */
	processSVGEmbeds(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		// Find all internal embeds that are SVG files
		const embeds = el.querySelectorAll('.internal-embed[src$=".svg"]');

		embeds.forEach((embed: HTMLElement) => {
			const src = embed.getAttribute('src');
			if (!src) return;

			// Add visual cue class
			embed.addClass('svg-editable');

			// Add click listener
			this.registerDomEvent(embed, 'click', async (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				await this.openInlineEditor(embed, src);
			});
		});
	}

	/**
	 * Open inline editor for an SVG embed
	 */
	async openInlineEditor(element: HTMLElement, filePath: string) {
		// Close any existing editor first
		await this.editorStateManager.closeActiveEditor();

		// Create new editor
		const editor = new InlineSVGEditor(
			this.app,
			filePath,
			this.svgFileManager,
			this.settings,
			() => {
				// On save callback: trigger re-render
				this.app.workspace.trigger('drawing-blocks:svg-updated', filePath);
				this.editorStateManager.clearActiveEditor();
			}
		);

		// Replace the embed element with the editor
		await editor.replaceElement(element);
		this.editorStateManager.setActiveEditor(editor);
	}
}
