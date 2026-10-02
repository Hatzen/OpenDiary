import { Injectable } from '@angular/core';
import { DiaryDocument, EncryptedEnvelope, SecurityLevel } from '../models/diary.model';

@Injectable({
  providedIn: 'root'
})
export class CryptoService {
  private readonly SYSTEM_PEPPER = 'OpenDiary::Vault::StaticPepper_7f9b2c3a5e1d408f912e::2026';
  private readonly LEGACY_PEPPER = 'Memoiren::Vault::StaticPepper_7f9b2c3a5e1d408f912e::2026';
  private readonly STANDARD_ITERATIONS = 100_000;
  private readonly MAXIMUM_ITERATIONS = 300_000;

  /**
   * Evaluates the strength of a password
   */
  evaluatePasswordStrength(password: string): {
    score: number; // 0 to 100
    level: 'weak' | 'fair' | 'good' | 'strong';
    feedback: string;
  } {
    if (!password) {
      return { score: 0, level: 'weak', feedback: 'Password cannot be empty' };
    }

    let score = 0;
    if (password.length >= 8) score += 20;
    if (password.length >= 12) score += 20;
    if (password.length >= 16) score += 15;
    if (/[a-z]/.test(password)) score += 10;
    if (/[A-Z]/.test(password)) score += 15;
    if (/[0-9]/.test(password)) score += 10;
    if (/[^a-zA-Z0-9]/.test(password)) score += 10;

    let level: 'weak' | 'fair' | 'good' | 'strong' = 'weak';
    let feedback = 'Password is too short';

    if (score >= 80) {
      level = 'strong';
      feedback = 'High security passphrase';
    } else if (score >= 60) {
      level = 'good';
      feedback = 'Good password. Add symbols or length for maximum safety';
    } else if (score >= 40) {
      level = 'fair';
      feedback = 'Moderate. Consider adding numbers and special characters';
    }

    return { score: Math.min(score, 100), level, feedback };
  }

  /**
   * Deterministic Static Swap Algorithm
   */
  applyStaticSwap(bytes: Uint8Array, seedStr: string, rounds: number = 1, pepper: string = this.SYSTEM_PEPPER): Uint8Array {
    const output = new Uint8Array(bytes);
    if (output.length === 0) return output;

    for (let r = 0; r < rounds; r++) {
      const currentSeed = `${seedStr}::round_${r}::${pepper}`;
      const { sbox, swapIndices } = this.generateSwapTables(currentSeed, output.length);

      for (let i = 0; i < output.length; i++) {
        output[i] = sbox[output[i]];
      }

      for (let i = 0; i < output.length; i++) {
        const target = swapIndices[i];
        if (target !== i) {
          const temp = output[i];
          output[i] = output[target];
          output[target] = temp;
        }
      }
    }

    return output;
  }

  /**
   * Inverse of Static Swap Algorithm
   */
  reverseStaticSwap(bytes: Uint8Array, seedStr: string, rounds: number = 1, pepper: string = this.SYSTEM_PEPPER): Uint8Array {
    const output = new Uint8Array(bytes);
    if (output.length === 0) return output;

    for (let r = rounds - 1; r >= 0; r--) {
      const currentSeed = `${seedStr}::round_${r}::${pepper}`;
      const { invSbox, swapIndices } = this.generateSwapTables(currentSeed, output.length);

      for (let i = output.length - 1; i >= 0; i--) {
        const target = swapIndices[i];
        if (target !== i) {
          const temp = output[i];
          output[i] = output[target];
          output[target] = temp;
        }
      }

      for (let i = 0; i < output.length; i++) {
        output[i] = invSbox[output[i]];
      }
    }

    return output;
  }

  private generateSwapTables(seedStr: string, length: number): {
    sbox: Uint8Array;
    invSbox: Uint8Array;
    swapIndices: Int32Array;
  } {
    let hash = 2166136261;
    for (let i = 0; i < seedStr.length; i++) {
      hash ^= seedStr.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    let prngState = hash >>> 0;

    const nextPrng = (): number => {
      prngState ^= prngState << 13;
      prngState ^= prngState >>> 17;
      prngState ^= prngState << 5;
      return (prngState >>> 0) / 4294967296;
    };

    const sbox = new Uint8Array(256);
    for (let i = 0; i < 256; i++) sbox[i] = i;

    for (let i = 255; i > 0; i--) {
      const j = Math.floor(nextPrng() * (i + 1));
      const temp = sbox[i];
      sbox[i] = sbox[j];
      sbox[j] = temp;
    }

    const invSbox = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      invSbox[sbox[i]] = i;
    }

    const swapIndices = new Int32Array(length);
    for (let i = 0; i < length; i++) {
      swapIndices[i] = Math.floor(nextPrng() * length);
    }

    return { sbox, invSbox, swapIndices };
  }

  private async deriveKey(
    password: string,
    saltBytes: Uint8Array,
    securityLevel: SecurityLevel,
    pepper: string = this.SYSTEM_PEPPER
  ): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const pepperedPassword = `${password}::${pepper}`;
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(pepperedPassword),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const iterations =
      securityLevel === 'maximum' ? this.MAXIMUM_ITERATIONS : this.STANDARD_ITERATIONS;

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes as BufferSource,
        iterations,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypts a DiaryDocument into an EncryptedEnvelope
   */
  async encryptDocument(
    doc: DiaryDocument,
    password: string
  ): Promise<EncryptedEnvelope> {
    const encoder = new TextEncoder();
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const ivBytes = crypto.getRandomValues(new Uint8Array(12));

    const seed = `seed_${doc.id}_v${doc.version}_${doc.lastModified}`;
    const swapRounds = doc.securityLevel === 'maximum' ? 3 : 1;

    const payloadToEncrypt = JSON.stringify({
      content: doc.content,
      gitHistory: doc.gitHistory,
      version: doc.version,
      lastModified: doc.lastModified
    });

    const plaintextBytes = encoder.encode(payloadToEncrypt);
    const checksumDigest = await crypto.subtle.digest('SHA-256', plaintextBytes as BufferSource);
    const checksum = this.bytesToBase64(new Uint8Array(checksumDigest));

    const swappedBytes = this.applyStaticSwap(plaintextBytes, seed, swapRounds, this.SYSTEM_PEPPER);
    const aesKey = await this.deriveKey(password, saltBytes, doc.securityLevel, this.SYSTEM_PEPPER);

    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: ivBytes as BufferSource },
      aesKey,
      swappedBytes as BufferSource
    );

    const ciphertext = this.bytesToBase64(new Uint8Array(encryptedBuffer));

    return {
      format: 'OPENDIARY_V1',
      id: doc.id,
      title: doc.title,
      passwordHint: doc.passwordHint ? doc.passwordHint.trim() : undefined,
      securityLevel: doc.securityLevel,
      salt: this.bytesToBase64(saltBytes),
      iv: this.bytesToBase64(ivBytes),
      seed,
      version: doc.version,
      lastModified: doc.lastModified,
      swapRounds,
      ciphertext,
      checksum
    };
  }

  /**
   * Decrypts an EncryptedEnvelope into a DiaryDocument
   */
  async decryptDocument(
    envelope: EncryptedEnvelope,
    password: string
  ): Promise<DiaryDocument> {
    if (envelope.format !== 'OPENDIARY_V1' && envelope.format !== 'MEMOIREN_V1') {
      throw new Error('Unsupported format. Expected OPENDIARY_V1 or MEMOIREN_V1.');
    }

    const isLegacy = envelope.format === 'MEMOIREN_V1';
    const pepper = isLegacy ? this.LEGACY_PEPPER : this.SYSTEM_PEPPER;

    const saltBytes = this.base64ToBytes(envelope.salt);
    const ivBytes = this.base64ToBytes(envelope.iv);
    const ciphertextBytes = this.base64ToBytes(envelope.ciphertext);

    let aesKey: CryptoKey;
    let decryptedBuffer: ArrayBuffer;

    try {
      aesKey = await this.deriveKey(password, saltBytes, envelope.securityLevel, pepper);
      decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes as BufferSource },
        aesKey,
        ciphertextBytes as BufferSource
      );
    } catch {
      // If legacy pepper didn't match or vice-versa, try system pepper as fallback
      try {
        const altPepper = isLegacy ? this.SYSTEM_PEPPER : this.LEGACY_PEPPER;
        aesKey = await this.deriveKey(password, saltBytes, envelope.securityLevel, altPepper);
        decryptedBuffer = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: ivBytes as BufferSource },
          aesKey,
          ciphertextBytes as BufferSource
        );
      } catch {
        throw new Error('Decryption failed: Incorrect password or corrupted data.');
      }
    }

    const swappedBytes = new Uint8Array(decryptedBuffer);
    const swapRounds = envelope.swapRounds || (envelope.securityLevel === 'maximum' ? 3 : 1);
    const restoredBytes = this.reverseStaticSwap(swappedBytes, envelope.seed, swapRounds, pepper);

    if (envelope.checksum) {
      const checksumDigest = await crypto.subtle.digest('SHA-256', restoredBytes as BufferSource);
      const currentChecksum = this.bytesToBase64(new Uint8Array(checksumDigest));
      if (currentChecksum !== envelope.checksum) {
        throw new Error('Integrity validation failed: Checksum mismatch.');
      }
    }

    const decoder = new TextDecoder();
    const jsonString = decoder.decode(restoredBytes);
    const payload = JSON.parse(jsonString);

    // Extract password hint (handling optional passwordHint or legacy hints)
    let hint = envelope.passwordHint;
    if (!hint && envelope.hints) {
      const parts = [
        envelope.hints.firstPet,
        envelope.hints.mothersSecondName,
        envelope.hints.mostImportantLeak,
        envelope.hints.firstPhoneNumber,
        envelope.hints.customHint
      ].filter(Boolean);
      if (parts.length > 0) hint = parts.join(' | ');
    }

    return {
      id: envelope.id,
      title: envelope.title,
      passwordHint: hint,
      content: payload.content || '',
      createdAt: envelope.lastModified,
      lastModified: envelope.lastModified,
      version: envelope.version,
      securityLevel: envelope.securityLevel,
      gitHistory: payload.gitHistory || []
    };
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
