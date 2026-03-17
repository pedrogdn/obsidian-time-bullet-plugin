import { Editor, MarkdownView, Plugin } from 'obsidian';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { TimeBulletSettingTab } from './time-bullet-setting-tab';

interface TimeBulletPluginSettings {
	timeStampFormat: string;
	isUTC: boolean;
}

type BulletMarker = '-' | '*' | '+';

type BulletMatch = {
	marker: BulletMarker;
	restOfLine: string;
};

type TimeBulletMatch = BulletMatch & {
	timestamp: string;
};

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
	private readonly timeBulletLinePattern = /^([-*+]) \[([^\]]+)\](.*)$/;
	private readonly indentationPattern = /^(\s*)/;
	private readonly bulletLinePattern = /^([-*+])(.*)$/;
	private readonly registeredDocuments = new WeakSet<Document>();

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

		// Add command for hotkey support
		this.addCommand({
			id: 'toggle-time-bullet',
			name: 'Toggle time bullet',
			editorCallback: (editor: Editor) => {
				this.toggleTimeBullet(editor);
			},
		});

		this.registerWorkspaceKeyHandlers();
	}

	private registerWorkspaceKeyHandlers() {
		this.registerDocumentKeyHandler(document);

		this.app.workspace.iterateAllLeaves((leaf) => {
			this.registerDocumentKeyHandler(leaf.getContainer().doc);
		});

		this.registerEvent(
			this.app.workspace.on('window-open', (workspaceWindow) => {
				this.registerDocumentKeyHandler(workspaceWindow.doc);
			}),
		);
	}

	private registerDocumentKeyHandler(doc: Document) {
		if (this.registeredDocuments.has(doc)) {
			return;
		}

		this.registeredDocuments.add(doc);
		this.registerDomEvent(doc, 'keydown', (event: KeyboardEvent) => {
			this.handleKeydown(event, doc);
		});
	}

	private handleKeydown(event: KeyboardEvent, doc: Document) {
		const editor = this.getFocusedMarkdownEditor(doc);
		if (!editor) {
			return;
		}

		if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
			this.handleEnterInEditor(editor, event);
		}

		if (event.key === ' ') {
			this.handleSpaceInEditor(editor, event);
		}
	}

	private getFocusedMarkdownEditor(doc: Document): Editor | null {
		let focusedEditor: Editor | null = null;

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (focusedEditor || !(leaf.view instanceof MarkdownView)) {
				return;
			}

			if (leaf.getContainer().doc !== doc) {
				return;
			}

			const editor = leaf.view.editor;
			if (editor.hasFocus()) {
				focusedEditor = editor;
			}
		});

		return focusedEditor ?? this.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? null;
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
				const indentation = this.getIndentation(currentLineContent);
				const currentBullet = this.getBulletMatch(currentLineContent);

				if (!currentBullet) {
					return;
				}

				const currentLineWithoutIndentation = currentLineContent.slice(indentation.length);
				const currentTimestamp = this.generateTimestamp();
				const trimmedRestOfLine = currentBullet.restOfLine.trimStart();
				const oldPrefixLength = currentLineWithoutIndentation.length - trimmedRestOfLine.length;
				const newPrefixLength = `${currentBullet.marker} [${currentTimestamp}] `.length;
				const updatedLineContent = this.buildTimeBulletLine(
					indentation,
					currentBullet.marker,
					currentTimestamp,
					currentBullet.restOfLine,
				);

				editor.setLine(currentLine, updatedLineContent);

				const updatedCursorCh = this.calculateUpdatedCursorPosition(
					currentCursorCh,
					indentation.length,
					oldPrefixLength,
					newPrefixLength,
					updatedLineContent.length,
				);
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
		return this.getValidTimeBulletMatch(line) !== null;
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

	private getIndentation(line: string): string {
		const match = line.match(this.indentationPattern);
		return match ? match[1] : '';
	}

	private getBulletMatch(line: string): BulletMatch | null {
		const match = line.trimStart().match(this.bulletLinePattern);
		if (!match) {
			return null;
		}

		const [, marker, restOfLine] = match;
		return {
			marker: marker as BulletMarker,
			restOfLine,
		};
	}

	private getValidTimeBulletMatch(line: string): TimeBulletMatch | null {
		const match = line.trimStart().match(this.timeBulletLinePattern);
		if (!match) {
			return null;
		}

		const [, marker, timestamp, restOfLine] = match;
		if (!dayjs(timestamp, this.timeStampFormat, true).isValid()) {
			return null;
		}

		return {
			marker: marker as BulletMarker,
			timestamp,
			restOfLine,
		};
	}

	private buildBulletLine(indent: string, marker: BulletMarker, text: string): string {
		const trimmedText = text.trimStart();
		return trimmedText ? `${indent}${marker} ${trimmedText}` : `${indent}${marker} `;
	}

	private buildTimeBulletLine(indent: string, marker: BulletMarker, timestamp: string, text: string): string {
		const trimmedText = text.trimStart();
		return trimmedText ? `${indent}${marker} [${timestamp}] ${trimmedText}` : `${indent}${marker} [${timestamp}] `;
	}

	private calculateUpdatedCursorPosition(
		currentPosition: number,
		prefixStart: number,
		oldPrefixLength: number,
		newPrefixLength: number,
		newLineLength: number,
	): number {
		if (currentPosition < prefixStart) {
			return currentPosition;
		}

		const oldPrefixEnd = prefixStart + oldPrefixLength;
		if (currentPosition <= oldPrefixEnd) {
			return Math.min(prefixStart + newPrefixLength, newLineLength);
		}

		const updatedPosition = currentPosition + newPrefixLength - oldPrefixLength;
		return Math.max(0, Math.min(updatedPosition, newLineLength));
	}

	private toggleTimeBullet(editor: Editor) {
		const cursor = editor.getCursor();
		const currentLine = cursor.line;
		const originalCursorCh = cursor.ch;
		const currentLineContent = editor.getLine(currentLine);
		const indentation = this.getIndentation(currentLineContent);
		const currentLineWithoutIndentation = currentLineContent.slice(indentation.length);
		const timeBulletMatch = this.getValidTimeBulletMatch(currentLineContent);

		if (timeBulletMatch) {
			const trimmedRestOfLine = timeBulletMatch.restOfLine.trimStart();
			const oldPrefixLength = currentLineWithoutIndentation.length - trimmedRestOfLine.length;
			const newPrefixLength = `${timeBulletMatch.marker} `.length;
			const updatedLineContent = this.buildBulletLine(
				indentation,
				timeBulletMatch.marker,
				timeBulletMatch.restOfLine,
			);

			editor.setLine(currentLine, updatedLineContent);
			editor.setCursor({
				line: currentLine,
				ch: this.calculateUpdatedCursorPosition(
					originalCursorCh,
					indentation.length,
					oldPrefixLength,
					newPrefixLength,
					updatedLineContent.length,
				),
			});
			return;
		}

		const timestamp = this.generateTimestamp();
		const bulletMatch = this.getBulletMatch(currentLineContent);
		if (bulletMatch) {
			const trimmedRestOfLine = bulletMatch.restOfLine.trimStart();
			const oldPrefixLength = currentLineWithoutIndentation.length - trimmedRestOfLine.length;
			const newPrefixLength = `${bulletMatch.marker} [${timestamp}] `.length;
			const updatedLineContent = this.buildTimeBulletLine(
				indentation,
				bulletMatch.marker,
				timestamp,
				bulletMatch.restOfLine,
			);

			editor.setLine(currentLine, updatedLineContent);
			editor.setCursor({
				line: currentLine,
				ch: this.calculateUpdatedCursorPosition(
					originalCursorCh,
					indentation.length,
					oldPrefixLength,
					newPrefixLength,
					updatedLineContent.length,
				),
			});
			return;
		}

		const updatedLineContent = this.buildTimeBulletLine(indentation, '-', timestamp, currentLineWithoutIndentation);
		const newPrefixLength = `- [${timestamp}] `.length;
		editor.setLine(currentLine, updatedLineContent);
		editor.setCursor({
			line: currentLine,
			ch: this.calculateUpdatedCursorPosition(
				originalCursorCh,
				indentation.length,
				0,
				newPrefixLength,
				updatedLineContent.length,
			),
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
