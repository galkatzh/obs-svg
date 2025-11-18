import { App, TFile, TFolder, Notice } from 'obsidian';
import { DrawingBlocksSettings } from './settings';

export class SVGFileManager {
	constructor(
		private app: App,
		private settings: DrawingBlocksSettings
	) {}

	/**
	 * Create a new SVG file with the given path and initial content
	 */
	async createNewSVG(filePath: string): Promise<TFile> {
		const content = this.generateEmptySVG();

		// Ensure the folder exists
		const folderPath = this.getFolderPath(filePath);
		await this.ensureFolderExists(folderPath);

		// Create the file
		try {
			const file = await this.app.vault.create(filePath, content);
			return file;
		} catch (error) {
			new Notice(`Error creating SVG file: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Load SVG content from a file
	 */
	async loadSVG(filePath: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (file instanceof TFile) {
			try {
				return await this.app.vault.read(file);
			} catch (error) {
				new Notice(`Error reading SVG file: ${error.message}`);
				throw error;
			}
		}

		throw new Error(`File not found: ${filePath}`);
	}

	/**
	 * Save SVG content to a file
	 */
	async saveSVG(filePath: string, content: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (file instanceof TFile) {
			try {
				await this.app.vault.modify(file, content);
			} catch (error) {
				new Notice(`Error saving SVG file: ${error.message}`);
				throw error;
			}
		} else {
			// File doesn't exist, create it
			await this.createNewSVG(filePath);
			// Now save the content
			const newFile = this.app.vault.getAbstractFileByPath(filePath);
			if (newFile instanceof TFile) {
				await this.app.vault.modify(newFile, content);
			}
		}
	}

	/**
	 * Generate a timestamp-based filename
	 */
	generateFilename(): string {
		const timestamp = new Date().toISOString()
			.replace(/[:.]/g, '-')
			.replace('T', '-')
			.split('.')[0]; // Remove milliseconds and timezone

		return `drawing-${timestamp}.svg`;
	}

	/**
	 * Generate a full file path with the default folder
	 */
	generateFilePath(): string {
		const filename = this.generateFilename();
		return `${this.settings.defaultFolder}/${filename}`;
	}

	/**
	 * Generate empty SVG content with default dimensions
	 */
	private generateEmptySVG(): string {
		const { defaultWidth, defaultHeight } = this.settings;

		return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${defaultWidth}" height="${defaultHeight}" viewBox="0 0 ${defaultWidth} ${defaultHeight}">
  <!-- Drawing elements will be added here -->
</svg>`;
	}

	/**
	 * Ensure a folder exists, creating it if necessary
	 */
	private async ensureFolderExists(folderPath: string): Promise<void> {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);

		if (!folder) {
			try {
				await this.app.vault.createFolder(folderPath);
			} catch (error) {
				// Folder might already exist or parent folder missing
				// Try to create parent folders recursively
				const parts = folderPath.split('/');
				let currentPath = '';

				for (const part of parts) {
					currentPath = currentPath ? `${currentPath}/${part}` : part;
					const existing = this.app.vault.getAbstractFileByPath(currentPath);

					if (!existing) {
						try {
							await this.app.vault.createFolder(currentPath);
						} catch (e) {
							// Ignore if folder already exists
						}
					}
				}
			}
		}
	}

	/**
	 * Extract folder path from file path
	 */
	private getFolderPath(filePath: string): string {
		const lastSlash = filePath.lastIndexOf('/');
		return lastSlash > 0 ? filePath.substring(0, lastSlash) : '';
	}

	/**
	 * Validate that a file path is an SVG file
	 */
	isSVGFile(filePath: string): boolean {
		return filePath.toLowerCase().endsWith('.svg');
	}

	/**
	 * Get relative path from vault root
	 */
	getRelativePath(file: TFile): string {
		return file.path;
	}
}
