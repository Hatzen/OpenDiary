import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DiaryService } from '../../services/diary.service';
import { StorageService } from '../../services/storage.service';
import { CryptoService } from '../../services/crypto.service';
import { EncryptedEnvelope, LocalDiaryMetadata, SecurityLevel } from '../../models/diary.model';

@Component({
  selector: 'app-startpage',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './startpage.html',
  styleUrl: './startpage.css'
})
export class StartpageComponent {
  diaryService = inject(DiaryService);
  storageService = inject(StorageService);
  cryptoService = inject(CryptoService);

  activeTab = signal<'new' | 'local' | 'import-file' | 'import-url'>('new');

  // New Diary Form State
  newTitle = signal<string>('Personal Journal');
  optionalPasswordHint = signal<string>('');
  newPassword = signal<string>('');
  confirmPassword = signal<string>('');
  showPassword = signal<boolean>(false);
  selectedSecurityLevel = signal<SecurityLevel>('standard');
  creationError = signal<string | null>(null);

  passwordStrength = computed(() => {
    return this.cryptoService.evaluatePasswordStrength(this.newPassword());
  });

  savedDiaries = signal<LocalDiaryMetadata[]>([]);
  isDragging = signal<boolean>(false);

  importUrl = signal<string>('');
  isFetchingUrl = signal<boolean>(false);
  urlError = signal<string | null>(null);

  unlockPasswordInput = signal<string>('');
  showUnlockPassword = signal<boolean>(false);

  constructor() {
    this.refreshSavedDiaries();
  }

  refreshSavedDiaries(): void {
    this.savedDiaries.set(this.storageService.getSavedDiaries());
  }

  setActiveTab(tab: 'new' | 'local' | 'import-file' | 'import-url'): void {
    this.activeTab.set(tab);
    if (tab === 'local') {
      this.refreshSavedDiaries();
    }
  }

  async handleCreateDiary(): Promise<void> {
    this.creationError.set(null);

    const title = this.newTitle().trim();
    if (!title) {
      this.creationError.set('Please provide a diary title.');
      return;
    }

    if (!this.newPassword()) {
      this.creationError.set('Please choose an encryption password.');
      return;
    }

    if (this.newPassword() !== this.confirmPassword()) {
      this.creationError.set('Passwords do not match. Please re-enter.');
      return;
    }

    try {
      await this.diaryService.createNewDiary(
        title,
        this.optionalPasswordHint().trim() || undefined,
        this.newPassword(),
        this.selectedSecurityLevel()
      );
    } catch (e: any) {
      this.creationError.set(e.message || 'Creation failed');
    }
  }

  openLocalDiary(item: LocalDiaryMetadata): void {
    const envelope = this.storageService.loadEncryptedDiary(item.id);
    if (!envelope) {
      this.diaryService.showToast('Could not load encrypted diary from storage.', 'error');
      return;
    }
    this.unlockPasswordInput.set('');
    this.diaryService.prepareUnlock(envelope);
  }

  deleteLocalDiary(item: LocalDiaryMetadata, event: Event): void {
    event.stopPropagation();
    if (confirm(`Permanently remove "${item.title}" and all its encrypted snapshots from this browser?`)) {
      this.storageService.deleteDiary(item.id);
      this.refreshSavedDiaries();
      this.diaryService.showToast(`Deleted "${item.title}"`, 'info');
    }
  }

  exportLocalDiary(item: LocalDiaryMetadata, event: Event): void {
    event.stopPropagation();
    const envelope = this.storageService.loadEncryptedDiary(item.id);
    if (envelope) {
      this.storageService.exportEncryptedFile(envelope);
    }
  }

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.isDragging.set(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFileSelected(files[0]);
    }
  }

  onFileInputChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFileSelected(input.files[0]);
    }
  }

  private handleFileSelected(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const envelope = JSON.parse(text) as EncryptedEnvelope;
        if (envelope.format !== 'OPENDIARY_V1' && envelope.format !== 'MEMOIREN_V1') {
          throw new Error('Not a valid OpenDiary file format.');
        }
        this.unlockPasswordInput.set('');
        this.diaryService.prepareUnlock(envelope);
      } catch (err: any) {
        this.diaryService.showToast(`Invalid file: ${err.message}`, 'error');
      }
    };
    reader.onerror = () => {
      this.diaryService.showToast('Error reading selected file.', 'error');
    };
    reader.readAsText(file);
  }

  async handleImportFromUrl(): Promise<void> {
    const url = this.importUrl().trim();
    if (!url) return;

    this.isFetchingUrl.set(true);
    this.urlError.set(null);

    try {
      const envelope = await this.storageService.fetchFromUrl(url);
      this.unlockPasswordInput.set('');
      this.diaryService.prepareUnlock(envelope);
    } catch (e: any) {
      this.urlError.set(e.message || 'Failed to fetch encrypted diary from URL.');
    } finally {
      this.isFetchingUrl.set(false);
    }
  }

  async submitUnlock(): Promise<void> {
    const pwd = this.unlockPasswordInput();
    if (!pwd) return;
    await this.diaryService.unlockPendingEnvelope(pwd);
  }

  closeUnlockModal(): void {
    this.diaryService.closeUnlockModal();
    this.unlockPasswordInput.set('');
  }
}
