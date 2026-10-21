import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import Avatar from '../../components/Avatar';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { enrichApplication, getPlacementStatistics } from '../../utils/selectors';
import { formatDate } from '../../utils/format';

/**
 * pages/admin/AdminDashboard.jsx
 * ===========================================================================
 * PLACEMENT CELL DASHBOARD  (/admin/dashboard)
 * ===========================================================================
 * The admin does not apply or shortlist - their job is MONITORING. So this page
 * is all aggregates: totals, the status funnel, branch-wise placement and the
 * latest activity across the whole portal.
 *
 * Every number comes from `utils/selectors.getPlacementStatistics(state)`,
 * which is the frontend equivalent of a MongoDB aggregation pipeline
 * (the same function backs GET /api/admin/statistics).
 */
export default function AdminDashboard() {
  const { user } = useAuth();
  const data = useData();
  const { loading } = data;
  const navigate = useNavigate();

  const stats = useMemo(
    () => getPlacementStatistics(data),
    [data.students, data.companies, data.drives, data.applications],
  );

  const recentApplications = useMemo(
    () =>
      [...data.applications]
        .sort((a, b) => (a.lastUpdated < b.lastUpdated ? 1 : -1))
        .slice(0, 8)
        .map((application) => enrichApplication(application, data)),
    [data],
  );

  if (loading) return <LoadingState text="Loading placement dashboard..." />;

  return (
    <>
      <PageHeader
        title="Placement Dashboard"
        subtitle={`${user?.designation || 'Administrator'} - monitoring ${stats.totalStudents} students, ${stats.totalCompanies} companies and ${stats.totalDrives} drives.`}
      >
        <Button variant="outline" icon="bar-chart" onClick={() => navigate('/admin/statistics')}>
          Statistics
        </Button>
        <Button variant="primary" icon="graduation" onClick={() => navigate('/admin/students')}>
          Students
        </Button>
      </PageHeader>

      {/* ------------------------------- KPI cards ------------------------------- */}
      <div className="grid grid-3 mb-24">
        <StatCard
          label="Total Students"
          value={stats.totalStudents}
          icon="graduation"
          tint="blue"
          foot={`${stats.placedStudents} placed so far`}
        />
        <StatCard
          label="Registered Companies"
          value={stats.totalCompanies}
          icon="building"
          tint="navy"
          foot={`${stats.totalDrives} drives published`}
        />
        <StatCard
          label="Active Drives"
          value={stats.activeDrives}
          icon="briefcase"
          tint="violet"
          foot="accepting applications"
        />
        <StatCard
          label="Applications"
          value={stats.totalApplications}
          icon="file-text"
          tint="blue"
          foot="submitted by students"
        />
        <StatCard
          label="Shortlisted"
          value={stats.shortlisted}
          icon="star"
          tint="amber"
          foot="moved to the interview round"
        />
        <StatCard
          label="Selected"
          value={stats.selected}
          icon="award"
          tint="green"
          foot="offers released"
        />
      </div>

      <div className="two-column">
        <div className="col gap-16">
          {/* ---------------------------- recent activity ---------------------------- */}
          <section className="card card--flush">
            <div className="card__header">
              <div>
                <div className="card__title">Recent Application Activity</div>
                <div className="card__subtitle">Latest status changes across the portal</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                iconRight="chevron-right"
                onClick={() => navigate('/admin/applications')}
              >
                View all
              </Button>
            </div>

            {recentApplications.length === 0 ? (
              <div style={{ padding: 20 }}>
                <EmptyState
                  icon="file-text"
                  title="No applications yet"
                  text="Applications will appear here as students apply."
                />
              </div>
            ) : (
              <div className="table-wrap table-wrap--flush">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Company</th>
                      <th>Role</th>
                      <th>Last Updated</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentApplications.map((application) => (
                      <tr key={application.id}>
                        <td>
                          <div className="row gap-8">
                            <Avatar name={application.studentName} size="sm" />
                            <div>
                              <div className="cell-primary">{application.studentName}</div>
                              <div className="cell-sub">
                                {application.student?.branch} &middot; CGPA {application.student?.cgpa}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="strong">{application.companyName}</td>
                        <td className="muted">{application.role}</td>
                        <td className="nowrap muted">{formatDate(application.lastUpdated)}</td>
                        <td>
                          <StatusBadge status={application.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* --------------------------- company-wise table --------------------------- */}
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
                    <th>Drives</th>
                    <th>Applications</th>
                    <th>Shortlisted</th>
                    <th>Selected</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.companyWise.map((row) => (
                    <tr key={row.company.id}>
                      <td>
                        <div className="row gap-8">
                          <Avatar name={row.company.name} size="sm" square />
                          <div>
                            <div className="cell-primary">{row.company.name}</div>
                            <div className="cell-sub">{row.company.tier}</div>
                          </div>
                        </div>
                      </td>
                      <td>{row.drives}</td>
                      <td className="strong">{row.applications}</td>
                      <td>{row.shortlisted}</td>
                      <td>
                        <span className="badge badge--success">{row.selected}</span>
                      </td>
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
            <h2 className="section__title mb-16">Application Status Funnel</h2>
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
            <p className="text-xs soft mt-12">
              {stats.totalApplications > 0
                ? `${stats.placementRate}% of registered students have at least one offer, and ${stats.selected} offers have been released.`
                : 'No applications recorded yet.'}
            </p>
          </section>

          {/* ---------------------------- branch-wise ---------------------------- */}
          <section className="card card--pad">
            <h2 className="section__title mb-16">Branch-wise Placement</h2>
            <div className="bar-chart">
              {stats.branchWise.map((row) => (
                <div className="bar-chart__row" key={row.branch}>
                  <span className="bar-chart__label">{row.branch}</span>
                  <span className="bar-chart__track">
                    <span className="bar-chart__fill" style={{ width: `${row.rate}%` }} />
                  </span>
                  <span className="bar-chart__value">
                    {row.placed}/{row.students}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* ---------------------------- key metrics ---------------------------- */}
          <section className="card card--pad">
            <h2 className="section__title mb-16">Key Metrics</h2>
            <div className="mini-metric">
              <span className="mini-metric__label">Average CGPA</span>
              <span className="mini-metric__value">{stats.averageCgpa}</span>
            </div>
            <div className="mini-metric">
              <span className="mini-metric__label">Highest package</span>
              <span className="mini-metric__value">{stats.highestPackage}</span>
            </div>
            <div className="mini-metric">
              <span className="mini-metric__label">Average package</span>
              <span className="mini-metric__value">{stats.averagePackage}</span>
            </div>
            <div className="mini-metric">
              <span className="mini-metric__label">Applications / student</span>
              <span className="mini-metric__value">
                {stats.totalStudents ? (stats.totalApplications / stats.totalStudents).toFixed(1) : '0.0'}
              </span>
            </div>
            <div className="mini-metric">
              <span className="mini-metric__label">Pending review</span>
              <span className="mini-metric__value">{stats.applied + stats.underReview}</span>
            </div>
          </section>

          <div className="inline-note">
            <Icon name="info" size={16} />
            <span>
              Demo data is stored in the browser. Use <strong>Reset demo data</strong> in the sidebar to
              restore the original records.
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
