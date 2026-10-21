import { useEffect } from 'react';
import Icon from './Icon';

/**
 * components/Modal.jsx
 * ---------------------------------------------------------------------------
 * A reusable dialog, used for the "Confirm application" step and the company
 * "Create drive" form.
 *
 * Usage:
 *   {showModal && (
 *     <Modal title="..." onClose={close} footer={<Button .../>}>
 *       content
 *     </Modal>
 *   )}
 *
 * Implementation notes (useful for the viva):
 *  - the browser only has one DOM tree, so the overlay is `position: fixed`
 *  - Escape closes it, and clicking the dark overlay closes it too
 *  - we lock background scrolling while it is open
 */
export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
  closeOnOverlay = true,
}) {
  // Close on the Escape key + prevent the page behind from scrolling.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onClick={closeOnOverlay ? onClose : undefined}
      role="presentation"
    >
      <div
        className={`modal ${wide ? 'modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        onClick={(event) => event.stopPropagation()} // clicks inside must not close it
      >
        <header className="modal__header">
          <div>
            <div className="modal__title">{title}</div>
            {subtitle ? <div className="modal__subtitle">{subtitle}</div> : null}
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="modal__body">{children}</div>

        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
