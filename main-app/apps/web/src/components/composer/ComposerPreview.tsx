"use client";

import { Tabs } from "@/components/ui/Tabs";
import type { PlatformConfig, PlatformId } from "@/lib/api/types";

/** Live per-platform preview. Each platform gets its own crop and limit. */
export function ComposerPreview({
  platforms,
  tab,
  onTab,
  brandName,
  caption,
  hashtags,
  generating,
  whenLabel,
  mediaUrl,
}: {
  platforms: PlatformConfig[];
  tab: PlatformId | null;
  onTab: (id: PlatformId) => void;
  brandName: string;
  caption: string;
  hashtags: string[];
  generating: boolean;
  whenLabel: string;
  mediaUrl: string | null;
}) {
  const current = platforms.find((p) => p.id === tab) ?? platforms[0];
  const aspect = current?.id === "li" ? "1.91 / 1" : "1 / 1";
  const handle = current?.sub.startsWith("@") ? current.sub.slice(1) : brandName;

  return (
    <aside aria-label="Preview" className="sticky top-6 flex flex-col gap-3.5 self-start max-md:static">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 font-display text-xl font-bold tracking-[-0.02em]">Preview</h2>
        {platforms.length > 0 && current && (
          <Tabs
            idBase="preview"
            label="Platform preview"
            value={current.id}
            onChange={onTab}
            items={platforms.map((p) => ({ id: p.id, label: p.name }))}
          />
        )}
      </div>

      {current ? (
        <div
          id={`preview-panel-${current.id}`}
          role="tabpanel"
          aria-labelledby={`preview-tab-${current.id}`}
          className="overflow-hidden rounded-[22px] border border-line bg-surface"
        >
          <div className="flex items-center gap-2.5 p-3.5">
            <span
              aria-hidden="true"
              className="inline-flex size-9 items-center justify-center rounded-full bg-forest font-display font-bold text-lime"
            >
              {brandName.charAt(0)}
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold">{handle}</span>
              <span className="text-xs text-muted">
                {current.name} · {whenLabel}
              </span>
            </span>
          </div>
          <div
            className="flex items-center justify-center bg-[#DCE6DE] bg-cover bg-center text-[13px] text-ink-2"
            style={{ aspectRatio: aspect, backgroundImage: mediaUrl ? `url(${mediaUrl})` : undefined }}
            role="img"
            aria-label={mediaUrl ? "Attached media" : "No media attached yet"}
          >
            {!mediaUrl && "Add a photo or video"}
          </div>
          <div className="p-3.5">
            {generating ? (
              <div className="flex flex-col gap-2" aria-hidden="true">
                <span className="h-3 w-11/12 rounded-md bg-page-hover motion-safe:animate-pulse" />
                <span className="h-3 w-4/5 rounded-md bg-page-hover motion-safe:animate-pulse" />
                <span className="h-3 w-3/5 rounded-md bg-page-hover motion-safe:animate-pulse" />
              </div>
            ) : caption ? (
              <>
                <p className="m-0 text-sm leading-relaxed whitespace-pre-line">
                  <strong className="font-semibold">{handle}</strong> {caption}
                </p>
                {hashtags.length > 0 && (
                  <p className="m-0 mt-2 text-sm text-[#0A5CA8]">{hashtags.join(" ")}</p>
                )}
              </>
            ) : (
              <span className="text-sm text-muted">Your caption appears here as it&apos;s written.</span>
            )}
          </div>
        </div>
      ) : (
        <p className="m-0 rounded-[22px] border border-dashed border-line-strong p-6 text-sm text-muted">
          Pick at least one platform to see a preview.
        </p>
      )}
      {current && (
        <span className="text-[13px] text-muted">
          {current.name} allows {current.limit.toLocaleString("en-US")} characters. Each platform gets its own preview.
        </span>
      )}
    </aside>
  );
}
