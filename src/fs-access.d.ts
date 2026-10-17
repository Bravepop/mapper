// File System Access API (Chrome/Edge). Not yet in TypeScript's DOM lib.
interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface Window {
  showSaveFilePicker?(options?: { suggestedName?: string; types?: FilePickerAcceptType[] }): Promise<FileSystemFileHandle>;
  showOpenFilePicker?(options?: { types?: FilePickerAcceptType[]; multiple?: boolean }): Promise<FileSystemFileHandle[]>;
}
