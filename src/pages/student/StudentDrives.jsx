import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import PageHeader from '../../components/PageHeader';
import SearchBar from '../../components/SearchBar';
import FilterBar, { FilterField } from '../../components/FilterBar';
import DriveCard from '../../components/DriveCard';
import EmptyState from '../../components/EmptyState';
import LoadingState, { CardSkeleton } from '../../components/LoadingState';
import ApplyConfirmModal from '../../components/ApplyConfirmModal';
import Button from '../../components/Button';
import { useCurrentStudent } from '../../hooks/useCurrentStudent';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { checkEligibility } from '../../utils/eligibility';
import {
  enrichDrive,
  filterDrives,
  getAllDriveBranches,
  getAllRequiredSkills,
} from '../../utils/selectors';

/**
 * pages/student/StudentDrives.jsx
 * ===========================================================================
 * RECRUITMENT DRIVES  (search + filtering)
 * ===========================================================================
 * This page demonstrates three things the evaluator usually asks about:
 *
 *  1. CONTROLLED INPUTS - every filter is a piece of state, and the list is
 *     recalculated from that state on each render. React "re-renders" the
 *     component, and the visible cards are just the filtered array.
 *
 *  2. DERIVED DATA - the visible list is not stored in state at all:
 *        const visibleDrives = filterDrives(enrichedDrives, filters);
 *     Storing derived data in state is the classic React bug (two sources of
 *     truth that drift apart).
 *
 *  3. URL PARAMETERS - the top bar search navigates to /student/drives?q=java,
 *     and useSearchParams reads that value into the search box.
 */
export default function StudentDrives() {
  const student = useCurrentStudent();
  const data = useData();
  const { loading, saving, applyToDrive } = data;
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [filters, setFilters] = useState({
    branch: '',
    minCgpa: '',
    skill: '',
    status: '',
    deadlineWithinDays: '',
    onlyEligible: false,
  });
  const [confirmDrive, setConfirmDrive] = useState(null);

  // If the top bar search changes the ?q= parameter, mirror it into the box.
  useEffect(() => {
    const query = searchParams.get('q');
    if (query !== null) setSearch(query);
  }, [searchParams]);

  /** Every drive + its company + the eligibility result for THIS student. */
  const enrichedDrives = useMemo(
    () =>
      data.drives.map((drive) => ({
        ...enrichDrive(drive, data.companies),
        eligibility: checkEligibility(student, drive),
      })),
    [data.drives, data.companies, student],
  );

  /** The list actually shown on screen (pure function from utils/selectors). */
  const visibleDrives = useMemo(
    () => filterDrives(enrichedDrives, { ...filters, search }),
    [enrichedDrives, filters, search],
  );

  const branchOptions = useMemo(() => getAllDriveBranches(data.drives), [data.drives]);
  const skillOptions = useMemo(() => getAllRequiredSkills(data.drives), [data.drives]);

  const eligibleCount = useMemo(
    () => enrichedDrives.filter((drive) => drive.eligibility.eligible && drive.status === 'Open').length,
    [enrichedDrives],
  );

  // Used to display "Applied" instead of the Apply button.
  const appliedDriveIds = useMemo(
    () => new Set(data.applications.filter((item) => item.studentId === student?.id).map((item) => item.driveId)),
    [data.applications, student],
  );

  const activeFilterCount =
    (filters.branch ? 1 : 0) +
    (filters.minCgpa ? 1 : 0) +
    (filters.skill ? 1 : 0) +
    (filters.status ? 1 : 0) +
    (filters.deadlineWithinDays ? 1 : 0) +
    (filters.onlyEligible ? 1 : 0) +
    (search ? 1 : 0);

  const resetFilters = () => {
    setSearch('');
    setFilters({
      branch: '',
      minCgpa: '',
      skill: '',
      status: '',
      deadlineWithinDays: '',
      onlyEligible: false,
    });
  };

  /** Runs after the student confirms inside the modal. */
  const handleConfirmApply = async () => {
    try {
      await applyToDrive({ studentId: student.id, driveId: confirmDrive.id });
      setConfirmDrive(null);
      showToast('Application submitted successfully.', 'success');
    } catch (error) {
      setConfirmDrive(null);
      showToast(error.message, 'error');
    }
  };

  if (loading || !student) {
    return (
      <>
        <PageHeader title="Recruitment Drives" subtitle="Loading drives published by visiting companies..." />
        <CardSkeleton count={4} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Recruitment Drives"
        subtitle={`${data.drives.length} drives published this season - you are eligible for ${eligibleCount} of them.`}
      >
        <Button variant="outline" icon="user" onClick={() => navigate('/student/profile')}>
          My Profile
        </Button>
      </PageHeader>

      {/* ------------------------------ filters ------------------------------ */}
      <FilterBar activeCount={activeFilterCount} onClear={resetFilters}>
        <FilterField label="Search">
          <SearchBar value={search} onChange={setSearch} placeholder="Company, role, skill..." />
        </FilterField>

        <FilterField label="Branch">
          <select
            className="select"
            value={filters.branch}
            onChange={(event) => setFilters({ ...filters, branch: event.target.value })}
          >
            <option value="">All branches</option>
            {branchOptions.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Minimum CGPA">
          <select
            className="select"
            value={filters.minCgpa}
            onChange={(event) => setFilters({ ...filters, minCgpa: event.target.value })}
          >
            <option value="">Any CGPA</option>
            <option value="6">6.0+</option>
            <option value="7">7.0+</option>
            <option value="7.5">7.5+</option>
            <option value="8">8.0+</option>
            <option value="8.5">8.5+</option>
          </select>
        </FilterField>

        <FilterField label="Skill">
          <select
            className="select"
            value={filters.skill}
            onChange={(event) => setFilters({ ...filters, skill: event.target.value })}
          >
            <option value="">Any skill</option>
            {skillOptions.map((skill) => (
              <option key={skill} value={skill}>
                {skill}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Status">
          <select
            className="select"
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          >
            <option value="">All statuses</option>
            <option value="Open">Open</option>
            <option value="Closed">Closed</option>
          </select>
        </FilterField>

        <FilterField label="Deadline">
          <select
            className="select"
            value={filters.deadlineWithinDays}
            onChange={(event) => setFilters({ ...filters, deadlineWithinDays: event.target.value })}
          >
            <option value="">Any time</option>
            <option value="7">Closing in 7 days</option>
            <option value="15">Closing in 15 days</option>
            <option value="30">Closing in 30 days</option>
          </select>
        </FilterField>

        <FilterField label="Eligibility">
          <label className="checkbox" style={{ height: 40 }}>
            <input
              type="checkbox"
              checked={filters.onlyEligible}
              onChange={(event) => setFilters({ ...filters, onlyEligible: event.target.checked })}
            />
            Only eligible drives
          </label>
        </FilterField>
      </FilterBar>

      {/* ------------------------------ results ------------------------------ */}
      <div className="filter-summary">
        <Icon name="briefcase" size={15} />
        <span>
          Showing <strong>{visibleDrives.length}</strong> of {enrichedDrives.length} drives
        </span>
        {search ? <span className="badge badge--info">search: "{search}"</span> : null}
      </div>

      {visibleDrives.length === 0 ? (
        <EmptyState
          icon="search"
          title="No drives match your filters"
          text="Try removing a filter, or search for a different company or role."
        >
          <Button variant="outline" icon="refresh" onClick={resetFilters}>
            Reset filters
          </Button>
        </EmptyState>
      ) : (
        <div className="grid grid-2">
          {visibleDrives.map((drive) => (
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
