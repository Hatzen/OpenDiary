export type SecurityLevel = 'standard' | 'maximum';

export interface GitCommit {
  hash: string;
  timestamp: string;
  author: string;
  message: string;
  content: string;
  stats: {
    words: number;
    characters: number;
  };
}

export interface DiaryDocument {
  id: string;
  title: string;
  passwordHint?: string; // Optional user-defined password hint
  content: string; // HTML content from WYSIWYG
  createdAt: string;
  lastModified: string;
  version: number;
  securityLevel: SecurityLevel;
  gitHistory: GitCommit[];
}

export interface EncryptedEnvelope {
  format: 'OPENDIARY_V1' | 'MEMOIREN_V1';
  id: string;
  title: string;
  passwordHint?: string;
  hints?: any; // For backward compatibility with legacy files
  securityLevel: SecurityLevel;
  salt: string; // Base64
  iv: string; // Base64
  seed: string;
  version: number;
  lastModified: string;
  swapRounds: number;
  ciphertext: string; // Base64
  checksum?: string;
}

export interface SnapshotItem {
  id: string;
  documentId: string;
  timestamp: string;
  version: number;
  title: string;
  encryptedData: string; // Serialized EncryptedEnvelope
  wordCount: number;
  byteSize: number;
}

export interface LocalDiaryMetadata {
  id: string;
  title: string;
  passwordHint?: string;
  lastModified: string;
  version: number;
  securityLevel: SecurityLevel;
  snapshotCount: number;
  storageKey: string;
}

export interface EditorSettings {
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  margin: 'normal' | 'narrow' | 'moderate' | 'wide';
  zoom: number; // e.g. 100
  paperTheme: 'light' | 'sepia' | 'dark';
}
