import { Injectable, computed, inject, signal } from '@angular/core';
import { CryptoService } from './crypto.service';
import { GitHistoryService } from './git-history.service';
import { StorageService } from './storage.service';
import {
  DiaryDocument,
  EncryptedEnvelope,
  GitCommit,
  SecurityLevel,
  SnapshotItem
} from '../models/diary.model';

@Injectable({
  providedIn: 'root'
})
export class DiaryService {
  private crypto = inject(CryptoService);
  private storage = inject(StorageService);
  private git = inject(GitHistoryService);

  readonly currentDocument = signal<DiaryDocument | null>(null);
  readonly sessionPassword = signal<string>('');
  readonly hasUnsavedChanges = signal<boolean>(false);
  readonly currentView = signal<'startpage' | 'editor'>('startpage');

  // Pending unlock modal state
  readonly pendingEnvelope = signal<EncryptedEnvelope | null>(null);
  readonly isUnlockModalOpen = signal<boolean>(false);
  readonly unlockError = signal<string | null>(null);
  readonly isDecrypting = signal<boolean>(false);

  // Status & notifications
  readonly toastMessage = signal<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  readonly lastSnapshotTime = signal<string | null>(null);

  // Computed signals
  readonly isUnlocked = computed(() => this.currentDocument() !== null && !!this.sessionPassword());
  readonly documentTitle = computed(() => this.currentDocument()?.title || 'OpenDiary');
  readonly currentHint = computed(() => this.currentDocument()?.passwordHint || null);

  private autoSnapshotTimer: any = null;

  constructor() {
    this.startAutoSnapshotEngine();
  }

  showToast(text: string, type: 'success' | 'error' | 'info' = 'info', duration: number = 3500): void {
    this.toastMessage.set({ text, type });
    setTimeout(() => {
      if (this.toastMessage()?.text === text) {
        this.toastMessage.set(null);
      }
    }, duration);
  }

  /**
   * Creates a new blank diary document with optional password hint
   */
  async createNewDiary(
    title: string,
    passwordHint: string | undefined,
    password: string,
    securityLevel: SecurityLevel = 'standard'
  ): Promise<DiaryDocument> {
    const id = `diary_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date().toISOString();

    const cleanTitle = title.trim() || 'Untitled Diary';
    const initialContent = `<h1>${this.escapeHtml(cleanTitle)}</h1>
<p>Begin writing your encrypted personal journal, reflections, or notes here.</p>
<hr/>
<p>Protected with <strong>AES-256-GCM</strong>, <strong>PBKDF2 key derivation</strong>, <strong>Salt & Pepper</strong>, and <strong>Static Swap</strong>.</p>`;

    const initialCommit: GitCommit = {
      hash: await this.git.generateCommitHash(initialContent, now, '0000000'),
      timestamp: now,
      author: 'Author',
      message: 'Initial journal creation',
      content: initialContent,
      stats: this.git.getContentStats(initialContent)
    };

    const doc: DiaryDocument = {
      id,
      title: cleanTitle,
      passwordHint: passwordHint ? passwordHint.trim() : undefined,
      content: initialContent,
      createdAt: now,
      lastModified: now,
      version: 1,
      securityLevel,
      gitHistory: [initialCommit]
    };

    this.currentDocument.set(doc);
    this.sessionPassword.set(password);
    this.hasUnsavedChanges.set(false);
    this.currentView.set('editor');

    await this.saveCurrentDocument();
    await this.createSnapshotNow('Initial checkpoint');

    this.showToast('Journal created and encrypted successfully', 'success');
    return doc;
  }

  prepareUnlock(envelope: EncryptedEnvelope): void {
    this.pendingEnvelope.set(envelope);
    this.unlockError.set(null);
    this.isUnlockModalOpen.set(true);
  }

  closeUnlockModal(): void {
    this.isUnlockModalOpen.set(false);
    this.pendingEnvelope.set(null);
    this.unlockError.set(null);
  }

  async unlockPendingEnvelope(password: string): Promise<boolean> {
    const envelope = this.pendingEnvelope();
    if (!envelope) return false;

    this.isDecrypting.set(true);
    this.unlockError.set(null);

    try {
      const doc = await this.crypto.decryptDocument(envelope, password);
      this.currentDocument.set(doc);
      this.sessionPassword.set(password);
      this.hasUnsavedChanges.set(false);
      this.isUnlockModalOpen.set(false);
      this.pendingEnvelope.set(null);
      this.currentView.set('editor');

      this.showToast(`Unlocked "${doc.title}"`, 'success');
      return true;
    } catch (err: any) {
      this.unlockError.set(err.message || 'Incorrect password.');
      return false;
    } finally {
      this.isDecrypting.set(false);
    }
  }

  updateContent(newContent: string): void {
    const doc = this.currentDocument();
    if (!doc) return;

    if (doc.content !== newContent) {
      doc.content = newContent;
      doc.lastModified = new Date().toISOString();
      this.currentDocument.set({ ...doc });
      this.hasUnsavedChanges.set(true);
    }
  }

  async saveCurrentDocument(newPassword?: string): Promise<void> {
    const doc = this.currentDocument();
    const pwd = newPassword || this.sessionPassword();
    if (!doc || !pwd) return;

    doc.lastModified = new Date().toISOString();
    doc.version += 1;

    try {
      const envelope = await this.crypto.encryptDocument(doc, pwd);
      this.storage.saveEncryptedDiary(envelope);
      if (newPassword) {
        this.sessionPassword.set(newPassword);
      }
      this.currentDocument.set({ ...doc });
      this.hasUnsavedChanges.set(false);
      this.showToast('Saved and encrypted to local storage', 'success');
    } catch (err: any) {
      this.showToast(`Save failed: ${err.message}`, 'error');
    }
  }

  async createSnapshotNow(customTitle?: string): Promise<void> {
    const doc = this.currentDocument();
    const pwd = this.sessionPassword();
    if (!doc || !pwd) return;

    try {
      await this.storage.createSnapshot(doc, pwd);
      this.lastSnapshotTime.set(new Date().toLocaleTimeString());
    } catch (e) {
      console.warn('Snapshot error', e);
    }
  }

  async restoreSnapshot(snapshot: SnapshotItem): Promise<boolean> {
    const pwd = this.sessionPassword();
    if (!pwd) return false;

    try {
      const envelope: EncryptedEnvelope = JSON.parse(snapshot.encryptedData);
      const restoredDoc = await this.crypto.decryptDocument(envelope, pwd);

      const doc = this.currentDocument();
      if (doc) {
        doc.content = restoredDoc.content;
        doc.lastModified = new Date().toISOString();
        doc.version += 1;
        this.currentDocument.set({ ...doc });
        this.hasUnsavedChanges.set(true);
        this.showToast(`Restored snapshot from ${new Date(snapshot.timestamp).toLocaleTimeString()}`, 'success');
        return true;
      }
    } catch (err: any) {
      this.showToast(`Failed to restore snapshot: ${err.message}`, 'error');
    }
    return false;
  }

  async commitChanges(message: string, author: string = 'Author'): Promise<GitCommit | null> {
    const doc = this.currentDocument();
    if (!doc) return null;

    try {
      const newCommit = await this.git.createCommit(doc, message, author);
      doc.gitHistory.push(newCommit);
      doc.lastModified = new Date().toISOString();
      doc.version += 1;
      this.currentDocument.set({ ...doc });

      await this.saveCurrentDocument();
      await this.createSnapshotNow(`Commit: ${newCommit.hash}`);

      this.showToast(`Committed [${newCommit.hash}]`, 'success');
      return newCommit;
    } catch (err: any) {
      this.showToast(`Commit failed: ${err.message}`, 'error');
      return null;
    }
  }

  revertToCommit(commit: GitCommit): void {
    const doc = this.currentDocument();
    if (!doc) return;

    doc.content = commit.content;
    doc.lastModified = new Date().toISOString();
    doc.version += 1;
    this.currentDocument.set({ ...doc });
    this.hasUnsavedChanges.set(true);
    this.showToast(`Reverted to commit ${commit.hash}`, 'info');
  }

  async updateSecurity(
    newPasswordHint?: string,
    newPassword?: string,
    newSecurityLevel?: SecurityLevel
  ): Promise<void> {
    const doc = this.currentDocument();
    if (!doc) return;

    doc.passwordHint = newPasswordHint ? newPasswordHint.trim() : undefined;
    if (newSecurityLevel) {
      doc.securityLevel = newSecurityLevel;
    }

    const pwd = newPassword && newPassword.trim() ? newPassword.trim() : this.sessionPassword();

    await this.saveCurrentDocument(pwd);
    this.showToast('Security settings updated', 'success');
  }

  lockAndExit(): void {
    this.currentDocument.set(null);
    this.sessionPassword.set('');
    this.hasUnsavedChanges.set(false);
    this.currentView.set('startpage');
    this.showToast('Vault locked. Memory cleared.', 'info');
  }

  private startAutoSnapshotEngine(): void {
    if (this.autoSnapshotTimer) clearInterval(this.autoSnapshotTimer);

    this.autoSnapshotTimer = setInterval(async () => {
      if (this.isUnlocked() && this.hasUnsavedChanges()) {
        await this.createSnapshotNow('Auto-save snapshot');
      }
    }, 30000);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
