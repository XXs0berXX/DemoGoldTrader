import type { ReactNode } from 'react';
import { AsasaMark, BellIcon, ChevronLeftIcon } from './icons';

interface AppBarProps {
  title: string;
  onBack?: () => void;
  /** Adds the hairline under the bar once content scrolls beneath it. */
  bordered?: boolean;
  children?: ReactNode;
}

export function AppBar({ title, onBack, bordered = false, children }: AppBarProps): JSX.Element {
  return (
    <header className={`appbar${bordered ? ' appbar--bordered' : ''}`}>
      <div className="appbar__left">
        {onBack ? (
          <button type="button" className="appbar__back" onClick={onBack} aria-label="Go back">
            <ChevronLeftIcon />
          </button>
        ) : (
          <AsasaMark />
        )}
      </div>

      <h1 className="appbar__title">{title}</h1>

      <div className="appbar__right">
        {children}
        <span className="bell" aria-hidden="true">
          <BellIcon />
          <span className="bell__dot">1</span>
        </span>
        <span className="avatar" aria-hidden="true">
          AS
        </span>
      </div>
    </header>
  );
}
