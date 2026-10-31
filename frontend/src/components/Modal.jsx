import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const focusableSelector = [
  'button',
  'a[href]',
  'area[href]',
  'input',
  'select',
  'textarea',
  'summary',
  '[tabindex]',
  '[contenteditable="true"]',
  'audio[controls]',
  'video[controls]',
].join(',');

function isAvailable(element, dialog) {
  if (element.tabIndex < 0 || element.matches(':disabled, input[type="hidden"]')) return false;
  for (let node = element; node && node !== dialog.parentElement; node = node.parentElement) {
    if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true')
      return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) return false;
    if (node.tagName === 'DETAILS' && !node.open) {
      const summary = Array.from(node.children).find((child) => child.tagName === 'SUMMARY');
      if (!summary?.contains(element)) return false;
    }
  }
  return true;
}

function tabStops(dialog) {
  return Array.from(dialog.querySelectorAll(focusableSelector))
    .filter((element) => isAvailable(element, dialog))
    .sort((a, b) => {
      const aOrder = a.tabIndex > 0 ? a.tabIndex : Infinity;
      const bOrder = b.tabIndex > 0 ? b.tabIndex : Infinity;
      return aOrder === bOrder ? 0 : aOrder - bOrder;
    });
}

export default function Modal({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  const subtitleId = `${titleId}-description`;

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.focus();
    document.body.style.overflow = 'hidden';

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const stops = tabStops(dialog);
      const active = document.activeElement;
      const first = stops[0];
      const last = stops.at(-1);
      if (!stops.length) {
        event.preventDefault();
        dialog.focus();
      } else if (!stops.includes(active)) {
        // Initial dialog focus and programmatic focus must stay in the same keyboard loop.
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const keepFocusInside = (event) => {
      if (!dialog.contains(event.target)) dialog.focus();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', keepFocusInside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', keepFocusInside);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div
      className="modal-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        ref={ref}
      >
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p id={subtitleId}>{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={18} strokeWidth={1.5} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
