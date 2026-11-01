export type Permission = 'owner' | 'editor' | 'viewer';
export type User = { id: number; name: string; email: string; role?: string; department?: string; demo?: boolean };
// Folder colors, in picker order. CSS: .folder-shape.<color>.
export const FOLDER_COLORS = ['yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'teal', 'green', 'gray'] as const;
export type FolderItem = { id: number; name: string; color: string; ownerId: number; permission: Permission; count: number; shared: boolean };
export type FileItem = {
  id: number; name: string; tags: string[]; type: string; mime: string; bytes: number;
  modified: string; created: string; size: string; folder: string; folderId: number | null;
  ownerId: number; ownerName: string; permission: Permission; favorite: boolean; shared: boolean;
  deleted: boolean; url: string; hash: string; version: number; excerpt: string; extractionStatus: string;
};
export type Activity = { id: number; action: string; actor: string; created: string; fileName?: string };
export type Version = { id: number; number: number; name: string; bytes: number; created: string; actor: string; current: boolean };
export type Share = { id: number; email: string; name: string; permission: 'viewer' | 'editor' };
export type FileDetails = { file: FileItem; text: string; activities: Activity[]; versions: Version[]; shares: Share[]; inheritedShares: Share[]; scan?: {status:string;checked:string|null} };
export type Workspace = { user: User; files: FileItem[]; folders: FolderItem[]; used: number; personalUsed?: number; quota: number; maxUpload: number; activities: Activity[]; preferences?: {language?: 'en'|'th'; theme?: 'light'|'dark'|'system'; grid?: boolean; ascending?: boolean; sort?: string}; };
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  // Compare the rounded value so 1048575 bytes shows as "1.0 MB", not "1024.0 KB".
  if ((bytes / 1024).toFixed(1) !== '1024.0' && bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if ((bytes / 1048576).toFixed(1) !== '1024.0' && bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}
