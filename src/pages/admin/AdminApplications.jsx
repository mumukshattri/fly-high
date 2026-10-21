import { useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';
import SearchBar from '../../components/SearchBar';
import Avatar from '../../components/Avatar';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import Button from '../../components/Button';
import { useData } from '../../context/DataContext';
import { enrichApplication } from '../../utils/selectors';
import { formatDate } from '../../utils/format';
import { APPLICATION_STATUSES } from '../../data/mockApplications';

/**
 * pages/admin/AdminApplications.jsx
 * ---------------------------------------------------------------------------
 * The placement cell's read-only monitor of every application in the system.
 *
 * The admin does NOT change statuses here - that is the company's job. This
 * page exists to verify that the process is moving and to spot students who
 * are stuck (or companies who are not reviewing applications).
 */
export default function AdminApplications() {
  const data = useData();
  const { loading } = data;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [companyFilter, setCompanyFilter] = useState('All');

  const rows = useMemo(
    () =>
      [...data.applications]
        .map((application) => enrichApplication(application, data))
        .sort((a, b) => (a.lastUpdated < b.lastUpdated ? 1 : -1)),
    [data],
  );

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'All' && row.status !== statusFilter) return false;
      if (companyFilter !== 'All' && row.company?.id !== companyFilter) return false;
      if (term) {
        const haystack = `${row.studentName} ${row.companyName} ${row.role} ${row.student?.branch}`;
        if (!haystack.toLowerCase().includes(term)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, companyFilter]);

  const countFor = (status) => rows.filter((row) => row.status === status).length;

  if (loading) return <LoadingState text="Loading applications..." />;

  return (
    <>
      <PageHeader
        title="All Applications"
        subtitle={`${rows.length} applications recorded across ${data.drives.length} drives.`}
      >
        <Button
          variant="outline"
          icon="refresh"
          onClick={() => {
            setSearch('');
            setStatusFilter('All');
            setCompanyFilter('All');
          }}
        >
          Reset filters
        </Button>
      </PageHeader>

      {/* ------------------------- status summary strip ------------------------- */}
      <div className="grid grid-4 mb-24">
        {['Applied', 'Under Review', 'Shortlisted', 'Selected'].map((status) => (
          <button
            key={status}
            type="button"
            className="card card--pad"
            style={{
              textAlign: 'left',
              borderColor: statusFilter === status ? 'var(--blue-500)' : undefined,
              boxShadow: statusFilter === status ? '0 0 0 3px var(--blue-50)' : undefined,
            }}
            onClick={() => setStatusFilter(statusFilter === status ? 'All' : status)}
          >
            <div className="stat-card__label">{status}</div>
            <div className="stat-card__value">{countFor(status)}</div>
            <div className="stat-card__foot">Rejected: {countFor('Rejected')}</div>
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <div className="filter-bar__grid">
          <label className="col">
            <span className="filter-bar__label">Search</span>
            <SearchBar value={search} onChange={setSearch} placeholder="Student, company or role..." />
          </label>

          <label className="col">
            <span className="filter-bar__label">Company</span>
            <select className="select" value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}>
              <option value="All">All companies</option>
              {data.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
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
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <EmptyState icon="file-text" title="No applications match these filters" text="Try another status or company." />
      ) : (
        <div className="table-wrap">
          <table className="data-table" style={{ minWidth: 1040 }}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Company</th>
                <th>Role</th>
                <th>Applied</th>
                <th>Last Updated</th>
                <th>Status History</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="row gap-8">
                      <Avatar name={row.studentName} size="sm" />
                      <div>
                        <div className="cell-primary">{row.studentName}</div>
                        <div className="cell-sub">
                          {row.student?.branch} · CGPA {row.student?.cgpa}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="strong">{row.companyName}</td>
                  <td className="muted">{row.role}</td>
                  <td className="nowrap muted">{formatDate(row.appliedOn)}</td>
                  <td className="nowrap muted">{formatDate(row.lastUpdated)}</td>
                  <td>
                    <span className="badge badge--neutral">{row.statusHistory.length} updates</span>
                  </td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
