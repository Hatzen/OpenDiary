import { Injectable } from '@angular/core';
import { DiaryDocument, GitCommit } from '../models/diary.model';

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
}

@Injectable({
  providedIn: 'root'
})
export class GitHistoryService {

  /**
   * Generates a 7-character commit hash using SHA-256
   */
  async generateCommitHash(content: string, timestamp: string, parentHash: string = ''): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(`${parentHash}::${timestamp}::${content}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const fullHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return fullHex.substring(0, 7);
  }

  /**
   * Counts words and characters in HTML content
   */
  getContentStats(htmlContent: string): { words: number; characters: number } {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent || '';
    const plainText = tempDiv.textContent || tempDiv.innerText || '';
    const cleanText = plainText.trim();
    const words = cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0;
    return {
      words,
      characters: plainText.length
    };
  }

  /**
   * Creates a new GitCommit
   */
  async createCommit(
    doc: DiaryDocument,
    message: string,
    author: string = 'Author'
  ): Promise<GitCommit> {
    const timestamp = new Date().toISOString();
    const lastCommit = doc.gitHistory.length > 0 ? doc.gitHistory[doc.gitHistory.length - 1] : null;
    const parentHash = lastCommit ? lastCommit.hash : '0000000';
    const hash = await this.generateCommitHash(doc.content, timestamp, parentHash);
    const stats = this.getContentStats(doc.content);

    return {
      hash,
      timestamp,
      author,
      message: message.trim() || `Commit ${hash}`,
      content: doc.content,
      stats
    };
  }

  /**
   * Computes a line-by-line diff between two text/HTML contents
   */
  computeDiff(oldText: string, newText: string): DiffLine[] {
    const oldLines = this.extractLines(oldText);
    const newLines = this.extractLines(newText);

    // Simple, clear LCS (Longest Common Subsequence) diff implementation
    const m = oldLines.length;
    const n = newLines.length;

    // dp table
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to find differences
    const diff: DiffLine[] = [];
    let i = m;
    let j = n;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        diff.unshift({ type: 'unchanged', content: oldLines[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        diff.unshift({ type: 'added', content: newLines[j - 1] });
        j--;
      } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
        diff.unshift({ type: 'removed', content: oldLines[i - 1] });
        i--;
      }
    }

    return diff;
  }

  private extractLines(htmlOrText: string): string[] {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlOrText || '';
    const text = tempDiv.innerText || tempDiv.textContent || '';
    return text.split('\n');
  }
}
