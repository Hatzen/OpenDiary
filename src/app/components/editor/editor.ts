import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DiaryService } from '../../services/diary.service';
import { StorageService } from '../../services/storage.service';
import { GitHistoryService, DiffLine } from '../../services/git-history.service';
import { CryptoService } from '../../services/crypto.service';
import {
  EditorSettings,
  GitCommit,
  SecurityLevel,
  SnapshotItem
} from '../../models/diary.model';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './editor.html',
  styleUrl: './editor.css'
})
export class EditorComponent implements OnInit, OnDestroy {
  diaryService = inject(DiaryService);
  storageService = inject(StorageService);
  gitService = inject(GitHistoryService);
  cryptoService = inject(CryptoService);

  @ViewChild('editorArea') editorArea!: ElementRef<HTMLDivElement>;

  settings = signal<EditorSettings>({
    fontFamily: 'Inter',
    fontSize: '12pt',
    lineHeight: '1.6',
    margin: 'normal',
    zoom: 100,
    paperTheme: 'light'
  });

  isSnapshotsDrawerOpen = signal<boolean>(false);
  isGitDrawerOpen = signal<boolean>(false);
  isSecurityModalOpen = signal<boolean>(false);
  isExportModalOpen = signal<boolean>(false);
  isTableModalOpen = signal<boolean>(false);
  isDiffModalOpen = signal<boolean>(false);

  snapshots = signal<SnapshotItem[]>([]);

  newCommitMessage = signal<string>('');
  selectedCommitForDiff = signal<GitCommit | null>(null);
  activeDiffLines = signal<DiffLine[]>([]);

  // Single Optional Password Hint & Security Form
  editPasswordHint = signal<string>('');
  changePassword = signal<string>('');
  changePasswordConfirm = signal<string>('');
  editSecurityLevel = signal<SecurityLevel>('standard');
  securityFormError = signal<string | null>(null);

  tableRows = signal<number>(3);
  tableCols = signal<number>(3);
  tableHasHeader = signal<boolean>(true);

  stats = signal<{ words: number; characters: number }>({ words: 0, characters: 0 });

  readingTime = computed(() => {
    const minutes = Math.ceil(this.stats().words / 200);
    return minutes <= 1 ? '1 min read' : `${minutes} min read`;
  });

  private syncInterval: any = null;

  ngOnInit(): void {
    const doc = this.diaryService.currentDocument();
    if (doc) {
      this.refreshSnapshots();
      this.initSecurityForm();
      this.updateStats(doc.content);
    }
  }

  ngAfterViewInit(): void {
    const doc = this.diaryService.currentDocument();
    if (doc && this.editorArea) {
      this.editorArea.nativeElement.innerHTML = doc.content;
      this.updateStats(doc.content);
    }
  }

  ngOnDestroy(): void {
    if (this.syncInterval) clearInterval(this.syncInterval);
  }

  onEditorInput(): void {
    if (!this.editorArea) return;
    const content = this.editorArea.nativeElement.innerHTML;
    this.diaryService.updateContent(content);
    this.updateStats(content);
  }

  private updateStats(html: string): void {
    const counts = this.gitService.getContentStats(html);
    this.stats.set(counts);
  }

  execCmd(command: string, value: string | undefined = undefined): void {
    this.editorArea.nativeElement.focus();
    document.execCommand(command, false, value);
    this.onEditorInput();
  }

  formatHeading(tag: string): void {
    if (tag === 'p') {
      this.execCmd('formatBlock', '<p>');
    } else {
      this.execCmd('formatBlock', `<${tag}>`);
    }
  }

  setFontFamily(font: string): void {
    this.settings.update(s => ({ ...s, fontFamily: font }));
  }

  setFontSize(size: string): void {
    this.settings.update(s => ({ ...s, fontSize: size }));
  }

  setMargin(margin: 'normal' | 'narrow' | 'moderate' | 'wide'): void {
    this.settings.update(s => ({ ...s, margin }));
  }

  setZoom(zoom: number): void {
    this.settings.update(s => ({ ...s, zoom }));
  }

  setPaperTheme(theme: 'light' | 'sepia' | 'dark'): void {
    this.settings.update(s => ({ ...s, paperTheme: theme }));
  }

  insertCallout(type: 'note' | 'confidential' | 'quote' | 'warning'): void {
    let title = 'Note';
    let borderClass = 'callout-note';

    if (type === 'confidential') {
      title = 'Confidential';
      borderClass = 'callout-confidential';
    } else if (type === 'warning') {
      title = 'Important';
      borderClass = 'callout-warning';
    } else if (type === 'quote') {
      title = 'Reflection';
      borderClass = 'callout-reflection';
    }

    const html = `<div class="editor-callout ${borderClass}" contenteditable="true">
      <div class="callout-header"><strong>${title}</strong></div>
      <p>Insert details here...</p>
    </div><p></p>`;

    this.execCmd('insertHTML', html);
  }

  insertTimestamp(): void {
    const now = new Date();
    const formatted = now.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    const html = `<strong>[ ${formatted} ]</strong>&nbsp;`;
    this.execCmd('insertHTML', html);
  }

  openTableModal(): void {
    this.isTableModalOpen.set(true);
  }

  insertCustomTable(): void {
    const rows = Math.max(1, this.tableRows());
    const cols = Math.max(1, this.tableCols());
    const hasHeader = this.tableHasHeader();

    let tableHtml = `<table class="editor-table">`;
    if (hasHeader) {
      tableHtml += '<thead><tr>';
      for (let c = 0; c < cols; c++) {
        tableHtml += `<th>Header ${c + 1}</th>`;
      }
      tableHtml += '</tr></thead>';
    }

    tableHtml += '<tbody>';
    for (let r = 0; r < rows; r++) {
      tableHtml += '<tr>';
      for (let c = 0; c < cols; c++) {
        tableHtml += `<td>Cell ${r + 1},${c + 1}</td>`;
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table><p></p>';

    this.execCmd('insertHTML', tableHtml);
    this.isTableModalOpen.set(false);
  }

  onImageUpload(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        const html = `<p><img src="${base64}" alt="Journal Image" style="max-width: 100%; height: auto; border-radius: 6px; margin: 12px 0;" /></p><p></p>`;
        this.execCmd('insertHTML', html);
      };
      reader.readAsDataURL(file);
    }
  }

  refreshSnapshots(): void {
    const doc = this.diaryService.currentDocument();
    if (doc) {
      this.snapshots.set(this.storageService.getSnapshots(doc.id));
    }
  }

  toggleSnapshotsDrawer(): void {
    this.refreshSnapshots();
    this.isSnapshotsDrawerOpen.set(!this.isSnapshotsDrawerOpen());
    if (this.isSnapshotsDrawerOpen()) {
      this.isGitDrawerOpen.set(false);
    }
  }

  async triggerManualSnapshot(): Promise<void> {
    await this.diaryService.createSnapshotNow('Manual Snapshot');
    this.refreshSnapshots();
  }

  async restoreSnapshot(snap: SnapshotItem): Promise<void> {
    if (confirm(`Restore snapshot from ${new Date(snap.timestamp).toLocaleString()}? Current unsaved edits will be replaced.`)) {
      const ok = await this.diaryService.restoreSnapshot(snap);
      if (ok && this.editorArea) {
        this.editorArea.nativeElement.innerHTML = this.diaryService.currentDocument()?.content || '';
        this.updateStats(this.editorArea.nativeElement.innerHTML);
      }
      this.isSnapshotsDrawerOpen.set(false);
    }
  }

  deleteSnapshot(snap: SnapshotItem, event: Event): void {
    event.stopPropagation();
    const doc = this.diaryService.currentDocument();
    if (doc && confirm('Delete this snapshot?')) {
      this.storageService.deleteSnapshot(doc.id, snap.id);
      this.refreshSnapshots();
    }
  }

  clearAllSnapshots(): void {
    const doc = this.diaryService.currentDocument();
    if (doc && confirm('Clear all snapshots for this journal?')) {
      this.storageService.clearSnapshots(doc.id);
      this.refreshSnapshots();
    }
  }

  toggleGitDrawer(): void {
    this.isGitDrawerOpen.set(!this.isGitDrawerOpen());
    if (this.isGitDrawerOpen()) {
      this.isSnapshotsDrawerOpen.set(false);
    }
  }

  async handleCommit(): Promise<void> {
    const msg = this.newCommitMessage().trim();
    if (!msg) {
      this.diaryService.showToast('Please enter a commit message.', 'info');
      return;
    }

    const commit = await this.diaryService.commitChanges(msg);
    if (commit) {
      this.newCommitMessage.set('');
      this.refreshSnapshots();
    }
  }

  revertToGitCommit(commit: GitCommit): void {
    if (confirm(`Revert document content to commit [${commit.hash}] "${commit.message}"?`)) {
      this.diaryService.revertToCommit(commit);
      if (this.editorArea) {
        this.editorArea.nativeElement.innerHTML = commit.content;
        this.updateStats(commit.content);
      }
      this.isGitDrawerOpen.set(false);
    }
  }

  viewCommitDiff(commit: GitCommit): void {
    const currentContent = this.diaryService.currentDocument()?.content || '';
    const diff = this.gitService.computeDiff(commit.content, currentContent);
    this.selectedCommitForDiff.set(commit);
    this.activeDiffLines.set(diff);
    this.isDiffModalOpen.set(true);
  }

  openSecurityModal(): void {
    this.initSecurityForm();
    this.isSecurityModalOpen.set(true);
  }

  private initSecurityForm(): void {
    const doc = this.diaryService.currentDocument();
    if (doc) {
      this.editPasswordHint.set(doc.passwordHint || '');
      this.editSecurityLevel.set(doc.securityLevel);
    }
    this.changePassword.set('');
    this.changePasswordConfirm.set('');
    this.securityFormError.set(null);
  }

  async saveSecuritySettings(): Promise<void> {
    this.securityFormError.set(null);

    if (this.changePassword()) {
      if (this.changePassword() !== this.changePasswordConfirm()) {
        this.securityFormError.set('New passwords do not match.');
        return;
      }
    }

    try {
      await this.diaryService.updateSecurity(
        this.editPasswordHint().trim() || undefined,
        this.changePassword(),
        this.editSecurityLevel()
      );
      this.isSecurityModalOpen.set(false);
    } catch (err: any) {
      this.securityFormError.set(err.message || 'Failed to update security settings');
    }
  }

  async handleSave(): Promise<void> {
    await this.diaryService.saveCurrentDocument();
    await this.diaryService.createSnapshotNow('Manual Save');
    this.refreshSnapshots();
  }

  openExportModal(): void {
    this.isExportModalOpen.set(true);
  }

  exportEncryptedFile(): void {
    const doc = this.diaryService.currentDocument();
    const pwd = this.diaryService.sessionPassword();
    if (doc && pwd) {
      this.cryptoService.encryptDocument(doc, pwd).then(env => {
        this.storageService.exportEncryptedFile(env);
        this.isExportModalOpen.set(false);
      });
    }
  }

  exportDecrypted(format: 'html' | 'txt' | 'md'): void {
    const doc = this.diaryService.currentDocument();
    if (doc) {
      this.storageService.exportDecryptedContent(doc.title, doc.content, format);
      this.isExportModalOpen.set(false);
    }
  }

  triggerPrint(): void {
    this.isExportModalOpen.set(false);
    setTimeout(() => {
      window.print();
    }, 150);
  }

  lockVault(): void {
    if (this.diaryService.hasUnsavedChanges()) {
      if (!confirm('You have unsaved changes. Lock vault and clear memory now?')) {
        return;
      }
    }
    this.diaryService.lockAndExit();
  }
}
