import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "@/lib/api";

// A native modal <dialog>: the browser traps focus inside it and turns Escape
// into a close. Focus goes back to whatever opened it.
export function Dialog({
  open,
  onClose,
  titleId,
  size = "large",
  children,
}: {
  open: boolean;
  onClose: () => void;
  titleId: string;
  size?: "large" | "small";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // A layout effect, so the dialog is modal before its content's effects move focus into it.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      aria-labelledby={titleId}
      className={`dialog dialog-${size}`}
      onClose={() => {
        onClose();
        opener.current?.focus();
      }}
      ref={ref}
    >
      {open ? children : null}
    </dialog>
  );
}

type DeleteProps = {
  title: string;
  children: ReactNode;
  confirm: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

/** The small confirm before a delete. The confirm button names what it deletes. */
export function DeleteDialog({ open, ...props }: DeleteProps & { open: boolean }) {
  return (
    <Dialog onClose={props.onClose} open={open} size="small" titleId="delete-title">
      <DeleteConfirm {...props} />
    </Dialog>
  );
}

// Mounted only while open, so a failed attempt does not greet the next one.
function DeleteConfirm({ title, children, confirm, onConfirm, onClose }: DeleteProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="dialog-head">
        <h2 id="delete-title">{title}</h2>
      </div>
      <div className="dialog-body">
        {children}
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="dialog-foot">
        <button className="button quiet" disabled={busy} onClick={onClose} type="button">
          Cancel
        </button>
        <button aria-busy={busy} className="button danger" disabled={busy} onClick={run} type="button">
          {busy ? "Deleting…" : confirm}
        </button>
      </div>
    </>
  );
}
