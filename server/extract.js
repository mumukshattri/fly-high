/**
 * server/extract.js
 * ===========================================================================
 * RESUME TEXT EXTRACTION AND STRUCTURED PARSING
 * ===========================================================================
 *
 * Dependency-free, because a resume parser is not worth pulling in a native
 * addon (and the project keeps its dependency list deliberately small).
 *
 * TEXT EXTRACTION
 * ---------------
 *   PDF  - read the document's objects, decode each page's /Contents stream
 *          (honouring the /Filter chain: ASCII85, ASCIIHex, Flate, RunLength),
 *          then read the text-showing operators (Tj, TJ, ', "). Embedded
 *          files, images, metadata, signatures and object streams are skipped:
 *          they are not page text and parsing them produces binary noise.
 *   DOCX - read `word/document.xml` out of the ZIP (stored or deflated), turn
 *          `</w:p>` into a newline and strip the remaining tags.
 *
 * WHAT THIS CANNOT DO (and says so, instead of inventing data)
 * ------------------------------------------------------------
 *   - encrypted PDFs: reported, not cracked
 *   - scanned / image-only PDFs: no text layer exists without OCR, so the
 *     student is told to upload a text-readable version
 *   - PDFs that only draw text as vector outlines: nothing to read
 *   - column-perfect reading order: lines may not match the visual layout
 *
 * STRUCTURED PARSING
 * ------------------
 * Headings are matched case-insensitively and tolerate decoration, so
 * "EDUCATION", "Education:", "Academic Qualifications" and
 * "CERTIFICATIONS & ACHIEVEMENTS" all work. Each section is parsed on its own
 * (projects and internships are grouped into entries) instead of guessing from
 * the whole document. Nothing is invented: a field with no evidence stays empty.
 */

import zlib from 'node:zlib';

import { HttpError, cleanMultiline, cleanText } from './http.js';
import { extractSkillsFromText, uniqueSkills } from './skills.js';

/* -------------------------------------------------------------------------- */
/* ERRORS                                                                     */
/* -------------------------------------------------------------------------- */

export class UnreadableResumeError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'UnreadableResumeError';
    this.code = code;
  }
}

/* -------------------------------------------------------------------------- */
/* ZIP (DOCX)                                                                 */
/* -------------------------------------------------------------------------- */

function readZipEntries(buffer) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  const stop = Math.max(0, buffer.length - 66_000);

  for (let i = buffer.length - 22; i >= stop; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new UnreadableResumeError('The DOCX archive is malformed.', 'bad_zip');

  const count = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let offset = directoryOffset;

  for (let i = 0; i < count && offset + 46 <= buffer.length; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer, entry) {
  const offset = entry.localOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new UnreadableResumeError('The DOCX archive is malformed.', 'bad_zip');
  }

  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return data;
  if (entry.method === 8) {
    try {
      return zlib.inflateRawSync(data);
    } catch {
      throw new UnreadableResumeError('The DOCX content could not be decompressed.', 'bad_zip');
    }
  }
  throw new UnreadableResumeError('The DOCX uses an unsupported compression method.', 'bad_zip');
}

const decodeXmlEntities = (value) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');

function docxToText(buffer) {
  const entries = readZipEntries(buffer);
  const entry = entries.get('word/document.xml');
  if (!entry) throw new UnreadableResumeError('The file is not a Word document.', 'not_docx');

  const xml = readZipEntry(buffer, entry).toString('utf8');

  const text = xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<[^>]+>/g, '');

  return decodeXmlEntities(text);
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                        */
/* -------------------------------------------------------------------------- */

function readPdfLiteralString(source, start) {
  // source[start] === '('
  let depth = 0;
  let index = start;
  let value = '';

  while (index < source.length) {
    const char = source[index];

    if (char === '\\') {
      const next = source[index + 1];
      const simple = {
        n: '\n',
        r: '\r',
        t: '\t',
        b: '\b',
        f: '\f',
        '(': '(',
        ')': ')',
        '\\': '\\',
      }[next];
      if (simple !== undefined) {
        value += simple;
        index += 2;
        continue;
      }
      if (next >= '0' && next <= '7') {
        let octal = '';
        let cursor = index + 1;
        while (
          cursor < source.length &&
          octal.length < 3 &&
          source[cursor] >= '0' &&
          source[cursor] <= '7'
        ) {
          octal += source[cursor];
          cursor += 1;
        }
        value += String.fromCharCode(parseInt(octal, 8) & 0xff);
        index = cursor;
        continue;
      }
      if (next === '\n' || next === '\r') {
        index += next === '\r' && source[index + 2] === '\n' ? 3 : 2;
        continue;
      }
      value += next ?? '';
      index += 2;
      continue;
    }

    if (char === '(') {
      depth += 1;
      if (depth > 1) value += char;
      index += 1;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      if (depth === 0) return { value, next: index + 1 };
      value += char;
      index += 1;
      continue;
    }

    value += char;
    index += 1;
  }

  return { value, next: index };
}

function readPdfHexString(source, start) {
  const end = source.indexOf('>', start + 1);
  if (end === -1) return { value: '', next: start + 1 };
  const hex = source.slice(start + 1, end).replace(/[^0-9a-f]/gi, '');
  let value = '';
  // PDF hex strings are UTF-16BE when they start with FE FF, otherwise bytes.
  if (/^feff/i.test(hex)) {
    for (let i = 4; i + 3 < hex.length + 1; i += 4) {
      value += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    }
  } else {
    for (let i = 0; i + 1 < hex.length; i += 2) {
      value += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
  }
  return { value, next: end + 1 };
}

const nextOperator = (source, index) => {
  const match = /^\s*([A-Za-z*'"]+)/.exec(source.slice(index, index + 24));
  return match ? match[1] : '';
};

/** Pull visible text out of one decoded content stream. */
export function pdfContentToText(source) {
  let index = 0;
  let output = '';

  while (index < source.length) {
    const char = source[index];

    if (char === '(') {
      const literal = readPdfLiteralString(source, index);
      index = literal.next;
      const operator = nextOperator(source, index);
      if (operator === 'Tj' || operator === "'" || operator === '"') {
        output += literal.value;
        if (operator === "'" || operator === '"') output += '\n';
      } else if (
        source[index - 1] !== ')' ||
        operator === '' ||
        operator === 'Td' ||
        operator === 'TD'
      ) {
        // Text inside an array is handled by the '[' branch below; a literal
        // followed by a positioning operator is still visible text.
        if (!['TJ', 'Tf', 'Td', 'TD', 'T*'].includes(operator)) output += literal.value;
      }
      continue;
    }

    if (char === '<' && source[index + 1] !== '<') {
      const hexString = readPdfHexString(source, index);
      index = hexString.next;
      const operator = nextOperator(source, index);
      if (operator === 'Tj' || operator === "'" || operator === '"') output += hexString.value;
      continue;
    }

    if (char === '[') {
      // A TJ array: strings separated by kerning numbers.
      let cursor = index + 1;
      let depth = 1;
      let text = '';

      while (cursor < source.length && depth > 0) {
        const inner = source[cursor];
        if (inner === '(') {
          const literal = readPdfLiteralString(source, cursor);
          text += literal.value;
          cursor = literal.next;
          continue;
        }
        if (inner === '<' && source[cursor + 1] !== '<') {
          const hexString = readPdfHexString(source, cursor);
          text += hexString.value;
          cursor = hexString.next;
          continue;
        }
        if (inner === '[') depth += 1;
        if (inner === ']') depth -= 1;
        // A large negative kern is a word space in most InDesign exports.
        if (inner === '-' && /^-\d{3,}/.test(source.slice(cursor, cursor + 5))) {
          const number = /^-(\d+)/.exec(source.slice(cursor, cursor + 8));
          if (number && Number(number[1]) >= 100) text += ' ';
        }
        cursor += 1;
      }

      index = cursor;
      const operator = nextOperator(source, index);
      if (operator === 'TJ') output += text;
      continue;
    }

    if (
      (char === 'T' &&
        (source[index + 1] === 'd' || source[index + 1] === 'D' || source[index + 1] === '*')) ||
      (char === 'E' && source[index + 1] === 'T')
    ) {
      output += '\n';
      index += 2;
      continue;
    }

    index += 1;
  }

  return output;
}

function inflateStream(data) {
  for (const attempt of [
    () => zlib.inflateSync(data),
    () => zlib.inflateRawSync(data),
    () => zlib.unzipSync(data),
  ]) {
    try {
      return attempt();
    } catch {
      /* try the next strategy */
    }
  }
  return null;
}

/** ASCII85Decode - a whole filter of its own, common in ReportLab output. */
function decodeAscii85(source) {
  const clean = String(source).replace(/\s+/g, '');
  const out = [];
  let group = [];

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (char === '~') break;
    if (char === 'z') {
      out.push(0, 0, 0, 0);
      continue;
    }
    const code = char.charCodeAt(0) - 33;
    if (code < 0 || code > 84) continue;
    group.push(code);
    if (group.length === 5) {
      let value = 0;
      for (const digit of group) value = value * 85 + digit;
      out.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
      group = [];
    }
  }

  if (group.length) {
    const padding = 5 - group.length;
    while (group.length < 5) group.push(84);
    let value = 0;
    for (const digit of group) value = value * 85 + digit;
    const bytes = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    out.push(...bytes.slice(0, 4 - padding));
  }

  return Buffer.from(out);
}

function decodeAsciiHex(source) {
  const hex = String(source).replace(/[^0-9a-f]/gi, '');
  return Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
}

function decodeRunLength(data) {
  const out = [];
  for (let index = 0; index < data.length; ) {
    const length = data[index];
    if (length === 128) break;
    if (length < 128) {
      out.push(...data.subarray(index + 1, index + 2 + length));
      index += length + 2;
    } else {
      const byte = data[index + 1];
      for (let count = 0; count < 257 - length; count += 1) out.push(byte);
      index += 2;
    }
  }
  return Buffer.from(out);
}

/** `/Filter /FlateDecode` and `/Filter [ /ASCII85Decode /FlateDecode ]`. */
function streamFilters(dict) {
  const arrayMatch = /\/Filter\s*\[([^\]]*)\]/.exec(dict);
  if (arrayMatch) {
    return [...arrayMatch[1].matchAll(/\/([A-Za-z0-9]+)/g)].map((match) => match[1]);
  }
  const single = /\/Filter\s*\/([A-Za-z0-9]+)/.exec(dict);
  return single ? [single[1]] : [];
}

/** Apply a filter chain in order. Returns null for codecs we cannot read. */
function decodeStreamData(data, dict) {
  let out = data;

  for (const filter of streamFilters(dict)) {
    if (filter === 'ASCII85Decode') out = decodeAscii85(out.toString('latin1'));
    else if (filter === 'ASCIIHexDecode') out = decodeAsciiHex(out.toString('latin1'));
    else if (filter === 'FlateDecode') out = inflateStream(out);
    else if (filter === 'RunLengthDecode') out = decodeRunLength(out);
    else if (filter === 'Crypt') continue;
    else return null; // image codecs, LZW, JBIG2: not text

    if (!out || out.length === 0) return null;
  }

  return out;
}

/**
 * Index every `N G obj` in the file. Streams are sliced by /Length when the
 * declared length is followed by `endstream` (which is what the spec requires);
 * otherwise we fall back to the keyword. Object numbers that appear inside
 * binary stream data are skipped by moving the cursor past the stream.
 */
function readPdfObjects(buffer) {
  const text = buffer.toString('latin1');
  const objects = new Map();
  const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let match;

  while ((match = pattern.exec(text))) {
    const start = match.index + match[0].length;
    let chunkEnd = text.indexOf('endobj', start);
    if (chunkEnd === -1) chunkEnd = text.length;

    const streamAt = text.indexOf('stream', start);
    const hasStream = streamAt !== -1 && streamAt < chunkEnd;
    const dict = text.slice(start, hasStream ? streamAt : chunkEnd);
    let stream = null;

    if (hasStream) {
      let dataStart = streamAt + 'stream'.length;
      if (text[dataStart] === '\r') dataStart += 1;
      if (text[dataStart] === '\n') dataStart += 1;

      const lengthMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      let dataEnd = -1;
      if (lengthMatch) {
        const candidate = dataStart + Number(lengthMatch[1]);
        if (/^\s*endstream/.test(text.slice(candidate, candidate + 24))) dataEnd = candidate;
      }
      if (dataEnd === -1) dataEnd = text.indexOf('endstream', dataStart);
      if (dataEnd === -1) dataEnd = chunkEnd;

      stream = buffer.subarray(dataStart, dataEnd);
      pattern.lastIndex = Math.max(pattern.lastIndex, dataEnd);
    }

    objects.set(Number(match[1]), { dict, stream });
  }

  return objects;
}

/** References listed in each page's /Contents entry (single or array). */
function pageContentRefs(objects) {
  const refs = [];
  for (const { dict } of objects.values()) {
    if (!/\/Type\s*\/Page(?![s\w])/.test(dict)) continue;

    const arrayMatch = /\/Contents\s*\[([^\]]*)\]/.exec(dict);
    if (arrayMatch) {
      for (const entry of arrayMatch[1].matchAll(/(\d+)\s+\d+\s+R/g)) refs.push(Number(entry[1]));
      continue;
    }
    const single = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(dict);
    if (single) refs.push(Number(single[1]));
  }
  return refs;
}

/** A stream full of control bytes is data (a signature, a font), not text. */
function looksLikeBinaryText(data) {
  const sample = data.subarray(0, Math.min(data.length, 4096));
  if (!sample.length) return true;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32 || byte > 126) suspicious += 1;
  }
  return suspicious / sample.length > 0.1;
}

/** Streams that are never page content. */
const NON_TEXT_STREAM =
  /\/(Subtype\s*\/Image|Type\s*\/(EmbeddedFile|ObjStm|XRef|Metadata|Sig|Filespec)|Subtype\s*\/(application|image)|Linearized)/;

function pdfToText(buffer) {
  const latin = buffer.toString('latin1');

  if (/\/Encrypt\s*<<|\/Encrypt\s+\d+\s+\d+\s+R/.test(latin)) {
    throw new UnreadableResumeError(
      'This PDF is password protected, so its text cannot be read. Upload an unprotected copy.',
      'encrypted_pdf',
    );
  }

  const objects = readPdfObjects(buffer);
  const contentRefs = pageContentRefs(objects);

  const readStreams = (streams) => {
    const pieces = [];
    for (const object of streams) {
      if (!object?.stream || NON_TEXT_STREAM.test(object.dict)) continue;
      const decoded = decodeStreamData(object.stream, object.dict);
      if (!decoded || looksLikeBinaryText(decoded)) continue;
      const text = pdfContentToText(decoded.toString('latin1'));
      if (text.trim()) pieces.push(text);
    }
    return pieces;
  };

  // Prefer the real page content. Falling back to every stream keeps older or
  // unusual generators working, but only streams that decode to text survive.
  let pieces = readStreams(contentRefs.map((ref) => objects.get(ref)).filter(Boolean));
  if (!pieces.length) pieces = readStreams([...objects.values()]);

  return pieces.join('\n');
}

/* -------------------------------------------------------------------------- */
/* PUBLIC ENTRY POINT                                                         */
/* -------------------------------------------------------------------------- */

/**
 * PDF text is byte-oriented. ReportLab and Word write WinAnsiEncoding, whose
 * 0x80-0x9F range holds bullets, em dashes and smart quotes - not control
 * characters. Without this map a bullet becomes an invisible byte that hides
 * the fact that a line is a list item.
 */
const WIN_ANSI = {
  0x7f: ' ',
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

function decodeWinAnsi(value) {
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, (char) => {
    const mapped = WIN_ANSI[char.charCodeAt(0)];
    return mapped === undefined ? ' ' : mapped;
  });
}

function normaliseExtractedText(text) {
  return decodeWinAnsi(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\u0000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, lines) => line.length > 0 || lines[index - 1]?.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract readable text from a PDF or DOCX buffer.
 * @returns {{text: string, kind: 'pdf'|'docx', hasText: boolean, notes: string[]}}
 */
export function extractResumeText(buffer, kind) {
  let text = '';

  if (kind === 'docx') {
    text = docxToText(buffer);
  } else if (kind === 'pdf') {
    text = pdfToText(buffer);
  } else {
    throw new HttpError(400, 'Only PDF and DOCX resumes can be read.');
  }

  const cleaned = normaliseExtractedText(text);
  const notes = [];

  if (cleaned.length < 40) {
    notes.push(
      kind === 'pdf'
        ? 'No selectable text was found. This PDF is probably a scan or an image; upload a text-based PDF (exported from Word or Google Docs) so the details can be read.'
        : 'Almost no text was found in this DOCX. Check that the document is not an empty template.',
    );
  }

  return { text: cleaned, kind, hasText: cleaned.length >= 40, notes };
}

/* -------------------------------------------------------------------------- */
/* STRUCTURED PARSING                                                         */
/* -------------------------------------------------------------------------- */

const DEGREE_PATTERNS = [
  { pattern: /\bB\.?\s?Tech\b|\bBachelor of Technology\b/i, value: 'B.Tech' },
  { pattern: /\bB\.?\s?E\b\.?(?![a-z])|\bBachelor of Engineering\b/i, value: 'B.E.' },
  { pattern: /\bM\.?\s?Tech\b|\bMaster of Technology\b/i, value: 'M.Tech' },
  { pattern: /\bM\.?\s?E\b\.?(?![a-z])|\bMaster of Engineering\b/i, value: 'M.E.' },
  { pattern: /\bMCA\b|\bMaster of Computer Applications\b/i, value: 'MCA' },
  { pattern: /\bBCA\b|\bBachelor of Computer Applications\b/i, value: 'BCA' },
  { pattern: /\bB\.?\s?Sc\b|\bBachelor of Science\b/i, value: 'B.Sc' },
  { pattern: /\bM\.?\s?Sc\b|\bMaster of Science\b/i, value: 'M.Sc' },
  { pattern: /\bMBA\b|\bMaster of Business Administration\b/i, value: 'MBA' },
  { pattern: /\bB\.?\s?Com\b|\bBachelor of Commerce\b/i, value: 'B.Com' },
  { pattern: /\bPh\.?\s?D\b/i, value: 'Ph.D' },
];

const DEPARTMENT_PATTERNS = [
  {
    pattern: /computer science(?: and engineering)?|\bCSE\b|\bCS\b/i,
    value: 'Computer Science and Engineering',
  },
  { pattern: /information technology|\bIT\b/i, value: 'Information Technology' },
  {
    pattern: /artificial intelligence|machine learning|\bAI\b|\bAIML\b/i,
    value: 'Artificial Intelligence and Machine Learning',
  },
  { pattern: /data science/i, value: 'Data Science' },
  {
    pattern: /electronics(?: and communication)?|\bECE\b|\bENTC\b|\bE&TC\b/i,
    value: 'Electronics and Communication Engineering',
  },
  { pattern: /electrical(?: engineering)?|\bEEE\b|\bEE\b/i, value: 'Electrical Engineering' },
  { pattern: /mechanical(?: engineering)?|\bMECH\b/i, value: 'Mechanical Engineering' },
  { pattern: /civil(?: engineering)?/i, value: 'Civil Engineering' },
  { pattern: /chemical(?: engineering)?/i, value: 'Chemical Engineering' },
  { pattern: /instrumentation/i, value: 'Instrumentation Engineering' },
];

/**
 * Section headings. Matching is case-insensitive, ignores decoration and a
 * trailing colon, and accepts the variants real resumes use. A compound heading
 * ("Certifications & Achievements") maps to the first key and its lines are
 * also scanned for the second kind of entry.
 */
const SECTION_ALIASES = {
  summary: [
    'professional summary',
    'summary',
    'profile',
    'professional profile',
    'career objective',
    'objective',
    'about me',
    'about',
  ],
  education: [
    'education',
    'academic qualifications',
    'academic qualification',
    'academic background',
    'educational qualifications',
    'academics',
    'qualifications',
    'education details',
  ],
  skills: [
    'technical skills',
    'skills',
    'technical expertise',
    'core competencies',
    'key skills',
    'technologies',
    'technical proficiencies',
    'programming languages',
  ],
  projects: [
    'projects',
    'academic projects',
    'personal projects',
    'key projects',
    'selected projects',
    'project experience',
  ],
  experience: [
    'internship experience',
    'work experience',
    'professional experience',
    'experience',
    'internships',
    'internship',
    'employment history',
    'training',
  ],
  certifications: [
    'certifications',
    'certification',
    'courses',
    'certificates',
    'licenses & certifications',
    'certifications & achievements',
    'certifications and achievements',
    'courses & certifications',
    'training & certifications',
  ],
  achievements: [
    'achievements',
    'awards',
    'awards & achievements',
    'accomplishments',
    'honors',
    'honours',
  ],
  additional: [
    'additional information',
    'other information',
    'preferences',
    'personal details',
    'declaration',
  ],
};

const HEADING_TRIM = /^[\s•·▪◦*\-–—]+|[\s:•·▪◦*\-–—]+$/g;

function headingKey(line) {
  const raw = String(line || '').trim();
  if (!raw || raw.length > 60) return null;
  const normalized = raw.replace(HEADING_TRIM, '').replace(/\s+/g, ' ').toLowerCase();
  if (!normalized) return null;
  // A heading is a label, not a sentence.
  if (/[.;]/.test(normalized)) return null;

  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.includes(normalized)) return key;
  }
  return null;
}

function splitSections(lines) {
  const sections = {};
  const preamble = [];
  let current = null;

  for (const line of lines) {
    const key = headingKey(line);
    if (key) {
      current = key;
      if (!sections[current]) sections[current] = [];
      continue;
    }
    if (current) sections[current].push(line);
    else preamble.push(line);
  }

  return { sections, preamble };
}

/** A phone number is 10-15 digits with optional +country and separators. */
function findPhone(text) {
  for (const match of String(text).matchAll(/(\+?\d[\d\s().-]{7,18}\d)/g)) {
    const digits = match[1].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) return match[1].trim().replace(/\s+/g, ' ');
  }
  return '';
}

function findEmail(text) {
  const match = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(String(text));
  return match ? match[1] : '';
}

function findName(preamble) {
  for (const line of preamble.slice(0, 8)) {
    const value = line.trim();
    if (!value || value.length > 60) continue;
    if (/@|\/|resume|curriculum|vitae|page\s*\d/i.test(value)) continue;
    if (/\d/.test(value)) continue;
    if (!/^[A-Za-z][A-Za-z.'’\-]*(?:\s+[A-Za-z][A-Za-z.'’\-]*){1,3}$/.test(value)) continue;
    return cleanText(value, 120);
  }
  return '';
}

function parseEducation(sections, text) {
  const section = (sections.education || []).join('\n');
  const scope = section || text.slice(0, 1500);

  const degree =
    DEGREE_PATTERNS.find((entry) => entry.pattern.test(section))?.value ||
    DEGREE_PATTERNS.find((entry) => entry.pattern.test(text))?.value ||
    '';

  const department =
    DEPARTMENT_PATTERNS.find((entry) => entry.pattern.test(section))?.value ||
    DEPARTMENT_PATTERNS.find((entry) => entry.pattern.test(text))?.value ||
    '';

  const institutionLine = (sections.education || []).find(
    (line) => /university|college|institute|school|academy/i.test(line) && !/degree|bachelor|master/i.test(line),
  );
  const university = institutionLine
    ? cleanText(institutionLine.split('|')[0].trim(), 160)
    : '';

  let cgpa = null;
  const cgpaPatterns = [
    /(?:cgpa|gpa|pointer)\s*[:\-–]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:\/\s*10|out of 10)?/i,
    /(\d{1,2}(?:\.\d{1,2})?)\s*(?:\/\s*10|out of 10)/i,
  ];
  for (const pattern of cgpaPatterns) {
    const match = pattern.exec(scope);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0 && value <= 10) {
        cgpa = value;
        break;
      }
    }
  }

  const percentageMatch = /(\d{2,3}(?:\.\d{1,2})?)\s*%/.exec(scope);
  const percentage = percentageMatch ? Number(percentageMatch[1]) : null;

  const explicitYear =
    /(?:expected\s+graduation|graduation(?:\s+year)?|graduating(?:\s+in)?|batch(?:\s+of)?|passing(?:\s+out)?(?:\s+in)?|class\s+of)\D{0,24}(20\d{2})/i.exec(
      scope,
    );
  let graduationYear = explicitYear ? Number(explicitYear[1]) : null;
  if (!graduationYear) {
    const years = [...scope.matchAll(/\b(20\d{2})\b/g)]
      .map((match) => Number(match[1]))
      .filter((year) => year >= 2015 && year <= 2100);
    if (years.length) graduationYear = Math.max(...years);
  }

  const semesterMatch = /(?:current\s+)?semester\s*[:\-–]?\s*(\d{1,2})/i.exec(scope);
  const semester = semesterMatch ? Number(semesterMatch[1]) : null;

  const backlogsMatch = /(?:active\s+)?backlogs?\s*[:\-–]?\s*(\d{1,2})/i.exec(scope);
  const backlogs = backlogsMatch ? Number(backlogsMatch[1]) : null;

  return {
    degree,
    department,
    university,
    cgpa,
    percentage,
    graduationYear,
    semester,
    currentYear: semester && semester >= 1 && semester <= 10 ? Math.ceil(semester / 2) : null,
    backlogs,
  };
}

const DATE_TOKEN =
  /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*,?\s*20\d{2}|20\d{2}\s*[-–]\s*(?:20\d{2}|present)|Present|Current)/gi;

function parseDateRange(text) {
  const matches = [...String(text).matchAll(DATE_TOKEN)].map((match) => match[1].trim());
  if (matches.length >= 2) return { startDate: matches[0], endDate: matches[1] };
  if (matches.length === 1) return { startDate: matches[0], endDate: '' };
  return { startDate: '', endDate: '' };
}

const isBulletLine = (line) => /^[\s•·▪◦*\-–—]/.test(line);

/** Drop a leading bullet or dash so list items can be classified. */
const stripDecoration = (line) =>
  String(line || '')
    .replace(/^[\s•·▪◦*\-–—]+/, '')
    .trim();

/** Projects: a title line (often "Title | stack") followed by bullet lines. */
function parseProjectEntries(lines) {
  const entries = [];
  let current = null;

  for (const line of lines) {
    const value = line.trim();
    if (!value) continue;

    const isHeader = value.includes('|') && !isBulletLine(value);
    if (isHeader) {
      const [titlePart, ...rest] = value.split('|');
      const stack = rest.join(' ');
      current = {
        title: cleanText(titlePart, 160),
        description: '',
        techStack: uniqueSkills(extractSkillsFromText(stack, { limit: 12 })),
        link: '',
      };
      entries.push(current);
      continue;
    }

    if (!current) {
      const looksLikeTitle = value.length <= 120 && !/[.!?]$/.test(value);
      if (!looksLikeTitle) continue;
      current = {
        title: cleanText(value, 160),
        description: '',
        techStack: uniqueSkills(extractSkillsFromText(value, { limit: 10 })),
        link: '',
      };
      entries.push(current);
      continue;
    }

    current.description = cleanMultiline(`${current.description} ${value}`.trim(), 600);
    current.techStack = uniqueSkills([
      ...current.techStack,
      ...extractSkillsFromText(value, { limit: 10 }),
    ]);
  }

  return entries.filter((project) => project.title.length > 2).slice(0, 8);
}

/** Internships: "Role | Company | Dates" followed by bullet lines. */
function parseExperienceEntries(lines) {
  const entries = [];
  let current = null;

  for (const line of lines) {
    const value = line.trim();
    if (!value) continue;

    const isHeader = value.includes('|') && !isBulletLine(value);
    if (isHeader) {
      const parts = value.split('|').map((part) => part.trim()).filter(Boolean);
      const dates = parseDateRange(parts.slice(1).join(' '));
      current = {
        type: /intern/i.test(value) ? 'Internship' : 'Work',
        role: cleanText(parts[0] || value, 160),
        company: cleanText(parts[1] || '', 160),
        startDate: dates.startDate,
        endDate: dates.endDate,
        description: '',
        technologies: uniqueSkills(extractSkillsFromText(value, { limit: 10 })),
      };
      entries.push(current);
      continue;
    }

    if (!current) {
      if (value.length < 4) continue;
      const dates = parseDateRange(value);
      current = {
        type: /intern/i.test(value) ? 'Internship' : 'Work',
        role: cleanText(value, 160),
        company: '',
        startDate: dates.startDate,
        endDate: dates.endDate,
        description: '',
        technologies: uniqueSkills(extractSkillsFromText(value, { limit: 8 })),
      };
      entries.push(current);
      continue;
    }

    current.description = cleanMultiline(`${current.description} ${value}`.trim(), 600);
  }

  return entries.filter((entry) => entry.role.length > 1).slice(0, 8);
}

const ACHIEVEMENT_START =
  /^(participated|won|winner|secured|awarded|award|selected|finalist|runner|presented|published|volunteered|organized|ranked|topper)/i;

function splitCertification(value) {
  let rest = value.trim();
  let year = '';

  const yearMatch = /(?:,\s*|\s*[–—-]\s*)((?:19|20)\d{2})\s*$/.exec(rest);
  if (yearMatch) {
    year = yearMatch[1];
    rest = rest.slice(0, yearMatch.index).trim();
  }

  const parts = rest
    .split(/\s{2,}|\s+[–—-]\s+|\s*·\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    name: cleanText(parts[0] || rest, 200),
    issuer: cleanText(parts[1] || '', 160),
    year,
    link: '',
  };
}

function parseCertifications(lines) {
  const result = [];

  for (const line of lines) {
    const value = stripDecoration(line);
    if (!value || value.length < 4) continue;
    if (headingKey(value)) continue;
    if (ACHIEVEMENT_START.test(value)) continue;

    const certification = splitCertification(value);
    if (certification.name.length > 2) result.push(certification);
  }

  return result.slice(0, 10);
}

function parseAchievements(sections) {
  const lines = [...(sections.achievements || []), ...(sections.certifications || [])]
    .map(stripDecoration)
    .filter((line) => ACHIEVEMENT_START.test(line));

  const values = lines
    .map((line) => cleanText(line, 240))
    .filter((line) => line.length > 4);

  return [...new Set(values)].slice(0, 8);
}

function parseSkills(sections, text) {
  const scoped = [...(sections.skills || []), ...(sections.summary || [])].join('\n');
  const fromSections = extractSkillsFromText(scoped, { limit: 40 });
  if (fromSections.length) return uniqueSkills(fromSections);
  return uniqueSkills(extractSkillsFromText(text, { limit: 30 }));
}

/**
 * Turn resume text into a *proposed* structured profile.
 *
 * @param {string} text
 * @param {{now?: Date}} [options]
 */
export function parseResumeText(text, { now = new Date() } = {}) {
  const content = String(text || '');
  const notes = [];

  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const { sections, preamble } = splitSections(lines);

  const name = findName(preamble);
  const email = findEmail(content);
  const phone = findPhone(content);
  const summary = cleanMultiline((sections.summary || []).join(' '), 600);
  const skills = parseSkills(sections, content);
  const education = parseEducation(sections, content);
  const projects = parseProjectEntries(sections.projects || []);
  const experience = parseExperienceEntries(sections.experience || []);
  const certifications = parseCertifications(sections.certifications || []);
  const achievements = parseAchievements(sections);

  if (!skills.length) {
    notes.push('No technologies were recognised in the text, so nothing was added to skills.');
  }
  if (!education.degree) notes.push('No degree was recognised. Fill it in yourself if it is missing.');
  if (!education.graduationYear) notes.push('No graduation year was recognised.');
  if (!education.cgpa && !education.percentage) notes.push('No CGPA or percentage was recognised.');
  if (!projects.length && !experience.length) {
    notes.push('No projects or internships were recognised in the text.');
  }

  return {
    name,
    email,
    phone,
    university: education.university,
    summary,
    skills,
    education: {
      degree: education.degree,
      department: education.department,
      university: education.university,
      cgpa: education.cgpa,
      percentage: education.percentage,
      graduationYear: education.graduationYear,
      semester: education.semester,
      currentYear: education.currentYear,
      backlogs: education.backlogs,
    },
    experience,
    projects,
    certifications,
    achievements,
    notes,
    textPreview: cleanMultiline(content.slice(0, 900), 900),
    wordCount: content.split(/\s+/).filter(Boolean).length,
  };
}

/** Extract + parse in one call; used by the upload route. */
export function readResume(buffer, kind, { fileName = '' } = {}) {
  const extracted = extractResumeText(buffer, kind);
  const parsed = parseResumeText(extracted.text);
  return {
    ...extracted,
    parsed,
    fileName,
  };
}
