import Modal from './Modal';
import Button from './Button';
import { formatDate } from '../utils/format';

/**
 * components/ApplyConfirmModal.jsx
 * ---------------------------------------------------------------------------
 * The confirmation step before an application is submitted.
 *
 *   "Apply for Software Development Engineer at TechNova?"
 *
 * Why a confirmation modal? Applying is a one-way action - the student cannot
 * un-apply from the portal - so we show exactly what is being submitted (name,
 * branch, CGPA) and ask for a final click. This is the pattern used by real
 * placement portals.
 *
 * The parent page owns the `applying` flag; this component is purely
 * presentational.
 */
export default function ApplyConfirmModal({ student, drive, onConfirm, onClose, applying = false }) {
  if (!drive || !student) return null;

  const rows = [
    { label: 'Student', value: student.name },
    { label: 'Roll number', value: student.rollNumber || '—' },
    { label: 'Branch', value: student.branch },
    { label: 'CGPA', value: student.cgpa },
    { label: 'Company', value: drive.companyName },
    { label: 'Role', value: drive.role },
    { label: 'Package', value: drive.package },
    { label: 'Deadline', value: formatDate(drive.deadline) },
  ];

  return (
    <Modal
      title={`Apply for ${drive.role} at ${drive.companyName}?`}
      subtitle="Please confirm your details before submitting. This action cannot be undone."
      onClose={applying ? () => {} : onClose}
      closeOnOverlay={!applying}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={applying}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} loading={applying} icon="send">
            Confirm Application
          </Button>
        </>
      }
    >
      <div className="summary-list">
        {rows.map((row) => (
          <div className="summary-list__item" key={row.label}>
            <span className="summary-list__label">{row.label}</span>
            <span className="summary-list__value">{row.value}</span>
          </div>
        ))}
      </div>

      <p className="text-sm muted mt-16">
        Your saved resume and profile will be shared with the recruiter when you confirm.
      </p>
    </Modal>
  );
}
