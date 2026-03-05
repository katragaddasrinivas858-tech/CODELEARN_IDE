import { useEffect, useRef } from "react";

export default function Modal({ open, title, description, onClose, onConfirm, children }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelector("input, select, textarea, button");
    if (focusable && typeof focusable.focus === "function") {
      focusable.focus();
    }
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }

    if (event.key === "Enter" && event.target?.tagName !== "TEXTAREA") {
      event.preventDefault();
      onConfirm?.();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onKeyDown={onKeyDown}>
      <div
        ref={panelRef}
        className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-950 p-5 shadow-2xl"
      >
        <div className="text-lg font-semibold text-white">{title}</div>
        {description && <div className="mt-1 text-sm text-slate-400">{description}</div>}
        <div className="mt-4">{children}</div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-slate-300 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
