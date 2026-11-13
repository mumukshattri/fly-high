/**
 * server/admin-students-api.js
 * ===========================================================================
 * ADMINISTRATOR STUDENT MANAGEMENT
 * ===========================================================================
 *
 *   GET    /api/admin/students                 directory (search + filters + paging)
 *   GET    /api/admin/students/:id             one full profile + applications
 *   GET    /api/admin/students/:id/resume/file private resume download (admin)
 *   POST   /api/admin/students/import/preview  parse + validate, never writes
 *   POST   /api/admin/students/import/confirm  create the valid rows
 *   GET    /api/admin/students/export          CSV or JSON of the filtered set
 *   POST   /api/auth/activate                  invitee sets a password
 *
 * Every route is `requireAuth(['admin'])`. Recruiters have no access here at
 * all, and a student cannot reach another student's record: their own profile is
 * served by /api/students/me/*.
 *
 * IMPORTS NEVER OVERWRITE
 * -----------------------
 * A row whose email already exists is skipped and reported. Imported accounts
 * are created with a random, unknowable password, so nobody can log in until
 * they activate through the one-time link the administrator receives. There is
 * no shared default password anywhere in this file.
 */

import { createHash, randomBytes } from 'node:crypto';

import { Student, Application, Drive, Company } from './models/index.js';
import { requireAuth, createSession, setSessionCookie } from './auth.js';
import { hashPassword } from './password.js';
import {
  asyncHandler,
  badRequest,
  cleanList,
  cleanText,
  isEmail,
  isObjectId,
  notFound,
} from './http.js';
import { serializeApplication, serializeStudent } from './serialize.js';
import { broadcast } from './events.js';
import { getProfileCompletion } from '../src/utils/profileCompletion.js';
import { DEPARTMENTS, departmentToBranch } from '../src/config/constants.js';
import { IMPORT_FIELDS, parseCsv, stringifyCsv, suggestMapping } from './csv.js';
import { INVITE_TTL_MS } from './config.js';
import { readResume } from './resume-store.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* -------------------------------------------------------------------------- */
/* DIRECTORY                                                                  */
/* -------------------------------------------------------------------------- */

const SORT_FIELDS = {
  name: { name: 1 },
  email: { email: 1 },
  cgpa: { cgpa: -1 },
  graduationYear: { graduationYear: -1 },
  registeredOn: { registeredOn: -1, createdAt: -1 },
};

/** Build the Mongo filter from the query string (all values validated). */
function buildFilter(query = {}) {
  const filter = {};
  const and = [];

  const search = cleanText(query.search, 100);
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    and.push({
      $or: [
        { name: rx },
        { email: rx },
        { rollNumber: rx },
        { enrollmentNumber: rx },
        { department: rx },
        { branch: rx },
        { skills: rx },
      ],
    });
  }

  const department = cleanText(query.department, 120);
  if (department) {
    const branch = departmentToBranch(department);
    and.push({ $or: [{ department }, { branch }] });
  }

  const degree = cleanText(query.degree, 60);
  if (degree) filter.degree = degree;

  const graduationYear = Number(query.graduationYear);
  if (Number.isInteger(graduationYear) && graduationYear >= 2000 && graduationYear <= 2100) {
    filter.graduationYear = graduationYear;
  }

  const minCgpa = Number(query.minCgpa);
  const maxCgpa = Number(query.maxCgpa);
  if (Number.isFinite(minCgpa) || Number.isFinite(maxCgpa)) {
    filter.cgpa = {};
    if (Number.isFinite(minCgpa)) filter.cgpa.$gte = Math.max(0, minCgpa);
    if (Number.isFinite(maxCgpa)) filter.cgpa.$lte = Math.min(10, maxCgpa);
    if (Object.keys(filter.cgpa).length === 0) delete filter.cgpa;
  }

  const resume = cleanText(query.resume, 20);
  if (resume === 'uploaded') and.push({ 'resume.fileName': { $exists: true, $ne: '' } });
  if (resume === 'missing') {
    and.push({ $or: [{ resume: null }, { 'resume.fileName': { $exists: false } }, { 'resume.fileName': '' }] });
  }

  const onboarding = cleanText(query.onboarding, 20);
  if (onboarding === 'complete') filter['onboarding.completedAt'] = { $ne: null };
  if (onboarding === 'incomplete') filter['onboarding.completedAt'] = null;

  const dataSource = cleanText(query.dataSource, 20);
  if (['imported', 'self-declared'].includes(dataSource)) filter.dataSource = dataSource;

  if (and.length > 0) filter.$and = and;
  return filter;
}

function readPaging(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 20));
  return { page, pageSize };
}

async function applicationStats(studentIds) {
  if (studentIds.length === 0) return { counts: new Map(), placed: new Set() };

  const rows = await Application.aggregate([
    { $match: { student: { $in: studentIds } } },
    {
      $group: {
        _id: '$student',
        applications: { $sum: 1 },
        selected: { $sum: { $cond: [{ $eq: ['$status', 'Selected'] }, 1, 0] } },
      },
    },
  ]);

  const counts = new Map();
  const placed = new Set();
  for (const row of rows) {
    counts.set(String(row._id), row.applications);
    if (row.selected > 0) placed.add(String(row._id));
  }
  return { counts, placed };
}

function rowFromStudent(doc, stats) {
  const profile = serializeStudent(doc);
  return {
    ...profile,
    profileCompletion: getProfileCompletion(profile),
    applicationCount: stats.counts.get(profile.id) || 0,
    isPlaced: stats.placed.has(profile.id),
  };
}

/** GET /api/admin/students */
const listStudents = asyncHandler(async (req, res) => {
  const filter = buildFilter(req.query);
  const { page, pageSize } = readPaging(req.query);

  // A college directory is bounded; the cap protects the process if somebody
  // asks for everything at once.
  const docs = await Student.find(filter).sort(SORT_FIELDS[cleanText(req.query.sort, 20)] || SORT_FIELDS.name).limit(5000).lean();

  const stats = await applicationStats(docs.map((doc) => doc._id));
  let rows = docs.map((doc) => rowFromStudent(doc, stats));

  // Profile completion is derived, so it is filtered and sorted after the read.
  const minCompletion = Number(req.query.minCompletion);
  const maxCompletion = Number(req.query.maxCompletion);
  if (Number.isFinite(minCompletion)) rows = rows.filter((row) => row.profileCompletion.percent >= minCompletion);
  if (Number.isFinite(maxCompletion)) rows = rows.filter((row) => row.profileCompletion.percent <= maxCompletion);

  const completion = cleanText(req.query.completion, 20);
  if (completion === 'complete') rows = rows.filter((row) => row.profileCompletion.percent >= 100);
  if (completion === 'incomplete') rows = rows.filter((row) => row.profileCompletion.percent < 100);

  if (req.query.sort === 'completion') {
    rows.sort((a, b) => b.profileCompletion.percent - a.profileCompletion.percent);
  }

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const items = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    items,
    total,
    page: safePage,
    pageSize,
    pageCount,
    summary: {
      matched: total,
      completeProfiles: rows.filter((row) => row.profileCompletion.percent >= 100).length,
      withResume: rows.filter((row) => Boolean(row.resume)).length,
      placed: rows.filter((row) => row.isPlaced).length,
      imported: rows.filter((row) => row.dataSource === 'imported').length,
    },
  });
});

/** GET /api/admin/students/:id */
const getStudent = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Student not found.');

  const doc = await Student.findById(req.params.id).lean();
  if (!doc) throw notFound('Student not found.');

  const [stats, applications, drives] = await Promise.all([
    applicationStats([doc._id]),
    Application.find({ student: doc._id }).sort({ appliedOn: -1 }).lean(),
    Drive.find().select('_id role company').lean(),
  ]);

  const driveById = new Map(drives.map((drive) => [String(drive._id), drive]));
  const companyDocs = await Company.find({
    _id: { $in: drives.map((drive) => drive.company) },
  })
    .select('name')
    .lean();
  const companyById = new Map(companyDocs.map((company) => [String(company._id), company.name]));

  const profile = serializeStudent(doc);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    profile,
    completion: getProfileCompletion(profile),
    applicationCount: stats.counts.get(profile.id) || 0,
    isPlaced: stats.placed.has(profile.id),
    applications: applications.map((application) => {
      const drive = driveById.get(String(application.drive));
      return {
        ...serializeApplication(application),
        role: drive?.role || 'Unknown role',
        companyName: drive ? companyById.get(String(drive.company)) || 'Unknown company' : 'Unknown company',
      };
    }),
    invitation: {
      pending: Boolean(doc.invitationPending),
      expiresAt: doc.inviteExpiresAt || null,
    },
  });
});

/** GET /api/admin/students/:id/resume/file - administrators only. */
const downloadStudentResume = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Student not found.');

  const doc = await Student.findById(req.params.id).lean();
  if (!doc?.resume?.storedName) throw notFound('This student has not uploaded a resume.');

  const buffer = await readResume(doc.resume.storedName);
  const safeName = doc.resume.fileName.replace(/[\\/:*?"<>|]/g, '_');

  res.setHeader('Content-Type', doc.resume.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
});

/* -------------------------------------------------------------------------- */
/* CSV IMPORT                                                                 */
/* -------------------------------------------------------------------------- */

const MAX_IMPORT_ROWS = 2000;

/** Canonicalise a department cell onto the list the rest of the app uses. */
function normaliseDepartment(raw) {
  const value = cleanText(raw, 120);
  if (!value) return { department: '', branch: '' };

  const byLabel = DEPARTMENTS.find(
    (item) => item.label.toLowerCase() === value.toLowerCase() || item.branch.toLowerCase() === value.toLowerCase(),
  );
  if (byLabel) return { department: byLabel.label === 'Other' ? value : byLabel.label, branch: byLabel.branch };

  const branch = departmentToBranch(value);
  const label = DEPARTMENTS.find((item) => item.branch === branch && item.label !== 'Other')?.label || value;
  return { department: label, branch };
}

function normaliseCgpa(raw) {
  const value = String(raw || '').trim().replace('%', '');
  if (!value) return { value: null, error: null };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { value: null, error: 'CGPA is not a number.' };
  if (parsed < 0 || parsed > 10) {
    return {
      value: null,
      error: 'CGPA must be between 0 and 10 (convert a percentage before importing).',
    };
  }
  return { value: parsed, error: null };
}

function readMapping(body) {
  const mapping = body?.mapping && typeof body.mapping === 'object' ? body.mapping : null;
  if (!mapping) throw badRequest('A column mapping is required. Use /import/preview to detect one.');

  const cleaned = {};
  for (const field of Object.keys(IMPORT_FIELDS)) {
    const header = cleanText(mapping[field], 100);
    cleaned[field] = header;
  }
  return cleaned;
}

/**
 * Parse, normalise and validate an import without touching the database.
 * @returns {Promise<object>} preview payload
 */
async function validateImport({ csv, mapping }) {
  const parsed = parseCsv(csv);
  if (parsed.error) throw badRequest(parsed.error);
  if (parsed.rows.length === 0) throw badRequest('The CSV contains a header row but no student rows.');
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    throw badRequest(`Import at most ${MAX_IMPORT_ROWS} students at a time.`);
  }

  const columnIndex = {};
  for (const [field, header] of Object.entries(mapping)) {
    if (!header) continue;
    const index = parsed.headers.findIndex((item) => item.toLowerCase() === header.toLowerCase());
    if (index === -1) {
      throw badRequest(`The mapped column "${header}" is not in the CSV header row.`);
    }
    columnIndex[field] = index;
  }

  const missingRequired = Object.entries(IMPORT_FIELDS)
    .filter(([field, config]) => config.required && columnIndex[field] === undefined)
    .map(([field, config]) => ({ field, label: config.label }));

  const existingEmails = new Set(
    (await Student.find({ email: { $in: parsed.rows.map((row) => String(row[columnIndex.email] || '').trim().toLowerCase()) } })
      .select('email')
      .lean()).map((doc) => doc.email),
  );

  const seenInFile = new Map();
  const rows = [];
  let valid = 0;
  let duplicates = 0;
  let invalid = 0;

  parsed.rows.forEach((cells, index) => {
    const valueOf = (field) => (columnIndex[field] === undefined ? '' : cells[columnIndex[field]] ?? '');
    const rowNumber = index + 2; // header is line 1
    const errors = [];

    const name = cleanText(valueOf('name'), 120);
    const email = cleanText(valueOf('email'), 160).toLowerCase();
    const { department, branch } = normaliseDepartment(valueOf('department'));
    const degree = cleanText(valueOf('degree'), 60);
    const rollNumber = cleanText(valueOf('rollNumber'), 40);
    const phone = cleanText(valueOf('phone'), 40);
    const university = cleanText(valueOf('university'), 200);

    const graduationRaw = String(valueOf('graduationYear') || '').trim();
    const graduationYear = /^\d{4}$/.test(graduationRaw) ? Number(graduationRaw) : null;
    if (graduationRaw && !graduationYear) errors.push('Graduation year must be a four-digit year.');
    if (graduationYear && (graduationYear < 2000 || graduationYear > 2100)) {
      errors.push('Graduation year must be between 2000 and 2100.');
    }

    const cgpa = normaliseCgpa(valueOf('cgpa'));
    if (cgpa.error) errors.push(cgpa.error);

    const backlogsRaw = String(valueOf('backlogs') || '').trim();
    const backlogs = backlogsRaw === '' ? 0 : Number(backlogsRaw);
    if (backlogsRaw && (!Number.isInteger(backlogs) || backlogs < 0 || backlogs > 50)) {
      errors.push('Backlogs must be a whole number between 0 and 50.');
    }

    if (!name) errors.push('Name is required.');
    if (!email) errors.push('Email is required.');
    else if (!isEmail(email)) errors.push('Email address is not valid.');

    let duplicate = null;
    if (email) {
      if (existingEmails.has(email)) duplicate = { type: 'existing-account' };
      else if (seenInFile.has(email)) duplicate = { type: 'duplicate-in-file', firstRow: seenInFile.get(email) };
      else seenInFile.set(email, rowNumber);
    }

    if (duplicate) duplicates += 1;
    else if (errors.length > 0) invalid += 1;
    else valid += 1;

    rows.push({
      rowNumber,
      values: { name, email, department, degree, graduationYear, cgpa: cgpa.value, backlogs, rollNumber, phone, university },
      skills: cleanList(String(valueOf('skills') || '').split(/[,;/|]/), { maxLength: 50, limit: 40 }),
      branch,
      errors,
      duplicate,
      actionable: !duplicate && errors.length === 0,
    });
  });

  return {
    headers: parsed.headers,
    mapping,
    missingRequired,
    summary: {
      totalRows: rows.length,
      valid,
      invalid,
      duplicates,
      willCreate: valid,
    },
    rows: rows.slice(0, 300),
    truncated: rows.length > 300,
    canImport: missingRequired.length === 0 && valid > 0,
    rowsAll: rows,
  };
}

/**
 * POST /api/admin/students/import/preview
 *
 * Called twice by the UI: first without a mapping (to learn the CSV's columns
 * and receive a suggested mapping), then with the mapping the administrator
 * confirmed. The first call never touches the database.
 */
const previewImport = asyncHandler(async (req, res) => {
  const body = req.body || {};

  res.setHeader('Cache-Control', 'no-store');

  if (!body.mapping) {
    const parsed = parseCsv(body.csv);
    if (parsed.error) throw badRequest(parsed.error);

    res.json({
      needsMapping: true,
      headers: parsed.headers,
      detectedMapping: suggestMapping(parsed.headers),
      importFields: IMPORT_FIELDS,
      sampleRows: parsed.rows.slice(0, 5),
      totalRows: parsed.rows.length,
    });
    return;
  }

  const mapping = readMapping(body);
  const preview = await validateImport({ csv: body.csv, mapping });
  const { rowsAll, ...payload } = preview;

  res.json(payload);
});

/** POST /api/admin/students/import/confirm */
const confirmImport = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const mapping = readMapping(body);

  const preview = await validateImport({ csv: body.csv, mapping });
  if (preview.missingRequired.length > 0) {
    throw badRequest(
      `Map the required column(s) first: ${preview.missingRequired.map((item) => item.label).join(', ')}.`,
    );
  }

  const invitations = [];
  const errors = [];
  let imported = 0;
  let skipped = preview.summary.duplicates + preview.summary.invalid;

  for (const row of preview.rowsAll) {
    if (!row.actionable) {
      errors.push({
        rowNumber: row.rowNumber,
        email: row.values.email,
        reason: row.duplicate
          ? row.duplicate.type === 'existing-account'
            ? 'A student with this email already exists. Nothing was overwritten.'
            : `Duplicate of row ${row.duplicate.firstRow} in this file.`
          : row.errors.join(' '),
      });
      continue;
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    try {
      const student = await Student.create({
        name: row.values.name,
        email: row.values.email,
        // Random, never revealed: the account cannot be used until activation.
        passwordHash: await hashPassword(randomBytes(32).toString('hex')),
        phone: row.values.phone,
        rollNumber: row.values.rollNumber,
        university: row.values.university || 'Not specified',
        department: row.values.department,
        branch: row.branch || 'OTHER',
        degree: row.values.degree,
        graduationYear: row.values.graduationYear || 0,
        cgpa: row.values.cgpa ?? 0,
        backlogs: row.values.backlogs,
        skills: row.skills,
        dataSource: 'imported',
        declaredBy: 'placement-cell',
        verified: false,
        invitationPending: true,
        inviteTokenHash: sha256(token),
        inviteExpiresAt: expiresAt,
        inviteCreatedAt: new Date(),
        onboarding: { step: 0, completedAt: null, updatedAt: null },
        registeredOn: new Date().toISOString().slice(0, 10),
      });

      imported += 1;
      invitations.push({
        studentId: String(student._id),
        email: student.email,
        name: student.name,
        activationPath: `/activate?token=${token}`,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      skipped += 1;
      errors.push({
        rowNumber: row.rowNumber,
        email: row.values.email,
        reason:
          error?.code === 11000
            ? 'A student with this email already exists. Nothing was overwritten.'
            : 'The row could not be saved.',
      });
    }
  }

  if (imported > 0) broadcast('students', { action: 'imported' });

  res.status(imported > 0 ? 201 : 200).json({
    imported,
    skipped,
    errors,
    // Returned once, to the administrator who ran the import. Only the hash is
    // stored, so these links cannot be recovered later.
    invitations,
    note:
      'Activation links are shown once. Students set their own password through the link; no default password exists.',
  });
});

/* -------------------------------------------------------------------------- */
/* EXPORT                                                                     */
/* -------------------------------------------------------------------------- */

const EXPORT_COLUMNS = [
  ['id', 'Student ID'],
  ['name', 'Name'],
  ['email', 'Email'],
  ['rollNumber', 'Roll number'],
  ['phone', 'Phone'],
  ['university', 'University'],
  ['department', 'Department'],
  ['degree', 'Degree'],
  ['graduationYear', 'Graduation year'],
  ['cgpa', 'CGPA'],
  ['backlogs', 'Backlogs'],
  ['skills', 'Skills'],
  ['profileCompletion', 'Profile completion %'],
  ['resume', 'Resume file'],
  ['dataSource', 'Data source'],
  ['placementStatus', 'Placement status'],
  ['registeredOn', 'Registered on'],
];

/** GET /api/admin/students/export?format=csv|json */
const exportStudents = asyncHandler(async (req, res) => {
  const filter = buildFilter(req.query);
  const docs = await Student.find(filter).sort({ name: 1 }).limit(5000).lean();
  const stats = await applicationStats(docs.map((doc) => doc._id));

  const rows = docs.map((doc) => {
    const profile = rowFromStudent(doc, stats);
    const record = {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      rollNumber: profile.rollNumber,
      phone: profile.phone,
      university: profile.university,
      department: profile.department || profile.branch,
      degree: profile.degree,
      graduationYear: profile.graduationYear,
      cgpa: profile.cgpa,
      backlogs: profile.backlogs,
      skills: profile.skills.join('; '),
      profileCompletion: profile.profileCompletion.percent,
      resume: profile.resume?.fileName || '',
      dataSource: profile.dataSource,
      placementStatus: profile.isPlaced ? 'Placed' : profile.placementStatus,
      registeredOn: profile.registeredOn,
    };
    return record;
  });

  const format = cleanText(req.query.format, 10).toLowerCase() === 'json' ? 'json' : 'csv';
  const stamp = new Date().toISOString().slice(0, 10);

  res.setHeader('Cache-Control', 'no-store');

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="students-${stamp}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      filters: Object.fromEntries(
        Object.entries(req.query).filter(([key]) => !['format', 'page', 'pageSize'].includes(key)),
      ),
      count: rows.length,
      students: rows,
      note: 'Passwords, sessions and resume binaries are never included in an export.',
    });
    return;
  }

  const csv = stringifyCsv(
    EXPORT_COLUMNS.map(([, label]) => label),
    rows.map((row) => EXPORT_COLUMNS.map(([key]) => row[key])),
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="students-${stamp}.csv"`);
  res.send(`\uFEFF${csv}`);
});

/* -------------------------------------------------------------------------- */
/* ACCOUNT ACTIVATION                                                         */
/* -------------------------------------------------------------------------- */

/** POST /api/auth/activate - an invited student sets their own password. */
export const activateAccount = asyncHandler(async (req, res) => {
  const token = cleanText(req.body?.token, 300);
  const password = String(req.body?.password || '');

  if (!token) throw badRequest('An activation token is required.');
  if (password.length < 6) throw badRequest('Password must be at least 6 characters.');

  const student = await Student.findOne({
    inviteTokenHash: sha256(token),
    invitationPending: true,
  }).select('+passwordHash');

  if (!student) {
    throw badRequest('This activation link is not valid. Ask the placement cell for a new one.');
  }
  if (student.inviteExpiresAt && student.inviteExpiresAt.getTime() < Date.now()) {
    throw badRequest('This activation link has expired. Ask the placement cell to resend it.');
  }

  student.passwordHash = await hashPassword(password);
  student.invitationPending = false;
  student.inviteTokenHash = '';
  student.inviteExpiresAt = null;
  await student.save();

  const user = serializeStudent(student.toObject());
  const session = await createSession(user, req);
  setSessionCookie(res, session);

  res.json({ user, activated: true });
});

/* -------------------------------------------------------------------------- */
/* REGISTRATION                                                               */
/* -------------------------------------------------------------------------- */

export function registerAdminStudentRoutes(router) {
  const adminOnly = requireAuth(['admin']);

  router.get('/admin/students', adminOnly, listStudents);
  router.get('/admin/students/export', adminOnly, exportStudents);
  // The 2 MB JSON parser for these two paths lives in server/app.js.
  router.post('/admin/students/import/preview', adminOnly, previewImport);
  router.post('/admin/students/import/confirm', adminOnly, confirmImport);
  router.get('/admin/students/:id', adminOnly, getStudent);
  router.get('/admin/students/:id/resume/file', adminOnly, downloadStudentResume);

  router.post('/auth/activate', activateAccount);
}

export { listStudents, validateImport, buildFilter };
export default registerAdminStudentRoutes;
