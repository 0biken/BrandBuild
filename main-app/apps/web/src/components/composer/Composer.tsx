"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/FormControls";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ArrowRightIcon, CheckIcon, ClockIcon, CloseIcon, RefreshIcon, SparkIcon } from "@/components/ui/icons";
import { listPlatforms } from "@/lib/api/accounts";
import { generatePost, type Tone, type Tweak } from "@/lib/api/ai";
import { getSession } from "@/lib/api/auth";
import { getBrand } from "@/lib/api/brand";
import { createDraft, deleteDraft, getDraft, updateDraft } from "@/lib/api/drafts";
import { invalidate, useQuery } from "@/lib/api/hooks";
import { createPost, getPost, updatePost, type PostInput } from "@/lib/api/posts";
import type { PlatformConfig, PlatformId } from "@/lib/api/types";
import { formatShort, fromInputs, isPast, isoDay, isoTime, postDate } from "@/lib/postDates";
import { ROUTES } from "@/lib/routes";
import { ComposerPreview } from "./ComposerPreview";

const TONES: Tone[] = ["Warm", "Playful", "Professional", "Bold"];
const STEPS = ["Reading your brand voice", "Writing the caption", "Choosing hashtags", "Finding the best time"];
const STEP_MS = 700;
const TWEAKS: { id: Tweak; label: string }[] = [
  { id: "rewrite", label: "Rewrite" },
  { id: "shorter", label: "Shorter" },
  { id: "playful", label: "More playful" },
  { id: "cta", label: "Add a call to action" },
];

type Phase = "idle" | "gen" | "done";

const card = "flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-[22px] max-md:p-4";
const h2 = "m-0 text-base font-semibold";

function defaultWhen(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(19, 0, 0, 0);
  return d;
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface ComposerProps {
  idea?: string;
  draftId?: string;
  postId?: string;
  /** YYYY-MM-DD from the calendar (a draft dropped on a day). */
  date?: string;
}

const noop = () => () => {};

/**
 * Renders only in the browser: default dates come from the user's clock and
 * time zone, which the server doesn't know.
 */
export function Composer(props: ComposerProps) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) {
    return (
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6" aria-busy="true">
        <Skeleton className="h-11 w-64" />
        <Skeleton className="h-[220px] rounded-[20px]" />
      </div>
    );
  }
  return <ComposerForm {...props} />;
}

function ComposerForm({ idea: initialIdea = "", draftId: initialDraftId, postId, date }: ComposerProps) {
  const router = useRouter();
  const toast = useToast();
  const platforms = useQuery("platforms", listPlatforms);
  const session = useQuery("session", getSession);
  const brand = useQuery("brand", getBrand);
  const isEditor = session.data?.role === "editor";

  const [idea, setIdea] = useState(initialIdea);
  const [tone, setTone] = useState<Tone>("Warm");
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState(0);
  const [caption, setCaption] = useState("");
  const [shown, setShown] = useState(0);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlatformId[]>(["ig", "li"]);
  const [tab, setTab] = useState<PlatformId | null>("ig");
  const [when, setWhen] = useState<"now" | "later">("later");
  const initial = date ? fromInputs(date, "19:00") ?? defaultWhen() : defaultWhen();
  const [day, setDay] = useState(isoDay(initial));
  const [time, setTime] = useState(isoTime(initial));
  const [bestTime, setBestTime] = useState<Date | null>(null);
  const [media, setMedia] = useState<{ url: string; name: string } | null>(null);
  const [draftId, setDraftId] = useState(initialDraftId);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clearTimers, []);
  useEffect(() => () => {
    if (media) URL.revokeObjectURL(media.url);
  }, [media]);

  // Prefill from a draft or an existing post.
  useEffect(() => {
    let live = true;
    if (postId) {
      getPost(postId).then((res) => {
        if (!live || !res.ok) return;
        const p = res.data;
        setIdea(p.title);
        setCaption(p.caption);
        setShown(p.caption.length);
        setHashtags(p.hashtags);
        setSelected(p.platforms);
        setTab(p.platforms[0] ?? null);
        const at = postDate(p);
        setDay(isoDay(at));
        setTime(isoTime(at));
        setPhase("done");
      });
    } else if (initialDraftId) {
      Promise.all([getDraft(initialDraftId), listPlatforms()]).then(([res, pf]) => {
        if (!live || !res.ok) return;
        const d = res.data;
        setIdea(d.title);
        if (d.state !== "Idea") {
          setCaption(d.body);
          setShown(d.body.length);
          setPhase("done");
        }
        if (pf.ok) {
          const ids = d.pfs
            .map((x) => pf.data.find((p) => p.k === x.k)?.id)
            .filter((x): x is PlatformId => !!x);
          if (ids.length) {
            setSelected(ids);
            setTab(ids[0]);
          }
        }
      });
    }
    return () => {
      live = false;
    };
  }, [postId, initialDraftId]);

  const allPlatforms = platforms.data ?? [];
  const chosen = allPlatforms.filter((p) => selected.includes(p.id));
  const fullText = [caption, hashtags.join(" ")].filter(Boolean).join("\n\n");
  const tooLong = chosen.filter((p) => fullText.length > p.limit);
  const typing = phase === "done" && shown < caption.length;

  async function generate(tweak?: Tweak) {
    if (phase === "gen") return;
    if (!idea.trim()) {
      setError("Tell us what the post is about first.");
      return;
    }
    clearTimers();
    setError("");
    setPhase("gen");
    setStep(0);
    const skipAnim = reducedMotion();
    if (!skipAnim) {
      for (let i = 1; i < STEPS.length; i++) {
        timers.current.push(window.setTimeout(() => setStep(i), STEP_MS * i));
      }
    }
    const [res] = await Promise.all([
      generatePost({ idea, tone, platforms: selected, tweak, caption }),
      new Promise((r) => setTimeout(r, skipAnim ? 0 : STEP_MS * STEPS.length)),
    ]);
    if (!res.ok) {
      setPhase(caption ? "done" : "idle");
      setError("We couldn't write that post. Check your connection and try again.");
      return;
    }
    setCaption(res.data.caption);
    setHashtags(res.data.hashtags);
    const best = new Date(res.data.bestTime);
    setBestTime(best);
    if (!postId && !date) {
      setDay(isoDay(best));
      setTime(isoTime(best));
    }
    setPhase("done");
    if (skipAnim) {
      setShown(res.data.caption.length);
    } else {
      setShown(0);
      const total = res.data.caption.length;
      let n = 0;
      const tick = () => {
        n = Math.min(total, n + 5);
        setShown(n);
        if (n < total) timers.current.push(window.setTimeout(tick, 16));
      };
      tick();
    }
  }

  function onIdeaKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      generate();
    }
  }

  function togglePlatform(p: PlatformConfig) {
    const next = selected.includes(p.id) ? selected.filter((x) => x !== p.id) : [...selected, p.id];
    setSelected(next);
    if (!tab || !next.includes(tab)) setTab(next[0] ?? null);
  }

  function addTag(raw: string) {
    const tag = `#${raw.trim().replace(/^#+/, "").replace(/\s+/g, "")}`;
    if (tag.length > 1 && !hashtags.includes(tag)) setHashtags((h) => [...h, tag]);
    setTagDraft(null);
  }

  function pickMedia(file: File | undefined) {
    if (!file) return;
    if (!/^(image|video)\//.test(file.type)) {
      setError("That file isn't an image or video.");
      return;
    }
    // The effect cleanup revokes the previous object URL.
    setMedia({ url: URL.createObjectURL(file), name: file.name });
    setError("");
  }

  // Only read in event handlers; render uses the pure fromInputs value.
  const scheduledFor = () => (when === "later" ? fromInputs(day, time) : new Date());
  const pickedTime = when === "later" ? fromInputs(day, time) : null;

  function validate(scheduledAt: Date | null): string | null {
    if (!caption.trim()) return "Write or generate a caption first.";
    if (chosen.length === 0) return "Pick at least one platform to post to.";
    if (tooLong.length) return `The caption is too long for ${tooLong.map((p) => p.name).join(" and ")}.`;
    if (when === "later") {
      if (!scheduledAt) return "Pick a date and time.";
      if (isPast(scheduledAt)) return "That time has passed. Pick a time in the future.";
    }
    return null;
  }

  async function submit() {
    const scheduledAt = scheduledFor();
    const problem = validate(scheduledAt);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    const input: PostInput = {
      title: idea.trim() || caption.split("\n")[0].slice(0, 60),
      caption,
      hashtags,
      platforms: selected,
      scheduledAt: when === "later" ? scheduledAt!.toISOString() : undefined,
      intent: isEditor ? "approval" : when === "now" ? "publish" : "schedule",
    };
    const res = postId ? await updatePost(postId, input) : await createPost(input);
    if (!res.ok) {
      setBusy(false);
      setError("We couldn't save the post. Try again.");
      return;
    }
    if (draftId && !postId) await deleteDraft(draftId);
    ["posts", "drafts"].forEach(invalidate);
    toast({
      tone: "success",
      message: isEditor
        ? "Sent for approval"
        : when === "now"
          ? "Posted"
          : `Scheduled for ${formatShort(scheduledAt!)}`,
    });
    router.push(ROUTES.post(res.data.id));
  }

  async function saveDraft() {
    if (!idea.trim() && !caption.trim()) {
      setError("Write an idea or a caption before saving.");
      return;
    }
    setBusy(true);
    setError("");
    const body = {
      title: idea.trim() || caption.split("\n")[0].slice(0, 60),
      body: caption || idea,
      state: caption ? (media ? "Ready" : "Needs a photo") : "Idea",
      pfs: chosen.map((p) => ({ k: p.k, bg: p.bg })),
      edited: "Just now",
      action: caption ? (media ? "Schedule" : "Add photo") : "Write it",
    } as const;
    const res = draftId ? await updateDraft(draftId, body) : await createDraft(body);
    setBusy(false);
    if (!res.ok) {
      setError("We couldn't save the draft. Try again.");
      return;
    }
    setDraftId(res.data.id);
    invalidate("drafts");
    setSaved(`Draft saved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  }

  const ctaLabel = postId ? "Save changes" : isEditor ? "Send for approval" : when === "now" ? "Post now" : "Schedule post";
  const whenLabel = when === "now" ? "Now" : pickedTime ? formatShort(pickedTime) : "Pick a time";

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6">
      <header className="flex items-center gap-3.5">
        <Link
          href={ROUTES.home}
          aria-label="Back to home"
          className="press inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink no-underline fine:bg-page-hover"
        >
          <ArrowRightIcon size={18} className="rotate-180" />
        </Link>
        <h1 className="m-0 font-display text-[30px] font-bold tracking-[-0.03em] max-md:text-[26px]">
          {postId ? "Edit post" : "New post"}
        </h1>
        <span role="status" className="ml-auto flex items-center gap-1.5 text-sm text-muted">
          {saved && (
            <>
              <CheckIcon size={14} className="text-primary-ink" />
              {saved}
            </>
          )}
        </span>
      </header>

      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Prompt */}
          <section aria-label="Prompt" className={card}>
            <label htmlFor="idea" className="flex items-center gap-2 text-[15px] font-semibold">
              <SparkIcon size={18} className="text-primary" />
              What&apos;s this post about?
            </label>
            <textarea
              id="idea"
              rows={2}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={onIdeaKey}
              placeholder="Behind the scenes of how we pack orders for Friday's drop"
              className="min-h-[76px] w-full resize-y rounded-[14px] border border-line-strong bg-surface-2 px-4 py-3 text-base leading-relaxed text-ink placeholder:text-muted/70 focus:border-primary focus:shadow-[0_0_0_3px_rgba(18,161,80,0.18)] focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span id="tone-label" className="mr-1 text-[13px] font-semibold text-muted">Tone</span>
              <div role="radiogroup" aria-labelledby="tone-label" className="flex flex-wrap gap-1.5">
                {TONES.map((t) => (
                  <label
                    key={t}
                    className={`press inline-flex min-h-10 cursor-pointer items-center rounded-[10px] px-3.5 text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary ${
                      tone === t ? "bg-ink text-white" : "bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="tone"
                      value={t}
                      checked={tone === t}
                      onChange={() => setTone(t)}
                      className="sr-only"
                    />
                    {t}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href={ROUTES.brand} className="flex items-center gap-2 text-sm text-ink-2 no-underline">
                <span className="size-2 rounded-sm bg-primary" />
                Writing in {brand.data?.name ?? "your brand"}&apos;s voice
                <span className="font-semibold text-primary-hover">Edit</span>
              </Link>
              <Button size="lg" onClick={() => generate()} disabled={phase === "gen"} className="rounded-[14px]">
                {phase === "gen" ? (
                  <>
                    <RefreshIcon size={18} className="motion-safe:animate-spin" />
                    Generating...
                  </>
                ) : phase === "done" ? (
                  "Regenerate"
                ) : (
                  "Generate post"
                )}
                <kbd aria-hidden="true" className="rounded-md bg-forest/40 px-1.5 py-0.5 font-mono text-xs max-md:hidden">Ctrl ↵</kbd>
              </Button>
            </div>
          </section>

          {error && <Alert tone="error">{error}</Alert>}

          {/* Generating */}
          {phase === "gen" && (
            <section
              aria-label="Generating"
              aria-live="polite"
              className="flex flex-col gap-4 rounded-[20px] bg-forest p-[22px] text-forest-text"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-display text-[22px] font-bold text-white">Building your post</span>
                <span className="font-mono text-[13px] text-lime">{Math.min(step + 1, 4)} of 4</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-[#1F4430]">
                <div
                  className="h-full origin-left bg-lime transition-transform duration-500 ease-out"
                  style={{ transform: `scaleX(${(step + 0.35) / 4})` }}
                />
              </div>
              <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
                {STEPS.map((label, i) => {
                  const done = i < step;
                  const active = i === step;
                  return (
                    <li
                      key={label}
                      className={`flex items-center gap-3 text-[15px] ${done || active ? "text-white" : "text-[#8FAA98]"}`}
                    >
                      <span
                        className={`inline-flex size-[22px] items-center justify-center rounded-full ${
                          done ? "bg-lime text-forest" : active ? "border-2 border-lime" : "bg-[#1F4430]"
                        }`}
                      >
                        {done && <CheckIcon size={12} />}
                      </span>
                      {label}
                      <span className="sr-only">{done ? ", done" : active ? ", in progress" : ""}</span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {phase === "done" && (
            <>
              {/* Caption */}
              <section aria-label="Caption and hashtags" className={card}>
                <Textarea
                  id="caption"
                  label="Caption"
                  value={typing ? caption.slice(0, shown) : caption}
                  readOnly={typing}
                  onChange={(e) => setCaption(e.target.value)}
                  limit={chosen.find((p) => p.id === tab)?.limit}
                  rows={6}
                />
                <div className="flex flex-wrap gap-2">
                  {TWEAKS.map((t) => (
                    <Button key={t.id} variant="soft" className="h-10 px-3 text-sm" onClick={() => generate(t.id)}>
                      {t.id === "rewrite" && <RefreshIcon size={16} />}
                      {t.label}
                    </Button>
                  ))}
                </div>
                {!typing && (
                  <div className="flex flex-col gap-2">
                    <span id="tags-label" className="text-[13px] font-semibold text-muted">Hashtags</span>
                    <ul aria-labelledby="tags-label" className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
                      {hashtags.map((h) => (
                        <li
                          key={h}
                          className="inline-flex h-9 items-center gap-1 rounded-[9px] bg-primary-soft pr-1 pl-3 text-sm font-semibold text-primary-ink"
                        >
                          {h}
                          <button
                            type="button"
                            aria-label={`Remove ${h}`}
                            onClick={() => setHashtags((x) => x.filter((y) => y !== h))}
                            className="press inline-flex size-7 cursor-pointer items-center justify-center rounded-[7px] border-0 bg-transparent text-primary-ink fine:bg-white/60"
                          >
                            <CloseIcon size={12} />
                          </button>
                        </li>
                      ))}
                      <li>
                        {tagDraft === null ? (
                          <Button variant="ghost" className="h-9 px-3 text-sm" onClick={() => setTagDraft("")}>
                            + Add
                          </Button>
                        ) : (
                          <input
                            autoFocus
                            aria-label="New hashtag"
                            value={tagDraft}
                            onChange={(e) => setTagDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                addTag(tagDraft);
                              } else if (e.key === "Escape") setTagDraft(null);
                            }}
                            onBlur={() => (tagDraft.trim() ? addTag(tagDraft) : setTagDraft(null))}
                            placeholder="#hashtag"
                            className="h-9 w-36 rounded-[9px] border border-line-strong bg-surface px-3 text-sm focus:border-primary focus:outline-none"
                          />
                        )}
                      </li>
                    </ul>
                  </div>
                )}
                {tooLong.length > 0 && (
                  <Alert tone="error">
                    Caption and hashtags are {fullText.length.toLocaleString()} characters, over the limit for{" "}
                    {tooLong.map((p) => `${p.name} (${p.limit.toLocaleString()})`).join(" and ")}.
                  </Alert>
                )}
              </section>

              {/* Media */}
              <section aria-label="Media" className={card}>
                <h2 className={h2}>Media</h2>
                <div className="flex flex-wrap gap-3">
                  {media && (
                    <div
                      className="relative size-32 overflow-hidden rounded-[14px] bg-cover bg-center"
                      style={{ backgroundImage: `url(${media.url})` }}
                      role="img"
                      aria-label={`Attached: ${media.name}`}
                    >
                      <button
                        type="button"
                        aria-label="Remove media"
                        onClick={() => setMedia(null)}
                        className="press absolute top-1.5 right-1.5 inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-ink/70 text-white"
                      >
                        <CloseIcon size={14} />
                      </button>
                    </div>
                  )}
                  <label
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      pickMedia(e.dataTransfer.files[0]);
                    }}
                    className="flex min-h-32 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-[#C7CCC1] bg-surface-2 p-4 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary"
                  >
                    <span className="text-sm font-semibold text-ink-2">Drop an image or video here</span>
                    <span className="text-[13px] text-muted">or choose a file</span>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      className="sr-only"
                      onChange={(e) => pickMedia(e.target.files?.[0])}
                    />
                  </label>
                </div>
                <span className="text-[13px] text-muted">Square images work on every platform you&apos;ve picked.</span>
              </section>

              {/* Where and when */}
              <section aria-label="Where and when" className={card}>
                <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
                  <legend className={`${h2} mb-3`}>Post to</legend>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5">
                    {allPlatforms.map((p) => {
                      const on = selected.includes(p.id);
                      return (
                        <label
                          key={p.id}
                          className={`press flex min-h-14 items-center gap-2.5 rounded-[14px] p-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary ${
                            p.off ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                          } ${on ? "bg-[#F2FAF5] shadow-[inset_0_0_0_2px_var(--color-primary)]" : "bg-surface shadow-[inset_0_0_0_1px_var(--color-line-strong)]"}`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={p.off}
                            onChange={() => togglePlatform(p)}
                            className="sr-only"
                          />
                          <span
                            aria-hidden="true"
                            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-white"
                            style={{ background: p.bg }}
                          >
                            {p.k}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="text-sm font-semibold text-ink">{p.name}</span>
                            <span className={`truncate text-xs ${p.warn ? "text-[#8A5300]" : "text-muted"}`}>{p.sub}</span>
                          </span>
                          <span
                            aria-hidden="true"
                            className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md text-white ${
                              on ? "bg-primary-strong" : "bg-surface shadow-[inset_0_0_0_1.5px_#9AA39C]"
                            }`}
                          >
                            {on && <CheckIcon size={12} />}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {chosen.some((p) => p.warn) && (
                    <Alert tone="info">
                      TikTok needs reconnecting. Its post will be held until you{" "}
                      <Link href={ROUTES.connect}>reconnect</Link>.
                    </Alert>
                  )}
                </fieldset>

                <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
                  <legend className={`${h2} mb-3`}>When</legend>
                  <div role="radiogroup" aria-label="When to post" className="flex w-fit gap-1 rounded-xl bg-page p-1">
                    {(["now", "later"] as const).map((w) => (
                      <label
                        key={w}
                        className={`inline-flex min-h-10 cursor-pointer items-center rounded-[9px] px-4 text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                          when === w ? "bg-surface text-ink shadow-sm" : "text-ink-2"
                        }`}
                      >
                        <input
                          type="radio"
                          name="when"
                          checked={when === w}
                          onChange={() => setWhen(w)}
                          className="sr-only"
                        />
                        {w === "now" ? "Post now" : "Schedule"}
                      </label>
                    ))}
                  </div>
                  {when === "later" && (
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
                        Date
                        <input
                          type="date"
                          value={day}
                          min={isoDay(new Date())}
                          onChange={(e) => setDay(e.target.value)}
                          className="h-11 rounded-xl border border-line-strong bg-surface-2 px-3 text-[15px] text-ink focus:border-primary focus:outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
                        Time
                        <input
                          type="time"
                          value={time}
                          onChange={(e) => setTime(e.target.value)}
                          className="h-11 rounded-xl border border-line-strong bg-surface-2 px-3 text-[15px] text-ink focus:border-primary focus:outline-none"
                        />
                      </label>
                      {bestTime && (
                        <button
                          type="button"
                          onClick={() => {
                            setDay(isoDay(bestTime));
                            setTime(isoTime(bestTime));
                          }}
                          className="press inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border-0 bg-primary-soft px-3.5 text-sm font-semibold text-primary-ink"
                        >
                          <ClockIcon size={16} />
                          Best time: {formatShort(bestTime)}
                        </button>
                      )}
                      <span className="w-full text-xs text-muted">
                        Times are in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
                      </span>
                    </div>
                  )}
                </fieldset>
              </section>

              {isEditor && (
                <div className="flex items-start gap-3 rounded-2xl bg-info-soft p-4 text-info-ink">
                  <span className="text-sm">
                    The account owner approves posts before they go out. They&apos;ll get an email and can approve
                    from their phone. You&apos;ll hear back here.
                  </span>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-3">
                <Button variant="outline" size="lg" onClick={saveDraft} disabled={busy}>
                  Save draft
                </Button>
                <Button size="lg" onClick={submit} disabled={busy || typing}>
                  {busy ? "Saving..." : ctaLabel}
                </Button>
              </div>
            </>
          )}
        </div>

        <ComposerPreview
          platforms={chosen}
          tab={tab}
          onTab={setTab}
          brandName={brand.data?.name ?? "Brand"}
          caption={phase === "done" ? caption.slice(0, shown) : ""}
          hashtags={phase === "done" && !typing ? hashtags : []}
          generating={phase === "gen"}
          whenLabel={whenLabel}
          mediaUrl={media?.url ?? null}
        />
      </div>
    </div>
  );
}
