import { Editor, MarkdownView, Plugin } from 'obsidian';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { TimeBulletSettingTab } from './time-bullet-setting-tab';

interface TimeBulletPluginSettings {
  timeStampFormat: string;
  isUTC: boolean;
}

const DEFAULT_SETTINGS: Partial<TimeBulletPluginSettings> = {
  timeStampFormat: 'HH:mm',
  isUTC: true,
};

// Define plugins for dayjs.
dayjs.extend(utc); // Required for UTC time.
dayjs.extend(customParseFormat); // Required for validating against a format string.

export default class TimeBulletPlugin extends Plugin {
  public settings: TimeBulletPluginSettings;
  private readonly timeBulletPattern = '-[t]';

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

    // Only proceed if we're not at the very first line
    if (currentLine > 0) {
      const previousLine = editor.getLine(currentLine - 1);

      if (this.doesLineStartWithTimeBullet(previousLine)) {
        const currentLineContent = editor.getLine(currentLine);

        const timeStampPrefix = `- [${this.generateTimestamp()}] `;
        const updatedLineContent = `${timeStampPrefix}${currentLineContent.slice(2)}`;
        editor.setLine(currentLine, updatedLineContent);

        // Position cursor after the timestamp
        editor.setCursor({
          line: currentLine,
          ch: timeStampPrefix.length,
        });

        // Prevent default Enter behavior to avoid creating an additional empty line
        event.preventDefault();
      }
    }
  }

  private doesLineStartWithTimeBullet(line: string) {
    const timeStampMatches = line.match(/^- \[(.*)\]/);
    if (!timeStampMatches || !Array.isArray(timeStampMatches)) return false;

    return dayjs(timeStampMatches[1], this.settings.timeStampFormat, true).isValid();
  }

  private generateTimestamp(): string {
    if (this.settings.isUTC) {
      return dayjs.utc().format(this.settings.timeStampFormat);
    } else {
      return dayjs().format(this.settings.timeStampFormat);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
