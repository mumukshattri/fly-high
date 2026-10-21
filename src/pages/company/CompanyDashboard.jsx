import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import Avatar from '../../components/Avatar';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import DriveFormModal from '../../components/DriveFormModal';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { getCompanyApplications, getCompanyDrives } from '../../utils/selectors';
import { formatDate, deadlineLabel } from '../../utils/format';
import { PIPELINE_STAGES } from '../../data/mockApplications';

/**
 * pages/company/CompanyDashboard.jsx
 * ===========================================================================
 * RECRUITER DASHBOARD  (/company/dashboard)
 * ===========================================================================
 * Shows the recruiter their own hiring activity only - every query is filtered
 * by `company.id`, which is the company counterpart of the student's personal
 * dashboard.
 *
 * Cards: Active Drives | Total Applicants | Shortlisted | Selected
 * Plus the hiring funnel and the most recent applicants, where the recruiter
 * can shortlist or reject directly (PATCH /api/applications/:id).
 */
export default function CompanyDashboard() {
  const company = useCurrentCompany();
  const data = useData();
  const { loading, saving, createDrive, updateApplicationStatus } = data;
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [showCreateForm, setShowCreateForm] = useState(false);

  const drives = useMemo(
    () => (company ? getCompanyDrives(company.id, data) : []),
    [company, data.drives, data.applications],
  );

  const applications = useMemo(
    () => (company ? getCompanyApplications(company.id, data) : []),
    [company, data.drives, data.applications, data.students],
  );

  const stats = useMemo(() => {
    const countBy = (status) => applications.filter((item) => item.status === status).length;
    return {
      activeDrives: drives.filter((drive) => drive.status === 'Open').length,
      totalApplicants: applications.length,
      shortlisted: countBy('Shortlisted'),
      selected: countBy('Selected'),
      rejected: countBy('Rejected'),
      underReview: countBy('Under Review'),
      applied: countBy('Applied'),
    };
  }, [drives, applications]);

  const recentApplicants = useMemo(() => applications.slice(0, 6), [applications]);

  if (loading || !company) return <LoadingState text="Loading recruiter dashboard..." />;

  /** PATCH /api/applications/:id - shortlist / reject / select */
  const handleStatusChange = async (application, status) => {
    try {
      await updateApplicationStatus({ applicationId: application.id, status });
      showToast(`${application.studentName} marked as ${status}.`, 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  /** POST /api/drives */
  const handleCreateDrive = async (payload) => {
    try {
      await createDrive(payload);
      setShowCreateForm(false);
      showToast('Recruitment drive published successfully.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  return (
    <>
      <PageHeader
        title={`Welcome, ${company.name}`}
        subtitle={`${company.industry} - ${company.location}. Manage your campus hiring from here.`}
      >
        <Button variant="outline" icon="users" onClick={() => navigate('/company/applicants')}>
          View applicants
        </Button>
        <Button variant="primary" icon="plus" onClick={() => setShowCreateForm(true)}>
          Create Drive
        </Button>
      </PageHeader>

      {/* ------------------------------- KPI cards ------------------------------- */}
      <div className="stats-grid mb-24">
        <StatCard label="Active Drives" value={stats.activeDrives} icon="briefcase" tint="blue" foot={`${drives.length} total drives`} />
        <StatCard label="Total Applicants" value={stats.totalApplicants} icon="users" tint="navy" foot="across all drives" />
        <StatCard label="Shortlisted" value={stats.shortlisted} icon="star" tint="violet" foot="moved to interview round" />
        <StatCard label="Selected" value={stats.selected} icon="award" tint="green" foot="offers released" />
      </div>

      <div className="two-column">
        <div className="col gap-16">
          {/* ------------------------------ my drives ------------------------------ */}
          <section className="card card--flush">
            <div className="card__header">
              <div>
                <div className="card__title">My Recruitment Drives</div>
                <div className="card__subtitle">Drives you published to the campus</div>
              </div>
              <Button variant="outline" size="sm" icon="plus" onClick={() => setShowCreateForm(true)}>
                New Drive
              </Button>
            </div>

            {drives.length === 0 ? (
              <div style={{ padding: 20 }}>
                <EmptyState
                  icon="briefcase"
                  title="You have not published a drive yet"
                  text="Create your first recruitment drive so eligible students can apply."
                >
                  <Button variant="primary" icon="plus" onClick={() => setShowCreateForm(true)}>
                    Create Drive
                  </Button>
                </EmptyState>
              </div>
            ) : (
              <div className="table-wrap table-wrap--flush">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Deadline</th>
                      <th>Applicants</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drives.slice(0, 6).map((drive) => (
                      <tr key={drive.id}>
                        <td>
                          <div className="cell-primary">{drive.role}</div>
                          <div className="cell-sub">
                            {drive.branches.join(' / ')} &middot; CGPA {drive.minimumCGPA}+
                          </div>
                        </td>
                        <td className="nowrap">
                          <div>{formatDate(drive.deadline)}</div>
                          <div className="cell-sub">{deadlineLabel(drive.deadline)}</div>
                        </td>
                        <td>
                          <span className="strong">{drive.applicantCount}</span>
                          <span className="cell-sub"> applicants</span>
                        </td>
                        <td>
                          <StatusBadge status={drive.status} />
                        </td>
                        <td>
                          <div className="data-table__actions">
                            <Button
                              variant="outline"
                              size="sm"
                              icon="users"
                              onClick={() => navigate('/company/applicants')}
                            >
                              Applicants
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* --------------------------- recent applicants --------------------------- */}
          <section className="card card--flush">
            <div className="card__header">
              <div>
                <div className="card__title">Recent Applicants</div>
                <div className="card__subtitle">Shortlist or reject directly from here</div>
              </div>
              <Button variant="ghost" size="sm" iconRight="chevron-right" onClick={() => navigate('/company/applicants')}>
                View all
              </Button>
            </div>

            {recentApplicants.length === 0 ? (
              <div style={{ padding: 20 }}>
                <EmptyState
                  icon="users"
                  title="No applications yet"
                  text="Once eligible students apply to your drives, they will appear here."
                />
              </div>
            ) : (
              <div className="table-wrap table-wrap--flush">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Role</th>
                      <th>CGPA</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentApplicants.map((application) => (
                      <tr key={application.id}>
                        <td>
                          <div className="row gap-8">
                            <Avatar name={application.studentName} size="sm" />
                            <div>
                              <div className="cell-primary">{application.studentName}</div>
                              <div className="cell-sub">
                                {application.student?.branch} &middot; {application.student?.rollNumber}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="muted">{application.role}</td>
                        <td className="strong">{application.student?.cgpa}</td>
                        <td>
                          <StatusBadge status={application.status} />
                        </td>
                        <td>
                          <div className="data-table__actions">
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
          </section>
        </div>

        <div className="col gap-16">
          {/* ---------------------------- hiring funnel ---------------------------- */}
          <section className="card card--pad">
            <h2 className="section__title mb-16">Hiring Funnel</h2>
            <div className="bar-chart">
              {[...PIPELINE_STAGES, 'Rejected'].map((stage) => {
                const count = applications.filter((item) => item.status === stage).length;
                const percent = applications.length ? Math.round((count / applications.length) * 100) : 0;
                return (
                  <div className="bar-chart__row" key={stage}>
                    <span className="bar-chart__label">{stage}</span>
                    <span className="bar-chart__track">
                      <span className="bar-chart__fill" style={{ width: `${percent}%` }} />
                    </span>
                    <span className="bar-chart__value">{count}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* --------------------------- company profile --------------------------- */}
          <section className="card card--pad">
            <div className="row gap-12 mb-16">
              <div className="stat-card__icon tint-navy">
                <Icon name="building" size={18} />
              </div>
              <div>
                <div className="strong">{company.name}</div>
                <div className="text-xs muted">
                  {company.tier} tier {company.verified ? '· verified' : '· pending verification'}
                </div>
              </div>
            </div>

            <div className="mini-metric">
              <span className="mini-metric__label">HR Contact</span>
              <span className="mini-metric__value">{company.hrName}</span>
            </div>
            <div className="mini-metric">
              <span className="mini-metric__label">Email</span>
              <span className="mini-metric__value text-xs">{company.hrEmail}</span>
            </div>
            <div className="mini-metric">
              <span className="mini-metric__label">Industry</span>
              <span className="mini-metric__value text-xs">{company.industry}</span>
            </div>
            <div className="mini-metric">
              <span className="mini-metric__label">Location</span>
              <span className="mini-metric__value text-xs">{company.location}</span>
            </div>
            <div className="mini-metric">
              <span className="mini-metric__label">Registered on</span>
              <span className="mini-metric__value text-xs">{formatDate(company.registeredOn)}</span>
            </div>
          </section>

          <section className="card card--pad">
            <h2 className="section__title mb-8">Applicant Review Guide</h2>
            <ul className="bullet-list">
              <li>Applied &rarr; Under Review &rarr; Shortlisted &rarr; Selected</li>
              <li>Every change is recorded and the student is notified automatically.</li>
              <li>Use "View Profile" to see skills and academic details before deciding.</li>
            </ul>
          </section>
        </div>
      </div>

      {showCreateForm ? (
        <DriveFormModal
          company={company}
          saving={saving}
          onClose={() => setShowCreateForm(false)}
          onCreate={handleCreateDrive}
        />
      ) : null}
    </>
  );
}
