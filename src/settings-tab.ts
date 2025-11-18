import { App, PluginSettingTab, Setting } from 'obsidian';
import DrawingBlocksPlugin from './main';

export class DrawingBlocksSettingTab extends PluginSettingTab {
	plugin: DrawingBlocksPlugin;

	constructor(app: App, plugin: DrawingBlocksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Drawing Blocks Settings' });

		// Default folder
		new Setting(containerEl)
			.setName('Default drawings folder')
			.setDesc('Folder where new drawings will be saved')
			.addText(text => text
				.setPlaceholder('drawings')
				.setValue(this.plugin.settings.defaultFolder)
				.onChange(async (value) => {
					this.plugin.settings.defaultFolder = value || 'drawings';
					await this.plugin.saveSettings();
				}));

		// Canvas dimensions
		containerEl.createEl('h3', { text: 'Canvas Settings' });

		new Setting(containerEl)
			.setName('Default canvas width')
			.setDesc('Width of new drawing canvases (in pixels)')
			.addText(text => text
				.setPlaceholder('800')
				.setValue(String(this.plugin.settings.defaultWidth))
				.onChange(async (value) => {
					const width = parseInt(value);
					if (!isNaN(width) && width > 0) {
						this.plugin.settings.defaultWidth = width;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Default canvas height')
			.setDesc('Height of new drawing canvases (in pixels)')
			.addText(text => text
				.setPlaceholder('600')
				.setValue(String(this.plugin.settings.defaultHeight))
				.onChange(async (value) => {
					const height = parseInt(value);
					if (!isNaN(height) && height > 0) {
						this.plugin.settings.defaultHeight = height;
						await this.plugin.saveSettings();
					}
				}));

		// Drawing defaults
		containerEl.createEl('h3', { text: 'Drawing Defaults' });

		new Setting(containerEl)
			.setName('Default stroke color')
			.setDesc('Default color for drawing tools')
			.addText(text => text
				.setPlaceholder('#000000')
				.setValue(this.plugin.settings.defaultStrokeColor)
				.onChange(async (value) => {
					this.plugin.settings.defaultStrokeColor = value || '#000000';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default stroke width')
			.setDesc('Default width for drawing strokes (in pixels)')
			.addText(text => text
				.setPlaceholder('2')
				.setValue(String(this.plugin.settings.defaultStrokeWidth))
				.onChange(async (value) => {
					const width = parseInt(value);
					if (!isNaN(width) && width > 0) {
						this.plugin.settings.defaultStrokeWidth = width;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Default fill color')
			.setDesc('Default fill color for shapes (use "none" for no fill)')
			.addText(text => text
				.setPlaceholder('none')
				.setValue(this.plugin.settings.defaultFillColor)
				.onChange(async (value) => {
					this.plugin.settings.defaultFillColor = value || 'none';
					await this.plugin.saveSettings();
				}));

		// Auto-save settings
		containerEl.createEl('h3', { text: 'Auto-save' });

		new Setting(containerEl)
			.setName('Enable auto-save')
			.setDesc('Automatically save drawings while editing')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSave)
				.onChange(async (value) => {
					this.plugin.settings.autoSave = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto-save interval')
			.setDesc('How often to auto-save (in seconds)')
			.addText(text => text
				.setPlaceholder('30')
				.setValue(String(this.plugin.settings.autoSaveInterval / 1000))
				.onChange(async (value) => {
					const seconds = parseInt(value);
					if (!isNaN(seconds) && seconds > 0) {
						this.plugin.settings.autoSaveInterval = seconds * 1000;
						await this.plugin.saveSettings();
					}
				}));
	}
}
