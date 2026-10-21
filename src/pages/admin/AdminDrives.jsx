import { useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import SearchBar from '../../components/SearchBar';
import StatusBadge from '../../components/StatusBadge';
import Avatar from '../../components/Avatar';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import Button from '../../components/Button';
import { useData } from '../../context/DataContext';
import { getDriveRows } from '../../utils/selectors';
import { formatDate, deadlineLabel } from '../../utils/format';

/**
 * pages/admin/AdminDrives.jsx
 * ---------------------------------------------------------------------------
 * Every drive published across the campus, from every company, in one table.
 * The placement cell uses this to check eligibility rules for fairness
 * (for example: is any company demanding an unreasonable CGPA?).
 */
export default function AdminDrives() {
  const data = useData();
  const { loading } = data;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [companyFilter, setCompanyFilter] = useState('All');

  /** Every drive + its company + applicant funnel (joined in utils/selectors). */
  const rows = useMemo(
    () => getDriveRows(data),
    [data.drives, data.companies, data.applications],
  );

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'All' && row.status !== statusFilter) return false;
      if (companyFilter !== 'All' && row.companyId !== companyFilter) return false;
      if (term && !`${row.companyName} ${row.role} ${row.branches.join(' ')}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, search, statusFilter, companyFilter]);

  const activeFiltered = statusFilter !== 'All' || companyFilter !== 'All' || search;

  if (loading) return <LoadingState text="Loading drives..." />;

  return (
    <>
      <PageHeader
        title="All Recruitment Drives"
        subtitle={`${data.drives.length} drives published · ${data.drives.filter((d) => d.status === 'Open').length} currently open.`}
      >
        {activeFiltered ? (
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
        ) : null}
      </PageHeader>

      <div className="filter-bar">
        <div className="filter-bar__grid">
          <label className="col">
            <span className="filter-bar__label">Search</span>
            <SearchBar value={search} onChange={setSearch} placeholder="Company, role or branch..." />
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
              <option value="Open">Open</option>
              <option value="Closed">Closed</option>
            </select>
          </label>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <EmptyState icon="briefcase" title="No drives match your filters" text="Try another company or status." />
      ) : (
        <div className="table-wrap">
          <table className="data-table" style={{ minWidth: 1040 }}>
            <thead>
              <tr>
                <th>Company</th>
                <th>Role</th>
                <th>Eligibility</th>
                <th>Deadline</th>
                <th>Applicants</th>
                <th>Pipeline</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="row gap-8">
                      <Avatar name={row.companyName} size="sm" square />
                      <div>
                        <div className="cell-primary">{row.companyName}</div>
                        <div className="cell-sub">{row.location}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-primary" style={{ fontWeight: 500 }}>
                      {row.role}
                    </div>
                    <div className="cell-sub">
                      {row.jobType} · {row.package}
                    </div>
                  </td>
                  <td>
                    <div className="text-sm">
                      CGPA <strong>{row.minimumCGPA}+</strong>
                    </div>
                    <div className="cell-sub">{row.branches.join(' / ')}</div>
                    <div className="cell-sub">{row.requiredSkills.join(', ')}</div>
                  </td>
                  <td className="nowrap">
                    <div>{formatDate(row.deadline)}</div>
                    <div className="cell-sub">{deadlineLabel(row.deadline)}</div>
                  </td>
                  <td className="strong">{row.applicantCount}</td>
                  <td>
                    <div className="row gap-4 wrap">
                      <span className="badge badge--violet">{row.shortlistedCount} shortlisted</span>
                      <span className="badge badge--success">{row.selectedCount} selected</span>
                    </div>
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
