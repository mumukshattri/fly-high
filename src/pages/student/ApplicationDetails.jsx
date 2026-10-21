import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import Button from '../../components/Button';
import StatusBadge from '../../components/StatusBadge';
import StatusTimeline from '../../components/StatusTimeline';
import EligibilityPanel from '../../components/EligibilityPanel';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import { useCurrentStudent } from '../../hooks/useCurrentStudent';
import { useData } from '../../context/DataContext';
import { checkEligibility } from '../../utils/eligibility';
import { enrichApplication } from '../../utils/selectors';
import { formatDate, initials } from '../../utils/format';

/**
 * pages/student/ApplicationDetails.jsx
 * ===========================================================================
 * APPLICATION DETAILS  (/student/applications/:applicationId)
 * ===========================================================================
 * The second core screen of the student workflow. It answers:
 *   "Where has my application reached in the hiring process?"
 *
 * Layout
 *   left  : the PROGRESS TRACKER (StatusTimeline) + additional information
 *   right : drive summary, company details and the eligibility result
 *
 * The tracker is driven by `application.statusHistory`, the audit trail that
 * `applicationService.updateApplicationStatus()` appends to whenever a company
 * changes a status. That is why the dates and remarks are real values.
 */
export default function ApplicationDetails() {
  const { applicationId } = useParams();
  const navigate = useNavigate();
  const student = useCurrentStudent();
  const data = useData();
  const { loading } = data;

  const application = useMemo(() => {
    const found = data.applications.find((item) => item.id === applicationId);
    if (!found) return null;
    return enrichApplication(found, data);
  }, [data, applicationId]);

  // Re-run the eligibility rules for this drive so the page can show the
  // student's eligibility alongside the application.
  const eligibility = useMemo(() => {
    if (!application?.drive || !student) return null;
    return checkEligibility(student, application.drive);
  }, [application, student]);

  if (loading) return <LoadingState text="Loading application..." />;

  if (!application) {
    return (
      <EmptyState
        icon="alert-circle"
        title="Application not found"
        text="This application does not exist, or it does not belong to your account."
      >
        <Button variant="outline" icon="arrow-left" onClick={() => navigate('/student/applications')}>
          Back to my applications
        </Button>
      </EmptyState>
    );
  }

  const { drive, company } = application;

  return (
    <>
      <button
        type="button"
        className="btn btn--ghost btn--sm mb-16"
        onClick={() => navigate('/student/applications')}
      >
        <Icon name="arrow-left" size={15} />
        Back to my applications
      </button>

      {/* --------------------------------- header --------------------------------- */}
      <header className="card card--pad mb-24">
        <div className="company-header">
          <div className="drive-card__logo" style={{ width: 60, height: 60, fontSize: '1.125rem' }}>
            {initials(application.companyName)}
          </div>

          <div className="grow" style={{ minWidth: 220 }}>
            <div className="row gap-8 wrap">
              <h1 style={{ fontSize: '1.25rem' }}>{application.role}</h1>
              <StatusBadge status={application.status} />
            </div>
            <p className="muted text-sm mt-4">
              {application.companyName} &middot; Application ID <span className="mono">{application.id}</span>
            </p>
            <div className="row gap-16 wrap mt-12">
              <span className="row gap-4 text-xs muted">
                <Icon name="calendar" size={13} /> Applied on {formatDate(application.appliedOn)}
              </span>
              <span className="row gap-4 text-xs muted">
                <Icon name="refresh" size={13} /> Last updated {formatDate(application.lastUpdated)}
              </span>
              {drive ? (
                <span className="row gap-4 text-xs muted">
                  <Icon name="award" size={13} /> {drive.package}
                </span>
              ) : null}
            </div>
          </div>

          {drive ? (
            <Button variant="outline" icon="briefcase" onClick={() => navigate(`/student/drives/${drive.id}`)}>
              View drive
            </Button>
          ) : null}
        </div>
      </header>

      <div className="detail-layout">
        {/* ------------------------------ left column ------------------------------ */}
        <div className="col gap-16">
          <section className="card card--pad">
            <div className="row-between mb-16">
              <h2 className="section__title">Application Progress</h2>
              <span className="section__hint">Applied &rarr; Under Review &rarr; Shortlisted &rarr; Selected</span>
            </div>

            <StatusTimeline application={application} />
          </section>

          <section className="card card--pad">
            <h2 className="section__title mb-8">Detailed Status History</h2>
            <p className="text-sm muted mb-16">
              Every change made by the recruiter is recorded, so you always know when your
              application moved forward.
            </p>

            <div className="summary-list">
              <div className="summary-list__item">
                <span className="summary-list__label">Application date</span>
                <span className="summary-list__value">{formatDate(application.appliedOn)}</span>
              </div>
              <div className="summary-list__item">
                <span className="summary-list__label">Last updated</span>
                <span className="summary-list__value">{formatDate(application.lastUpdated)}</span>
              </div>
              <div className="summary-list__item">
                <span className="summary-list__label">Status changes</span>
                <span className="summary-list__value">{application.statusHistory.length}</span>
              </div>
              <div className="summary-list__item">
                <span className="summary-list__label">Source</span>
                <span className="summary-list__value">Campus recruitment drive</span>
              </div>
              <div className="summary-list__item">
                <span className="summary-list__label">Resume shared</span>
                <span className="summary-list__value">{student?.resume?.fileName || 'Not uploaded'}</span>
              </div>
            </div>
          </section>

          <section className="card card--pad">
            <h2 className="section__title mb-8">Additional Information</h2>
            {application.recruiterNote ? (
              <div className="inline-note mb-16">
                <Icon name="info" size={16} />
                <span>
                  <strong>Recruiter note:</strong> {application.recruiterNote}
                </span>
              </div>
            ) : (
              <p className="text-sm muted mb-16">
                The recruiter has not added a remark for this application yet.
              </p>
            )}

            <ul className="bullet-list">
              <li>Shortlisted candidates are contacted by the placement cell on their registered email.</li>
              <li>Keep your resume and skills updated so recruiters see your latest profile.</li>
              <li>You can apply to other drives while this application is in progress.</li>
            </ul>
          </section>
        </div>

        {/* ------------------------------ right column ----------------------------- */}
        <div className="col gap-16">
          {drive ? (
            <section className="card card--pad">
              <h2 className="section__title mb-16">Drive Summary</h2>
              <div className="mini-metric">
                <span className="mini-metric__label">Company</span>
                <span className="mini-metric__value">{application.companyName}</span>
              </div>
              <div className="mini-metric">
                <span className="mini-metric__label">Role</span>
                <span className="mini-metric__value">{drive.role}</span>
              </div>
              <div className="mini-metric">
                <span className="mini-metric__label">Job type</span>
                <span className="mini-metric__value">{drive.jobType}</span>
              </div>
              <div className="mini-metric">
                <span className="mini-metric__label">Package</span>
                <span className="mini-metric__value">{drive.package}</span>
              </div>
              <div className="mini-metric">
                <span className="mini-metric__label">Location</span>
                <span className="mini-metric__value">{drive.location}</span>
              </div>
              <div className="mini-metric">
                <span className="mini-metric__label">Drive date</span>
                <span className="mini-metric__value">{formatDate(drive.driveDate)}</span>
              </div>
            </section>
          ) : null}

          <EligibilityPanel eligibility={eligibility} title="Eligibility at the time of applying" />

          {company ? (
            <section className="card card--pad">
              <h2 className="section__title mb-16">Recruiter Contact</h2>
              <div className="row gap-12">
                <div className="stat-card__icon tint-blue">
                  <Icon name="user" size={18} />
                </div>
                <div>
                  <div className="strong text-sm">{company.hrName}</div>
                  <div className="text-xs muted">{company.hrEmail}</div>
                </div>
              </div>
              <div className="detail-list mt-16">
                <div className="detail-list__item">
                  <div className="detail-list__label">Phone</div>
                  <div className="detail-list__value">{company.hrPhone}</div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">Industry</div>
                  <div className="detail-list__value">{company.industry}</div>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
