/**
 * server/email/preferences.js
 * ===========================================================================
 * SEND-TIME PREFERENCE CHECK
 * ===========================================================================
 * A preference can change between the business event and the actual provider
 * call. The worker therefore rechecks the recipient document immediately
 * before sending, using the related Mongo id where available (email addresses
 * can be edited).
 */

import { Admin, Company, Student } from '../models/index.js';
import { emailLog } from './log.js';

/**
 * @returns {Promise<{allowed:boolean, reason?:string, retryable?:boolean}>}
 */
export async function recipientAllowsEmail(row) {
  const role = row?.recipient?.role;
  const email = String(row?.recipient?.email || '').trim().toLowerCase();
  const related = row?.related || {};

  try {
    if (role === 'student') {
      const query = related.student ? { _id: related.student } : { email };
      const student = await Student.findOne(query)
        .select('emailNotifications driveAnnouncements placementStatus invitationPending')
        .lean();
      if (!student) {
        // A row with a related student id whose document disappeared is a
        // deleted recipient and must be suppressed. Legacy/test rows without a
        // link are still sendable.
        return related.student
          ? { allowed: false, reason: 'recipient_deleted' }
          : { allowed: true };
      }
      if (student.emailNotifications === false) {
        return { allowed: false, reason: 'email_opted_out' };
      }
      if (row.eventType === 'drive.announcement') {
        if (student.driveAnnouncements === false) {
          return { allowed: false, reason: 'announcement_opted_out' };
        }
        if (student.placementStatus !== 'Active' || student.invitationPending === true) {
          return { allowed: false, reason: 'announcement_not_eligible' };
        }
      }
      return { allowed: true };
    }

    if (role === 'company') {
      const query = related.company ? { _id: related.company } : { hrEmail: email };
      const company = await Company.findOne(query).select('emailNotifications').lean();
      if (!company) return { allowed: false, reason: 'recipient_deleted' };
      if (company.emailNotifications === false) {
        return { allowed: false, reason: 'email_opted_out' };
      }
      return { allowed: true };
    }

    if (role === 'admin') {
      const query = related.admin ? { _id: related.admin } : { email };
      const admin = await Admin.findOne(query).select('_id').lean();
      if (!admin) return { allowed: false, reason: 'recipient_deleted' };
      return { allowed: true };
    }

    return { allowed: false, reason: 'unknown_recipient_role' };
  } catch (error) {
    // A transient lookup failure must not be treated as an opt-out.
    emailLog('preference recheck failed', {
      outboxId: row?._id ? String(row._id) : '',
      error: error?.name || 'error',
    });
    return { allowed: false, reason: 'preference_check_failed', retryable: true };
  }
}
