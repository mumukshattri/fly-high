/**
 * config/pipeline.js
 * ---------------------------------------------------------------------------
 * The hiring pipeline, defined once.
 *
 * These are the only values the backend accepts for an application's `status`
 * (see server/models/application.js), so the UI filters and the progress
 * tracker must build their options from this list rather than hard-coding
 * strings in several places.
 */

export const APPLICATION_STATUSES = [
  'Applied',
  'Under Review',
  'Shortlisted',
  'Selected',
  'Rejected',
];

/** The happy-path stages shown in the progress tracker (Rejected is off-path). */
export const PIPELINE_STAGES = ['Applied', 'Under Review', 'Shortlisted', 'Selected'];
