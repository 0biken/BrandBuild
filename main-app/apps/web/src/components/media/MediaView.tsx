"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/api/media";
import type { MediaRef } from "@/lib/api/types";
import { blobUrl } from "@/lib/media/store";

/** Resolves a media item to something an <img>/<video> can show. */
export function useMediaUrl(ref: MediaRef | undefined): string | null {
  const [resolved, setResolved] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!ref || ref.url) return;
    let live = true;
    blobUrl(ref.id).then((url) => live && setResolved({ id: ref.id, url }));
    return () => {
      live = false;
    };
  }, [ref]);
  if (!ref) return null;
  if (ref.url) return ref.url;
  return resolved?.id === ref.id ? resolved.url : null;
}

/**
 * Shows one photo or video filling its box. Videos are muted and only
 * play with controls when `controls` is set (previews and post detail).
 */
export function MediaView({
  media,
  className = "",
  controls = false,
}: {
  media: MediaRef;
  className?: string;
  controls?: boolean;
}) {
  const url = useMediaUrl(media);
  if (!url) {
    return (
      <span className={`flex items-center justify-center bg-[#DCE6DE] text-[13px] text-ink-2 ${className}`}>
        {media.kind === "video" ? "Video" : "Photo"} unavailable
      </span>
    );
  }
  if (media.kind === "video") {
    return (
      <span className={`relative block bg-ink ${className}`}>
        <video
          src={url}
          muted
          playsInline
          preload="metadata"
          controls={controls}
          aria-label={media.name}
          className="size-full object-cover"
        />
        {!controls && media.duration !== undefined && (
          <span className="absolute bottom-1.5 left-1.5 rounded-md bg-ink/75 px-1.5 py-0.5 font-mono text-[11px] text-white">
            ▶ {formatDuration(media.duration)}
          </span>
        )}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- local blob URL, not optimisable
    <img src={url} alt={media.name} className={`object-cover ${className}`} />
  );
}
