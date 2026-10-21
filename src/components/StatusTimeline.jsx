import Icon from './Icon';
import { PIPELINE_STAGES } from '../data/mockApplications';
import { formatDate } from '../utils/format';
import StatusBadge from './StatusBadge';

/**
 * components/StatusTimeline.jsx
 * ---------------------------------------------------------------------------
 * The visual progress tracker used on the application details page.
 *
 *   Applied  ->  Under Review  ->  Shortlisted  ->  Selected
 *
 * A "Rejected" application leaves the main pipeline, so in that case we show
 * only the stages it actually reached and add a red Rejected step at the end.
 *
 * The component reads `application.statusHistory` (the audit trail created by
 * applicationService.updateApplicationStatus) so the dates and recruiter notes
 * next to each stage are real data, not decoration.
 */

const STAGE_ICONS = {
  Applied: 'send',
  'Under Review': 'clock',
  Shortlisted: 'star',
  Selected: 'check-circle',
  Rejected: 'x',
};

/** i-th stage met in the history? */
const findHistoryEntry = (history, status) =>
  [...history].reverse().find((entry) => entry.status === status);

export default function StatusTimeline({ application }) {
  if (!application) return null;

  const history = application.statusHistory || [];
  const reachedStatuses = history.map((entry) => entry.status);
  const currentStatus = application.status;
  const isRejected = currentStatus === 'Rejected';

  // Build the list of stages to draw.
  let stages = PIPELINE_STAGES;
  if (isRejected) {
    const reached = PIPELINE_STAGES.filter((stage) => reachedStatuses.includes(stage));
    stages = [...reached, 'Rejected'];
  }

  const currentIndex = stages.indexOf(currentStatus);

  return (
    <div>
      <div className="row-between mb-16">
        <span className="text-sm muted">Current status</span>
        <StatusBadge status={currentStatus} />
      </div>

      <ol className="timeline">
        {stages.map((stage, index) => {
          const entry = findHistoryEntry(history, stage);
          const isCurrent = index === currentIndex;
          const isDone = index < currentIndex;
          const isRejectedStage = isRejected && stage === 'Rejected';

          const stateClass = isRejectedStage
            ? 'is-rejected'
            : isCurrent
              ? 'is-current'
              : isDone
                ? 'is-done'
                : '';

          return (
            <li className={`timeline__step ${stateClass}`} key={stage}>
              <span className="timeline__marker">
                <Icon
                  name={isDone ? 'check' : STAGE_ICONS[stage] || 'circle'}
                  size={14}
                  strokeWidth={isDone ? 3 : 2}
                />
              </span>
              <span className="timeline__line" />

              <div className="timeline__content">
                <div className="row gap-8 wrap">
                  <span className="timeline__label">{stage}</span>
                  {isCurrent ? (
                    <span className="badge badge--info text-xs">Current stage</span>
                  ) : null}
                </div>
                {entry ? (
                  <div className="timeline__date">
                    {formatDate(entry.date)}
                    {entry.note ? ` - ${entry.note}` : ''}
                  </div>
                ) : (
                  <div className="timeline__date">Pending</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {isRejected && application.recruiterNote ? (
        <div className="inline-note inline-note--warning mt-16">
          <Icon name="info" size={16} />
          <span>
            <strong>Recruiter remark:</strong> {application.recruiterNote}
          </span>
        </div>
      ) : null}
    </div>
  );
}
