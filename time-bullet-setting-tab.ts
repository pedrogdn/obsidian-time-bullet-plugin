import TimeBulletPlugin from './main';
import { App, PluginSettingTab, Setting } from 'obsidian';

export class TimeBulletSettingTab extends PluginSettingTab {
	plugin: TimeBulletPlugin;

	constructor(app: App, plugin: TimeBulletPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Time format')
			.setDesc('See this list of available formats: https://day.js.org/docs/en/display/format')
			.addText((text) =>
				text
					.setPlaceholder('HH:mm')
					.setValue(this.plugin.settings.timeStampFormat)
					.onChange(async (value) => {
						this.plugin.settings.timeStampFormat = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Use UTC')
			.setDesc('If not using UTC, your local time will be used.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.isUTC).onChange(async (value) => {
					this.plugin.settings.isUTC = value;
					await this.plugin.saveSettings();
				});
			});
	}
}
