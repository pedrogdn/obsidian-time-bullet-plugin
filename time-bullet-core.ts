import { EditorState } from '@codemirror/state';
import type { Extension, Transaction, TransactionSpec } from '@codemirror/state';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

// Required for validating a captured timestamp against a format string.
dayjs.extend(customParseFormat);

export const TIME_BULLET_PATTERN = '-[t]';

export interface TimeBulletCoreOptions {
	/** Current timestamp format, read fresh per transaction so settings changes apply. */
	getFormat: () => string;
	/** Produces the timestamp string. Injected so tests can be deterministic. */
	generateTimestamp: () => string;
	/**
	 * One level of list indentation (`"\t"`, or N spaces), read from the editor's
	 * settings so Enter-on-empty-bullet outdents by a real level. Defaults to a tab.
	 */
	getIndentUnit?: () => string;
}

/**
 * Builds a CodeMirror transaction filter that drives Time Bullet from document
 * changes rather than DOM `keydown` events. Reacting to the resulting text
 * change is what lets the plugin work with virtual keyboards on iOS/Android.
 */
export function createTimeBulletFilter(options: TimeBulletCoreOptions): Extension {
	return EditorState.transactionFilter.of((tr) =>
		filterTransaction(
			tr,
			options.getFormat(),
			options.generateTimestamp,
			options.getIndentUnit?.() || '\t'
		)
	);
}

export function filterTransaction(
	tr: Transaction,
	format: string,
	generateTimestamp: () => string,
	indentUnit = '\t'
): TransactionSpec | readonly TransactionSpec[] {
	if (!tr.docChanged) return tr;

	// Only react to a single, simple insertion (typing / list continuation).
	let changeCount = 0;
	let fromA = 0;
	let toA = 0;
	let inserted = '';
	tr.changes.iterChanges((fA, tA, _fB, _tB, ins) => {
		changeCount += 1;
		fromA = fA;
		toA = tA;
		inserted = ins.toString();
	});
	if (changeCount !== 1) return tr;

	return (
		buildSpaceReplacement(tr, fromA, toA, inserted, generateTimestamp) ??
		buildEnterReplacement(tr, fromA, toA, inserted, format, generateTimestamp, indentUnit) ??
		tr
	);
}

/**
 * Space pressed while the line begins with `-[t]` -> expand into a timestamped
 * bullet. The trailing space in the prefix stands in for the space the user
 * typed, so the original insertion is dropped.
 */
function buildSpaceReplacement(
	tr: Transaction,
	fromA: number,
	toA: number,
	inserted: string,
	generateTimestamp: () => string
): TransactionSpec | null {
	if (inserted !== ' ' || toA !== fromA) return null;

	const line = tr.startState.doc.lineAt(fromA);
	if (!line.text.startsWith(TIME_BULLET_PATTERN)) return null;

	const timeStampPrefix = `- [${generateTimestamp()}] `;
	const updatedLine = `${timeStampPrefix}${line.text.slice(TIME_BULLET_PATTERN.length)}`;

	return {
		changes: { from: line.from, to: line.to, insert: updatedLine },
		selection: { anchor: line.from + timeStampPrefix.length },
	};
}

/**
 * Enter on a timestamped line makes Obsidian continue the list with a plain
 * `- ` bullet. This arrives as either one change carrying the newline+bullet
 * (desktop `"\n- "`, mobile `" \n- "` where a trailing space is re-inserted
 * before the newline) or as a separate `- ` insertion on the freshly created
 * line, so both shapes are handled.
 *
 * When the source bullet still has content, a fresh timestamp is injected into
 * the continued bullet. When the source bullet is empty (only the timestamp,
 * nothing typed), Enter instead mirrors Obsidian's native empty-bullet Enter:
 * it outdents the bullet one level, and once at the top level drops the marker
 * to exit the list. Obsidian can't do this itself here because the timestamp
 * makes the line look non-empty.
 */
function buildEnterReplacement(
	tr: Transaction,
	fromA: number,
	toA: number,
	inserted: string,
	format: string,
	generateTimestamp: () => string,
	indentUnit: string
): TransactionSpec | null {
	// Shape A: a single change whose insert contains a newline followed by the
	// continued bullet. Obsidian may prefix same-line text before the newline
	// (mobile emits a leading space, e.g. " \n- "), so the prefix up to the
	// newline is captured and preserved rather than anchoring on "\n".
	const combined = inserted.match(/^([^\n]*\n[ \t]*)([-*+]) (.*)$/s);
	if (combined) {
		const sourceLine = tr.startState.doc.lineAt(fromA);
		const bullet = parseTimeBullet(sourceLine.text, format);
		if (!bullet) return null;

		if (bullet.content.trim() === '') {
			// Discard the continuation and outdent/exit the source line in place.
			return exitOrOutdentEmptyBullet(bullet, sourceLine.from, sourceLine.to, indentUnit);
		}

		const [, lead, marker, rest] = combined;
		const updatedInsert = `${lead}${marker} [${generateTimestamp()}] ${rest}`;
		return {
			changes: { from: fromA, to: toA, insert: updatedInsert },
			selection: { anchor: fromA + updatedInsert.length },
		};
	}

	// Shape B: bullet inserted on its own onto a just-created line, e.g. "- ".
	const bulletOnly = inserted.match(/^([ \t]*)([-*+]) (.*)$/s);
	if (bulletOnly) {
		const line = tr.startState.doc.lineAt(fromA);
		if (fromA !== line.from || line.number <= 1) return null;

		const previousLine = tr.startState.doc.line(line.number - 1);
		const bullet = parseTimeBullet(previousLine.text, format);
		if (!bullet) return null;

		if (bullet.content.trim() === '') {
			// Collapse the source bullet and the just-created line, outdenting or
			// exiting on the source bullet's own line.
			return exitOrOutdentEmptyBullet(bullet, previousLine.from, toA, indentUnit);
		}

		const [, indent, marker, rest] = bulletOnly;
		const updatedInsert = `${indent}${marker} [${generateTimestamp()}] ${rest}`;
		return {
			changes: { from: fromA, to: toA, insert: updatedInsert },
			selection: { anchor: fromA + updatedInsert.length },
		};
	}

	return null;
}

/**
 * Enter on an empty timestamped bullet. Replaces the range `[from, to)` (the
 * source bullet plus any list-continuation Obsidian inserted) with either the
 * same bullet outdented one level, or nothing when it is already top-level —
 * matching Obsidian's native empty-bullet Enter, which steps out one indent
 * level per press before removing the marker.
 */
function exitOrOutdentEmptyBullet(
	bullet: ParsedTimeBullet,
	from: number,
	to: number,
	indentUnit: string
): TransactionSpec {
	if (indentUnit && bullet.indent.startsWith(indentUnit)) {
		const outdented = `${bullet.indent.slice(indentUnit.length)}${bullet.marker} [${bullet.stamp}]${bullet.content}`;
		return {
			changes: { from, to, insert: outdented },
			selection: { anchor: from + outdented.length },
		};
	}

	// Top level (or unrecognized indent): drop the marker and exit the list.
	return { changes: { from, to, insert: '' }, selection: { anchor: from } };
}

interface ParsedTimeBullet {
	indent: string;
	marker: string;
	stamp: string;
	content: string;
}

/**
 * Parses a line as a timestamped bullet (`- [<stamp>] <content>`, optionally
 * indented, with a `-`/`*`/`+` marker). Returns the indent, marker, captured
 * stamp, and trailing content when the stamp is valid for `format`, otherwise
 * null.
 */
function parseTimeBullet(line: string, format: string): ParsedTimeBullet | null {
	const match = line.match(/^([ \t]*)([-*+]) \[([^\]]+)\](.*)$/);
	if (!match) return null;

	const [, indent, marker, stamp, content] = match;
	if (!dayjs(stamp, format, true).isValid()) return null;

	return { indent, marker, stamp, content };
}

export function doesLineStartWithTimeBullet(line: string, format: string): boolean {
	return parseTimeBullet(line, format) !== null;
}
