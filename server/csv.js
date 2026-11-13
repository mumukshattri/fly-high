/**
 * server/csv.js
 * ===========================================================================
 * CSV PARSING AND WRITING (RFC 4180)
 * ===========================================================================
 *
 * The admin student import accepts files exported from Excel, Google Sheets and
 * every university system under the sun, so this parser handles the parts that
 * actually show up in the wild:
 *
 *   - a UTF-8 BOM (Excel writes one, which would otherwise corrupt the first
 *     header name)
 *   - CRLF and CR line endings
 *   - quoted fields containing commas, newlines and doubled quotes ("")
 *   - trailing empty lines
 *
 * It intentionally does NOT try to guess delimiters: a comma is the format.
 * Export writes the same dialect back, and prefixes values that Excel would
 * otherwise interpret as formulas with a single quote.
 */

const BOM = '\uFEFF';

/** Neutralise spreadsheet formula injection ('=cmd', '+1', '-2', '@x'). */
export function csvSafe(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}

/**
 * @param {string} input
 * @returns {{headers: string[], rows: string[][], error: string|null}}
 */
export function parseCsv(input) {
  let text = String(input || '');
  if (text.startsWith(BOM)) text = text.slice(1);
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (!text.trim()) return { headers: [], rows: [], error: 'The CSV file is empty.' };

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    return { headers: [], rows: [], error: 'The CSV has an unterminated quoted field.' };
  }

  // Last line without a trailing newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [], error: 'The CSV file is empty.' };

  const headers = nonEmpty[0].map((header) => String(header).trim());
  if (headers.length > 60) {
    return { headers: [], rows: [], error: 'The CSV has too many columns (maximum 60).' };
  }

  return {
    headers,
    rows: nonEmpty.slice(1).map((cells) => {
      const padded = [...cells];
      while (padded.length < headers.length) padded.push('');
      return padded.slice(0, headers.length).map((cell) => String(cell).trim());
    }),
    error: null,
  };
}

/** Write rows as CSV text (header row included). */
export function stringifyCsv(headers, rows) {
  const escape = (value) => {
    const text = csvSafe(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\r\n');
}

/**
 * Header alias table for automatic column mapping. Keys are canonical fields,
 * values are the spellings a real spreadsheet is likely to use.
 */
export const IMPORT_FIELDS = {
  name: { label: 'Name', required: true, aliases: ['name', 'full name', 'student name', 'candidate name'] },
  email: { label: 'Email', required: true, aliases: ['email', 'email address', 'college email', 'e-mail'] },
  department: {
    label: 'Department',
    required: false,
    aliases: ['department', 'branch', 'dept', 'discipline', 'course'],
  },
  degree: { label: 'Degree', required: false, aliases: ['degree', 'program', 'programme', 'course'] },
  graduationYear: {
    label: 'Graduation year',
    required: false,
    aliases: ['graduation year', 'graduation', 'passing year', 'batch', 'year of passing', 'grad year'],
  },
  cgpa: { label: 'CGPA', required: false, aliases: ['cgpa', 'gpa', 'current cgpa', 'percentage'] },
  backlogs: { label: 'Backlogs', required: false, aliases: ['backlogs', 'active backlogs', 'arrears'] },
  rollNumber: {
    label: 'Roll number',
    required: false,
    aliases: ['roll number', 'roll no', 'rollno', 'enrollment number', 'enrolment number', 'registration number', 'prn'],
  },
  phone: { label: 'Phone', required: false, aliases: ['phone', 'mobile', 'phone number', 'contact'] },
  university: {
    label: 'University',
    required: false,
    aliases: ['university', 'institute', 'college', 'institution'],
  },
  skills: { label: 'Skills', required: false, aliases: ['skills', 'technical skills', 'key skills'] },
};

/** Best-effort mapping from a CSV header row to canonical fields. */
export function suggestMapping(headers = []) {
  const mapping = {};
  for (const [field, config] of Object.entries(IMPORT_FIELDS)) {
    const match = headers.find((header) => {
      const normalised = header.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
      return config.aliases.includes(normalised);
    });
    mapping[field] = match || '';
  }
  return mapping;
}
