"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { fromInputs, isPast, isoDay, isoTime } from "@/lib/postDates";

const input =
  "h-11 rounded-xl border border-line-strong bg-surface-2 px-3 text-[15px] text-ink focus:border-primary focus:outline-none";

/** Pick a new date and time for a post. Also the keyboard path for calendar drag-and-drop. */
export function RescheduleDialog({
  open,
  onClose,
  initial,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initial: Date;
  onSave: (when: Date) => Promise<boolean>;
}) {
  const [day, setDay] = useState(isoDay(initial));
  const [time, setTime] = useState(isoTime(initial));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const when = fromInputs(day, time);
    if (!when) return setError("Pick a date and time.");
    if (isPast(when)) return setError("That time has passed. Pick a time in the future.");
    setBusy(true);
    const ok = await onSave(when);
    setBusy(false);
    if (ok) onClose();
    else setError("We couldn't move the post. Try again.");
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Reschedule"
      description={`Times are in your time zone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
          Date
          <input type="date" value={day} min={isoDay(new Date())} onChange={(e) => setDay(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
          Time
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={input} />
        </label>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}
