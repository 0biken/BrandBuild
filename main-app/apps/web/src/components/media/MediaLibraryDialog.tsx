"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { CheckIcon } from "@/components/ui/icons";
import { invalidate, useQuery } from "@/lib/api/hooks";
import { listMedia, removeMedia } from "@/lib/api/media";
import type { MediaRef } from "@/lib/api/types";
import { MediaView } from "./MediaView";

/** Pick photos and videos imported earlier. */
export function MediaLibraryDialog({
  open,
  onClose,
  attached,
  max,
  onAttach,
}: {
  open: boolean;
  onClose: () => void;
  attached: MediaRef[];
  max: number;
  onAttach: (picked: MediaRef[]) => void;
}) {
  const library = useQuery("media", listMedia);
  const [picked, setPicked] = useState<string[]>([]);
  const room = max - attached.length;
  const items = library.data ?? [];

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < room ? [...p, id] : p));
  }

  function close() {
    setPicked([]);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Media library"
      description={
        items.length
          ? `Photos and videos you've imported. Pick up to ${room}.`
          : "Photos and videos you import show up here, ready to reuse."
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={picked.length === 0}
            onClick={() => {
              onAttach(items.filter((m) => picked.includes(m.id)));
              setPicked([]);
            }}
          >
            Add {picked.length || ""} to post
          </Button>
        </div>
      }
    >
      {items.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
          {items.map((m) => {
            const on = picked.includes(m.id);
            const already = attached.some((a) => a.id === m.id);
            return (
              <li key={m.id} className="relative aspect-square overflow-hidden rounded-xl">
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`${already ? "Already attached: " : ""}${m.name}`}
                  disabled={already}
                  onClick={() => toggle(m.id)}
                  className={`block size-full cursor-pointer border-0 p-0 disabled:cursor-default disabled:opacity-50 ${
                    on ? "outline-3 -outline-offset-3 outline-primary" : ""
                  }`}
                >
                  <MediaView media={m} className="pointer-events-none size-full" />
                </button>
                {on && (
                  <span className="pointer-events-none absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-full bg-primary-strong text-white">
                    <CheckIcon size={12} />
                  </span>
                )}
                {!already && (
                  <button
                    type="button"
                    aria-label={`Delete ${m.name} from library`}
                    onClick={async () => {
                      await removeMedia(m.id);
                      setPicked((p) => p.filter((x) => x !== m.id));
                      invalidate("media");
                    }}
                    className="absolute bottom-1.5 left-1.5 cursor-pointer rounded-md border-0 bg-ink/70 px-1.5 py-0.5 text-[11px] font-semibold text-white"
                  >
                    Delete
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
