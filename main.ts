import { Editor, Plugin } from 'obsidian';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { TimeBulletSettingTab } from './time-bullet-setting-tab';
import { createTimeBulletFilter } from './time-bullet-core';

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
	private readonly invalidFormatFallbackText = 'invalid_format';
	private readonly timeBulletLinePattern = /^([-*+]) \[([^\]]+)\](.*)$/;
	private readonly indentationPattern = /^(\s*)/;
	private readonly bulletLinePattern = /^([-*+])(.*)$/;

	private get timeStampFormat() {
		// Use `||` to handle the case of an empty string.
		return this.settings.timeStampFormat || DEFAULT_SETTINGS.timeStampFormat;
	}

	private get isUTC() {
		return this.settings.isUTC;
	}

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new TimeBulletSettingTab(this.app, this));

		this.addCommand({
			id: 'toggle-time-bullet',
			name: 'Toggle time bullet',
			editorCallback: (editor: Editor) => {
				this.toggleTimeBullet(editor);
			},
		});

		/**
		 * Drive the Space/Enter timestamp triggers from CodeMirror document changes
		 * rather than DOM `keydown` events. Virtual keyboards on iOS/Android do not
		 * emit reliable `keydown` for Space/Enter, so reacting to the resulting text
		 * change makes the plugin work on both desktop and mobile. The editor
		 * extension is applied to every editor Obsidian creates, including popout
		 * windows, so no per-document key wiring is needed.
		 */
		this.registerEditorExtension(
			createTimeBulletFilter({
				getFormat: () => this.timeStampFormat,
				generateTimestamp: () => this.generateTimestamp(),
				getIndentUnit: () => this.indentUnit,
			})
		);
	}

	/** One indent level, honoring the vault's "Use tabs" / "Tab size" settings. */
	private get indentUnit(): string {
		const getConfig = (this.app.vault as unknown as { getConfig?: (key: string) => unknown }).getConfig;
		const useTab = getConfig?.call(this.app.vault, 'useTab');
		const tabSize = getConfig?.call(this.app.vault, 'tabSize');
		if (useTab === false) {
			return ' '.repeat(typeof tabSize === 'number' && tabSize > 0 ? tabSize : 4);
		}
		return '\t';
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
