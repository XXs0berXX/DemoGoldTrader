import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons';

interface SheetProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

/** A bottom sheet. Escape closes it, backdrop clicks close it, and focus moves
 *  into the sheet on open so keyboard users are not left behind the scrim. */
export function Sheet({ open, title, subtitle, onClose, children }: SheetProps): JSX.Element | null {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__head">
          <div>
            <h2 className="sheet__title">{title}</h2>
            {subtitle ? <p className="sheet__sub">{subtitle}</p> : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="sheet__close"
            onClick={onClose}
            aria-label="Close demo controls"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  );
}
