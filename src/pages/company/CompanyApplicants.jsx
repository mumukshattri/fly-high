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
import Icon from '../../components/Icon';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { getCompanyApplications, getCompanyDrives } from '../../utils/selectors';
import { formatDate } from '../../utils/format';
import { APPLICATION_STATUSES } from '../../data/mockApplications';

/**
 * pages/company/CompanyApplicants.jsx
 * ===========================================================================
 * APPLICANTS  (/company/applicants)
 * ===========================================================================
 * The recruiter reviews every student who applied to their drives:
 *
 *   Student | CGPA | Branch | Skills | Status   ->  [Shortlist] [Reject] [Select]
 *
 * Each action calls `updateApplicationStatus()` which:
 *   1. PATCHes the application (here: writes to the demo database)
 *   2. appends an entry to the status timeline
 *   3. creates a notification for the student
 *
 * That is the connecting tissue of the whole project: what the recruiter does
 * here appears on the student's "My Applications" page and notification inbox.
 */
export default function CompanyApplicants() {
  const company = useCurrentCompany();
  const data = useData();
  const { loading, saving, updateApplicationStatus } = data;
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [statusFilter, setStatusFilter] = useState('All');
  const [driveFilter, setDriveFilter] = useState('All');
  const [selectedApplication, setSelectedApplication] = useState(null);

  useEffect(() => {
    const query = searchParams.get('q');
    if (query !== null) setSearch(query);
  }, [searchParams]);

  const drives = useMemo(
    () => (company ? getCompanyDrives(company.id, data) : []),
    [company, data.drives, data.applications],
  );

  const applications = useMemo(
    () => (company ? getCompanyApplications(company.id, data) : []),
    [company, data.drives, data.applications, data.students],
  );

  const visibleApplications = useMemo(() => {
    const term = search.trim().toLowerCase();
    return applications.filter((application) => {
      if (statusFilter !== 'All' && application.status !== statusFilter) return false;
      if (driveFilter !== 'All' && application.driveId !== driveFilter) return false;
      if (term) {
        const haystack = `${application.studentName} ${application.role} ${application.student?.branch} ${(
          application.student?.skills || []
        ).join(' ')}`;
        if (!haystack.toLowerCase().includes(term)) return false;
      }
      return true;
    });
  }, [applications, statusFilter, driveFilter, search]);

  /** Keeps the details modal in sync after a status change. */
  const currentModalApplication = useMemo(
    () => (selectedApplication ? applications.find((item) => item.id === selectedApplication.id) || null : null),
    [applications, selectedApplication],
  );

  if (loading || !company) return <LoadingState text="Loading applicants..." />;

  const handleStatusChange = async (application, status) => {
    try {
      await updateApplicationStatus({
        applicationId: application.id,
        status,
        note:
          status === 'Shortlisted'
            ? 'Shortlisted by the recruiter after resume screening.'
            : status === 'Rejected'
              ? 'Not moving ahead for this role.'
              : status === 'Selected'
                ? 'Offer released to the candidate.'
                : '',
      });
      showToast(`${application.studentName} marked as ${status}.`, 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  const activeFilterCount =
    (statusFilter !== 'All' ? 1 : 0) + (driveFilter !== 'All' ? 1 : 0) + (search ? 1 : 0);

  const resetFilters = () => {
    setStatusFilter('All');
    setDriveFilter('All');
    setSearch('');
  };

  return (
    <>
      <PageHeader
        title="Applicants"
        subtitle={`${applications.length} students applied across ${drives.length} of your drives.`}
      >
        <span className="badge badge--info">{visibleApplications.length} shown</span>
      </PageHeader>

      {/* ------------------------------- filters ------------------------------- */}
      <div className="filter-bar">
        <div className="filter-bar__grid">
          <label className="col">
            <span className="filter-bar__label">Search</span>
            <SearchBar value={search} onChange={setSearch} placeholder="Student, role, skill..." />
          </label>

          <label className="col">
            <span className="filter-bar__label">Drive</span>
            <select className="select" value={driveFilter} onChange={(event) => setDriveFilter(event.target.value)}>
              <option value="All">All drives</option>
              {drives.map((drive) => (
                <option key={drive.id} value={drive.id}>
                  {drive.role}
                </option>
              ))}
            </select>
          </label>

          <label className="col">
            <span className="filter-bar__label">Status</span>
            <select className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="All">All statuses</option>
              {APPLICATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <div className="col" style={{ justifyContent: 'flex-end' }}>
            <Button variant="outline" icon="refresh" onClick={resetFilters} disabled={activeFilterCount === 0}>
              Reset filters
            </Button>
          </div>
        </div>
      </div>

      {/* -------------------------------- table -------------------------------- */}
      {visibleApplications.length === 0 ? (
        <EmptyState
          icon="users"
          title={applications.length === 0 ? 'No applications received yet' : 'No applicants match your filters'}
          text={
            applications.length === 0
              ? 'Publish a recruitment drive and eligible students will be able to apply.'
              : 'Try clearing the status or drive filter.'
          }
        >
          {applications.length > 0 ? (
            <Button variant="outline" icon="refresh" onClick={resetFilters}>
              Reset filters
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="data-table" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Role applied for</th>
                <th>CGPA</th>
                <th>Branch</th>
                <th>Skills</th>
                <th>Applied</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleApplications.map((application) => (
                <tr key={application.id}>
                  <td>
                    <div className="row gap-8">
                      <Avatar name={application.studentName} size="sm" />
                      <div>
                        <div className="cell-primary">{application.studentName}</div>
                        <div className="cell-sub">{application.student?.rollNumber}</div>
                      </div>
                    </div>
                  </td>
                  <td className="muted">{application.role}</td>
                  <td className="strong">{application.student?.cgpa}</td>
                  <td>
                    <span className="badge badge--info">{application.student?.branch}</span>
                  </td>
                  <td>
                    <div className="applicant-skills">
                      {(application.student?.skills || []).slice(0, 4).map((skill) => (
                        <span className="chip chip--neutral" key={skill}>
                          {skill}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="nowrap muted">{formatDate(application.appliedOn)}</td>
                  <td>
                    <StatusBadge status={application.status} />
                  </td>
                  <td>
                    <div className="data-table__actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="eye"
                        onClick={() => setSelectedApplication(application)}
                      >
                        View Profile
                      </Button>
                      <Button
                        variant="success"
                        size="sm"
                        icon="user-check"
                        disabled={saving || application.status === 'Shortlisted'}
                        onClick={() => handleStatusChange(application, 'Shortlisted')}
                      >
                        Shortlist
                      </Button>
                      <Button
                        variant="danger-outline"
                        size="sm"
                        icon="user-x"
                        disabled={saving || application.status === 'Rejected'}
                        onClick={() => handleStatusChange(application, 'Rejected')}
                      >
                        Reject
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* --------------------------- student profile modal --------------------------- */}
      {currentModalApplication ? (
        <Modal
          wide
          title={currentModalApplication.studentName}
          subtitle={`${currentModalApplication.student?.branch} · ${currentModalApplication.student?.rollNumber}`}
          onClose={() => setSelectedApplication(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setSelectedApplication(null)}>
                Close
              </Button>
              <Button
                variant="danger-outline"
                icon="user-x"
                disabled={saving || currentModalApplication.status === 'Rejected'}
                onClick={() => handleStatusChange(currentModalApplication, 'Rejected')}
              >
                Reject
              </Button>
              <Button
                variant="success"
                icon="user-check"
                disabled={saving || currentModalApplication.status === 'Shortlisted'}
                onClick={() => handleStatusChange(currentModalApplication, 'Shortlisted')}
              >
                Shortlist
              </Button>
              <Button
                variant="primary"
                icon="award"
                disabled={saving || currentModalApplication.status === 'Selected'}
                onClick={() => handleStatusChange(currentModalApplication, 'Selected')}
              >
                Mark Selected
              </Button>
            </>
          }
        >
          <div className="row gap-16 mb-16">
            <Avatar name={currentModalApplication.studentName} size="lg" />
            <div>
              <div className="strong">{currentModalApplication.studentName}</div>
              <div className="text-sm muted">{currentModalApplication.student?.university}</div>
              <div className="row gap-8 mt-8 wrap">
                <StatusBadge status={currentModalApplication.status} />
                <span className="badge badge--success">CGPA {currentModalApplication.student?.cgpa}</span>
                <span className="badge badge--neutral">
                  Applied {formatDate(currentModalApplication.appliedOn)}
                </span>
              </div>
            </div>
          </div>

          <div className="detail-list mb-16">
            <div className="detail-list__item">
              <div className="detail-list__label">Email</div>
              <div className="detail-list__value">{currentModalApplication.student?.email}</div>
            </div>
            <div className="detail-list__item">
              <div className="detail-list__label">Phone</div>
              <div className="detail-list__value">{currentModalApplication.student?.phone}</div>
            </div>
            <div className="detail-list__item">
              <div className="detail-list__label">Semester</div>
              <div className="detail-list__value">{currentModalApplication.student?.semester}</div>
            </div>
            <div className="detail-list__item">
              <div className="detail-list__label">Graduation</div>
              <div className="detail-list__value">{currentModalApplication.student?.graduationYear}</div>
            </div>
            <div className="detail-list__item">
              <div className="detail-list__label">Role applied for</div>
              <div className="detail-list__value">{currentModalApplication.role}</div>
            </div>
            <div className="detail-list__item">
              <div className="detail-list__label">Resume</div>
              <div className="detail-list__value">
                {currentModalApplication.student?.resume?.fileName || 'Not uploaded'}
              </div>
            </div>
          </div>

          <div className="mb-16">
            <div className="detail-list__label mb-8">Skills</div>
            <div className="chip-list">
              {(currentModalApplication.student?.skills || []).map((skill) => (
                <span className="chip" key={skill}>
                  {skill}
                </span>
              ))}
            </div>
          </div>

          <div className="mb-16">
            <div className="detail-list__label mb-8">About</div>
            <p className="text-sm muted">
              {currentModalApplication.student?.about || 'The student has not added a summary.'}
            </p>
          </div>

          <div className="inline-note">
            <Icon name="info" size={16} />
            <span>
              Changing the status here immediately updates the student's "My Applications" page and
              sends them a notification.
            </span>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
