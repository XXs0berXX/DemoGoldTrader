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
/**
 * The Asasa mark, exported from the brand Figma (`Asasa_logo`). The two paths
 * are the source vector verbatim — the outer teal "A" and the inner accent
 * triangle — rather than a hand-drawn approximation.
 *
 * `size` is the rendered height; the width follows the artwork's own 446:349
 * ratio so the mark is never squashed.
 */
export function AsasaMark({ size = 26, className }: IconProps): JSX.Element {
  return (
    <svg
      width={(size * 446) / 349}
      height={size}
      viewBox="0 0 446 349"
      fill="none"
      role="img"
      aria-label="Asasa"
      focusable="false"
      className={className}
    >
      <path
        d="M289.472 348.391H156.592C155.26 348.39 153.951 348.039 152.798 347.372C151.644 346.705 150.686 345.747 150.019 344.593C149.353 343.439 149.001 342.131 149 340.798C148.999 339.466 149.348 338.156 150.012 337.001L183.232 279.461L214.832 224.741C215.663 223.3 216.859 222.103 218.299 221.271C219.74 220.438 221.374 220 223.037 220C224.701 220 226.335 220.438 227.776 221.271C229.216 222.103 230.412 223.3 231.242 224.741L262.842 279.461L296.042 337.001C296.707 338.156 297.056 339.466 297.055 340.798C297.054 342.131 296.702 343.439 296.036 344.593C295.369 345.747 294.411 346.705 293.257 347.372C292.104 348.039 290.795 348.39 289.462 348.391H289.472Z"
        fill="var(--logo-accent, #8CCB50)"
      />
      <path
        d="M379.217 347.658H439.317C440.326 347.657 441.317 347.391 442.19 346.887C443.064 346.383 443.789 345.657 444.294 344.784C444.798 343.911 445.064 342.92 445.065 341.911C445.066 340.903 444.801 339.911 444.297 339.038L335.907 151.298L261.567 22.5375C244.217 -7.5125 200.847 -7.5125 183.497 22.5375L109.157 151.298L0.767471 339.038C0.264032 339.911 -0.000647161 340.903 0 341.911C0.000649537 342.92 0.266602 343.911 0.771165 344.784C1.27573 345.657 2.00115 346.383 2.87461 346.887C3.74807 347.391 4.73884 347.657 5.74747 347.658H65.8475C66.8574 347.663 67.8507 347.4 68.7257 346.896C69.6007 346.392 70.3261 345.664 70.8275 344.788L145.837 214.827L208.987 105.467C210.361 103.092 212.335 101.12 214.711 99.7486C217.088 98.3774 219.784 97.6555 222.527 97.6555C225.271 97.6555 227.967 98.3774 230.343 99.7486C232.72 101.12 234.694 103.092 236.067 105.467L299.197 214.827L374.237 344.788C374.747 345.657 375.474 346.38 376.347 346.883C377.22 347.386 378.21 347.653 379.217 347.658Z"
        fill="var(--logo-primary, #0D4A46)"
      />
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

export function EyeIcon({ size = 17, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M2.6 11.3a1 1 0 0 0 0 1.4C3.7 14.3 7.1 18.4 12 18.4s8.3-4.1 9.4-5.7a1 1 0 0 0 0-1.4C20.3 9.7 16.9 5.6 12 5.6S3.7 9.7 2.6 11.3Z" />
      <circle cx="12" cy="12" r="3" />
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
