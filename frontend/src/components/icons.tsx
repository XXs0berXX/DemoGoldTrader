/**
 * Hand-drawn icon set. Thin single-weight strokes, matching the light line
 * icons in the Asasa reference screens. Kept inline (no icon dependency) so the
 * bundle stays small and the stroke weight stays consistent.
 */

interface IconProps {
  size?: number;
  className?: string;
}

function svgProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: 'false' as const,
    className,
  };
}

/** The Asasa mark: an angular "A" with a green inner peak. */
export function AsasaMark({ size = 26, className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M16 3.5 30 27.5h-7.6L16 15.4 9.6 27.5H2L16 3.5Z" fill="#0D4A46" />
      <path d="M16 17.6l5.2 9.9H10.8L16 17.6Z" fill="#8CCB50" />
    </svg>
  );
}

export function BellIcon({ size = 21, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 4.2-1.2 5.7-2 6.6-.3.4 0 .9.5.9h15c.5 0 .8-.5.5-.9-.8-.9-2-2.4-2-6.6Z" />
      <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

export function EyeOffIcon({ size = 17, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.3A9.6 9.6 0 0 1 12 5.2c5 0 8.4 4 9.4 5.6.2.3.2.7 0 1a17 17 0 0 1-2.5 3" />
      <path d="M6.5 6.9C4.5 8.2 3.1 10 2.6 10.8a1 1 0 0 0 0 1c1 1.6 4.4 5.6 9.4 5.6 1.6 0 3-.4 4.2-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

export function InfoIcon({ size = 17, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.8h.01" />
    </svg>
  );
}

export function BuyGoldIcon({ size = 24, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <ellipse cx="9" cy="7" rx="5.5" ry="2.6" />
      <path d="M3.5 7v4.2c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6V7" />
      <path d="M3.5 11.2v4.2c0 1.4 2.5 2.6 5.5 2.6" />
      <circle cx="17" cy="16.5" r="4.2" />
      <path d="M17 14.6v3.8M15.6 16.5h2.8" />
    </svg>
  );
}

export function SellGoldIcon({ size = 24, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <ellipse cx="8.5" cy="6.5" rx="5" ry="2.4" />
      <path d="M3.5 6.5v3.8c0 1.3 2.2 2.4 5 2.4s5-1.1 5-2.4V6.5" />
      <path d="M13 18.5h4.6a2 2 0 0 0 1.7-1l1.4-2.4a1.3 1.3 0 0 0-2-1.6l-2.2 1.9" />
      <path d="M13 21H8.2a3 3 0 0 1-1.8-.6L3 17.8" />
      <path d="M9 17.4h2.6a1.4 1.4 0 0 0 0-2.8h-2a3 3 0 0 1-1.8-.6" />
    </svg>
  );
}

export function TopUpIcon({ size = 24, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="2.8" y="5.5" width="18.4" height="13" rx="3" />
      <path d="M2.8 10h18.4" />
      <path d="M17.5 14.6h1.4" />
    </svg>
  );
}

export function WithdrawIcon({ size = 24, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="2.8" y="6" width="18.4" height="12" rx="3" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M6.2 12h.01M17.8 12h.01" />
    </svg>
  );
}

export function HomeIcon({ size = 22, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3.5 10.4 12 3.8l8.5 6.6V19a1.6 1.6 0 0 1-1.6 1.6H5.1A1.6 1.6 0 0 1 3.5 19v-8.6Z" />
      <path d="M9.6 20.6v-6.2h4.8v6.2" />
    </svg>
  );
}

export function WalletIcon({ size = 22, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="3" y="6" width="18" height="12.5" rx="3" />
      <path d="M3 10.2h18" />
      <path d="M16.6 14.6h1.6" />
    </svg>
  );
}

export function MyGoldIcon({ size = 22, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="9" r="5.4" />
      <path d="M8.6 13.4 7.4 21l4.6-2.4 4.6 2.4-1.2-7.6" />
    </svg>
  );
}

export function CheckIcon({ size = 40, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)} strokeWidth={2.6}>
      <path d="M5 12.6 9.8 17.4 19 7.6" />
    </svg>
  );
}

export function ClockIcon({ size = 22, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.4V12l3 1.8" />
    </svg>
  );
}

export function AlertIcon({ size = 17, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 4.4 21 19.4H3L12 4.4Z" />
      <path d="M12 10v3.4M12 16.4h.01" />
    </svg>
  );
}

export function ShieldIcon({ size = 17, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 3 4.8 5.8V12c0 4.4 3 7.6 7.2 9 4.2-1.4 7.2-4.6 7.2-9V5.8L12 3Z" />
      <path d="M9.2 12.1 11.3 14l3.5-3.8" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 21, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)} strokeWidth={2}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  );
}

export function CloseIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)} strokeWidth={2}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function SlidersIcon({ size = 15, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)} strokeWidth={2}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

export function ArrowUpIcon({ size = 11, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)} strokeWidth={2.4}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}
