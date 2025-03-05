import { Plugin, MarkdownView, Editor } from 'obsidian';

export default class TimeStamperPlugin extends Plugin {
  async onload() {
    console.log('Time Stamper plugin loaded');

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

  handleSpaceInEditor(editor: Editor, event: KeyboardEvent) {
    const cursor = editor.getCursor();
    const currentLine = cursor.line;
    const currentLineContent = editor.getLine(currentLine);

    if (currentLineContent.startsWith("-[t]")) {
      editor.setLine(currentLine, `- [${this.generateTimestamp()}] ${currentLineContent.slice(4)}`);

      editor.setCursor({
        line: currentLine,
        ch: 10
      });

    event.preventDefault();
    }
  }

  handleEnterInEditor(editor: Editor, event: KeyboardEvent) {
    const cursor = editor.getCursor();
    const currentLine = cursor.line;
    
    // Only proceed if we're not at the very first line
    if (currentLine > 0) {
        const previousLine = editor.getLine(currentLine - 1);
        const timePattern = /^- \[\d{2}:\d{2}\]/;
        
         if (timePattern.test(previousLine)) {
            const currentLineContent = editor.getLine(currentLine);
            
            editor.setLine(currentLine, `- [${this.generateTimestamp()}] ${currentLineContent.slice(2)}`);
            
            // Position cursor after the timestamp
            editor.setCursor({
                line: currentLine,
                ch: 10
            });
            
            // Prevent default Enter behavior to avoid creating an additional empty line
            event.preventDefault();
        }
    }
  }

  generateTimestamp(): string {
		// Get the current date/time
		const now = new Date();
		
    // Pad with leading zero if needed
    const hours = now.getHours().toString().padStart(2, '0');
		const minutes = now.getMinutes().toString().padStart(2, '0');
		
		const timestamp = `${hours}:${minutes}`;
		
		return timestamp;
	}
}
