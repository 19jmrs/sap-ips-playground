import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button,a[href],input,select,textarea,summary,[tabindex="0"]';

/**
 * Behaviour every modal dialog needs, for the element `dialogRef` points at: focus moves in on open (to the first
 * focusable element; a child that takes focus itself, like an editor with autoFocus, wins), Tab stays inside, Escape
 * calls `onClose`, and focus returns to the opener on close.
 *
 * Escape that something inside already handled (an open completion list, say) is left to it: the handler checks
 * `defaultPrevented`.
 *
 * With `isolate`, every other child of <body> is made `inert` while the dialog is open, for dialogs rendered in a
 * portal where the page behind is not otherwise disabled.
 */
export function useModal(dialogRef, onClose, { isolate = false } = {}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    // Content inside closed <details> has no layout box and cannot take focus.
    const focusable = () =>
      [...dialog.querySelectorAll(FOCUSABLE)].filter((element) => element.getClientRects().length);
    focusable()[0]?.focus();

    const inerted = [];
    if (isolate) {
      for (const child of document.body.children) {
        if (child.contains(dialog) || child.hasAttribute('inert')) continue;
        child.setAttribute('inert', '');
        inerted.push(child);
      }
    }

    function keydown(event) {
      if (event.key === 'Escape' && !event.defaultPrevented) closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      for (const child of inerted) child.removeAttribute('inert');
      previous?.focus();
    };
    // Runs once per open: the options are fixed for the lifetime of a dialog.
  }, []);
}
