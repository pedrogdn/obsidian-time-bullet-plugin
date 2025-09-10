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
	private readonly registeredDocuments = new WeakSet<Document>();
	// Regex patterns for toggle functionality
	private readonly TIME_BULLET_REGEX = /^- \[([^\]]+)\](.*)$/;
	private readonly INDENT_REGEX = /^(\s*)/;
	private readonly BULLET_REGEX = /^[-*+](.*)$/;

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
	
	private getIndentation(line: string): string {
		const match = line.match(this.INDENT_REGEX);
		return match ? match[1] : '';
	}
	
	private calculateCursorOffset(oldLength: number, newLength: number, currentPosition: number): number {
		const lengthDiff = newLength - oldLength;
		return Math.max(0, currentPosition + lengthDiff);
	}

	private toggleTimeBullet(editor: Editor) {
		const cursor = editor.getCursor();
		const currentLine = cursor.line;
		const originalCursorCh = cursor.ch;
		const currentLineContent = editor.getLine(currentLine);
		const trimmedContent = currentLineContent.trim();
		
		// Check if line already has a time bullet
		const timeBulletMatch = trimmedContent.match(this.TIME_BULLET_REGEX);
		
		if (timeBulletMatch) {
			// Has time bullet - check if it's a valid timestamp
			const [fullMatch, capturedTimeStamp, restOfLine] = timeBulletMatch;
			const isValidTimestamp = dayjs(capturedTimeStamp, this.timeStampFormat, true).isValid();
			
			if (isValidTimestamp) {
				// Remove time bullet, keep as normal bullet
				const indent = this.getIndentation(currentLineContent);
				// Trim all leading spaces from restOfLine
				const trimmedRestOfLine = restOfLine.trimStart();
				const newContent = `${indent}- ${trimmedRestOfLine}`;
				
				editor.setLine(currentLine, newContent);
				
				// Preserve cursor position, adjusting for the removed timestamp
				const newCursorCh = this.calculateCursorOffset(
					currentLineContent.length,
					newContent.length,
					originalCursorCh
				);
				editor.setCursor({
					line: currentLine,
					ch: newCursorCh
				});
				return;
			}
		}
		
		// No time bullet or invalid timestamp - add time bullet
		const timestamp = this.generateTimestamp();
		const indent = this.getIndentation(currentLineContent);
		
		// Check if line starts with a normal bullet (after indentation)
		const normalBulletMatch = trimmedContent.match(this.BULLET_REGEX);
		
		if (normalBulletMatch) {
			// Replace normal bullet with time bullet
			const [, restOfLine] = normalBulletMatch;
			// Trim leading spaces from restOfLine and add exactly one space
			const trimmedRestOfLine = restOfLine.trimStart();
			const newContent = `${indent}- [${timestamp}] ${trimmedRestOfLine}`;
			
			editor.setLine(currentLine, newContent);
			
			// Preserve cursor position, adjusting for the added timestamp
			const newCursorCh = this.calculateCursorOffset(
				currentLineContent.length,
				newContent.length,
				originalCursorCh
			);
			editor.setCursor({
				line: currentLine,
				ch: newCursorCh
			});
		} else if (trimmedContent === '') {
			// Empty line - add time bullet
			const newContent = `${indent}- [${timestamp}] `;
			editor.setLine(currentLine, newContent);
			
			// Keep cursor at end of new content
			editor.setCursor({
				line: currentLine,
				ch: newContent.length
			});
		} else {
			// Line has content but no bullet - add time bullet at beginning
			const newContent = `${indent}- [${timestamp}] ${trimmedContent}`;
			
			editor.setLine(currentLine, newContent);
			
			// Preserve cursor position, adjusting for the added timestamp and bullet
			const newCursorCh = this.calculateCursorOffset(
				currentLineContent.length,
				newContent.length,
				originalCursorCh
			);
			editor.setCursor({
				line: currentLine,
				ch: newCursorCh
			});
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
