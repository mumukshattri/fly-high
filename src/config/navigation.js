/**
 * config/navigation.js
 * ---------------------------------------------------------------------------
 * ONE place that describes the sidebar for each role, plus the title and
 * subtitle shown in the top bar.
 *
 * Keeping this here (instead of inside App.jsx) means adding a page is a
 * two-line change: add a route in App.jsx and one entry here.
 */

/** Landing page of each role after login. */
export const HOME_ROUTE = {
  student: '/student/dashboard',
  company: '/company/dashboard',
  admin: '/admin/dashboard',
};

/** Friendly labels for the three roles. */
export const ROLE_LABELS = {
  student: 'Student',
  company: 'Recruiter',
  admin: 'Placement Admin',
};

/** Where the top bar search box sends the user for each role. */
export const SEARCH_ROUTE = {
  student: '/student/drives',
  company: '/company/applicants',
  admin: '/admin/students',
};

export const NAVIGATION = {
  student: {
    sectionLabel: 'Student Portal',
    items: [
      {
        label: 'Dashboard',
        path: '/student/dashboard',
        icon: 'dashboard',
        title: 'Dashboard',
        subtitle: 'Your placement activity at a glance',
      },
      {
        label: 'My Profile',
        path: '/student/profile',
        icon: 'user',
        title: 'My Profile',
        subtitle: 'Academic details, skills and resume',
      },
      {
        label: 'Recruitment Drives',
        path: '/student/drives',
        icon: 'briefcase',
        title: 'Recruitment Drives',
        subtitle: 'Open drives from visiting companies with your eligibility status',
      },
      {
        label: 'My Applications',
        path: '/student/applications',
        icon: 'file-text',
        title: 'My Applications',
        subtitle: 'Track every application through the hiring pipeline',
      },
      {
        label: 'Notifications',
        path: '/student/notifications',
        icon: 'bell',
        title: 'Notifications',
        subtitle: 'Updates from companies and the placement cell',
      },
    ],
    detailPages: [
      {
        test: /^\/student\/drives\/[^/]+$/,
        title: 'Drive Details',
        subtitle: 'Job description, requirements and your eligibility breakdown',
      },
      {
        test: /^\/student\/applications\/[^/]+$/,
        title: 'Application Details',
        subtitle: 'Progress of this application through the hiring pipeline',
      },
    ],
  },

  company: {
    sectionLabel: 'Recruiter Workspace',
    items: [
      {
        label: 'Dashboard',
        path: '/company/dashboard',
        icon: 'dashboard',
        title: 'Recruiter Dashboard',
        subtitle: 'Hiring activity across your recruitment drives',
      },
      {
        label: 'Recruitment Drives',
        path: '/company/drives',
        icon: 'briefcase',
        title: 'Recruitment Drives',
        subtitle: 'Create and manage the drives you publish to the campus',
      },
      {
        label: 'Applicants',
        path: '/company/applicants',
        icon: 'users',
        title: 'Applicants',
        subtitle: 'Review student applications and update their status',
      },
    ],
    detailPages: [],
  },

  admin: {
    sectionLabel: 'Placement Cell',
    items: [
      {
        label: 'Dashboard',
        path: '/admin/dashboard',
        icon: 'dashboard',
        title: 'Placement Dashboard',
        subtitle: 'Overall campus recruitment activity',
      },
      {
        label: 'Students',
        path: '/admin/students',
        icon: 'graduation',
        title: 'Registered Students',
        subtitle: 'Every student registered with the placement cell',
      },
      {
        label: 'Companies',
        path: '/admin/companies',
        icon: 'building',
        title: 'Companies',
        subtitle: 'Recruiters registered with the portal',
      },
      {
        label: 'Recruitment Drives',
        path: '/admin/drives',
        icon: 'briefcase',
        title: 'All Recruitment Drives',
        subtitle: 'Every drive published across the campus',
      },
      {
        label: 'Applications',
        path: '/admin/applications',
        icon: 'file-text',
        title: 'All Applications',
        subtitle: 'Monitor the status of every application',
      },
      {
        label: 'Placement Statistics',
        path: '/admin/statistics',
        icon: 'bar-chart',
        title: 'Placement Statistics',
        subtitle: 'Branch-wise and company-wise placement analysis',
      },
    ],
    detailPages: [],
  },
};

/**
 * Works out what the top bar should say for the current URL.
 * Detail pages (like /student/drives/drv-01) are matched with the regex list.
 */
export function getPageMeta(pathname, role) {
  const config = NAVIGATION[role];
  if (!config) return { title: 'Placement Portal', subtitle: '' };

  const detail = config.detailPages.find((page) => page.test.test(pathname));
  if (detail) return { title: detail.title, subtitle: detail.subtitle };

  // Longest matching prefix wins, so '/student/drives/drv-01' still matches
  // '/student/drives' when no detail rule exists.
  const item = [...config.items]
    .sort((a, b) => b.path.length - a.path.length)
    .find((navItem) => pathname.startsWith(navItem.path));

  return item
    ? { title: item.title, subtitle: item.subtitle }
    : { title: 'Placement Portal', subtitle: '' };
}
