/**
 * server/models/admin.js
 * ===========================================================================
 * PLACEMENT CELL ADMINISTRATOR
 * ===========================================================================
 *
 * Admins are NOT self-registrable - that would let anybody grant themselves
 * access to every student record. They are created out of band with:
 *
 *     npm run admin:create
 *
 * See server/provision-admin.js.
 */

import mongoose from 'mongoose';

const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 160,
    },
    passwordHash: { type: String, required: true, select: false },
    designation: { type: String, default: '', trim: true, maxlength: 120 },
    department: { type: String, default: '', trim: true, maxlength: 120 },
    phone: { type: String, default: '', trim: true, maxlength: 40 },
    college: { type: String, default: '', trim: true, maxlength: 200 },
  },
  { timestamps: true },
);

export const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);
export default Admin;
