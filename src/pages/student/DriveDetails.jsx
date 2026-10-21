import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import Button from '../../components/Button';
import StatusBadge from '../../components/StatusBadge';
import EligibilityPanel from '../../components/EligibilityPanel';
import ApplyConfirmModal from '../../components/ApplyConfirmModal';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import { useCurrentStudent } from '../../hooks/useCurrentStudent';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { checkEligibility } from '../../utils/eligibility';
import { enrichDrive } from '../../utils/selectors';
import { formatDate, deadlineLabel, daysUntil, initials } from '../../utils/format';

/**
 * pages/student/DriveDetails.jsx
 * ===========================================================================
 * RECRUITMENT DRIVE DETAILS  (/student/drives/:driveId)
 * ===========================================================================
 * Shows the full job description AND the eligibility result.
 *
 * HOW THE URL PARAMETER IS READ:
 *   <Route path="drives/:driveId" ... />   (in App.jsx)
 *   const { driveId } = useParams();       (here)  -> 'drv-01'
 *
 * The page then:
 *   1. finds the drive in DataContext
 *   2. attaches the company (utils/selectors.enrichDrive)
 *   3. runs utils/eligibility.checkEligibility(student, drive)
 *   4. renders either [Apply Now] or a disabled [Not Eligible] button
 *      together with the exact reason from the eligibility checks.
 */
export default function DriveDetails() {
  const { driveId } = useParams();
  const navigate = useNavigate();
  const student = useCurrentStudent();
  const data = useData();
  const { loading, saving, applyToDrive } = data;
  const { showToast } = useToast();
  const [showConfirm, setShowConfirm] = useState(false);

  const drive = useMemo(() => {
    const found = data.drives.find((item) => item.id === driveId);
    if (!found) return null;

    return {
      ...enrichDrive(found, data.companies),
      eligibility: checkEligibility(student, found),
    };
  }, [data.drives, data.companies, driveId, student]);

  // Has this student already applied for this drive?
  const application = useMemo(
    () => data.applications.find((item) => item.studentId === student?.id && item.driveId === driveId) || null,
    [data.applications, student, driveId],
  );

  if (loading) return <LoadingState text="Loading drive details..." />;

  if (!drive) {
    return (
      <EmptyState
        icon="alert-triangle"
        title="Drive not found"
        text="This recruitment drive may have been removed by the company."
      >
        <Button variant="outline" icon="arrow-left" onClick={() => navigate('/student/drives')}>
          Back to drives
        </Button>
      </EmptyState>
    );
  }

  const isEligible = drive.eligibility.eligible;
  const deadlinePassed = daysUntil(drive.deadline) < 0;

  /** STEP 3 OF THE APPLY FLOW. */
  const handleConfirmApply = async () => {
    try {
      await applyToDrive({ studentId: student.id, driveId: drive.id });
      setShowConfirm(false);
      showToast('Application submitted successfully.', 'success');
    } catch (error) {
      setShowConfirm(false);
      showToast(error.message, 'error');
    }
  };

  return (
    <>
      {/* Back link + header */}
      <button
        type="button"
        className="btn btn--ghost btn--sm mb-16"
        onClick={() => navigate('/student/drives')}
      >
        <Icon name="arrow-left" size={15} />
        Back to all drives
      </button>

      <header className="card card--pad mb-24">
        <div className="company-header">
          <div className="drive-card__logo" style={{ width: 64, height: 64, fontSize: '1.25rem' }}>
            {initials(drive.companyName)}
          </div>

          <div className="grow" style={{ minWidth: 220 }}>
            <div className="row gap-8 wrap">
              <h1 style={{ fontSize: '1.375rem' }}>{drive.role}</h1>
              <StatusBadge status={drive.status} />
              {drive.tier ? <span className="badge badge--violet">{drive.tier}</span> : null}
            </div>
            <p className="muted text-sm mt-4">
              {drive.companyName} &middot; {drive.location} &middot; {drive.jobType}
            </p>
            <div className="row gap-16 wrap mt-12">
              <span className="row gap-4 text-xs muted">
                <Icon name="map-pin" size={13} /> {drive.location}
              </span>
              <span className="row gap-4 text-xs muted">
                <Icon name="award" size={13} /> {drive.package}
              </span>
              <span className="row gap-4 text-xs muted">
                <Icon name="users" size={13} /> {drive.openings} openings
              </span>
              <span className="row gap-4 text-xs muted">
                <Icon name="calendar" size={13} /> Drive on {formatDate(drive.driveDate)}
              </span>
            </div>
          </div>

          <div className="text-right" style={{ flexShrink: 0 }}>
            <div className="detail-list__label">Application Deadline</div>
            <div className="strong">{formatDate(drive.deadline)}</div>
            <span
              className={`deadline-pill ${
                daysUntil(drive.deadline) < 0 ? 'deadline-pill--over' : 'deadline-pill--soon'
              }`}
            >
              {deadlineLabel(drive.deadline)}
            </span>
          </div>
        </div>
      </header>

      <div className="detail-layout">
        {/* ------------------------------- left column ------------------------------- */}
        <div className="col gap-16">
          <section className="card card--pad">
            <h2 className="section__title mb-8">Job Description</h2>
            <p className="text-sm muted">{drive.description}</p>

            {drive.responsibilities?.length ? (
              <>
                <h3 className="section__title mt-24 mb-8">What you will do</h3>
                <ul className="bullet-list">
                  {drive.responsibilities.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {drive.selectionProcess?.length ? (
              <>
                <h3 className="section__title mt-24 mb-8">Selection Process</h3>
                <ol className="bullet-list">
                  {drive.selectionProcess.map((step, index) => (
                    <li key={step}>
                      <strong className="strong">Round {index + 1}:</strong> {step}
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
          </section>

          <section className="card card--pad">
            <h2 className="section__title mb-16">Requirements</h2>
            <div className="detail-list">
              <div className="detail-list__item">
                <div className="detail-list__label">Minimum CGPA</div>
                <div className="detail-list__value">{drive.minimumCGPA}+</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Eligible Branches</div>
                <div className="detail-list__value">{drive.branches.join(' / ')}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Required Skills</div>
                <div className="detail-list__value">{drive.requiredSkills.join(', ')}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Skill Match</div>
                <div className="detail-list__value">
                  {drive.skillMatchMode === 'all' ? 'All skills required' : 'Any one skill required'}
                </div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Job Type</div>
                <div className="detail-list__value">{drive.jobType}</div>
              </div>
              <div className="detail-list__item">
                <div className="detail-list__label">Openings</div>
                <div className="detail-list__value">{drive.openings}</div>
              </div>
              {drive.stipend ? (
                <div className="detail-list__item">
                  <div className="detail-list__label">Stipend</div>
                  <div className="detail-list__value">{drive.stipend}</div>
                </div>
              ) : null}
              <div className="detail-list__item">
                <div className="detail-list__label">Posted On</div>
                <div className="detail-list__value">{formatDate(drive.postedOn)}</div>
              </div>
            </div>
          </section>

          {drive.company ? (
            <section className="card card--pad">
              <h2 className="section__title mb-16">About {drive.company.name}</h2>
              <p className="text-sm muted">{drive.company.about}</p>
              <div className="detail-list mt-16">
                <div className="detail-list__item">
                  <div className="detail-list__label">Industry</div>
                  <div className="detail-list__value">{drive.company.industry}</div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">Company Size</div>
                  <div className="detail-list__value">{drive.company.size}</div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">HR Contact</div>
                  <div className="detail-list__value">{drive.company.hrName}</div>
                </div>
                <div className="detail-list__item">
                  <div className="detail-list__label">Website</div>
                  <div className="detail-list__value">{drive.company.website}</div>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        {/* ------------------------------- right column ------------------------------ */}
        <div className="col gap-16">
          {/* The core feature: the eligibility breakdown */}
          <EligibilityPanel eligibility={drive.eligibility} title="Eligibility" />

          {/* Application status / Apply CTA */}
          <section className="card card--pad">
            <h2 className="section__title mb-16">Application</h2>

            {application ? (
              <>
                <div className="row-between mb-16">
                  <span className="text-sm muted">Your status</span>
                  <StatusBadge status={application.status} />
                </div>
                <div className="summary-list mb-16">
                  <div className="summary-list__item">
                    <span className="summary-list__label">Applied on</span>
                    <span className="summary-list__value">{formatDate(application.appliedOn)}</span>
                  </div>
                  <div className="summary-list__item">
                    <span className="summary-list__label">Last updated</span>
                    <span className="summary-list__value">{formatDate(application.lastUpdated)}</span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  fullWidth
                  icon="file-text"
                  onClick={() => navigate(`/student/applications/${application.id}`)}
                >
                  Track Application
                </Button>
              </>
            ) : isEligible && !deadlinePassed ? (
              <>
                <div className="inline-note inline-note--success mb-16">
                  <Icon name="check-circle" size={16} />
                  <span>You meet all the requirements for this drive.</span>
                </div>
                <Button variant="primary" fullWidth icon="send" onClick={() => setShowConfirm(true)}>
                  Apply Now
                </Button>
              </>
            ) : (
              <>
                <div className="inline-note inline-note--warning mb-16">
                  <Icon name="alert-circle" size={16} />
                  <span>
                    {!isEligible
                      ? drive.eligibility.reasons[0]
                      : 'The deadline has passed, so applications are closed.'}
                  </span>
                </div>
                <Button variant="outline" fullWidth icon="x" disabled>
                  Not Eligible
                </Button>
              </>
            )}

            <p className="text-xs soft mt-12">
              Applications are verified on the server too, so an ineligible application cannot be
              submitted even if the page is modified.
            </p>
          </section>

          <section className="card card--pad">
            <h2 className="section__title mb-8">Your Profile Snapshot</h2>
            <div className="mini-metric">
              <span className="mini-metric__label">Branch</span>
              <span className="mini-metric__value">{student?.branch}</span>
            </div>
            <div className="mini-metric">
              <span className="mini-metric__label">CGPA</span>
              <span className="mini-metric__value">{student?.cgpa}</span>
            </div>
            <div className="mini-metric">
              <span className="mini-metric__label">Skills</span>
              <span className="mini-metric__value text-xs" style={{ maxWidth: 160, textAlign: 'right' }}>
                {(student?.skills || []).join(', ')}
              </span>
            </div>
            <Button variant="ghost" size="sm" iconRight="chevron-right" onClick={() => navigate('/student/profile')}>
              Update profile
            </Button>
          </section>
        </div>
      </div>

      {showConfirm ? (
        <ApplyConfirmModal
          student={student}
          drive={drive}
          applying={saving}
          onConfirm={handleConfirmApply}
          onClose={() => setShowConfirm(false)}
        />
      ) : null}
    </>
  );
}
