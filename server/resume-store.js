/**
 * server/resume-store.js
 * ===========================================================================
 * PRIVATE RESUME STORAGE
 * ===========================================================================
 *
 * Resumes are personal documents, so they are NOT served from `dist/` or any
 * other public directory. They live in a directory outside the web root, under
 * a name this server generates, and are only ever read by:
 *
 *   GET /api/students/me/resume/file        (the owner)
 *   GET /api/admin/students/:id/resume/file (an administrator)
 *
 * Both routes check the session first; the file name never appears in an API
 * response, so a student cannot even guess another student's document.
 *
 * VALIDATION
 * ----------
 * The browser's `Content-Type` and the file extension are hints, not proof.
 * `sniffResume()` reads the actual bytes:
 *   - PDF  -> the file must start with `%PDF-`
 *   - DOCX -> it must be a ZIP whose entries include `[Content_Types].xml` and
 *             `word/document.xml`
 * A legacy `.doc` (OLE compound file) is rejected with an actionable message,
 * and an executable renamed to `.pdf` never gets written to disk.
 *
 * MOVING TO OBJECT STORAGE
 * ------------------------
 * Everything goes through four functions (save / read / delete / info). Swapping
 * the directory for S3 or any private bucket means re-implementing those four
 * in this one file; no route or model changes.
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { RESUME_MAX_BYTES, RESUME_STORAGE_DIR } from './config.js';
import { HttpError, cleanText } from './http.js';

export const RESUME_TYPES = {
  pdf: {
    mimeType: 'application/pdf',
    ext: 'pdf',
    label: 'PDF',
  },
  docx: {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
    label: 'DOCX',
  },
};

export const RESUME_ACCEPTED_MIME = Object.values(RESUME_TYPES).map((type) => type.mimeType);

/** Human readable size limit, for error messages. */
export function maxSizeLabel() {
  return `${Math.round(RESUME_MAX_BYTES / (1024 * 1024))} MB`;
}

/**
 * Identify a real resume by its bytes.
 * @returns {{kind: 'pdf'|'docx', mimeType: string, ext: string}}
 */
export function sniffResume(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new HttpError(400, 'The uploaded file is empty.');
  }
  if (buffer.length > RESUME_MAX_BYTES) {
    throw new HttpError(413, `Resume must be smaller than ${maxSizeLabel()}.`);
  }

  // PDF: "%PDF-" inside the first bytes (some writers add a UTF-8 BOM first).
  const head = buffer.subarray(0, 1024).toString('latin1');
  if (head.includes('%PDF-')) {
    return { kind: 'pdf', ...RESUME_TYPES.pdf };
  }

  // DOCX (and every other OOXML file) is a ZIP with a known content-types part.
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    const names = buffer.toString('latin1');
    if (names.includes('[Content_Types].xml')) {
      if (names.includes('word/document.xml')) {
        return { kind: 'docx', ...RESUME_TYPES.docx };
      }
      throw new HttpError(
        400,
        'That file is an Office document but not a Word document. Upload a .docx resume.',
      );
    }
    throw new HttpError(400, 'That ZIP archive is not a Word document. Upload a PDF or DOCX resume.');
  }

  // The old binary .doc format starts with the OLE magic bytes.
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
    throw new HttpError(
      400,
      'The older .doc format cannot be read safely. Save the resume as .docx or PDF and upload it again.',
    );
  }

  throw new HttpError(
    400,
    'That file is not a PDF or DOCX document. Only text-based PDF and word/document.xml DOCX resumes are accepted.',
  );
}

/** Only names this module created may ever reach the filesystem. */
function assertStoredName(storedName) {
  const value = String(storedName || '');
  if (!/^[a-f0-9]{24}\/[a-f0-9-]{36}\.(pdf|docx)$/.test(value)) {
    throw new HttpError(404, 'Resume file not found.');
  }
  return value;
}

/**
 * Write a validated resume to private storage.
 * @returns {{storedName: string, mimeType: string, kind: string, sizeBytes: number, displayName: string}}
 */
export async function saveResume({ studentId, buffer, fileName }) {
  const type = sniffResume(buffer);

  const displayName =
    cleanText(fileName, 200)
      .replace(/[\\/:*?"<>|]/g, '')
      .trim() || `resume.${type.ext}`;

  const storedName = `${studentId}/${randomUUID()}.${type.ext}`;
  const absolute = path.join(RESUME_STORAGE_DIR, ...storedName.split('/'));

  await mkdir(path.dirname(absolute), { recursive: true });
  // `wx` fails instead of overwriting if the random name somehow exists.
  await writeFile(absolute, buffer, { flag: 'wx', mode: 0o600 });

  return {
    storedName,
    mimeType: type.mimeType,
    kind: type.kind,
    sizeBytes: buffer.length,
    displayName,
  };
}

/** Read one stored resume. Throws 404 when the file is missing. */
export async function readResume(storedName) {
  const safe = assertStoredName(storedName);
  const absolute = path.join(RESUME_STORAGE_DIR, ...safe.split('/'));
  try {
    return await readFile(absolute);
  } catch {
    throw new HttpError(404, 'The stored resume file is no longer available. Upload it again.');
  }
}

/** Delete a stored resume. Missing files are not an error. */
export async function deleteResume(storedName) {
  if (!storedName) return;
  let safe;
  try {
    safe = assertStoredName(storedName);
  } catch {
    return;
  }
  const absolute = path.join(RESUME_STORAGE_DIR, ...safe.split('/'));
  await unlink(absolute).catch(() => {});
}

/** True when the private storage directory is configured (used by tests). */
export function resumeStorageInfo() {
  return { directory: RESUME_STORAGE_DIR, maxBytes: RESUME_MAX_BYTES };
}
