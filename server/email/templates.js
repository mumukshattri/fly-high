/**
 * server/email/templates.js
 * ===========================================================================
 * CENTRAL EMAIL TEMPLATES
 * ===========================================================================
 * One responsive layout, one consistent JOB N JOB voice, and a plain-text
 * version for every message. Every value interpolated into HTML is escaped.
 */

const BRAND = {
  name: 'JOB N JOB',
  tagline: 'Centralized Campus Recruitment Management System',
  navy: '#10233f',
  navySoft: '#1d3a5f',
  teal: '#0f766e',
  ink: '#172033',
  muted: '#5b6577',
  line: '#e3e8ef',
  surface: '#f5f7fa',
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const safe = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const formatDate = (value) => {
  if (!value) return 'Not specified';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return safe(value, 'Not specified');
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};

const list = (value) => (Array.isArray(value) ? value.filter(Boolean).map(String) : []);

function link(appUrl, path) {
  const base = String(appUrl || '').replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function layout({ title, preheader, body, ctaLabel, ctaUrl, footerNote }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.surface};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.surface};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid ${BRAND.line};border-radius:12px;overflow:hidden;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
          <tr>
            <td style="background:${BRAND.navy};padding:22px 28px;">
              <div style="color:#ffffff;font-size:18px;font-weight:800;letter-spacing:.4px;">${BRAND.name}</div>
              <div style="color:#d7e1ee;font-size:12px;margin-top:4px;">${BRAND.tagline}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 28px 8px;">
              <h1 style="margin:0 0 14px;color:${BRAND.ink};font-size:23px;line-height:1.3;font-weight:750;">${escapeHtml(title)}</h1>
              <div style="color:${BRAND.ink};font-size:15px;line-height:1.65;">${body}</div>
            </td>
          </tr>
          ${
            ctaLabel && ctaUrl
              ? `<tr><td style="padding:22px 28px 8px;">
                  <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${BRAND.teal};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 20px;border-radius:8px;">${escapeHtml(ctaLabel)}</a>
                </td></tr>`
              : ''
          }
          <tr>
            <td style="padding:22px 28px 0;">
              <div style="border-top:1px solid ${BRAND.line};padding-top:16px;color:${BRAND.muted};font-size:12px;line-height:1.6;">
                ${footerNote ? escapeHtml(footerNote) : 'This is an automated message from JOB N JOB.'}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 26px;color:${BRAND.muted};font-size:11px;line-height:1.6;">
              JOB N JOB · Campus Placement Management<br>
              If this message was not intended for you, please ignore it.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function detailsTable(rows) {
  const cells = rows
    .filter((row) => row && row.value !== undefined && row.value !== null && row.value !== '')
    .map(
      (row) => `<tr>
        <td style="padding:8px 0;color:${BRAND.muted};font-size:13px;vertical-align:top;width:38%;">${escapeHtml(row.label)}</td>
        <td style="padding:8px 0;color:${BRAND.ink};font-size:13px;font-weight:600;vertical-align:top;">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 4px;border-top:1px solid ${BRAND.line};border-bottom:1px solid ${BRAND.line};">${cells}</table>`;
}

/**
 * Render one event. The returned HTML and text are stored in the outbox so a
 * retry sends exactly the same message even if the underlying record changes.
 */
export function buildEmail(templateId, data = {}, appUrl = '') {
  const d = data || {};
  const app = String(appUrl || '').replace(/\/+$/, '');

  switch (templateId) {
    case 'student-welcome': {
      const title = 'Welcome to JOB N JOB';
      const name = safe(d.studentName, 'Student');
      return {
        subject: 'Welcome to JOB N JOB — Your placement journey starts here.',
        html: layout({
          title,
          preheader: 'Your placement journey starts here.',
          body: `<p style="margin:0 0 14px;">Hi ${escapeHtml(name)},</p>
            <p style="margin:0 0 14px;">Your student account is ready. Complete your profile, add your skills, and upload your resume so the eligibility engine can show you the drives you can apply for.</p>
            <p style="margin:0;">Keep your CGPA, branch, and resume up to date before the placement season begins.</p>`,
          ctaLabel: 'Complete your profile',
          ctaUrl: link(app, '/student/profile'),
        }),
        text: `Hi ${name},\n\nWelcome to JOB N JOB. Your student account is ready.\n\nComplete your profile, add your skills, and upload your resume so the eligibility engine can show you the drives you can apply for.\n\nComplete your profile: ${link(app, '/student/profile')}\n\nJOB N JOB · Campus Placement Management`,
      };
    }

    case 'company-welcome': {
      const title = 'Welcome to JOB N JOB';
      const name = safe(d.companyName, 'Recruiter');
      return {
        subject: 'Welcome to JOB N JOB — Your recruiter account is ready.',
        html: layout({
          title,
          preheader: 'Your recruiter account is ready.',
          body: `<p style="margin:0 0 14px;">Hello ${escapeHtml(name)},</p>
            <p style="margin:0 0 14px;">Your recruiter account has been created. The placement cell must verify your company before you can publish a recruitment drive.</p>
            <p style="margin:0;">You can sign in now to review your company details while verification is pending.</p>`,
          ctaLabel: 'Open recruiter dashboard',
          ctaUrl: link(app, '/company/dashboard'),
          footerNote: 'You will receive another email when the placement cell verifies your company.',
        }),
        text: `Hello ${name},\n\nWelcome to JOB N JOB. Your recruiter account has been created.\n\nThe placement cell must verify your company before you can publish a recruitment drive. You can sign in now to review your company details while verification is pending.\n\nOpen your dashboard: ${link(app, '/company/dashboard')}\n\nJOB N JOB · Campus Placement Management`,
      };
    }

    case 'company-approved': {
      const title = 'Your company is verified';
      const name = safe(d.companyName, 'your company');
      return {
        subject: 'Your company has been verified on JOB N JOB.',
        html: layout({
          title,
          preheader: 'You can now publish recruitment drives.',
          body: `<p style="margin:0 0 14px;">Good news — ${escapeHtml(name)} has been verified by the placement cell.</p>
            <p style="margin:0;">You can now publish recruitment drives, define eligibility rules, and review student applications.</p>`,
          ctaLabel: 'Create a recruitment drive',
          ctaUrl: link(app, '/company/drives'),
        }),
        text: `Good news — ${name} has been verified by the placement cell.\n\nYou can now publish recruitment drives, define eligibility rules, and review student applications.\n\nCreate a drive: ${link(app, '/company/drives')}\n\nJOB N JOB · Campus Placement Management`,
      };
    }

    case 'application-submitted': {
      const title = 'Application submitted';
      const role = safe(d.role, 'the role');
      const company = safe(d.companyName, 'the company');
      return {
        subject: `Your application for ${role} at ${company} has been submitted.`,
        html: layout({
          title,
          preheader: `Your ${role} application was submitted successfully.`,
          body: `<p style="margin:0 0 14px;">Hi ${escapeHtml(safe(d.studentName, 'Student'))},</p>
            <p style="margin:0 0 12px;">Your application has been submitted successfully.</p>
            ${detailsTable([
              { label: 'Role', value: role },
              { label: 'Company', value: company },
              { label: 'Applied on', value: formatDate(d.appliedOn) },
              { label: 'Status', value: 'Applied' },
            ])}
            <p style="margin:12px 0 0;">The recruiter will review your profile and update your application status. You can track it in My Applications.</p>`,
          ctaLabel: 'View my applications',
          ctaUrl: link(app, '/student/applications'),
        }),
        text: `Hi ${safe(d.studentName, 'Student')},\n\nYour application has been submitted successfully.\n\nRole: ${role}\nCompany: ${company}\nApplied on: ${formatDate(d.appliedOn)}\nStatus: Applied\n\nThe recruiter will review your profile and update your application status.\n\nView your applications: ${link(app, '/student/applications')}\n\nJOB N JOB · Campus Placement Management`,
      };
    }

    case 'new-application': {
      const title = 'A new student has applied';
      const role = safe(d.role, 'your placement drive');
      return {
        subject: `A new student has applied to your ${role} placement drive.`,
        html: layout({
          title,
          preheader: 'A new application is waiting in your recruiter dashboard.',
          body: `<p style="margin:0 0 14px;">A new application has arrived for <strong>${escapeHtml(role)}</strong>.</p>
            ${detailsTable([
              { label: 'Student', value: safe(d.studentName, 'Student') },
              { label: 'Branch', value: safe(d.branch, 'Not specified') },
              { label: 'CGPA', value: d.cgpa ?? 'Not specified' },
              { label: 'Skills', value: list(d.skills).slice(0, 6).join(', ') || 'Not specified' },
              { label: 'Drive', value: role },
              { label: 'Applied on', value: formatDate(d.appliedOn) },
            ])}
            <p style="margin:12px 0 0;">Open the applicant dashboard to review the full profile and move the candidate through your pipeline.</p>`,
          ctaLabel: 'Review applicant',
          ctaUrl: link(app, '/company/applicants'),
        }),
        text: `A new application has arrived for ${role}.\n\nStudent: ${safe(d.studentName, 'Student')}\nBranch: ${safe(d.branch, 'Not specified')}\nCGPA: ${d.cgpa ?? 'Not specified'}\nSkills: ${list(d.skills).slice(0, 6).join(', ') || 'Not specified'}\nApplied on: ${formatDate(d.appliedOn)}\n\nReview the applicant: ${link(app, '/company/applicants')}\n\nJOB N JOB · Campus Placement Management`,
      };
    }

    case 'application-shortlisted': {
      const role = safe(d.role, 'the role');
      const company = safe(d.companyName, 'the company');
      return {
        subject: 'Congratulations! Your application has been shortlisted.',
        html: layout({
          title: 'You have been shortlisted',
          preheader: 'Your application has moved to the next stage.',
          body: `<p style="margin:0 0 14px;">Hi ${escapeHtml(safe(d.studentName, 'Student'))},</p>
            <p style="margin:0 0 12px;">Congratulations — your application for <strong>${escapeHtml(role)}</strong> at <strong>${escapeHtml(company)}</strong> has been shortlisted.</p>
            <p style="margin:0;">The recruiter may contact you with the next steps. Keep your profile and resume up to date.</p>`,
          ctaLabel: 'View application',
          ctaUrl: link(app, '/student/applications'),
        }),
        text: `Hi ${safe(d.studentName, 'Student')},\n\nCongratulations — your application for ${role} at ${company} has been shortlisted.\n\nThe recruiter may contact you with the next steps. Keep your profile and resume up to date.\n\nView your application: ${link(app, '/student/applications')}\n\nJOB N JOB · Campus Placement Management`,
      };
    }

    case 'application-rejected': {
      const role = safe(d.role, 'the role');
      const company = safe(d.companyName, 'the company');
      return {
        subject: 'Your application status has been updated.',
        html: layout({
          title: 'Application status updated',
          preheader: 'Your application status has changed.',
          body: `<p style="margin:0 0 14px;">Hi ${escapeHtml(safe(d.studentName, 'Student'))},</p>
            <p style="margin:0 0 12px;">Your application for <strong>${escapeHtml(role)}</strong> at <strong>${escapeHtml(company)}</strong> has been updated to <strong>Rejected</strong>.</p>
            <p style="margin:0;">This decision applies to this drive. You can continue applying to other drives for which you are eligible.</p>`,
          ctaLabel: 'View my applications',
          ctaUrl: link(app, '/student/applications'),
        }),
        text: `Hi ${safe(d.studentName, 'Student')},\n\nYour application for ${role} at ${company} has been updated to Rejected.\n\nThis decision applies to this drive. You can continue applying to other drives for which you are eligible.\n\nView your applications: ${link(app, '/student/applications')}\n\nJOB N JOB · Campus Placement Management`,
      };
    }

    case 'application-status': {
      const role = safe(d.role, 'the role');
      const company = safe(d.companyName, 'the company');
      const status = safe(d.status, 'Updated');
      return {
        subject: 'Your application status has been updated.',
        html: layout({
          title: 'Application status updated',
          preheader: `Your ${role} application is now ${status}.`,
          body: `<p style="margin:0 0 14px;">Hi ${escapeHtml(safe(d.studentName, 'Student'))},</p>
            <p style="margin:0 0 12px;">Your application for <strong>${escapeHtml(role)}</strong> at <strong>${escapeHtml(company)}</strong> is now <strong>${escapeHtml(status)}</strong>.</p>
            <p style="margin:0;">Sign in to view the latest status and any recruiter updates.</p>`,
          ctaLabel: 'View application',
          ctaUrl: link(app, '/student/applications'),
        }),
        text: `Hi ${safe(d.studentName, 'Student')},\n\nYour application for ${role} at ${company} is now ${status}.\n\nSign in to view the latest status and any recruiter updates.\n\nView your application: ${link(app, '/student/applications')}\n\nJOB N JOB · Campus Placement Management`,
      };
    }

    case 'drive-published': {
      const role = safe(d.role, 'your recruitment drive');
      return {
        subject: 'Your placement drive is live on JOB N JOB.',
        html: layout({
          title: 'Your drive is live',
          preheader: 'Students can now discover and apply.',
          body: `<p style="margin:0 0 14px;">Your recruitment drive <strong>${escapeHtml(role)}</strong> is now published.</p>
            ${detailsTable([
              { label: 'Location', value: safe(d.location, 'Not specified') },
              { label: 'Package', value: safe(d.package, 'Not disclosed') },
              { label: 'Deadline', value: formatDate(d.deadline) },
            ])}
            <p style="margin:12px 0 0;">Eligible students can now apply. You can review applications from your recruiter dashboard.</p>`,
          ctaLabel: 'Manage your drives',
          ctaUrl: link(app, '/company/drives'),
        }),
        text: `Your recruitment drive ${role} is now published.\n\nLocation: ${safe(d.location, 'Not specified')}\nPackage: ${safe(d.package, 'Not disclosed')}\nDeadline: ${formatDate(d.deadline)}\n\nEligible students can now apply. Manage your drives: ${link(app, '/company/drives')}\n\nJOB N JOB · Campus Placement Management`,
      };
    }

    case 'drive-announcement': {
      const role = safe(d.role, 'a new role');
      const company = safe(d.companyName, 'a company');
      return {
        subject: `New placement drive: ${role} at ${company}.`,
        html: layout({
          title: 'A new drive matches your profile',
          preheader: `${company} is hiring for ${role}.`,
          body: `<p style="margin:0 0 14px;">Hi ${escapeHtml(safe(d.studentName, 'Student'))},</p>
            <p style="margin:0 0 12px;">A new placement drive has been published and you meet its eligibility rules.</p>
            ${detailsTable([
              { label: 'Company', value: company },
              { label: 'Role', value: role },
              { label: 'Location', value: safe(d.location, 'Not specified') },
              { label: 'Package', value: safe(d.package, 'Not disclosed') },
              { label: 'Minimum CGPA', value: d.minimumCGPA ?? 'Not specified' },
              { label: 'Branches', value: list(d.branches).join(' / ') || 'All' },
              { label: 'Deadline', value: formatDate(d.deadline) },
            ])}
            <p style="margin:12px 0 0;">Review the full details and apply before the deadline.</p>`,
          ctaLabel: 'View this drive',
          ctaUrl: link(app, `/student/drives/${d.driveId || ''}`),
          footerNote: 'You are receiving this because you opted in to placement drive announcements. You can change this in your profile.',
        }),
        text: `Hi ${safe(d.studentName, 'Student')},\n\nA new placement drive has been published and you meet its eligibility rules.\n\nCompany: ${company}\nRole: ${role}\nLocation: ${safe(d.location, 'Not specified')}\nPackage: ${safe(d.package, 'Not disclosed')}\nMinimum CGPA: ${d.minimumCGPA ?? 'Not specified'}\nBranches: ${list(d.branches).join(' / ') || 'All'}\nDeadline: ${formatDate(d.deadline)}\n\nView this drive: ${link(app, `/student/drives/${d.driveId || ''}`)}\n\nYou can change your email preferences in your profile.\n\nJOB N JOB · Campus Placement Management`,
      };
    }

    case 'drive-closed': {
      const role = safe(d.role, 'Your drive');
      return {
        subject: `${role} is now closed for applications.`,
        html: layout({
          title: 'Drive closed',
          preheader: 'Applications are no longer being accepted.',
          body: `<p style="margin:0 0 14px;">Your recruitment drive <strong>${escapeHtml(role)}</strong> is now closed.</p>
            <p style="margin:0;">Applications already received remain available in your recruiter dashboard.</p>`,
          ctaLabel: 'Review applicants',
          ctaUrl: link(app, '/company/applicants'),
        }),
        text: `Your recruitment drive ${role} is now closed.\n\nApplications already received remain available in your recruiter dashboard.\n\nReview applicants: ${link(app, '/company/applicants')}\n\nJOB N JOB · Campus Placement Management`,
      };
    }

    case 'drive-deadline': {
      const role = safe(d.role, 'Your drive');
      return {
        subject: `Your ${role} drive closes in ${d.days || 3} days.`,
        html: layout({
          title: 'Application deadline approaching',
          preheader: `Your ${role} drive closes soon.`,
          body: `<p style="margin:0 0 14px;">Your recruitment drive <strong>${escapeHtml(role)}</strong> closes on <strong>${escapeHtml(formatDate(d.deadline))}</strong>.</p>
            <p style="margin:0;">Review any pending applications before the deadline.</p>`,
          ctaLabel: 'Review applicants',
          ctaUrl: link(app, '/company/applicants'),
        }),
        text: `Your recruitment drive ${role} closes on ${formatDate(d.deadline)}.\n\nReview any pending applications before the deadline: ${link(app, '/company/applicants')}\n\nJOB N JOB · Campus Placement Management`,
      };
    }

    case 'admin-new-company': {
      const company = safe(d.companyName, 'A new company');
      return {
        subject: 'New recruiter registration requires verification.',
        html: layout({
          title: 'New recruiter needs verification',
          preheader: `${company} has registered and is awaiting approval.`,
          body: `<p style="margin:0 0 14px;"><strong>${escapeHtml(company)}</strong> has registered as a recruiter and is awaiting placement-cell verification.</p>
            ${detailsTable([
              { label: 'Industry', value: safe(d.industry, 'Not specified') },
              { label: 'Location', value: safe(d.location, 'Not specified') },
              { label: 'HR contact', value: safe(d.hrName, 'Not specified') },
              { label: 'HR email', value: safe(d.hrEmail, 'Not specified') },
              { label: 'Registered on', value: formatDate(d.registeredOn) },
            ])}
            <p style="margin:12px 0 0;">Review the company and approve or revoke verification from the admin dashboard.</p>`,
          ctaLabel: 'Review companies',
          ctaUrl: link(app, '/admin/companies'),
        }),
        text: `${company} has registered as a recruiter and is awaiting placement-cell verification.\n\nIndustry: ${safe(d.industry, 'Not specified')}\nLocation: ${safe(d.location, 'Not specified')}\nHR contact: ${safe(d.hrName, 'Not specified')}\nHR email: ${safe(d.hrEmail, 'Not specified')}\nRegistered on: ${formatDate(d.registeredOn)}\n\nReview companies: ${link(app, '/admin/companies')}\n\nJOB N JOB · Campus Placement Management`,
      };
    }

    default:
      throw new Error(`Unknown email template: ${templateId}`);
  }
}
