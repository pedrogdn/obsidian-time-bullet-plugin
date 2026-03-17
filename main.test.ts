import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { MarkdownView } from './test-support/obsidian';
import TimeBulletPlugin, { DEFAULT_SETTINGS } from './main';

type EditorCursor = {
	line: number;
	ch: number;
};

type PluginInternals = {
	generateTimestamp: () => string;
	handleSpaceInEditor: (editor: FakeEditor, event: KeyboardEvent) => void;
	handleEnterInEditor: (editor: FakeEditor, event: KeyboardEvent) => void;
};

type FakeLeaf = {
	view: MarkdownView;
	getContainer: () => { doc: Document };
};

type FakeWorkspace = {
	leaves: FakeLeaf[];
	iterateAllLeaves: (callback: (leaf: FakeLeaf) => void) => void;
	getActiveViewOfType: (ViewType: typeof MarkdownView) => MarkdownView | null;
	on: (name: string, callback: (...args: unknown[]) => void) => { name: string; callback: (...args: unknown[]) => void };
	trigger: (name: string, ...args: unknown[]) => void;
};

class FakeEditor {
	lines: string[];
	cursor: EditorCursor;
	private focused: boolean;

	constructor(lines: string[], cursor: EditorCursor = { line: 0, ch: 0 }, focused = true) {
		this.lines = [...lines];
		this.cursor = { ...cursor };
		this.focused = focused;
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

	hasFocus() {
		return this.focused;
	}
}

function createLeaf(doc: Document, editor: FakeEditor): FakeLeaf {
	const containerEl = doc.createElement('div');
	doc.body.appendChild(containerEl);

	return {
		view: new MarkdownView(editor, containerEl),
		getContainer: () => ({ doc }),
	};
}

function createWorkspace(leaves: FakeLeaf[] = []): FakeWorkspace {
	const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

	return {
		leaves,
		iterateAllLeaves(callback) {
			leaves.forEach(callback);
		},
		getActiveViewOfType(ViewType) {
			return leaves.map((leaf: FakeLeaf) => leaf.view).find((view: MarkdownView) => view instanceof ViewType) ?? null;
		},
		on(name, callback) {
			const callbacks = listeners.get(name) ?? [];
			callbacks.push(callback);
			listeners.set(name, callbacks);
			return { name, callback };
		},
		trigger(name, ...args) {
			for (const callback of listeners.get(name) ?? []) {
				callback(...args);
			}
		},
	};
}

function createPlugin(leaves: FakeLeaf[] = []) {
	const workspace = createWorkspace(leaves);
	const app = { workspace };
	const manifest = {
		id: 'time-bullet',
		name: 'Time Bullet',
		version: 'test-version',
	};

	return {
		plugin: new TimeBulletPlugin(app as any, manifest as any),
		workspace,
	};
}

describe('TimeBulletPlugin', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
		vi.restoreAllMocks();
	});

	it('replaces the shortcut with a timestamped bullet on space', () => {
		const { plugin } = createPlugin();
		const internals = plugin as unknown as PluginInternals;
		plugin.settings = { ...DEFAULT_SETTINGS };

		vi.spyOn(internals, 'generateTimestamp').mockReturnValue('09:30');

		const editor = new FakeEditor(['-[t]'], { line: 0, ch: 4 });
		const event = new KeyboardEvent('keydown', { key: ' ', cancelable: true });

		internals.handleSpaceInEditor(editor, event);

		expect(editor.lines[0]).toBe('- [09:30] ');
		expect(editor.cursor).toEqual({
			line: 0,
			ch: '- [09:30] '.length,
		});
		expect(event.defaultPrevented).toBe(true);
	});

	it('continues a timestamped list on enter', () => {
		const { plugin } = createPlugin();
		const internals = plugin as unknown as PluginInternals;
		plugin.settings = { ...DEFAULT_SETTINGS };

		vi.spyOn(internals, 'generateTimestamp').mockReturnValue('09:30');

		const editor = new FakeEditor(['- [08:00] start', '- next'], { line: 1, ch: 2 });
		const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });

		internals.handleEnterInEditor(editor, event);

		expect(editor.lines[1]).toBe('- [09:30] next');
		expect(editor.cursor).toEqual({
			line: 1,
			ch: 2 + '- [09:30]'.length - '-'.length,
		});
		expect(event.defaultPrevented).toBe(true);
	});

	it('handles key events inside an existing popout document', async () => {
		const popoutDom = new JSDOM('<!doctype html><html><body></body></html>');

		try {
			const mainEditor = new FakeEditor(['main'], { line: 0, ch: 0 }, false);
			const popoutEditor = new FakeEditor(['-[t]'], { line: 0, ch: 4 }, true);

			const { plugin } = createPlugin([
				createLeaf(document, mainEditor),
				createLeaf(popoutDom.window.document, popoutEditor),
			]);
			const internals = plugin as unknown as PluginInternals;

			vi.spyOn(internals, 'generateTimestamp').mockReturnValue('09:30');

			await plugin.onload();

			const event = new popoutDom.window.KeyboardEvent('keydown', {
				key: ' ',
				bubbles: true,
				cancelable: true,
			});

			popoutDom.window.document.dispatchEvent(event);

			expect(popoutEditor.lines[0]).toBe('- [09:30] ');
			expect(mainEditor.lines[0]).toBe('main');
			expect(event.defaultPrevented).toBe(true);
		} finally {
			popoutDom.window.close();
		}
	});

	it('registers handlers for popout windows opened after load', async () => {
		const { plugin, workspace } = createPlugin();
		const internals = plugin as unknown as PluginInternals;

		vi.spyOn(internals, 'generateTimestamp').mockReturnValue('09:30');

		await plugin.onload();

		const popoutDom = new JSDOM('<!doctype html><html><body></body></html>');

		try {
			const popoutEditor = new FakeEditor(['-[t]'], { line: 0, ch: 4 }, true);
			const popoutLeaf = createLeaf(popoutDom.window.document, popoutEditor);

			workspace.leaves.push(popoutLeaf);
			workspace.trigger('window-open', { doc: popoutDom.window.document }, popoutDom.window);

			const event = new popoutDom.window.KeyboardEvent('keydown', {
				key: ' ',
				bubbles: true,
				cancelable: true,
			});

			popoutDom.window.document.dispatchEvent(event);

			expect(popoutEditor.lines[0]).toBe('- [09:30] ');
			expect(event.defaultPrevented).toBe(true);
		} finally {
			popoutDom.window.close();
		}
	});
});
