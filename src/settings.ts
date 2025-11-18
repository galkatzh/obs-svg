export interface DrawingBlocksSettings {
	defaultFolder: string;
	defaultWidth: number;
	defaultHeight: number;
	defaultStrokeColor: string;
	defaultStrokeWidth: number;
	defaultFillColor: string;
	autoSave: boolean;
	autoSaveInterval: number;
}

export const DEFAULT_SETTINGS: DrawingBlocksSettings = {
	defaultFolder: 'drawings',
	defaultWidth: 800,
	defaultHeight: 600,
	defaultStrokeColor: '#000000',
	defaultStrokeWidth: 2,
	defaultFillColor: 'none',
	autoSave: true,
	autoSaveInterval: 30000, // 30 seconds
};
