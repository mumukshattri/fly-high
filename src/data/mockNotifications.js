/**
 * mockNotifications.js
 * ---------------------------------------------------------------------------
 * DEMO DATA ONLY. Mirrors the `notifications` collection
 * (GET /api/notifications). In a real system each notification would be
 * created by the backend whenever an application status changes, a new drive
 * is published, or a deadline is close.
 */

export const notifications = [
  {
    id: 'ntf-01',
    studentId: 'stu-101',
    type: 'success',
    title: 'You have been shortlisted',
    message:
      'Infosys shortlisted you for the Systems Engineer (Analyst) role. Your technical interview is on 12 Oct 2026, 10:00 AM.',
    date: '2026-10-03',
    read: false,
  },
  {
    id: 'ntf-02',
    studentId: 'stu-101',
    type: 'info',
    title: 'Application under review',
    message: 'Zoho is reviewing your application for Member Technical Staff.',
    date: '2026-10-04',
    read: false,
  },
  {
    id: 'ntf-03',
    studentId: 'stu-101',
    type: 'warning',
    title: 'Deadline approaching',
    message: 'TechNova - Software Development Engineer closes on 15 Oct 2026. Apply before the deadline.',
    date: '2026-10-05',
    read: false,
  },
  {
    id: 'ntf-04',
    studentId: 'stu-101',
    type: 'danger',
    title: 'Application not selected',
    message: 'Persistent Systems did not move your application forward for QA Automation Engineer.',
    date: '2026-10-05',
    read: true,
  },
  {
    id: 'ntf-05',
    studentId: 'stu-101',
    type: 'info',
    title: 'New recruitment drive published',
    message: 'Accenture published Associate Software Engineer (40 openings). Check your eligibility.',
    date: '2026-09-27',
    read: true,
  },
  {
    id: 'ntf-06',
    studentId: 'stu-101',
    type: 'info',
    title: 'Profile verified',
    message: 'The placement cell verified your academic details. Please keep your resume updated.',
    date: '2026-09-20',
    read: true,
  },
  // A couple of notifications for other students so the admin view has data.
  {
    id: 'ntf-07',
    studentId: 'stu-104',
    type: 'success',
    title: 'Offer received',
    message: 'Luminar Analytics released an internship offer for Full Stack Developer.',
    date: '2026-10-01',
    read: true,
  },
  {
    id: 'ntf-08',
    studentId: 'stu-107',
    type: 'success',
    title: 'Offer received',
    message: 'Persistent Systems released an offer for QA Automation Engineer.',
    date: '2026-10-05',
    read: true,
  },
];
