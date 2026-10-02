# OpenDiary 🛡️

**OpenDiary** is a client-side zero-knowledge encrypted personal journal and diary web application built with **Angular (TypeScript)**. It runs entirely inside the user's browser with no server requirement and can be hosted directly as a static webpage on **GitHub Pages**.

---

## 🌟 Key Capabilities

### 1. Multi-Layer Cryptography
- **AES-256-GCM**: Authenticated symmetric encryption ensuring both confidentiality and data tampering detection.
- **PBKDF2 Key Derivation**: High-iteration key derivation (up to 300,000 rounds) using SHA-256.
- **Unique Salt & Pepper**: Cryptographically secure 16-byte random salt per revision combined with application-level static pepper.
- **Deterministic Static Swap Algorithm**:
  - Deterministic S-Box substitution and pair-wise byte transpositions seeded by document version, modification timestamp, and cryptographic state.
  - Executed before AES-GCM encryption and inverted upon decryption.
- **Integrity Checksums**: Plaintext SHA-256 checksums verified upon decryption.

### 2. Optional Password Reminder Hint
- The encrypted file header (`OPENDIARY_V1`) allows users to store an **optional password reminder hint**.
- The hint is stored unencrypted in the file metadata so the author can recall their passphrase.
- All journal contents, formatting, and history remain strictly encrypted inside the authenticated ciphertext payload.

### 3. Professional DIN A4 Word-Like WYSIWYG Editor
- Standard DIN A4 page layout (**210mm × 297mm**) with authentic paper borders, subtle depth shadows, running headers, and footers.
- **Typography Suite**: Inter, Playfair Display (Serif), Cormorant Garamond, JetBrains Mono, Georgia; font sizes from 10pt to 24pt; Paragraph, H1, H2, H3.
- **Formatting Tools**: Bold, Italic, Underline, Strikethrough, Subscript, Superscript, Text Color, Highlight.
- **Layout & Structure**: Align Left/Center/Right/Justify, Bulleted lists, Numbered lists, Indent/Outdent, Blockquotes, Dividers.
- **Insert Tools**:
  - Date & Time stamp shortcut
  - Callout boxes (Notes, Confidential, Reflections, Warnings)
  - Dynamic Table generator (custom rows & columns)
  - Inline image upload (encrypted as base64 inside the vault payload)
- **Margins & Themes**: Normal (25mm), Narrow (15mm), Moderate (20mm), Wide (35mm); Bright White, Warm Parchment, and Night Slate themes.
- **Live Metrics**: Word count, character count, and estimated reading time.
- **Print / PDF**: Dedicated `@media print` rules for 1:1 clean DIN A4 printing or saving as PDF with zero UI chrome.

### 4. Encrypted Local Storage Snapshots
- Background auto-snapshot engine encrypts and saves revisions to browser `localStorage` every 30 seconds when edits are detected.
- Snapshots drawer provides a timestamped revision log with word count, byte size, one-click rollback, and deletion.

### 5. Git-Like Version Control Timeline & Diff Viewer
- In-vault version control system.
- Commit creation with custom commit messages.
- Deterministic 7-character SHA-256 commit hashes.
- Interactive timeline showing commit history, timestamps, and word statistics.
- Line-by-line **Diff Viewer** highlighting additions and deletions.
- One-click rollback to any historical commit.

### 6. Storage & Import Sources
- **New Journal**: Configure title, optional password reminder hint, passphrase with real-time entropy evaluation, and security level.
- **Local Storage Vaults**: Direct access to journals saved locally in this browser.
- **Drag & Drop File Open**: Open `.opendiary`, `.memoiren`, or `.json` files directly.
- **Import from URL**: Fetch public encrypted files from GitHub Raw, Gist, or any CORS-enabled web endpoint.

---

## 🚀 Getting Started

### Installation
```bash
npm install
```

### Development Server
```bash
npm start
```
Open [http://localhost:4200](http://localhost:4200) in your browser.

### Production Build
```bash
npm run build
```
The compiled static production bundle will be located in `dist/opendiary/browser`.

### Automated GitHub Pages Deployment
A GitHub Actions workflow is included at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) that automatically builds and deploys OpenDiary to GitHub Pages whenever changes are merged into the `main` or `master` branch.

**One-time Repository Configuration:**
1. Navigate to **Settings** > **Pages** in your GitHub repository.
2. Under **Build and deployment** > **Source**, choose **GitHub Actions**.
3. Every merge or push to `main` or `master` will now automatically deploy the latest release!

---

## 🔒 Security Hardening Levels
- **Standard**: 100,000 PBKDF2 rounds + AES-256-GCM + 1-round Static Swap.
- **Maximum**: 300,000 PBKDF2 rounds + AES-256-GCM + 3-round Static Swap.

