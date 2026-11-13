#!/usr/bin/env node
/**
 * server/provision-admin.js
 * ===========================================================================
 * SECURE ADMINISTRATOR PROVISIONING
 * ===========================================================================
 *
 * There is no "register as admin" endpoint on purpose: the placement cell can
 * see every student record, so an administrator account is created out of band
 * by someone who already has server access.
 *
 * USAGE
 *   npm run admin:create -- --email admin@college.edu --name "Placement Officer"
 *
 * OPTIONS
 *   --email <address>        required
 *   --name "<full name>"     required
 *   --password <value>       optional; otherwise a strong password is generated
 *   --password-file <path>   read the password from a file (safer than argv)
 *   --designation <text>     e.g. "Training & Placement Officer"
 *   --department <text>
 *   --phone <text>
 *   --college <text>
 *   --force                  reset the password of an existing admin
 *   --help
 *
 * The password is never echoed into shell history by default: if you do not
 * pass one, the command GENERATES a random password and prints it exactly once.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { connectDatabase, disconnectDatabase } from './db.js';
import { requireMongoUri } from './config.js';
import { Admin, Company, Student } from './models/index.js';
import { hashPassword } from './password.js';
import { isEmail } from './http.js';

const USAGE = `
Create (or update) a Job N Job administrator.

  npm run admin:create -- --email admin@college.edu --name "Placement Officer"

Options:
  --email <address>        required
  --name  "<full name>"    required
  --password <value>       optional (a strong one is generated if omitted)
  --password-file <path>   read the password from a file instead
  --designation <text>     --department <text>
  --phone <text>           --college <text>
  --force                  reset an existing admin's password
  --help
`;

function fail(message) {
  console.error(`\n  x ${message}\n`);
  process.exitCode = 1;
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        email: { type: 'string' },
        name: { type: 'string' },
        password: { type: 'string' },
        'password-file': { type: 'string' },
        designation: { type: 'string' },
        department: { type: 'string' },
        phone: { type: 'string' },
        college: { type: 'string' },
        force: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    }));
  } catch (error) {
    console.error(USAGE);
    fail(error.message);
    return;
  }

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const email = String(values.email || '').trim().toLowerCase();
  const name = String(values.name || '').trim();

  if (!email) return fail('--email is required.');
  if (!isEmail(email)) return fail('--email is not a valid email address.');
  if (!name) return fail('--name is required.');

  /* --------------------------------- password -------------------------------- */

  let password = values.password || null;
  let generated = false;

  if (values['password-file']) {
    try {
      password = readFileSync(values['password-file'], 'utf8').trim();
    } catch (error) {
      return fail(`Could not read --password-file: ${error.message}`);
    }
  }

  if (!password) {
    // 24 base64url characters = ~144 bits of entropy.
    password = randomBytes(18).toString('base64url');
    generated = true;
  }

  if (password.length < 12) {
    return fail('The password must be at least 12 characters long.');
  }

  /* --------------------------------- database -------------------------------- */

  await connectDatabase(requireMongoUri());

  const [existingAdmin, existingStudent, existingCompany] = await Promise.all([
    Admin.findOne({ email }),
    Student.exists({ email }),
    Company.exists({ hrEmail: email }),
  ]);

  if (existingStudent || existingCompany) {
    await disconnectDatabase();
    return fail(
      `${email} already belongs to a ${existingStudent ? 'student' : 'company'} account. ` +
        'Use a different email address for the administrator.',
    );
  }

  if (existingAdmin && !values.force) {
    await disconnectDatabase();
    return fail(`${email} already exists. Re-run with --force to reset its password.`);
  }

  const passwordHash = await hashPassword(password);

  if (existingAdmin) {
    existingAdmin.passwordHash = passwordHash;
    existingAdmin.name = name;
    if (values.designation !== undefined) existingAdmin.designation = values.designation;
    if (values.department !== undefined) existingAdmin.department = values.department;
    if (values.phone !== undefined) existingAdmin.phone = values.phone;
    if (values.college !== undefined) existingAdmin.college = values.college;
    await existingAdmin.save();
    console.log(`\n  Administrator updated: ${email}`);
  } else {
    await Admin.create({
      email,
      name,
      passwordHash,
      designation: values.designation || '',
      department: values.department || '',
      phone: values.phone || '',
      college: values.college || '',
    });
    console.log(`\n  Administrator created: ${email}`);
  }

  if (generated) {
    console.log('');
    console.log('  Generated password (shown once, store it now):');
    console.log(`      ${password}`);
  }

  console.log('');
  console.log('  Sign in at /login with the "Admin" role selected.');
  console.log('');

  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error(`\n  x ${error.message}\n`);
  await disconnectDatabase().catch(() => {});
  process.exitCode = 1;
});
