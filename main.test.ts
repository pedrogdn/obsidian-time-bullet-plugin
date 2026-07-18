import { beforeEach, describe, expect, it, vi } from 'vitest';
import TimeBulletPlugin, { DEFAULT_SETTINGS } from './main';

type EditorCursor = {
	line: number;
	ch: number;
};

type PluginInternals = {
	generateTimestamp: () => string;
	toggleTimeBullet: (editor: FakeEditor) => void;
};

class FakeEditor {
	lines: string[];
	cursor: EditorCursor;

	constructor(lines: string[], cursor: EditorCursor = { line: 0, ch: 0 }) {
		this.lines = [...lines];
		this.cursor = { ...cursor };
	}

	getCursor() {
		return { ...this.cursor };
	}

	getLine(line: number) {
		return this.lines[line] ?? '';
	}

	setLine(line: number, value: string) {
		this.lines[line] = value;
	}

	setCursor(cursor: EditorCursor) {
		this.cursor = { ...cursor };
	}
}

function createPlugin() {
	const app = {};
	const manifest = {
		id: 'time-bullet',
		name: 'Time Bullet',
		version: 'test-version',
	};

	return new TimeBulletPlugin(app as any, manifest as any);
}

describe('TimeBulletPlugin toggle command', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('adds a time bullet to a regular bullet and keeps the cursor with the content', () => {
		const plugin = createPlugin();
		const internals = plugin as unknown as PluginInternals;
		plugin.settings = { ...DEFAULT_SETTINGS };

		vi.spyOn(internals, 'generateTimestamp').mockReturnValue('09:30');

		const editor = new FakeEditor(['- task'], { line: 0, ch: 2 });

		internals.toggleTimeBullet(editor);

		expect(editor.lines[0]).toBe('- [09:30] task');
		expect(editor.cursor).toEqual({
			line: 0,
			ch: '- [09:30] '.length,
		});
	});

	it('keeps the cursor in leading indentation when toggling a plain text line', () => {
		const plugin = createPlugin();
		const internals = plugin as unknown as PluginInternals;
		plugin.settings = { ...DEFAULT_SETTINGS };

		vi.spyOn(internals, 'generateTimestamp').mockReturnValue('09:30');

		const editor = new FakeEditor(['  task'], { line: 0, ch: 1 });

		internals.toggleTimeBullet(editor);

		expect(editor.lines[0]).toBe('  - [09:30] task');
		expect(editor.cursor).toEqual({
			line: 0,
			ch: 1,
		});
	});

	it('preserves non-dash bullet markers when toggling on and off', () => {
		const plugin = createPlugin();
		const internals = plugin as unknown as PluginInternals;
		plugin.settings = { ...DEFAULT_SETTINGS };

		vi.spyOn(internals, 'generateTimestamp').mockReturnValue('09:30');

		const editor = new FakeEditor(['* task'], { line: 0, ch: 2 });

		internals.toggleTimeBullet(editor);

		expect(editor.lines[0]).toBe('* [09:30] task');
		expect(editor.cursor).toEqual({
			line: 0,
			ch: '* [09:30] '.length,
		});

		internals.toggleTimeBullet(editor);

		expect(editor.lines[0]).toBe('* task');
		expect(editor.cursor).toEqual({
			line: 0,
			ch: 2,
		});
	});
});
