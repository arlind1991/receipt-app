// Outline icons drawn on a 24px grid; colour comes from currentColor.

type IconProps = { className?: string };

function Svg({ className = "h-6 w-6", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function ExpensesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 3.5h14v17l-2.3-1.4-2.4 1.4-2.3-1.4-2.4 1.4-2.3-1.4L5 20.5z" />
      <path d="M8.5 8h7M8.5 11.5h7M8.5 15h4" />
    </Svg>
  );
}

export function ReportsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="12" width="3.5" height="8" rx="1.75" />
      <rect x="10.25" y="4" width="3.5" height="16" rx="1.75" />
      <rect x="16.5" y="8.5" width="3.5" height="11.5" rx="1.75" />
    </Svg>
  );
}

export function NewsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z" />
      <path d="M7.5 15.5 9 20" />
      <path d="M16.5 9.5a3.5 3.5 0 0 1 0 5M19 7a7 7 0 0 1 0 10" />
    </Svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="1.8" fill="var(--surface)" />
      <circle cx="15" cy="12" r="1.8" fill="var(--surface)" />
      <circle cx="9" cy="17" r="1.8" fill="var(--surface)" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="12.75" r="3.25" />
    </Svg>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m3.5 17 5-5 4 4 2.5-2.5 5 5" />
    </Svg>
  );
}

export function StoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9.5 5.5 4.5h13L20 9.5" />
      <path d="M4 9.5a2.67 2.67 0 0 0 5.33 0 2.67 2.67 0 0 0 5.34 0 2.67 2.67 0 0 0 5.33 0" />
      <path d="M5 12v7.5h14V12" />
    </Svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="1.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" />
    </Svg>
  );
}

export function CategoryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5 20.5 8 12 12.5 3.5 8z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5" />
      <path d="m3.5 16 8.5 4.5 8.5-4.5" />
    </Svg>
  );
}

export function AmountIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v4c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5V6" />
      <path d="M5 10v4c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-4" />
      <path d="M5 14v4c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-4" />
    </Svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l7.9 7.9a1 1 0 0 1 0 1.4l-7.2 7.2a1 1 0 0 1-1.4 0z" />
      <circle cx="8" cy="8" r="1.5" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 5 7 7-7 7" />
    </Svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Svg>
  );
}

export function SignOutIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 4.5H5.5v15H14" />
      <path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5" />
    </Svg>
  );
}

export function LeafIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z" />
      <path d="M5 19 13 11" />
    </Svg>
  );
}
