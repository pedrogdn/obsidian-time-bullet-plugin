import { describe, expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { createTimeBulletFilter } from './time-bullet-core';

const FORMAT = 'HH:mm';
const STAMP = '10:00';

/** Builds an EditorState wired with the filter and a deterministic timestamp. */
function makeState(doc: string, selectionAnchor: number, indentUnit = '\t'): EditorState {
	return EditorState.create({
		doc,
		selection: { anchor: selectionAnchor },
		extensions: [
			createTimeBulletFilter({
				getFormat: () => FORMAT,
				generateTimestamp: () => STAMP,
				getIndentUnit: () => indentUnit,
			}),
		],
	});
}

/** Applies a user insertion at the cursor and returns the resulting doc/selection. */
function type(state: EditorState, insert: string): { doc: string; head: number } {
	const from = state.selection.main.head;
	const tr = state.update({
		changes: { from, insert },
		selection: { anchor: from + insert.length },
	});
	return { doc: tr.state.doc.toString(), head: tr.state.selection.main.head };
}

describe('createTimeBulletFilter', () => {
	test('space after -[t] expands into a timestamped bullet', () => {
		// Doc is "-[t]" with cursor at end; user types a space.
		const state = makeState('-[t]', 4);
		const { doc, head } = type(state, ' ');
		expect(doc).toBe(`- [${STAMP}] `);
		expect(head).toBe(`- [${STAMP}] `.length);
	});

	test('space after -[t] preserves trailing text on the line', () => {
		const state = makeState('-[t]hello', 4);
		const { doc } = type(state, ' ');
		expect(doc).toBe(`- [${STAMP}] hello`);
	});

	test('space does nothing on a non time-bullet line', () => {
		const state = makeState('- regular', 9);
		const { doc } = type(state, ' ');
		expect(doc).toBe('- regular ');
	});

	test('enter (combined newline+bullet) on a timestamped line injects a fresh timestamp', () => {
		// Cursor at end of a valid timestamped bullet; list continuation inserts "\n- ".
		const doc = `- [09:30] first`;
		const state = makeState(doc, doc.length);
		const { doc: out } = type(state, '\n- ');
		expect(out).toBe(`- [09:30] first\n- [${STAMP}] `);
	});

	test('enter continues a non-dash marker list with the same marker', () => {
		const doc = `* [09:30] first`;
		const state = makeState(doc, doc.length);
		const { doc: out } = type(state, '\n* ');
		expect(out).toBe(`* [09:30] first\n* [${STAMP}] `);
	});

	test('enter on mobile (leading-space replacement " \\n- ") injects a fresh timestamp', () => {
		// Real iOS transaction captured on device: a single change that replaces the
		// trailing space and inserts " \n- " (leading space before the newline).
		const doc = `- [09:30] first `;
		const state = makeState(doc, doc.length);
		const from = doc.length - 1; // the trailing space
		const to = doc.length;
		const tr = state.update({
			changes: { from, to, insert: ' \n- ' },
			selection: { anchor: from + 4 },
		});
		expect(tr.state.doc.toString()).toBe(`- [09:30] first \n- [${STAMP}] `);
	});

	test('enter (separate bullet) on a just-created line injects a fresh timestamp', () => {
		// Newline already applied; the "- " arrives as its own insertion on the new line.
		const doc = `- [09:30] first\n`;
		const state = makeState(doc, doc.length);
		const { doc: out } = type(state, '- ');
		expect(out).toBe(`- [09:30] first\n- [${STAMP}] `);
	});

	test('enter does not inject when the source line is not a timestamped bullet', () => {
		const doc = `- plain bullet`;
		const state = makeState(doc, doc.length);
		const { doc: out } = type(state, '\n- ');
		expect(out).toBe(`- plain bullet\n- `);
	});

	test('enter preserves indentation of the continued bullet', () => {
		const doc = `\t- [09:30] nested`;
		const state = makeState(doc, doc.length);
		const { doc: out } = type(state, '\n\t- ');
		expect(out).toBe(`\t- [09:30] nested\n\t- [${STAMP}] `);
	});

	test('enter on an empty top-level time bullet (desktop shape) exits the list', () => {
		// Top-level bullet, no typed content -> Enter drops the marker entirely.
		const doc = `- [09:30] `;
		const state = makeState(doc, doc.length);
		const { doc: out, head } = type(state, '\n- ');
		expect(out).toBe('');
		expect(head).toBe(0);
	});

	test('enter on an empty top-level time bullet (mobile " \\n- " shape) exits the list', () => {
		const doc = `- [09:30] `;
		const state = makeState(doc, doc.length);
		const from = doc.length - 1;
		const to = doc.length;
		const tr = state.update({
			changes: { from, to, insert: ' \n- ' },
			selection: { anchor: from + 4 },
		});
		expect(tr.state.doc.toString()).toBe('');
		expect(tr.state.selection.main.head).toBe(0);
	});

	test('enter on an empty nested time bullet outdents one level (keeps timestamp)', () => {
		const doc = `\t- [09:30] `;
		const state = makeState(doc, doc.length);
		const { doc: out, head } = type(state, '\n\t- ');
		expect(out).toBe(`- [09:30] `);
		expect(head).toBe(`- [09:30] `.length);
	});

	test('enter on an empty nested non-dash bullet outdents and keeps the marker', () => {
		const doc = `\t* [09:30] `;
		const state = makeState(doc, doc.length);
		const { doc: out } = type(state, '\n\t* ');
		expect(out).toBe(`* [09:30] `);
	});

	test('enter on a deeply nested empty bullet removes just one indent level', () => {
		const doc = `\t\t- [09:30] `;
		const state = makeState(doc, doc.length);
		const { doc: out } = type(state, '\n\t\t- ');
		expect(out).toBe(`\t- [09:30] `);
	});

	test('enter on an empty nested bullet outdents with a spaces indent unit', () => {
		const indent = '    '; // 4-space indent level
		const doc = `${indent}- [09:30] `;
		const state = makeState(doc, doc.length, indent);
		const { doc: out } = type(state, `\n${indent}- `);
		expect(out).toBe(`- [09:30] `);
	});

	test('enter on an empty time bullet keeps preceding lines intact', () => {
		const first = `- [09:30] first`;
		const doc = `${first}\n- [09:35] `;
		const state = makeState(doc, doc.length);
		const { doc: out } = type(state, '\n- ');
		expect(out).toBe(`${first}\n`);
	});
});
