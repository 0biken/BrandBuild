"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Menu } from "@/components/ui/Menu";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/StatusChip";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { AlertIcon, DraftsIcon, MoreHorizontalIcon, PlusIcon, SearchIcon } from "@/components/ui/icons";
import { createDraft, deleteDraft, listDrafts, restoreDraft } from "@/lib/api/drafts";
import { invalidate, useQuery } from "@/lib/api/hooks";
import type { DraftItem, DraftState } from "@/lib/api/types";
import { ROUTES } from "@/lib/routes";

type Filter = "all" | DraftState;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "Ready", label: "Ready to schedule" },
  { id: "Needs a photo", label: "Needs a photo" },
  { id: "Idea", label: "Ideas only" },
];

const STATE_TONE = { Ready: "primary", "Needs a photo": "amber", Idea: "neutral" } as const;

const editHref = (d: DraftItem) => `${ROUTES.compose}?draft=${encodeURIComponent(d.id)}`;

export function DraftsScreen() {
  const drafts = useQuery("drafts", listDrafts);
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());

  const all = drafts.data ?? [];
  const count = (f: Filter) => (f === "all" ? all.length : all.filter((d) => d.state === f).length);
  const shown = all.filter(
    (d) =>
      (filter === "all" || d.state === filter) &&
      (!q || d.title.toLowerCase().includes(q) || d.body.toLowerCase().includes(q)),
  );

  async function remove(d: DraftItem) {
    const res = await deleteDraft(d.id);
    invalidate("drafts");
    if (!res.ok) {
      toast({ tone: "error", message: "We couldn't delete that draft. Try again." });
      return;
    }
    toast({
      tone: "success",
      message: `Deleted "${d.title}"`,
      action: {
        label: "Undo",
        onAction: async () => {
          await restoreDraft(d, res.data.index);
          invalidate("drafts");
        },
      },
    });
  }

  async function duplicate(d: DraftItem) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, ...rest } = d;
    const res = await createDraft({ ...rest, title: `${d.title} (copy)`, edited: "Just now" });
    invalidate("drafts");
    toast(
      res.ok
        ? { tone: "success", message: "Draft duplicated" }
        : { tone: "error", message: "We couldn't duplicate that draft. Try again." },
    );
  }

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-[22px]">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 mr-auto font-display text-[34px] font-bold tracking-[-0.03em] max-md:text-[28px]">
          Drafts {drafts.data && <span className="text-[#9AA39C]">{all.length}</span>}
        </h1>
        <label className="relative max-md:order-last max-md:w-full">
          <span className="sr-only">Search drafts</span>
          <SearchIcon size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search drafts"
            className="h-11 w-64 rounded-xl border border-line-strong bg-surface pr-3.5 pl-10 text-[15px] text-ink placeholder:text-muted/70 focus:border-primary focus:shadow-[0_0_0_3px_rgba(18,161,80,0.18)] focus:outline-none max-md:w-full"
          />
        </label>
        <ButtonLink href={ROUTES.compose}>
          <PlusIcon size={18} />
          New draft
        </ButtonLink>
      </header>

      <Tabs
        idBase="drafts"
        label="Filter drafts"
        value={filter}
        onChange={setFilter}
        className="max-w-full overflow-x-auto"
        items={FILTERS.map((f) => ({
          id: f.id,
          label: (
            <span className="whitespace-nowrap">
              {f.label} {drafts.data && <span className="font-mono text-xs opacity-70">{count(f.id)}</span>}
            </span>
          ),
        }))}
      />

      <div
        id={`drafts-panel-${filter}`}
        role="tabpanel"
        aria-labelledby={`drafts-tab-${filter}`}
        aria-busy={drafts.loading}
      >
        {drafts.error ? (
          <EmptyState
            icon={AlertIcon}
            tone="error"
            title="We couldn't load your drafts"
            body="Check your connection and try again."
            action={<Button variant="outline" onClick={drafts.refetch}>Try again</Button>}
          />
        ) : !drafts.data ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3.5 max-md:grid-cols-1">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[200px] rounded-[20px]" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={DraftsIcon}
            title={all.length === 0 ? "No drafts yet" : q ? `Nothing matches "${query.trim()}"` : "No drafts here"}
            body={
              all.length === 0
                ? "Ideas you save and posts you haven't scheduled live here."
                : "Try another filter or search."
            }
            action={
              all.length === 0 ? (
                <ButtonLink href={ROUTES.compose}>Write a post</ButtonLink>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  Show all drafts
                </Button>
              )
            }
          />
        ) : (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3.5 p-0 max-md:grid-cols-1">
            {shown.map((d) => (
              <li key={d.id}>
                <article className="flex h-full flex-col gap-3 rounded-[20px] border border-line bg-surface p-[18px]">
                  <div className="flex items-center gap-1.5">
                    {d.pfs.map((p) => (
                      <span
                        key={p.k}
                        aria-hidden="true"
                        className="inline-flex size-6 items-center justify-center rounded-[7px] text-[10px] font-semibold text-white"
                        style={{ background: p.bg }}
                      >
                        {p.k}
                      </span>
                    ))}
                    <Badge tone={STATE_TONE[d.state]} className="ml-1">
                      {d.state}
                    </Badge>
                  </div>
                  <h2 className="m-0 text-[17px] font-semibold tracking-[-0.01em]">
                    <Link href={editHref(d)} className="text-ink no-underline fine:underline">
                      {d.title}
                    </Link>
                  </h2>
                  <p className="m-0 line-clamp-3 text-sm leading-relaxed text-ink-2">{d.body}</p>
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <span className="mr-auto text-[13px] text-muted">{d.edited}</span>
                    <ButtonLink href={editHref(d)} variant="soft" className="h-10 px-3 text-sm">
                      {d.action}
                    </ButtonLink>
                    <Menu
                      label={`More actions for ${d.title}`}
                      trigger={<MoreHorizontalIcon size={20} />}
                      items={[
                        { label: "Duplicate", onSelect: () => duplicate(d) },
                        { label: "Delete", danger: true, onSelect: () => remove(d) },
                      ]}
                    />
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
