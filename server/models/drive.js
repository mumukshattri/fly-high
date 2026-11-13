/**
 * server/models/drive.js
 * ===========================================================================
 * RECRUITMENT DRIVE (a job posting)
 * ===========================================================================
 *
 * A drive declares its eligibility rules AS DATA - minimum CGPA, allowed
 * branches, required skills and how they match, deadline and status. The
 * eligibility engine (`src/utils/eligibility.js`) is the only code that reads
 * them, and it runs on the server on every application.
 *
 * Dates are stored as `YYYY-MM-DD` strings, not Date objects: the rules compare
 * calendar days, and a string comparison cannot drift across timezones.
 */

import mongoose from 'mongoose';

const driveSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },

    role: { type: String, required: true, trim: true, maxlength: 160 },
    jobType: { type: String, default: 'Full Time', trim: true, maxlength: 40 },
    location: { type: String, default: '', trim: true, maxlength: 160 },
    package: { type: String, default: 'Not disclosed', trim: true, maxlength: 60 },
    stipend: { type: String, default: null, trim: true, maxlength: 60 },
    openings: { type: Number, default: 1, min: 1, max: 10000 },

    // Eligibility rules.
    minimumCGPA: { type: Number, default: 0, min: 0, max: 10 },
    branches: { type: [String], default: [] },
    requiredSkills: { type: [String], default: [] },
    skillMatchMode: { type: String, enum: ['any', 'all'], default: 'any' },

    deadline: { type: String, required: true },
    driveDate: { type: String, default: '' },
    postedOn: { type: String, default: () => new Date().toISOString().slice(0, 10) },

    status: { type: String, enum: ['Open', 'Closed'], default: 'Open', index: true },
    tier: { type: String, default: 'Standard', trim: true, maxlength: 40 },
    description: { type: String, default: '', maxlength: 5000 },
    responsibilities: { type: [String], default: [] },
    selectionProcess: { type: [String], default: [] },
  },
  { timestamps: true },
);

driveSchema.index({ status: 1, postedOn: -1 });

export const Drive = mongoose.models.Drive || mongoose.model('Drive', driveSchema);
export default Drive;
