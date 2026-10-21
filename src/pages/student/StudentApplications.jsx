import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import StatusBadge from '../../components/StatusBadge';
import SearchBar from '../../components/SearchBar';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import Avatar from '../../components/Avatar';
import { useCurrentStudent } from '../../hooks/useCurrentStudent';
import { useData } from '../../context/DataContext';
import { getStudentApplications } from '../../utils/selectors';
import { formatDate } from '../../utils/format';
import { APPLICATION_STATUSES } from '../../data/mockApplications';

/**
 * pages/student/StudentApplications.jsx
 * ===========================================================================
 * MY APPLICATIONS  (/student/applications)
 * ===========================================================================
 * The tracking page. One row per application, with:
 *   Company | Role | Applied Date | Status | Last Updated | Action
 *
 * Filtering by status is done with the tab strip, which is again derived state:
 * the same array is filtered differently depending on `activeStatus`.
 *
 * Every status is colour coded by <StatusBadge /> so the student can scan the
 * list quickly (the "different visual indicators for each status" requirement).
 */
export default function StudentApplications() {
  const student = useCurrentStudent();
  const data = useData();
  const { loading } = data;
  const navigate = useNavigate();

  const [activeStatus, setActiveStatus] = useState('All');
  const [search, setSearch] = useState('');

  const applications = useMemo(() => getStudentApplications(student?.id, data), [student, data]);

  const visibleApplications = useMemo(() => {
    const term = search.trim().toLowerCase();
    return applications.filter((application) => {
      if (activeStatus !== 'All' && application.status !== activeStatus) return false;
      if (term && !`${application.companyName} ${application.role}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [applications, activeStatus, search]);

  /** Count per status, used for the tab labels. */
  const countFor = (status) =>
    status === 'All'
      ? applications.length
      : applications.filter((application) => application.status === status).length;

  if (loading || !student) return <LoadingState text="Loading your applications..." />;

  return (
    <>
      <PageHeader
        title="My Applications"
        subtitle="Every drive you applied to, with the latest status from the recruiter."
      >
        <Button variant="outline" icon="briefcase" onClick={() => navigate('/student/drives')}>
          Apply to more drives
        </Button>
      </PageHeader>

      {/* ---------------------------- status tabs ---------------------------- */}
      <div className="tabs" role="tablist">
        {['All', ...APPLICATION_STATUSES].map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={activeStatus === status}
            className={`tab ${activeStatus === status ? 'is-active' : ''}`}
            onClick={() => setActiveStatus(status)}
          >
            {status} ({countFor(status)})
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <div className="filter-bar__row">
          <SearchBar value={search} onChange={setSearch} placeholder="Search by company or role..." />
          <span className="text-sm muted nowrap">
            {visibleApplications.length} of {applications.length} applications
          </span>
        </div>
      </div>

      {/* ------------------------------ table ------------------------------ */}
      {visibleApplications.length === 0 ? (
        <EmptyState
          icon="file-text"
          title={applications.length === 0 ? 'You have not applied yet' : 'No applications with this status'}
          text={
            applications.length === 0
              ? 'Browse recruitment drives and apply to the ones you are eligible for. Your applications will then be tracked here.'
              : 'Try a different status tab or clear the search box.'
          }
        >
          {applications.length === 0 ? (
            <Button variant="primary" icon="briefcase" onClick={() => navigate('/student/drives')}>
              Browse recruitment drives
            </Button>
          ) : (
            <Button
              variant="outline"
              icon="refresh"
              onClick={() => {
                setActiveStatus('All');
                setSearch('');
              }}
            >
              Reset filters
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Role</th>
                <th>Applied Date</th>
                <th>Status</th>
                <th>Last Updated</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleApplications.map((application) => (
                <tr key={application.id}>
                  <td>
                    <div className="row gap-8">
                      <Avatar name={application.companyName} size="sm" square />
                      <div>
                        <div className="cell-primary">{application.companyName}</div>
                        <div className="cell-sub">{application.company?.location || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-primary" style={{ fontWeight: 500 }}>
                      {application.role}
                    </div>
                    <div className="cell-sub">{application.drive?.package || '—'}</div>
                  </td>
                  <td className="nowrap">{formatDate(application.appliedOn)}</td>
                  <td>
                    <StatusBadge status={application.status} />
                  </td>
                  <td className="nowrap muted">{formatDate(application.lastUpdated)}</td>
                  <td>
                    <div className="data-table__actions">
                      <Button
                        variant="outline"
                        size="sm"
                        icon="eye"
                        onClick={() => navigate(`/student/applications/${application.id}`)}
                      >
                        Track
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* --------------------------- summary footer --------------------------- */}
      {applications.length > 0 ? (
        <section className="card card--pad mt-24">
          <div className="row-between wrap gap-16">
            <div className="row gap-8">
              <Icon name="info" size={16} />
              <span className="text-sm muted">
                Statuses update as recruiters review your application. You will also get a notification.
              </span>
            </div>
            <div className="row gap-16 wrap">
              <span className="row gap-4 text-xs muted">
                <Icon name="star" size={13} /> {countFor('Shortlisted')} shortlisted
              </span>
              <span className="row gap-4 text-xs muted">
                <Icon name="award" size={13} /> {countFor('Selected')} selected
              </span>
              <span className="row gap-4 text-xs muted">
                <Icon name="clock" size={13} /> {countFor('Under Review')} under review
              </span>
            </div>
          </div>
        </section>
      ) : null}

    </>
  );
}
