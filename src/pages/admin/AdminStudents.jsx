import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import Avatar from '../../components/Avatar';
import Progress from '../../components/Progress';
import StatusBadge from '../../components/StatusBadge';
import SearchBar from '../../components/SearchBar';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import Modal from '../../components/Modal';
import Icon from '../../components/Icon';
import { useToast } from '../../context/ToastContext';
import { formatDate } from '../../utils/format';
import { DEPARTMENTS, DEGREES } from '../../config/constants';
import {
  getStudentDirectory,
  getStudentDetail,
  previewImport,
  confirmImport,
  studentExportUrl,
  studentResumeUrl,
} from '../../services/adminService';

/**
 * pages/admin/AdminStudents.jsx
 * ===========================================================================
 * THE PLACEMENT CELL'S STUDENT MANAGEMENT
 * ===========================================================================
 * Three connected tools on one page:
 *
 *   1. DIRECTORY - search + filters (department, degree, graduation year, CGPA
 *      range, completion, resume state) with server-side pagination
 *   2. CSV IMPORT - column detection, mapping, validation preview, duplicate
 *      detection and a one-time activation link per imported student
 *   3. EXPORT    - the current filtered set as CSV or JSON
 *
 * The filtering, validation and export happening on the SERVER is what makes
 * them trustworthy: the browser cannot widen a filter into "all students" or
 * skip a duplicate check.
 */

const PAGE_SIZE = 15;

const EMPTY_FILTERS = {
  search: '',
  department: '',
  degree: '',
  graduationYear: '',
  minCgpa: '',
  maxCgpa: '',
  completion: '',
  resume: '',
};

const FALLBACK_FIELDS = {
  name: { label: 'Name', required: true },
  email: { label: 'Email', required: true },
  department: { label: 'Department', required: false },
  degree: { label: 'Degree', required: false },
  graduationYear: { label: 'Graduation year', required: false },
  cgpa: { label: 'CGPA', required: false },
  backlogs: { label: 'Backlogs', required: false },
  rollNumber: { label: 'Roll number', required: false },
  phone: { label: 'Phone', required: false },
  university: { label: 'University', required: false },
  skills: { label: 'Skills', required: false },
};

/* -------------------------------------------------------------------------- */
/* IMPORT                                                                     */
/* -------------------------------------------------------------------------- */

function ImportPanel({ onClose, onImported }) {
  const { showToast } = useToast();
  const [csv, setCsv] = useState('');
  const [meta, setMeta] = useState(null);
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const fields = meta?.importFields || FALLBACK_FIELDS;

  const detect = async (text) => {
    const value = text ?? csv;
    if (!value.trim()) {
      setError('Choose a CSV file or paste its contents first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await previewImport(value);
      setMeta(response);
      setMapping(response.detectedMapping || {});
      setPreview(null);
      setResult(null);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    await detect(text);
    if (fileRef.current) fileRef.current.value = '';
  };

  const runPreview = async () => {
    setBusy(true);
    setError('');
    try {
      setPreview(await previewImport(csv, mapping));
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await confirmImport(csv, mapping);
      setResult(response);
      showToast(`${response.imported} student(s) imported.`, 'success');
      onImported();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title="Import students from CSV"
      subtitle="Nothing is written until you confirm. Existing accounts are never overwritten."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {result ? null : meta ? (
            <Button variant="outline" icon="refresh" loading={busy} onClick={runPreview}>
              Validate rows
            </Button>
          ) : null}
          {preview?.canImport ? (
            <Button variant="primary" icon="upload" loading={busy} onClick={runImport}>
              Import {preview.summary.willCreate} student(s)
            </Button>
          ) : null}
        </>
      }
    >
      <div className="col gap-16">
        <div className="inline-note">
          <Icon name="info" size={16} />
          <div>
            Expected columns: <strong>Name, Email</strong> (required) and Department, Degree,
            Graduation year, CGPA, Backlogs, Roll number, Phone, University, Skills. Imports are
            marked <strong>imported</strong> - they are not university-verified, and no shared
            password is ever created.
          </div>
        </div>

        {error ? (
          <div className="inline-note inline-note--warning" role="alert">
            <Icon name="alert-triangle" size={16} />
            <div>{error}</div>
          </div>
        ) : null}

        {!meta ? (
          <>
            <div className="row gap-12 wrap">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={onFile}
                style={{ display: 'none' }}
              />
              <Button variant="primary" icon="upload" loading={busy} onClick={() => fileRef.current?.click()}>
                Choose CSV file
              </Button>
              <span className="text-sm muted">or paste the rows below</span>
            </div>

            <div className="field">
              <label className="label" htmlFor="import-csv">CSV contents</label>
              <textarea
                id="import-csv"
                className="textarea"
                rows={10}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                value={csv}
                placeholder={'Name,Email,Department,Degree,Graduation Year,CGPA,Backlogs,Roll Number\nAarav Sharma,aarav@college.edu,Computer Science and Engineering,B.Tech,2027,8.4,0,2023CSE0142'}
                onChange={(event) => setCsv(event.target.value)}
              />
            </div>

            <Button variant="outline" icon="search" loading={busy} onClick={() => detect()}>
              Detect columns
            </Button>
          </>
        ) : (
          <>
            {/* ----------------------------- mapping ---------------------------- */}
            {!result ? (
              <div>
                <div className="row-between wrap gap-8">
                  <strong>Map the columns</strong>
                  <span className="text-xs muted">
                    {meta.totalRows} data row(s) detected · {meta.headers.length} columns
                  </span>
                </div>

                <div className="form-grid mt-12">
                  {Object.entries(fields).map(([field, config]) => (
                    <div className="field" key={field}>
                      <label className="label">
                        {config.label} {config.required ? <span className="muted">*</span> : null}
                      </label>
                      <select
                        className="select"
                        value={mapping[field] || ''}
                        onChange={(event) =>
                          setMapping((current) => ({ ...current, [field]: event.target.value }))
                        }
                      >
                        <option value="">Not imported</option>
                        {meta.headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <p className="text-xs soft mt-8">
                  Required columns: {Object.entries(fields).filter(([, c]) => c.required).map(([f, c]) => c.label).join(', ') || 'Name, Email'}.
                </p>
              </div>
            ) : null}

            {/* ----------------------------- preview ---------------------------- */}
            {preview && !result ? (
              <div>
                <div className="row gap-8 wrap">
                  <span className="badge badge--info">{preview.summary.totalRows} rows</span>
                  <span className="badge badge--success">{preview.summary.valid} valid</span>
                  <span className="badge badge--warning">{preview.summary.duplicates} duplicates</span>
                  <span className="badge badge--danger">{preview.summary.invalid} invalid</span>
                </div>

                {preview.missingRequired?.length ? (
                  <div className="inline-note inline-note--warning mt-12">
                    <Icon name="alert-triangle" size={16} />
                    <div>
                      Map these required columns first:{' '}
                      {preview.missingRequired.map((item) => item.label).join(', ')}.
                    </div>
                  </div>
                ) : null}

                <div className="table-wrap mt-12">
                  <table className="data-table" style={{ minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Department</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => (
                        <tr key={row.rowNumber}>
                          <td>{row.rowNumber}</td>
                          <td>{row.values.name || '—'}</td>
                          <td>{row.values.email || '—'}</td>
                          <td>{row.values.department || '—'}</td>
                          <td>
                            {row.duplicate ? (
                              <span className="badge badge--warning">
                                {row.duplicate.type === 'existing-account'
                                  ? 'Already registered'
                                  : `Duplicate of row ${row.duplicate.firstRow}`}
                              </span>
                            ) : row.errors.length ? (
                              <span className="text-xs" style={{ color: '#b91c1c' }}>
                                {row.errors.join(' ')}
                              </span>
                            ) : (
                              <span className="badge badge--success">Will be created</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.truncated ? (
                  <p className="text-xs soft mt-8">Showing the first 300 rows; the import uses all of them.</p>
                ) : null}
              </div>
            ) : null}

            {/* ------------------------------ result ---------------------------- */}
            {result ? (
              <div>
                <div className="row gap-8 wrap">
                  <span className="badge badge--success">{result.imported} imported</span>
                  <span className="badge badge--warning">{result.skipped} skipped</span>
                </div>

                {result.errors.length ? (
                  <div className="table-wrap mt-12">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Email</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.errors.map((row) => (
                          <tr key={`${row.rowNumber}-${row.email}`}>
                            <td>{row.rowNumber}</td>
                            <td>{row.email || '—'}</td>
                            <td>{row.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {result.invitations.length ? (
                  <div className="mt-16">
                    <div className="row gap-8">
                      <Icon name="lock" size={15} />
                      <strong>Activation links (shown once)</strong>
                    </div>
                    <p className="text-xs soft mt-8">
                      Share each link with the student. They set their own password; there is no
                      default password anywhere.
                    </p>
                    <div className="col gap-8 mt-8">
                      {result.invitations.map((invitation) => (
                        <div className="summary-list__item" key={invitation.studentId}>
                          <div style={{ minWidth: 0 }}>
                            <div className="strong text-sm">{invitation.name}</div>
                            <div className="text-xs muted">{invitation.email}</div>
                            <code className="text-xs" style={{ wordBreak: 'break-all' }}>
                              {invitation.activationPath}
                            </code>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            icon="check"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(invitation.activationPath);
                                showToast('Activation link copied.', 'success');
                              } catch {
                                showToast('Copy failed - select the link manually.', 'warning');
                              }
                            }}
                          >
                            Copy
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* EXPORT                                                                     */
/* -------------------------------------------------------------------------- */

function ExportPanel({ filters, onClose }) {
  const [format, setFormat] = useState('csv');
  const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
  const url = studentExportUrl(query, format);

  return (
    <Modal
      title="Export student directory"
      subtitle="The current filters are applied to the export."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <a className="btn btn--primary" href={url} onClick={onClose}>
            <Icon name="download" size={16} /> Download {format.toUpperCase()}
          </a>
        </>
      }
    >
      <div className="col gap-12">
        <div className="field">
          <label className="label" htmlFor="export-format">Format</label>
          <select
            id="export-format"
            className="select"
            value={format}
            onChange={(event) => setFormat(event.target.value)}
          >
            <option value="csv">CSV (spreadsheet)</option>
            <option value="json">JSON (backup / integration)</option>
          </select>
        </div>

        <div className="inline-note">
          <Icon name="shield" size={16} />
          <div>
            Exports contain profile data only. Passwords, session identifiers and resume binaries
            are never included.
          </div>
        </div>

        <div className="summary-list">
          {Object.entries(filters)
            .filter(([, value]) => value !== '')
            .map(([key, value]) => (
              <div className="summary-list__item" key={key}>
                <span className="summary-list__label">{key}</span>
                <span className="summary-list__value">{value}</span>
              </div>
            ))}
          {Object.values(filters).every((value) => value === '') ? (
            <p className="text-sm muted">No filters - every student will be exported.</p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* PAGE                                                                       */
/* -------------------------------------------------------------------------- */

export default function AdminStudents() {
  const { showToast } = useToast();

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const query = useMemo(() => {
    const cleaned = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
    return { ...cleaned, page, pageSize: PAGE_SIZE };
  }, [filters, page]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getStudentDirectory(query));
      setError(null);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  // A short debounce keeps a typing administrator from firing a request per key.
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const updateFilter = (field, value) => {
    setPage(1);
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const openDetail = async (studentId) => {
    setDetailLoading(true);
    try {
      setDetail(await getStudentDetail(studentId));
    } catch (caught) {
      showToast(caught.message, 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const rows = data?.items || [];

  return (
    <>
      <PageHeader
        title="Student Management"
        subtitle="Search the directory, import a batch from CSV, and export exactly the rows you need."
      >
        <Button variant="outline" icon="download" onClick={() => setExportOpen(true)}>
          Export
        </Button>
        <Button variant="primary" icon="upload" onClick={() => setImportOpen(true)}>
          Import CSV
        </Button>
      </PageHeader>

      {/* ------------------------------- summary ------------------------------- */}
      {data ? (
        <div className="row gap-8 wrap mb-16">
          <span className="badge badge--info">{data.summary.matched} matched</span>
          <span className="badge badge--success">{data.summary.completeProfiles} complete profiles</span>
          <span className="badge badge--neutral">{data.summary.withResume} with resume</span>
          <span className="badge badge--neutral">{data.summary.placed} placed</span>
          <span className="badge badge--violet">{data.summary.imported} imported</span>
        </div>
      ) : null}

      {/* ------------------------------- filters ------------------------------- */}
      <div className="filter-bar">
        <div className="filter-bar__grid">
          <label className="col">
            <span className="filter-bar__label">Search</span>
            <SearchBar
              value={filters.search}
              onChange={(value) => updateFilter('search', value)}
              placeholder="Name, email, roll number, skill…"
            />
          </label>

          <label className="col">
            <span className="filter-bar__label">Department</span>
            <select
              className="select"
              value={filters.department}
              onChange={(event) => updateFilter('department', event.target.value)}
            >
              <option value="">All departments</option>
              {DEPARTMENTS.map((item) => (
                <option key={item.label} value={item.label}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="col">
            <span className="filter-bar__label">Degree</span>
            <select
              className="select"
              value={filters.degree}
              onChange={(event) => updateFilter('degree', event.target.value)}
            >
              <option value="">All degrees</option>
              {DEGREES.map((degree) => (
                <option key={degree} value={degree}>
                  {degree}
                </option>
              ))}
            </select>
          </label>

          <label className="col">
            <span className="filter-bar__label">Graduation year</span>
            <input
              className="input"
              type="number"
              min="2000"
              max="2100"
              placeholder="e.g. 2027"
              value={filters.graduationYear}
              onChange={(event) => updateFilter('graduationYear', event.target.value)}
            />
          </label>

          <label className="col">
            <span className="filter-bar__label">Minimum CGPA</span>
            <select
              className="select"
              value={filters.minCgpa}
              onChange={(event) => updateFilter('minCgpa', event.target.value)}
            >
              <option value="">Any CGPA</option>
              <option value="7">7.0+</option>
              <option value="8">8.0+</option>
              <option value="8.5">8.5+</option>
              <option value="9">9.0+</option>
            </select>
          </label>

          <label className="col">
            <span className="filter-bar__label">Profile</span>
            <select
              className="select"
              value={filters.completion}
              onChange={(event) => updateFilter('completion', event.target.value)}
            >
              <option value="">Any completion</option>
              <option value="complete">100% complete</option>
              <option value="incomplete">Incomplete</option>
            </select>
          </label>

          <label className="col">
            <span className="filter-bar__label">Resume</span>
            <select
              className="select"
              value={filters.resume}
              onChange={(event) => updateFilter('resume', event.target.value)}
            >
              <option value="">Any</option>
              <option value="uploaded">Uploaded</option>
              <option value="missing">Missing</option>
            </select>
          </label>

          <div className="col" style={{ justifyContent: 'flex-end' }}>
            <Button
              variant="outline"
              icon="refresh"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setPage(1);
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="inline-note inline-note--warning mb-16">
          <Icon name="alert-triangle" size={16} />
          <div>{error}</div>
          <Button variant="outline" size="sm" icon="refresh" onClick={load}>
            Retry
          </Button>
        </div>
      ) : null}

      {/* -------------------------------- table -------------------------------- */}
      {loading && !data ? (
        <LoadingState text="Loading students..." />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="graduation"
          title="No students match these filters"
          text="Try a different department, CGPA range or search term."
        >
          <Button variant="outline" icon="refresh" onClick={() => setFilters(EMPTY_FILTERS)}>
            Reset filters
          </Button>
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="data-table" style={{ minWidth: 1040 }}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Department</th>
                <th>Year</th>
                <th>CGPA</th>
                <th>Profile</th>
                <th>Resume</th>
                <th>Applications</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="row gap-8">
                      <Avatar name={row.name} size="sm" />
                      <div>
                        <div className="cell-primary">{row.name}</div>
                        <div className="cell-sub">{row.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-primary">{row.department || row.branch || '—'}</div>
                    <div className="cell-sub">{row.degree || '—'}</div>
                  </td>
                  <td>{row.graduationYear || '—'}</td>
                  <td className="strong">{row.cgpa}</td>
                  <td style={{ minWidth: 120 }}>
                    <Progress value={row.profileCompletion.percent} small />
                    <span className="cell-sub">{row.profileCompletion.percent}%</span>
                  </td>
                  <td>
                    {row.resume ? (
                      <span className="badge badge--success">Uploaded</span>
                    ) : (
                      <span className="badge badge--neutral">Missing</span>
                    )}
                  </td>
                  <td className="strong">{row.applicationCount}</td>
                  <td>
                    {row.isPlaced ? (
                      <StatusBadge status="Selected" />
                    ) : row.invitationPending ? (
                      <span className="badge badge--warning">Invited</span>
                    ) : (
                      <StatusBadge status="Active" />
                    )}
                  </td>
                  <td>
                    <div className="data-table__actions">
                      <Button
                        variant="outline"
                        size="sm"
                        icon="eye"
                        loading={detailLoading}
                        onClick={() => openDetail(row.id)}
                      >
                        View
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* -------------------------------- pager -------------------------------- */}
      {data && data.pageCount > 1 ? (
        <div className="row-between wrap gap-8 mt-16">
          <span className="text-sm muted">
            Page {data.page} of {data.pageCount} · {data.total} students
          </span>
          <div className="row gap-8">
            <Button
              variant="outline"
              size="sm"
              icon="arrow-left"
              disabled={data.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              iconRight="chevron-right"
              disabled={data.page >= data.pageCount}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      {/* ---------------------------- detail modal ----------------------------- */}
      {detail ? (
        <Modal
          wide
          title={detail.profile.name}
          subtitle={`${detail.profile.department || detail.profile.branch} · ${detail.profile.degree || 'Degree not set'} · CGPA ${detail.profile.cgpa}`}
          onClose={() => setDetail(null)}
          footer={
            <Button variant="outline" onClick={() => setDetail(null)}>
              Close
            </Button>
          }
        >
          <div className="row-between wrap gap-12 mb-16">
            <div className="row gap-16">
              <Avatar name={detail.profile.name} size="lg" />
              <div>
                <div className="strong">{detail.profile.email}</div>
                <div className="text-sm muted">
                  {detail.profile.rollNumber || detail.profile.enrollmentNumber || 'No roll number'} ·{' '}
                  {detail.profile.university || 'No institution'}
                </div>
                <div className="row gap-8 mt-8 wrap">
                  <span className="badge badge--info">{detail.profile.branch}</span>
                  <span className="badge badge--neutral">{detail.completion.percent}% complete</span>
                  <span className="badge badge--warning">Self-declared</span>
                  {detail.profile.dataSource === 'imported' ? (
                    <span className="badge badge--violet">Imported</span>
                  ) : null}
                  {detail.isPlaced ? <span className="badge badge--success">Placed</span> : null}
                </div>
              </div>
            </div>

            <div className="col gap-8">
              {detail.profile.resume ? (
                <a
                  className="btn btn--outline btn--sm"
                  href={studentResumeUrl(detail.profile.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="download" size={14} /> Resume
                </a>
              ) : (
                <span className="badge badge--neutral">No resume</span>
              )}
              {detail.invitation.pending ? (
                <span className="badge badge--warning">
                  Activation pending
                  {detail.invitation.expiresAt
                    ? ` · expires ${formatDate(String(detail.invitation.expiresAt).slice(0, 10))}`
                    : ''}
                </span>
              ) : null}
            </div>
          </div>

          <div className="detail-list mb-16">
            <div className="detail-list__item">
              <div className="detail-list__label">Phone</div>
              <div className="detail-list__value">{detail.profile.phone || '—'}</div>
            </div>
            <div className="detail-list__item">
              <div className="detail-list__label">Graduation year</div>
              <div className="detail-list__value">{detail.profile.graduationYear || '—'}</div>
            </div>
            <div className="detail-list__item">
              <div className="detail-list__label">Backlogs</div>
              <div className="detail-list__value">{detail.profile.backlogs}</div>
            </div>
            <div className="detail-list__item">
              <div className="detail-list__label">Registered on</div>
              <div className="detail-list__value">{formatDate(detail.profile.registeredOn)}</div>
            </div>
            <div className="detail-list__item" style={{ gridColumn: '1 / -1' }}>
              <div className="detail-list__label">Skills</div>
              <div className="detail-list__value">
                {(detail.profile.skills || []).join(', ') || 'None added'}
              </div>
            </div>
            <div className="detail-list__item" style={{ gridColumn: '1 / -1' }}>
              <div className="detail-list__label">Career preferences</div>
              <div className="detail-list__value" style={{ fontWeight: 400 }}>
                {detail.profile.preferences.roles.join(', ') || 'No preferred roles'} ·{' '}
                {detail.profile.preferences.locations.join(', ') || 'No preferred locations'}
              </div>
            </div>
          </div>

          <h3 className="section__title mb-8">Applications ({detail.applications.length})</h3>
          {detail.applications.length === 0 ? (
            <p className="text-sm muted">This student has not applied to any drive yet.</p>
          ) : (
            <div className="summary-list">
              {detail.applications.map((application) => (
                <div className="summary-list__item" key={application.id}>
                  <span className="summary-list__label">
                    {application.companyName} · {application.role}
                  </span>
                  <span className="summary-list__value">
                    <StatusBadge status={application.status} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </Modal>
      ) : null}

      {importOpen ? (
        <ImportPanel onClose={() => setImportOpen(false)} onImported={load} />
      ) : null}
      {exportOpen ? (
        <ExportPanel filters={filters} onClose={() => setExportOpen(false)} />
      ) : null}
    </>
  );
}
