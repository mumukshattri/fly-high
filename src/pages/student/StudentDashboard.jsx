import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import Button from '../../components/Button';
import StatCard from '../../components/StatCard';
import DriveCard from '../../components/DriveCard';
import ProfileCard from '../../components/ProfileCard';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ApplyConfirmModal from '../../components/ApplyConfirmModal';
import { useCurrentStudent } from '../../hooks/useCurrentStudent';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import {
  getRecommendedDrives,
  getStudentApplications,
  getStudentDashboardStats,
} from '../../utils/selectors';
import { deadlineLabel } from '../../utils/format';

/**
 * pages/student/StudentDashboard.jsx
 * ===========================================================================
 * THE MAIN PAGE OF THE PROJECT - what the student sees after logging in.
 * ===========================================================================
 * Sections (top to bottom):
 *   1. Welcome banner            - "Welcome back, <name>"
 *   2. Placement summary         - 4 StatCards (eligible / applications / shortlisted / selected)
 *   3. Recommended drives        - open drives the student is eligible for
 *   4. Profile summary card       - with the calculated completion percentage
 *   5. Recent applications        - the latest statuses
 *
 * DATA FLOW (explain this in the viva):
 *   DataContext (all 5 collections)  ->  selector functions  ->  this JSX
 *
 * The page itself contains NO business rules. It asks utils/selectors.js for
 * numbers, and utils/eligibility.js decides who is eligible.
 */
export default function StudentDashboard() {
  const student = useCurrentStudent();
  const data = useData();
  const { loading, applyToDrive, saving } = data;
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [confirmDrive, setConfirmDrive] = useState(null);

  // useMemo keeps these calculations from re-running on every render
  // (for example when the confirmation modal opens).
  const dashboardStats = useMemo(
    () => getStudentDashboardStats(student, data),
    [student, data.drives, data.applications],
  );

  const recommendedDrives = useMemo(
    () => getRecommendedDrives(student, data, 4),
    [student, data.drives, data.applications, data.companies],
  );

  const myApplications = useMemo(
    () => getStudentApplications(student?.id, data).slice(0, 4),
    [student, data.applications, data.drives, data.companies],
  );

  // Which drives has this student already applied to? Used to disable Apply.
  const appliedDriveIds = useMemo(
    () => new Set(data.applications.filter((item) => item.studentId === student?.id).map((item) => item.driveId)),
    [data.applications, student],
  );

  if (loading || !student) {
    return <LoadingState text="Loading your dashboard..." />;
  }

  /** STEP 3 OF THE APPLY FLOW: the user confirmed inside the modal. */
  const handleConfirmApply = async () => {
    try {
      await applyToDrive({ studentId: student.id, driveId: confirmDrive.id });
      setConfirmDrive(null);
      showToast('Application submitted successfully.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
      setConfirmDrive(null);
    }
  };

  return (
    <>
      {/* ------------------------- 1. WELCOME SECTION ------------------------- */}
      <section className="welcome mb-24">
        <div className="welcome__text">
          <span className="welcome__eyebrow">Placement season 2026-27</span>
          <h1>Welcome back, {student.name}</h1>
          <p>Track your placement opportunities and applications from one place.</p>

          <div className="welcome__meta">
            <div className="welcome__meta-item">
              <span className="welcome__meta-value">{student.cgpa}</span>
              <span className="welcome__meta-label">CGPA</span>
            </div>
            <div className="welcome__meta-item">
              <span className="welcome__meta-value">{student.branch}</span>
              <span className="welcome__meta-label">Branch</span>
            </div>
            <div className="welcome__meta-item">
              <span className="welcome__meta-value">{dashboardStats.eligibleDrives}</span>
              <span className="welcome__meta-label">Eligible drives</span>
            </div>
            <div className="welcome__meta-item">
              <span className="welcome__meta-value">{dashboardStats.openDrives}</span>
              <span className="welcome__meta-label">Open drives</span>
            </div>
          </div>
        </div>

        <div className="welcome__action">
          <Button variant="outline" icon="briefcase" onClick={() => navigate('/student/drives')}>
            Browse all drives
          </Button>
        </div>
      </section>

      {/* ------------------------ 2. PLACEMENT SUMMARY ------------------------ */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Placement Summary</h2>
          <span className="section__hint">Updated automatically as companies update your status</span>
        </div>

        <div className="stats-grid">
          <StatCard
            label="Eligible Drives"
            value={dashboardStats.eligibleDrives}
            icon="target"
            tint="blue"
            foot={`out of ${dashboardStats.openDrives} open drives`}
          />
          <StatCard
            label="Applications"
            value={dashboardStats.applications}
            icon="file-text"
            tint="navy"
            foot="submitted by you"
          />
          <StatCard
            label="Shortlisted"
            value={dashboardStats.shortlisted}
            icon="star"
            tint="violet"
            foot="waiting for the interview round"
          />
          <StatCard
            label="Selected"
            value={dashboardStats.selected}
            icon="award"
            tint="green"
            foot="offers received"
          />
        </div>
      </section>

      {/* --------------------- 3. RECOMMENDED DRIVES + SIDE -------------------- */}
      <div className="two-column">
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Upcoming / Recommended Drives</h2>
            <Button variant="ghost" size="sm" iconRight="chevron-right" onClick={() => navigate('/student/drives')}>
              View all
            </Button>
          </div>

          {recommendedDrives.length === 0 ? (
            <EmptyState
              icon="briefcase"
              title="No new drives for you right now"
              text="Either you have already applied to every drive you are eligible for, or new drives have not been published yet."
            >
              <Button variant="outline" icon="briefcase" onClick={() => navigate('/student/applications')}>
                View my applications
              </Button>
            </EmptyState>
          ) : (
            <div className="grid grid-2">
              {recommendedDrives.map((drive) => (
                <DriveCard
                  key={drive.id}
                  drive={drive}
                  application={appliedDriveIds.has(drive.id) ? { id: 'already' } : null}
                  onView={(id) => navigate(`/student/drives/${id}`)}
                  onApply={setConfirmDrive}
                  applying={saving && confirmDrive?.id === drive.id}
                />
              ))}
            </div>
          )}
        </section>

        <div className="col gap-16">
          {/* --------------------- 4. PROFILE SUMMARY CARD --------------------- */}
          <ProfileCard student={student} onViewProfile={() => navigate('/student/profile')} />

          {/* ---------------------- 5. RECENT APPLICATIONS ---------------------- */}
          <section className="card card--pad">
            <div className="row-between mb-16">
              <h2 className="section__title">Recent Applications</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate('/student/applications')}>
                View all
              </Button>
            </div>

            {myApplications.length === 0 ? (
              <p className="text-sm muted">
                You have not applied to any drive yet. Browse the drives above and apply to your first one.
              </p>
            ) : (
              <div className="col">
                {myApplications.map((application) => (
                  <button
                    key={application.id}
                    type="button"
                    className="row-between"
                    style={{
                      background: 'transparent',
                      border: 0,
                      borderBottom: '1px solid var(--border)',
                      padding: '11px 0',
                      textAlign: 'left',
                      width: '100%',
                    }}
                    onClick={() => navigate(`/student/applications/${application.id}`)}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span className="strong text-sm" style={{ display: 'block' }}>
                        {application.companyName}
                      </span>
                      <span className="muted text-xs">{application.role}</span>
                    </span>
                    <StatusBadge status={application.status} withIcon={false} />
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ---------------------- Deadline watch card ---------------------- */}
          <section className="card card--pad">
            <div className="row gap-8 mb-16">
              <Icon name="clock" size={17} />
              <h2 className="section__title">Deadline Watch</h2>
            </div>
            {recommendedDrives.slice(0, 3).map((drive) => (
              <div className="mini-metric" key={drive.id}>
                <span className="mini-metric__label">
                  {drive.companyName} - {drive.role}
                </span>
                <span className="text-xs strong">{deadlineLabel(drive.deadline)}</span>
              </div>
            ))}
            {recommendedDrives.length === 0 ? (
              <p className="text-sm muted">No pending deadlines.</p>
            ) : null}
          </section>
        </div>
      </div>

      {/* STEP 2 OF THE APPLY FLOW: the confirmation modal */}
      {confirmDrive ? (
        <ApplyConfirmModal
          student={student}
          drive={confirmDrive}
          applying={saving}
          onConfirm={handleConfirmApply}
          onClose={() => setConfirmDrive(null)}
        />
      ) : null}
    </>
  );
}
