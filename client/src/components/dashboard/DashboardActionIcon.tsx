import { memo } from 'react';

type ActionIconProps = {
  name: string;
  className?: string;
};

function DashboardActionIcon({ name, className = 'h-8 w-8' }: ActionIconProps) {
  switch (name) {
    case 'Add Student':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
            stroke="#2563eb"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="9" cy="7" r="4" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19 8v6M22 11h-6" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'New Exam':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <rect
            x="4"
            y="3"
            width="16"
            height="18"
            rx="3"
            stroke="#0891b2"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M12 8v8M8 12h8" stroke="#0891b2" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'Attendance':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <rect
            x="3"
            y="4"
            width="18"
            height="17"
            rx="3"
            stroke="#16a34a"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M16 2v4M8 2v4M3 9h18" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="8" cy="13" r="1" fill="#16a34a" />
          <circle cx="12" cy="13" r="1" fill="#16a34a" />
          <circle cx="16" cy="13" r="1" fill="#16a34a" />
          <circle cx="8" cy="17" r="1" fill="#16a34a" />
          <circle cx="12" cy="17" r="1" fill="#16a34a" />
          <circle cx="16" cy="17" r="1" fill="#16a34a" />
        </svg>
      );

    case 'Fees':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <rect
            x="2"
            y="5"
            width="20"
            height="14"
            rx="3"
            stroke="#d97706"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3" stroke="#d97706" strokeWidth="2.2" />
          <path d="M6 12h.01M18 12h.01" stroke="#d97706" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );

    case 'Broadcast':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M3 11v3a1 1 0 0 0 1 1h4l5 4V5L8 9H4a1 1 0 0 0-1 1z"
            stroke="#ea580c"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11"
            stroke="#ea580c"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'Homework':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
            stroke="#0284c7"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M14 2v6h6M8 13h8M8 17h5" stroke="#0284c7" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );

    case 'Lead CRM':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M17 21v-2a4 4 0 0 0-3-3.87M9 21v-2a4 4 0 0 1 3-3.87m0 0a4 4 0 1 0 0-7.74 4 4 0 0 0 0 7.74zM21 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM7 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"
            stroke="#9333ea"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'Reports':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M18 20V10M12 20V4M6 20v-6"
            stroke="#e11d48"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
  }
}

export default memo(DashboardActionIcon);

