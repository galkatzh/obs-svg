import { InlineSVGEditor } from './inline-svg-editor';

/**
 * Manages the state of inline SVG editors
 * Ensures only one editor is active at a time
 */
export class EditorStateManager {
	private activeEditor: InlineSVGEditor | null = null;

	/**
	 * Set the currently active editor
	 * Closes any previously active editor first
	 */
	async setActiveEditor(editor: InlineSVGEditor): Promise<void> {
		if (this.activeEditor && this.activeEditor !== editor) {
			await this.closeActiveEditor();
		}
		this.activeEditor = editor;
	}

	/**
	 * Get the currently active editor
	 */
	getActiveEditor(): InlineSVGEditor | null {
		return this.activeEditor;
	}

	/**
	 * Close the currently active editor (with auto-save)
	 */
	async closeActiveEditor(): Promise<void> {
		if (this.activeEditor) {
			await this.activeEditor.save();
			this.activeEditor.close();
			this.activeEditor = null;
		}
	}

	/**
	 * Check if there is an active editor
	 */
	hasActiveEditor(): boolean {
		return this.activeEditor !== null;
	}

	/**
	 * Clear the active editor reference without closing it
	 * Used when the editor closes itself
	 */
	clearActiveEditor(): void {
		this.activeEditor = null;
	}
}
