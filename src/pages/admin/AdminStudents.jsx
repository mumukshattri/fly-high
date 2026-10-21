import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import Avatar from '../../components/Avatar';
import StatusBadge from '../../components/StatusBadge';
import SearchBar from '../../components/SearchBar';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import Modal from '../../components/Modal';
import { useData } from '../../context/DataContext';
import { formatDate } from '../../utils/format';
import { BRANCHES } from '../../config/constants';
import { getStudentApplications, getStudentRows } from '../../utils/selectors';

/**
 * pages/admin/AdminStudents.jsx
 * ---------------------------------------------------------------------------
 * The placement cell's master list of registered students.
 *
 * Columns: Student | Branch | Semester | CGPA | Skills | Applications | Status
 *
 * "Status" is derived, not stored: a student counts as PLACED when at least one
 * of their applications has the status "Selected". Deriving it from the
 * applications collection means it can never go out of sync.
 */
export default function AdminStudents() {
  const data = useData();
  const { loading } = data;
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [branchFilter, setBranchFilter] = useState('All');
  const [minCgpa, setMinCgpa] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);

  useEffect(() => {
    const query = searchParams.get('q');
    if (query !== null) setSearch(query);
  }, [searchParams]);

  /**
   * Students + derived placement info (application counts, placed or not).
   * The joining happens in utils/selectors.js so this page stays presentational.
   */
  const rows = useMemo(() => getStudentRows(data), [data.students, data.applications]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (branchFilter !== 'All' && row.branch !== branchFilter) return false;
      if (minCgpa && Number(row.cgpa) < Number(minCgpa)) return false;
      if (term) {
        const haystack = `${row.name} ${row.rollNumber} ${row.email} ${(row.skills || []).join(' ')}`;
        if (!haystack.toLowerCase().includes(term)) return false;
      }
      return true;
    });
  }, [rows, search, branchFilter, minCgpa]);

  const placedCount = rows.filter((row) => row.isPlaced).length;

  const selectedStudentApplications = useMemo(
    () => (selectedStudent ? getStudentApplications(selectedStudent.id, data) : []),
    [selectedStudent, data],
  );

  if (loading) return <LoadingState text="Loading students..." />;

  const resetFilters = () => {
    setSearch('');
    setBranchFilter('All');
    setMinCgpa('');
  };

  return (
    <>
      <PageHeader
        title="Registered Students"
        subtitle={`${data.students.length} students registered · ${placedCount} placed so far.`}
      >
        <span className="badge badge--success">{placedCount} placed</span>
        <span className="badge badge--info">{data.students.length - placedCount} in process</span>
      </PageHeader>

      {/* ------------------------------- filters ------------------------------- */}
      <div className="filter-bar">
        <div className="filter-bar__grid">
          <label className="col">
            <span className="filter-bar__label">Search</span>
            <SearchBar value={search} onChange={setSearch} placeholder="Name, roll number, skill..." />
          </label>

          <label className="col">
            <span className="filter-bar__label">Branch</span>
            <select className="select" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
              <option value="All">All branches</option>
              {BRANCHES.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          </label>

          <label className="col">
            <span className="filter-bar__label">Minimum CGPA</span>
            <select className="select" value={minCgpa} onChange={(event) => setMinCgpa(event.target.value)}>
              <option value="">Any CGPA</option>
              <option value="7">7.0+</option>
              <option value="8">8.0+</option>
              <option value="8.5">8.5+</option>
            </select>
          </label>

          <div className="col" style={{ justifyContent: 'flex-end' }}>
            <Button variant="outline" icon="refresh" onClick={resetFilters}>
              Reset filters
            </Button>
          </div>
        </div>
      </div>

      {/* -------------------------------- table -------------------------------- */}
      {visibleRows.length === 0 ? (
        <EmptyState
          icon="graduation"
          title="No students match these filters"
          text="Try a different branch, CGPA or search term."
        >
          <Button variant="outline" icon="refresh" onClick={resetFilters}>
            Reset filters
          </Button>
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="data-table" style={{ minWidth: 1000 }}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Branch</th>
                <th>Sem</th>
                <th>CGPA</th>
                <th>Skills</th>
                <th>Applications</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="row gap-8">
                      <Avatar name={row.name} size="sm" />
                      <div>
                        <div className="cell-primary">{row.name}</div>
                        <div className="cell-sub">{row.rollNumber}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge--info">{row.branch}</span>
                  </td>
                  <td>{row.semester}</td>
                  <td className="strong">{row.cgpa}</td>
                  <td>
                    <div className="applicant-skills">
                      {(row.skills || []).slice(0, 3).map((skill) => (
                        <span className="chip chip--neutral" key={skill}>
                          {skill}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className="strong">{row.applicationCount}</span>
                    {row.shortlistedCount > 0 ? (
                      <span className="cell-sub"> · {row.shortlistedCount} shortlisted</span>
                    ) : null}
                  </td>
                  <td>{row.isPlaced ? <StatusBadge status="Selected" /> : <StatusBadge status="Active" />}</td>
                  <td>
                    <div className="data-table__actions">
                      <Button variant="outline" size="sm" icon="eye" onClick={() => setSelectedStudent(row)}>
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

      {/* --------------------------- student detail modal --------------------------- */}
      {selectedStudent ? (
        <Modal
          wide
          title={selectedStudent.name}
          subtitle={`${selectedStudent.rollNumber} · ${selectedStudent.branch} · CGPA ${selectedStudent.cgpa}`}
          onClose={() => setSelectedStudent(null)}
          footer={
            <Button variant="outline" onClick={() => setSelectedStudent(null)}>
              Close
            </Button>
          }
        >
          <div className="row gap-16 mb-16">
            <Avatar name={selectedStudent.name} size="lg" />
            <div>
              <div className="strong">{selectedStudent.name}</div>
              <div className="text-sm muted">{selectedStudent.university}</div>
              <div className="row gap-8 mt-8 wrap">
                <span className="badge badge--info">{selectedStudent.branch}</span>
                <span className="badge badge--neutral">Semester {selectedStudent.semester}</span>
                <span className="badge badge--success">CGPA {selectedStudent.cgpa}</span>
                {selectedStudent.isPlaced ? <span className="badge badge--success">Placed</span> : null}
              </div>
            </div>
          </div>

          <div className="detail-list mb-16">
            <div className="detail-list__item">
              <div className="detail-list__label">Email</div>
              <div className="detail-list__value">{selectedStudent.email}</div>
            </div>
            <div className="detail-list__item">
              <div className="detail-list__label">Phone</div>
              <div className="detail-list__value">{selectedStudent.phone}</div>
            </div>
            <div className="detail-list__item">
              <div className="detail-list__label">Registered on</div>
              <div className="detail-list__value">{formatDate(selectedStudent.registeredOn)}</div>
            </div>
            <div className="detail-list__item">
              <div className="detail-list__label">Resume</div>
              <div className="detail-list__value">{selectedStudent.resume?.fileName || 'Not uploaded'}</div>
            </div>
          </div>

          <h3 className="section__title mb-8">Applications ({selectedStudentApplications.length})</h3>
          {selectedStudentApplications.length === 0 ? (
            <p className="text-sm muted">This student has not applied to any drive yet.</p>
          ) : (
            <div className="summary-list">
              {selectedStudentApplications.map((application) => (
                <div className="summary-list__item" key={application.id}>
                  <span className="summary-list__label">
                    {application.companyName} &middot; {application.role}
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
    </>
  );
}
