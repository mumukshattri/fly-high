import { useMemo } from 'react';
import Icon from './Icon';
import StatusBadge from './StatusBadge';
import { formatDate } from '../utils/format';
import { buildApplicationTimeline } from '../utils/applicationTimeline';

/**
 * components/StatusTimeline.jsx
 * ---------------------------------------------------------------------------
 * Progress tracker for one application.
 *
 *   Applied -> Application reviewed -> Shortlisted -> [Interview scheduled] -> Selected
 *
 * "Interview scheduled" only appears when the drive has a published date and
 * the application actually reached Shortlisted; "Rejected" replaces Selected
 * when the application was rejected. Every date and note comes from
 * `application.statusHistory` (written by the recruiter's PATCH request), so
 * nothing on this timeline is decorative. Stages with no recorded timestamp say
 * so instead of showing a made-up date.
 *
 * `compact` renders the same data as a horizontal stepper for list pages.
 */
export default function StatusTimeline({ application, drive = null, compact = false }) {
  const timeline = useMemo(
    () => buildApplicationTimeline(application || {}, drive),
    [application, drive],
  );

  if (!application) return null;

  const { stages, currentStatus } = timeline;

  if (compact) {
    return (
      <ol className="timeline-compact" aria-label="Application timeline">
        {stages.map((stage) => (
          <li className={`timeline-compact__step is-${stage.state}`} key={stage.key}>
            <span className="timeline-compact__marker">
              {stage.state === 'done' ? (
                <Icon name="check" size={11} strokeWidth={3} />
              ) : (
                <Icon name={stage.icon} size={12} />
              )}
            </span>
            <span className="timeline-compact__body">
              <span className="timeline-compact__label">{stage.label}</span>
              <span className="timeline-compact__date">
                {stage.date
                  ? formatDate(stage.date)
                  : stage.state === 'pending'
                    ? 'Pending'
                    : 'Not recorded'}
              </span>
            </span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div>
      <div className="row-between mb-16 wrap gap-8">
        <span className="text-sm muted">Current status</span>
        <StatusBadge status={currentStatus} />
      </div>

      <ol className="timeline">
        {stages.map((stage) => {
          const isDone = stage.state === 'done';

          return (
            <li className={`timeline__step is-${stage.state}`} key={stage.key}>
              <span className="timeline__marker">
                <Icon
                  name={isDone ? 'check' : stage.icon}
                  size={14}
                  strokeWidth={isDone ? 3 : 2}
                />
              </span>
              <span className="timeline__line" />

              <div className="timeline__content">
                <div className="row gap-8 wrap">
                  <span className="timeline__label">{stage.label}</span>
                  {stage.state === 'current' ? (
                    <span className="badge badge--info text-xs">Current stage</span>
                  ) : null}
                  {stage.isInterview ? (
                    <span className="badge badge--neutral text-xs">From drive data</span>
                  ) : null}
                </div>

                <div className="timeline__date">
                  {stage.date
                    ? formatDate(stage.date)
                    : stage.state === 'pending'
                      ? 'Pending'
                      : stage.state === 'skipped'
                        ? 'Not recorded'
                        : 'Timestamp not recorded'}
                </div>

                {stage.note ? <div className="timeline__note">{stage.note}</div> : null}
              </div>
            </li>
          );
        })}
      </ol>

      {timeline.isRejected && application.recruiterNote ? (
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
