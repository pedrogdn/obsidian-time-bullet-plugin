import { Editor, MarkdownView, Plugin } from 'obsidian';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { TimeBulletSettingTab } from './time-bullet-setting-tab';

interface TimeBulletPluginSettings {
	timeStampFormat: string;
	isUTC: boolean;
}

export const DEFAULT_SETTINGS: TimeBulletPluginSettings = {
	timeStampFormat: 'HH:mm',
	isUTC: true,
};

// Define plugins for dayjs.
dayjs.extend(utc); // Required for UTC time.
dayjs.extend(customParseFormat); // Required for validating against a format string.

export default class TimeBulletPlugin extends Plugin {
	public settings: TimeBulletPluginSettings;
	private readonly timeBulletPattern = '-[t]';
	private readonly invalidFormatFallbackText = 'invalid_format';

	private get timeStampFormat() {
		// Use `||` to handle the case of an empty string.
		return this.settings.timeStampFormat || DEFAULT_SETTINGS.timeStampFormat;
	}

	private get isUTC() {
		return this.settings.isUTC;
	}

	async onload() {
		console.log('Time Bullet plugin loaded');

		await this.loadSettings();
		this.addSettingTab(new TimeBulletSettingTab(this.app, this));

		// Register the Enter and Space key handler
		this.registerDomEvent(document, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
				// Get the active editor
				const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeLeaf) {
					const editor = activeLeaf.editor;
					this.handleEnterInEditor(editor, event);
				}
			}

			if (event.key === ' ') {
				const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeLeaf) {
					const editor = activeLeaf.editor;
					this.handleSpaceInEditor(editor, event);
				}
			}
		});
	}

	private handleSpaceInEditor(editor: Editor, event: KeyboardEvent) {
		const cursor = editor.getCursor();
		const currentLine = cursor.line;
		const currentLineContent = editor.getLine(currentLine);

		if (currentLineContent.startsWith(this.timeBulletPattern)) {
			const timeStampPrefix = `- [${this.generateTimestamp()}] `;
			const updatedLineContent = `${timeStampPrefix}${currentLineContent.slice(this.timeBulletPattern.length)}`;
			editor.setLine(currentLine, updatedLineContent);

			editor.setCursor({
				line: currentLine,
				ch: timeStampPrefix.length,
			});

			event.preventDefault();
		}
	}

	private handleEnterInEditor(editor: Editor, event: KeyboardEvent) {
		const cursor = editor.getCursor();
		const currentLine = cursor.line;
		const currentCursorCh = cursor.ch;

		// Only proceed if we're not at the very first line
		if (currentLine > 0) {
			const previousLine = editor.getLine(currentLine - 1);

			if (this.doesLineStartWithTimeBullet(previousLine)) {
				const currentLineContent = editor.getLine(currentLine);

				/**
				 * We don't want to strip the whitespace or otherwise change anything about the content in this new line.
				 * To achieve this, we will replace the bullet with a timestamped bullet. This preserves whitespace.
				 */
				const bulletToReplace = '-';
				const timeStampedBullet = `- [${this.generateTimestamp()}]`;
				const updatedLineContent = currentLineContent.replace(bulletToReplace, timeStampedBullet);

				editor.setLine(currentLine, updatedLineContent);

				// Remove the thing we replaced, add the thing we added.
				const updatedCursorCh = currentCursorCh + timeStampedBullet.length - bulletToReplace.length;

				// Position cursor after the timestamp
				editor.setCursor({
					line: currentLine,
					ch: updatedCursorCh,
				});

				// Prevent default Enter behavior to avoid creating an additional empty line
				event.preventDefault();
			}
		}
	}

	private doesLineStartWithTimeBullet(line: string) {
		const timeStampMatches = line.trim().match(/^- \[([^\]]+)\]/); // Capture contents within the first `[..]`
		if (!timeStampMatches || !Array.isArray(timeStampMatches) || timeStampMatches.length < 2) return false;

		const [, capturedTimeStamp] = timeStampMatches;
		return dayjs(capturedTimeStamp, this.timeStampFormat, true).isValid();
	}

	private generateTimestamp(): string {
		try {
			if (this.isUTC) {
				return dayjs.utc().format(this.timeStampFormat);
			} else {
				return dayjs().format(this.timeStampFormat);
			}
		} catch (_) {
			// If for some reason the format used results in an error, we will expose that error to the user by showing `invalid_format`.
			return this.invalidFormatFallbackText;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
