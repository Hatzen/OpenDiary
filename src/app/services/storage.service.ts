import { Injectable, inject } from '@angular/core';
import { CryptoService } from './crypto.service';
import {
  DiaryDocument,
  EncryptedEnvelope,
  LocalDiaryMetadata,
  SnapshotItem
} from '../models/diary.model';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private crypto = inject(CryptoService);

  private readonly INDEX_KEY = 'opendiary_catalogue_v1';
  private readonly LEGACY_INDEX_KEY = 'memoiren_catalogue_v1';
  private readonly SNAPSHOT_PREFIX = 'opendiary_snapshots_';
  private readonly DOC_PREFIX = 'opendiary_doc_';
  private readonly MAX_SNAPSHOTS = 50;

  /**
   * Retrieves all saved diary metadata from localStorage
   */
  getSavedDiaries(): LocalDiaryMetadata[] {
    try {
      let raw = localStorage.getItem(this.INDEX_KEY);
      if (!raw) {
        // Fallback to legacy index if exists
        raw = localStorage.getItem(this.LEGACY_INDEX_KEY);
        if (!raw) return [];
      }
      const parsed = JSON.parse(raw);
      return parsed.map((item: any) => ({
        id: item.id,
        title: item.title,
        passwordHint: item.passwordHint || (item.hints ? Object.values(item.hints).filter(Boolean).join(' | ') : undefined),
        lastModified: item.lastModified,
        version: item.version,
        securityLevel: item.securityLevel,
        snapshotCount: item.snapshotCount || 0,
        storageKey: item.storageKey || `${this.DOC_PREFIX}${item.id}`
      }));
    } catch {
      return [];
    }
  }

  /**
   * Saves or updates an encrypted envelope in localStorage and updates index
   */
  saveEncryptedDiary(envelope: EncryptedEnvelope): void {
    const key = `${this.DOC_PREFIX}${envelope.id}`;
    localStorage.setItem(key, JSON.stringify(envelope));

    const catalogue = this.getSavedDiaries();
    const existingIndex = catalogue.findIndex(d => d.id === envelope.id);
    const snapshots = this.getSnapshots(envelope.id);

    const meta: LocalDiaryMetadata = {
      id: envelope.id,
      title: envelope.title,
      passwordHint: envelope.passwordHint,
      lastModified: envelope.lastModified,
      version: envelope.version,
      securityLevel: envelope.securityLevel,
      snapshotCount: snapshots.length,
      storageKey: key
    };

    if (existingIndex >= 0) {
      catalogue[existingIndex] = meta;
    } else {
      catalogue.unshift(meta);
    }

    localStorage.setItem(this.INDEX_KEY, JSON.stringify(catalogue));
  }

  /**
   * Loads an encrypted envelope from localStorage by id
   */
  loadEncryptedDiary(id: string): EncryptedEnvelope | null {
    let raw = localStorage.getItem(`${this.DOC_PREFIX}${id}`);
    if (!raw) {
      // Try legacy prefix
      raw = localStorage.getItem(`memoiren_doc_${id}`);
      if (!raw) return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Deletes a diary and its snapshots from localStorage
   */
  deleteDiary(id: string): void {
    localStorage.removeItem(`${this.DOC_PREFIX}${id}`);
    localStorage.removeItem(`memoiren_doc_${id}`);
    localStorage.removeItem(`${this.SNAPSHOT_PREFIX}${id}`);
    localStorage.removeItem(`memoiren_snapshots_${id}`);

    const catalogue = this.getSavedDiaries().filter(d => d.id !== id);
    localStorage.setItem(this.INDEX_KEY, JSON.stringify(catalogue));
  }

  /**
   * Gets all automatic snapshots for a document
   */
  getSnapshots(docId: string): SnapshotItem[] {
    try {
      let raw = localStorage.getItem(`${this.SNAPSHOT_PREFIX}${docId}`);
      if (!raw) {
        raw = localStorage.getItem(`memoiren_snapshots_${docId}`);
        if (!raw) return [];
      }
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /**
   * Creates and stores an encrypted snapshot into localStorage
   */
  async createSnapshot(
    doc: DiaryDocument,
    password: string
  ): Promise<SnapshotItem> {
    const envelope = await this.crypto.encryptDocument(doc, password);
    const encryptedString = JSON.stringify(envelope);

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = doc.content || '';
    const text = (tempDiv.textContent || tempDiv.innerText || '').trim();
    const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;

    const snapshot: SnapshotItem = {
      id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      documentId: doc.id,
      timestamp: new Date().toISOString(),
      version: doc.version,
      title: doc.title,
      encryptedData: encryptedString,
      wordCount,
      byteSize: new Blob([encryptedString]).size
    };

    const snapshots = this.getSnapshots(doc.id);
    snapshots.unshift(snapshot);

    if (snapshots.length > this.MAX_SNAPSHOTS) {
      snapshots.length = this.MAX_SNAPSHOTS;
    }

    try {
      localStorage.setItem(`${this.SNAPSHOT_PREFIX}${doc.id}`, JSON.stringify(snapshots));
      const catalogue = this.getSavedDiaries();
      const entry = catalogue.find(d => d.id === doc.id);
      if (entry) {
        entry.snapshotCount = snapshots.length;
        localStorage.setItem(this.INDEX_KEY, JSON.stringify(catalogue));
      }
    } catch (e) {
      console.warn('LocalStorage snapshot quota reached. Removing older snapshots.', e);
      snapshots.splice(20);
      localStorage.setItem(`${this.SNAPSHOT_PREFIX}${doc.id}`, JSON.stringify(snapshots));
    }

    return snapshot;
  }

  deleteSnapshot(docId: string, snapshotId: string): void {
    const snapshots = this.getSnapshots(docId).filter(s => s.id !== snapshotId);
    localStorage.setItem(`${this.SNAPSHOT_PREFIX}${docId}`, JSON.stringify(snapshots));

    const catalogue = this.getSavedDiaries();
    const entry = catalogue.find(d => d.id === docId);
    if (entry) {
      entry.snapshotCount = snapshots.length;
      localStorage.setItem(this.INDEX_KEY, JSON.stringify(catalogue));
    }
  }

  clearSnapshots(docId: string): void {
    localStorage.removeItem(`${this.SNAPSHOT_PREFIX}${docId}`);
    localStorage.removeItem(`memoiren_snapshots_${docId}`);
    const catalogue = this.getSavedDiaries();
    const entry = catalogue.find(d => d.id === docId);
    if (entry) {
      entry.snapshotCount = 0;
      localStorage.setItem(this.INDEX_KEY, JSON.stringify(catalogue));
    }
  }

  /**
   * Exports an encrypted envelope as a downloadable .opendiary file
   */
  exportEncryptedFile(envelope: EncryptedEnvelope): void {
    const jsonStr = JSON.stringify(envelope, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const filename = `${this.slugify(envelope.title || 'opendiary')}_v${envelope.version}.opendiary`;
    this.triggerDownload(blob, filename);
  }

  exportDecryptedContent(title: string, content: string, format: 'html' | 'txt' | 'md'): void {
    let mimeType = 'text/plain';
    let data = content;
    let ext = format;

    if (format === 'html') {
      mimeType = 'text/html';
      data = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${this.escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 800px; margin: 48px auto; padding: 0 24px; line-height: 1.6; color: #1e293b; background: #f8fafc; }
    article { background: #fff; padding: 48px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 24px; }
    blockquote { border-left: 4px solid #94a3b8; margin: 16px 0; padding-left: 16px; color: #475569; font-style: italic; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #cbd5e1; padding: 10px 14px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; }
  </style>
</head>
<body>
  <article>
    <h1>${this.escapeHtml(title)}</h1>
    ${content}
  </article>
</body>
</html>`;
    } else if (format === 'txt' || format === 'md') {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = content;
      data = `# ${title}\n\n${tempDiv.innerText || tempDiv.textContent || ''}`;
    }

    const blob = new Blob([data], { type: mimeType });
    this.triggerDownload(blob, `${this.slugify(title)}.${ext}`);
  }

  async fetchFromUrl(url: string): Promise<EncryptedEnvelope> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch from URL: HTTP ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (!data || (data.format !== 'OPENDIARY_V1' && data.format !== 'MEMOIREN_V1')) {
      throw new Error('Fetched file does not contain a valid OpenDiary envelope.');
    }
    return data as EncryptedEnvelope;
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '_')
      .replace(/^-+|-+$/g, '') || 'opendiary';
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
