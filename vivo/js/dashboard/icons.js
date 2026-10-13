/** Small stroke-style nav icons, 18x18, stroke="currentColor" so they inherit the nav item's color. */

const wrap = (inner) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const icons = {
  overview: wrap('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  sleep: wrap('<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>'),
  recovery: wrap('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>'),
  activity: wrap('<path d="M13 3L5 14h6l-1 7 8-11h-6l1-7Z"/>'),
  trends: wrap('<path d="M3 17l5-6 4 3 7-9"/><path d="M14 5h5v5"/>'),
  insights: wrap('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 2Z"/>'),
  leverage: wrap('<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>'),
  menu: wrap('<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>'),
  upload: wrap('<path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>'),
  close: wrap('<path d="M18 6 6 18"/><path d="M6 6l12 12"/>'),
};
