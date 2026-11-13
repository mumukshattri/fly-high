import { useMemo, useState } from 'react';
import Icon from '../../components/Icon';
import PageHeader from '../../components/PageHeader';
import SearchBar from '../../components/SearchBar';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import Button from '../../components/Button';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { getCompanyRows } from '../../utils/selectors';
import { formatDate } from '../../utils/format';

/**
 * pages/admin/AdminCompanies.jsx
 * ---------------------------------------------------------------------------
 * The list of recruiters registered with the placement cell, plus how many
 * drives and applications each one generated. The admin uses this to see which
 * companies are actually engaging with the campus.
 *
 * VERIFICATION GATE: a newly registered company has `verified: false` and the
 * backend refuses its POST /api/drives with a 403 until the placement cell
 * approves it here, so this button is the only way a recruiter can start
 * publishing drives.
 */
export default function AdminCompanies() {
  const data = useData();
  const { loading, setCompanyVerification } = data;
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState(null);

  /** PATCH /api/admin/companies/:id { verified } */
  const handleVerification = async (company) => {
    setPendingId(company.id);
    try {
      await setCompanyVerification(company.id, !company.verified);
      showToast(
        company.verified
          ? `${company.name} can no longer publish drives.`
          : `${company.name} is verified and can publish drives now.`,
        'success',
      );
    } catch (error) {
      showToast(error.message || 'Could not update this company.', 'error');
    } finally {
      setPendingId(null);
    }
  };

  /** Companies + how many drives/applications each one generated. */
  const companies = useMemo(
    () => getCompanyRows(data),
    [data.companies, data.drives, data.applications],
  );

  const visibleCompanies = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return companies;
    return companies.filter((company) =>
      `${company.name} ${company.industry} ${company.location}`.toLowerCase().includes(term),
    );
  }, [companies, search]);

  if (loading) return <LoadingState text="Loading companies..." />;

  return (
    <>
      <PageHeader
        title="Companies"
        subtitle={`${data.companies.length} recruiters registered · ${data.drives.length} drives published in total.`}
      >
        <span className="badge badge--info">{data.companies.length} registered</span>
      </PageHeader>

      <div className="filter-bar">
        <div className="filter-bar__row">
          <SearchBar value={search} onChange={setSearch} placeholder="Search by company, industry or city..." />
          <span className="text-sm muted nowrap">{visibleCompanies.length} shown</span>
        </div>
      </div>

      {visibleCompanies.length === 0 ? (
        <EmptyState icon="building" title="No companies found" text="Try a different search term." />
      ) : (
        <div className="grid grid-3">
          {visibleCompanies.map((company) => (
            <article className="card card--pad" key={company.id}>
              <div className="row gap-12 mb-16">
                <div className="stat-card__icon tint-navy">
                  <Icon name="building" size={18} />
                </div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row gap-8 wrap">
                    <span className="strong">{company.name}</span>
                    {company.verified ? (
                      <span className="badge badge--success">Verified</span>
                    ) : (
                      <span className="badge badge--warning">Awaiting approval</span>
                    )}
                  </div>
                  <div className="text-xs muted">{company.industry}</div>
                </div>
              </div>

              <div className="mini-metric">
                <span className="mini-metric__label">Tier</span>
                <span className="mini-metric__value">{company.tier}</span>
              </div>
              <div className="mini-metric">
                <span className="mini-metric__label">Location</span>
                <span className="mini-metric__value text-xs">{company.location}</span>
              </div>
              <div className="mini-metric">
                <span className="mini-metric__label">HR contact</span>
                <span className="mini-metric__value text-xs">{company.hrName}</span>
              </div>
              <div className="mini-metric">
                <span className="mini-metric__label">Registered on</span>
                <span className="mini-metric__value text-xs">{formatDate(company.registeredOn)}</span>
              </div>

              <div className="row gap-8 mt-16 wrap">
                <span className="badge badge--info">{company.activeDrives} active drives</span>
                <span className="badge badge--neutral">{company.totalDrives} total</span>
                <span className="badge badge--neutral">{company.totalApplications} applications</span>
                {company.selected > 0 ? (
                  <span className="badge badge--success">{company.selected} selected</span>
                ) : null}
              </div>

              <Button
                variant={company.verified ? 'outline' : 'success'}
                size="sm"
                icon={company.verified ? 'x' : 'check'}
                className="mt-16"
                loading={pendingId === company.id}
                disabled={pendingId !== null && pendingId !== company.id}
                onClick={() => handleVerification(company)}
              >
                {company.verified ? 'Revoke verification' : 'Verify company'}
              </Button>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
