import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from '../src/components/Modal.jsx';

describe('modal keyboard and dismissal behavior', () => {
  it('keeps initial reverse tab and both boundary directions inside visible enabled controls', () => {
    const { rerender } = render(
      <Modal title="Edit invoice" subtitle="Review the billing details" onClose={() => {}}>
        <input aria-label="Reference" />
        <details>
          <summary>Payment details</summary>
          <button>Hidden by closed disclosure</button>
        </details>
        <button disabled>Disabled action</button>
        <div hidden>
          <button>Hidden action</button>
        </div>
        <div style={{ display: 'none' }}>
          <button>Invisible action</button>
        </div>
        <button tabIndex={-1}>Programmatic only</button>
        <div tabIndex={0}>Invoice notes</div>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit invoice' });
    const close = screen.getByRole('button', { name: 'Close dialog' });
    const last = screen.getByText('Invoice notes');
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveAccessibleDescription('Review the billing details');
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();
    rerender(
      <Modal title="Edit invoice" onClose={() => {}}>
        <details>
          <summary>Payment details</summary>
          <button>Hidden by closed disclosure</button>
        </details>
      </Modal>,
    );
    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(screen.getByText('Payment details')).toHaveFocus();
  });

  it('closes on Escape and restores the trigger and the previous body scrolling style', async () => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'scroll';
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open customer</button>
          {open && (
            <Modal title="Customer" onClose={() => setOpen(false)}>
              <input aria-label="Name" />
            </Modal>
          )}
        </>
      );
    }
    try {
      render(<Example />);
      const user = userEvent.setup();
      const trigger = screen.getByRole('button', { name: 'Open customer' });
      await user.click(trigger);
      expect(document.body.style.overflow).toBe('hidden');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      expect(document.body.style.overflow).toBe('scroll');
    } finally {
      document.body.style.overflow = before;
    }
  });

  it('recaptures programmatic outside focus and calls the current close handler', () => {
    const originalClose = vi.fn();
    const currentClose = vi.fn();
    const content = (onClose) => (
      <>
        <button>Outside action</button>
        <Modal title="Payment" onClose={onClose}>
          <button>Save payment</button>
        </Modal>
      </>
    );
    const { rerender } = render(content(originalClose));
    screen.getByRole('button', { name: 'Outside action' }).focus();
    expect(screen.getByRole('dialog')).toHaveFocus();
    rerender(content(currentClose));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(currentClose).toHaveBeenCalledOnce();
    expect(originalClose).not.toHaveBeenCalled();
  });

  it('dismisses on the backdrop but not when clicking dialog contents', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Invoice details" onClose={onClose}>
        <p>Invoice balance</p>
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByText('Invoice balance'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
