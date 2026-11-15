/**
 * server/models/company.js
 * ===========================================================================
 * COMPANY / RECRUITER ACCOUNT
 * ===========================================================================
 *
 * The login identity of a company is its HR email (`hrEmail`), which is unique.
 *
 * `verified` is a real gate, not decoration: a company that has just registered
 * is `verified: false` and the API refuses to let it publish drives until the
 * placement cell (an admin) approves it. See PATCH /api/admin/companies/:id.
 */

import mongoose from 'mongoose';

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    industry: { type: String, default: '', trim: true, maxlength: 120 },
    location: { type: String, default: '', trim: true, maxlength: 120 },
    website: { type: String, default: '', trim: true, maxlength: 200 },
    size: { type: String, default: '', trim: true, maxlength: 60 },
    tier: { type: String, default: 'Standard', trim: true, maxlength: 40 },

    // The recruiter who owns this account.
    hrName: { type: String, default: '', trim: true, maxlength: 120 },
    hrEmail: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 160,
    },
    hrPhone: { type: String, default: '', trim: true, maxlength: 40 },

    about: { type: String, default: '', maxlength: 2000 },
    verified: { type: Boolean, default: false },
    /** Recruiter transactional emails; in-app behavior is unaffected. */
    emailNotifications: { type: Boolean, default: true },
    passwordHash: { type: String, required: true, select: false },
    registeredOn: { type: String, default: () => new Date().toISOString().slice(0, 10) },
  },
  { timestamps: true },
);

export const Company = mongoose.models.Company || mongoose.model('Company', companySchema);
export default Company;
