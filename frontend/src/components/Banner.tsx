import type { ReactNode } from 'react';
import { AlertIcon, InfoIcon, ShieldIcon } from './icons';

export type BannerTone = 'paused' | 'guardrail' | 'shortfall' | 'info' | 'demo';

interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  children: ReactNode;
  /** `alert` for anything that blocks the user right now. */
  role?: 'status' | 'alert';
  className?: string;
}

function toneIcon(tone: BannerTone): JSX.Element | null {
  switch (tone) {
    case 'paused':
    case 'shortfall':
      return <AlertIcon />;
    case 'guardrail':
      return <ShieldIcon />;
    case 'info':
      return <InfoIcon />;
    default:
      return null;
  }
}

/**
 * A degraded or informational state. Deliberately calm: bordered, low-contrast,
 * and always paired with a title that says plainly what is going on — never a
 * red error dump.
 */
export function Banner({
  tone = 'info',
  title,
  children,
  role = 'status',
  className,
}: BannerProps): JSX.Element {
  const icon = toneIcon(tone);
  return (
    <div
      className={['banner', `banner--${tone}`, className ?? ''].filter(Boolean).join(' ')}
      role={role}
    >
      {icon ? <span className="banner__icon">{icon}</span> : null}
      <span>
        {title ? <strong className="banner__title">{title}</strong> : null}
        {children}
      </span>
    </div>
  );
}
