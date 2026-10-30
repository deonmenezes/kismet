// Small stroke icons for the chat shell (24px grid, currentColor).
const I = ({ d, className = "size-5" }: { d: string; className?: string }) => (
  <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d={d} />
  </svg>
);
export const PlusIcon = (p: { className?: string }) => <I {...p} d="M12 5v14M5 12h14" />;
export const MicIcon = (p: { className?: string }) => <I {...p} d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />;
export const ArrowUpIcon = (p: { className?: string }) => <I {...p} d="M12 19V5M5 12l7-7 7 7" />;
export const MenuIcon = (p: { className?: string }) => <I {...p} d="M4 7h16M4 12h16M4 17h10" />;
export const CopyIcon = (p: { className?: string }) => <I {...p} d="M9 9h10v10H9zM5 15V5h10" />;
export const CheckIcon = (p: { className?: string }) => <I {...p} d="M5 12l5 5L20 7" />;
export const CloseIcon = (p: { className?: string }) => <I {...p} d="M6 6l12 12M18 6L6 18" />;
export const ChatIcon = (p: { className?: string }) => <I {...p} d="M4 5h16v11H8l-4 4z" />;
export const HeartIcon = (p: { className?: string }) => <I {...p} d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />;
export const ShieldIcon = (p: { className?: string }) => <I {...p} d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z" />;
export const UserIcon = (p: { className?: string }) => <I {...p} d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />;
export const CalendarIcon = (p: { className?: string }) => <I {...p} d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" />;
export const BoardIcon = (p: { className?: string }) => <I {...p} d="M4 4h16v12H8l-4 4zM8 9h8M8 12h5" />;
export const AppsIcon = (p: { className?: string }) => <I {...p} d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />;
export const LogOutIcon = (p: { className?: string }) => <I {...p} d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />;
export const SparkIcon = (p: { className?: string }) => <I {...p} d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />;
export const WhatsAppIcon = (p: { className?: string }) => <I {...p} d="M5 19l1.2-3.6A7.5 7.5 0 1 1 9 18.2zM9.5 9.5c.3 2 2 3.8 4 4.2l1-1 1.8.8-.5 1.6c-3 .3-6.3-3-6.1-6l1.6-.5.8 1.8z" />;
export const BackIcon = (p: { className?: string }) => <I {...p} d="M15 5l-7 7 7 7" />;
export const ChevronIcon = (p: { className?: string }) => <I {...p} d="M6 9l6 6 6-6" />;
export const ExternalIcon = (p: { className?: string }) => <I {...p} d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />;
