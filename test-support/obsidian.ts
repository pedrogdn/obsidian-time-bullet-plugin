export class Plugin {
	app: unknown;
	manifest: unknown;

	constructor(app: unknown, manifest: unknown) {
		this.app = app;
		this.manifest = manifest;
	}

	addSettingTab() {}

	addCommand() {}

	register(cb: () => void) {
		return cb;
	}

	registerEvent(eventRef: unknown) {
		return eventRef;
	}

	registerDomEvent(
		el: Document | HTMLElement | Window,
		type: string,
		callback: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	) {
		el.addEventListener(type, callback, options);
	}

	async loadData() {
		return {};
	}

	async saveData() {}
}

export class App {}

export class Editor {}

export class MarkdownView {
	editor: unknown;
	containerEl: HTMLElement;

	constructor(editor: unknown, containerEl: HTMLElement) {
		this.editor = editor;
		this.containerEl = containerEl;
	}
}

export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl: HTMLDivElement;

	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement('div');
	}
}

export class Setting {
	constructor(_: HTMLElement) {}

	setName() {
		return this;
	}

	setDesc() {
		return this;
	}

	addText(callback: (text: { setPlaceholder: (value: string) => any; setValue: (value: string) => any; onChange: (cb: (value: string) => void) => any }) => void) {
		const text = {
			setPlaceholder() {
				return text;
			},
			setValue() {
				return text;
			},
			onChange() {
				return text;
			},
		};

		callback(text);
		return this;
	}

	addToggle(callback: (toggle: { setValue: (value: boolean) => { onChange: (cb: (value: boolean) => void) => void } }) => void) {
		callback({
			setValue() {
				return {
					onChange() {},
				};
			},
		});

		return this;
	}
}
