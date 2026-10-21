import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import StatusBadge from '../../components/StatusBadge';
import SearchBar from '../../components/SearchBar';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import DriveFormModal from '../../components/DriveFormModal';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { getCompanyDrives } from '../../utils/selectors';
import { formatDate, deadlineLabel } from '../../utils/format';

/**
 * pages/company/CompanyDrives.jsx
 * ===========================================================================
 * RECRUITMENT DRIVES (recruiter side)  (/company/drives)
 * ===========================================================================
 *   POST  /api/drives          -> the "Create Drive" form (DriveFormModal)
 *   PATCH /api/drives/:id      -> "Close Drive"
 *
 * A recruiter defines the eligibility rules here, and those rules instantly
 * decide which students see an "Eligible" badge on the student side. That is
 * the clearest demonstration of the workflow in the whole project.
 */
export default function CompanyDrives() {
  const company = useCurrentCompany();
  const data = useData();
  const { loading, saving, createDrive, closeDrive } = data;
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [search, setSearch] = useState(searchParams.get('q') || '');

  const drives = useMemo(
    () => (company ? getCompanyDrives(company.id, data) : []),
    [company, data.drives, data.applications],
  );

  const visibleDrives = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return drives;
    return drives.filter((drive) => `${drive.role} ${drive.location}`.toLowerCase().includes(term));
  }, [drives, search]);

  if (loading || !company) return <LoadingState text="Loading your drives..." />;

  const handleCreateDrive = async (payload) => {
    try {
      await createDrive(payload);
      setShowCreateForm(false);
      showToast('Recruitment drive published successfully.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  const handleCloseDrive = async (drive) => {
    try {
      await closeDrive(drive.id);
      showToast(`${drive.role} is now closed for applications.`, 'info');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  return (
    <>
      <PageHeader
        title="Recruitment Drives"
        subtitle="Create a drive, define its eligibility rules, and manage who can apply."
      >
        <Button variant="primary" icon="plus" onClick={() => setShowCreateForm(true)}>
          Create Drive
        </Button>
      </PageHeader>

      {/* ------------------------------ toolbar ------------------------------ */}
      <div className="filter-bar">
        <div className="filter-bar__row">
          <SearchBar value={search} onChange={setSearch} placeholder="Search your drives by role or location..." />
          <span className="badge badge--neutral">{drives.length} drives</span>
        </div>
      </div>

      {visibleDrives.length === 0 ? (
        <EmptyState
          icon="briefcase"
          title={drives.length === 0 ? 'No drives published yet' : 'No drives match your search'}
          text={
            drives.length === 0
              ? 'Publish your first recruitment drive. Students who satisfy the eligibility rules will be able to apply immediately.'
              : 'Try a different search term.'
          }
        >
          <Button variant="primary" icon="plus" onClick={() => setShowCreateForm(true)}>
            Create Drive
          </Button>
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job Role</th>
                <th>Eligibility Rules</th>
                <th>Deadline</th>
                <th>Applicants</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleDrives.map((drive) => (
                <tr key={drive.id}>
                  <td>
                    <div className="cell-primary">{drive.role}</div>
                    <div className="cell-sub">
                      {drive.jobType} &middot; {drive.package}
                    </div>
                  </td>
                  <td>
                    <div className="text-sm">
                      CGPA <strong>{drive.minimumCGPA}+</strong>
                    </div>
                    <div className="cell-sub">{drive.branches.join(' / ')}</div>
                    <div className="applicant-skills mt-4">
                      {drive.requiredSkills.map((skill) => (
                        <span className="chip chip--neutral" key={skill}>
                          {skill}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="nowrap">
                    <div>{formatDate(drive.deadline)}</div>
                    <div className="cell-sub">{deadlineLabel(drive.deadline)}</div>
                  </td>
                  <td>
                    <span className="strong">{drive.applicantCount}</span>
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
                      <Button
                        variant="danger-outline"
                        size="sm"
                        icon="lock"
                        disabled={saving || drive.status === 'Closed'}
                        onClick={() => handleCloseDrive(drive)}
                      >
                        Close
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* --------------------- how the eligibility rules work --------------------- */}
      <section className="card card--pad mt-24">
        <div className="row gap-8 mb-8">
          <Icon name="info" size={17} />
          <h2 className="section__title">How your rules are applied</h2>
        </div>
        <ul className="bullet-list">
          <li>
            <strong>Minimum CGPA</strong> and <strong>Eligible branches</strong> are hard filters - a
            student who fails either one can never apply.
          </li>
          <li>
            <strong>Required skills</strong> follow the matching rule you selected ("any one" or
            "all").
          </li>
          <li>
            <strong>Deadline and status</strong> are checked as well, so a closed drive stops
            accepting applications automatically.
          </li>
          <li>
            The check runs in <span className="mono">utils/eligibility.js</span> on the client and is
            repeated by the server when the application is submitted.
          </li>
        </ul>
      </section>

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
