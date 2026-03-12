import { clipboard } from 'electron';

export class ClipboardManager {
  read(): { text?: string; image?: string } {
    const text = clipboard.readText();
    const img = clipboard.readImage();
    return {
      text: text || undefined,
      image: img.isEmpty() ? undefined : img.toDataURL(),
    };
  }

  write(text: string): void {
    clipboard.writeText(text);
  }
}
