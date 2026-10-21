import { useMemo } from 'react';
import Icon from '../../components/Icon';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import Progress from '../../components/Progress';
import StatusBadge from '../../components/StatusBadge';
import LoadingState from '../../components/LoadingState';
import { useData } from '../../context/DataContext';
import { getPlacementStatistics } from '../../utils/selectors';

/**
 * pages/admin/AdminStatistics.jsx
 * ---------------------------------------------------------------------------
 * PLACEMENT STATISTICS  (/admin/statistics)
 *
 * The analytical view: which branches are getting placed, which companies hire
 * the most, and how applications convert into offers.
 *
 * All the numbers come from ONE pure function,
 * `utils/selectors.getPlacementStatistics(state)`, which is also what
 * `services/adminService.getStatistics()` wraps. Keeping the aggregation in a
 * single place means the dashboard and this page can never disagree, and the
 * whole thing can move to `GET /api/admin/statistics` without any change here.
 */
export default function AdminStatistics() {
  const data = useData();
  const { loading } = data;

  const stats = useMemo(() => getPlacementStatistics(data), [data.students, data.drives, data.applications, data.companies]);

  if (loading) return <LoadingState text="Calculating placement statistics..." />;

  return (
    <>
      <PageHeader
        title="Placement Statistics"
        subtitle="Branch-wise and company-wise analysis of the current placement season."
      >
        <span className="badge badge--info">Season 2026-27</span>
      </PageHeader>

      {/* ------------------------------- KPI cards ------------------------------- */}
      <div className="stats-grid mb-24">
        <StatCard
          label="Students Placed"
          value={`${stats.placedStudents}/${stats.totalStudents}`}
          icon="award"
          tint="green"
          foot={`${stats.placementRate}% placement rate`}
        />
        <StatCard
          label="Average CGPA"
          value={stats.averageCgpa}
          icon="graduation"
          tint="blue"
          foot="of registered students"
        />
        <StatCard
          label="Highest Package"
          value={stats.highestPackage}
          icon="trending-up"
          tint="violet"
          foot={`average ${stats.averagePackage}`}
        />
        <StatCard
          label="Total Applications"
          value={stats.totalApplications}
          icon="file-text"
          tint="navy"
          foot={`${stats.selected} offers released`}
        />
      </div>

      <div className="two-column">
        <div className="col gap-16">
          {/* ---------------------------- branch-wise ---------------------------- */}
          <section className="card card--flush">
            <div className="card__header">
              <div>
                <div className="card__title">Branch-wise Placement</div>
                <div className="card__subtitle">
                  Students placed / total registered, with the branch average CGPA
                </div>
              </div>
            </div>

            <div className="table-wrap table-wrap--flush">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th>Students</th>
                    <th>Shortlisted</th>
                    <th>Placed</th>
                    <th>Avg CGPA</th>
                    <th style={{ minWidth: 160 }}>Placement Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.branchWise.map((row) => (
                    <tr key={row.branch}>
                      <td>
                        <span className="badge badge--info">{row.branch}</span>
                      </td>
                      <td className="strong">{row.students}</td>
                      <td>{row.shortlisted}</td>
                      <td>
                        <span className="badge badge--success">{row.placed}</span>
                      </td>
                      <td className="muted">{row.avgCgpa}</td>
                      <td>
                        <div className="row gap-8">
                          <Progress value={row.rate} small />
                          <span className="text-xs strong nowrap">{row.rate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* --------------------------- company-wise --------------------------- */}
          <section className="card card--flush">
            <div className="card__header">
              <div>
                <div className="card__title">Company-wise Hiring</div>
                <div className="card__subtitle">Applications received and offers released</div>
              </div>
            </div>

            <div className="table-wrap table-wrap--flush">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Tier</th>
                    <th>Drives</th>
                    <th>Applications</th>
                    <th>Shortlisted</th>
                    <th>Selected</th>
                    <th>Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.companyWise.map((row) => (
                    <tr key={row.company.id}>
                      <td className="cell-primary">{row.company.name}</td>
                      <td>
                        <span className="badge badge--violet">{row.company.tier}</span>
                      </td>
                      <td>{row.drives}</td>
                      <td className="strong">{row.applications}</td>
                      <td>{row.shortlisted}</td>
                      <td>
                        <span className="badge badge--success">{row.selected}</span>
                      </td>
                      <td className="muted">{row.conversion}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="col gap-16">
          {/* ------------------------------- funnel ------------------------------- */}
          <section className="card card--pad">
            <h2 className="section__title mb-16">Recruitment Funnel</h2>
            <div className="bar-chart">
              {stats.funnel.map((row) => (
                <div className="bar-chart__row" key={row.status}>
                  <span className="bar-chart__label">{row.status}</span>
                  <span className="bar-chart__track">
                    <span className="bar-chart__fill" style={{ width: `${row.percent}%` }} />
                  </span>
                  <span className="bar-chart__value">{row.count}</span>
                </div>
              ))}
            </div>

            <div className="mt-16">
              {stats.funnel.slice(0, 4).map((row) => (
                <div className="mini-metric" key={row.status}>
                  <span className="mini-metric__label">{row.status}</span>
                  <StatusBadge status={row.status} withIcon={false} />
                </div>
              ))}
            </div>
          </section>

          <section className="card card--pad">
            <div className="row gap-8 mb-8">
              <Icon name="info" size={17} />
              <h2 className="section__title">How these numbers are produced</h2>
            </div>
            <ul className="bullet-list">
              <li>
                They come from the pure function
                <span className="mono"> utils/selectors.getPlacementStatistics()</span>, which
                <span className="mono"> services/adminService.getStatistics() </span>
                also wraps. One source of truth, no duplicated maths.
              </li>
              <li>
                With MongoDB the same object arrives from one aggregation endpoint
                (<span className="mono">GET /api/admin/statistics</span>), so this page does not change.
              </li>
              <li>
                "Placed" is derived from applications whose status is <strong>Selected</strong>, so it
                can never go out of sync.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
