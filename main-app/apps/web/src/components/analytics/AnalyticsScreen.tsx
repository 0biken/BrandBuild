"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { ArrowRightIcon, SparkIcon } from "@/components/ui/icons";
import { SLOTS, WEEKDAYS, bestSlots, recommend } from "@/lib/analytics/recommendations";
import { getAnalytics } from "@/lib/api/analytics";
import { useQuery } from "@/lib/api/hooks";
import type { AnalyticsRange, AnalyticsReport, AnalyticsTotals, PostFormat } from "@/lib/api/types";

const RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
];

const card = "rounded-[20px] border border-line bg-surface";
const h2 = "m-0 font-display text-xl font-bold tracking-[-0.02em]";

const compact = (n: number) =>
  n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
const rateOf = (t: AnalyticsTotals) => (t.reach ? t.engagements / t.reach : 0);
const percent = (x: number) => `${(x * 100).toFixed(1)}%`;

export function AnalyticsScreen() {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const report = useQuery(`analytics-${range}`, () => getAnalytics(range));
  const r = report.data;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="m-0 mr-auto font-display text-[34px] leading-tight font-bold tracking-[-0.03em] max-md:text-[28px]">
          Analytics
        </h1>
        <Tabs idBase="range" label="Time range" items={RANGES} value={range} onChange={setRange} />
      </div>

      <div id={`range-panel-${range}`} role="tabpanel" aria-labelledby={`range-tab-${range}`} className="flex flex-col gap-7">
        {report.error && !r ? (
          <Alert tone="error">We couldn&apos;t load your analytics. Refresh to try again.</Alert>
        ) : !r ? (
          <Loading />
        ) : (
          <Report r={r} />
        )}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <>
      <div className="grid grid-cols-4 gap-3 max-md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-[20px]" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-[20px]" />
      <Skeleton className="h-72 rounded-[20px]" />
    </>
  );
}

function Report({ r }: { r: AnalyticsReport }) {
  const tips = recommend(r);
  return (
    <>
      <Kpis r={r} />

      <section aria-labelledby="grow-h" className="flex flex-col gap-3 rounded-[20px] bg-forest p-5 text-forest-text md:p-6">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-lime uppercase">
            <SparkIcon size={15} />
            Recommendations
          </span>
          <h2 id="grow-h" className={`${h2} text-white`}>
            Grow your accounts
          </h2>
          <p className="m-0 text-sm text-forest-ink">Based on your last {RANGES.find((x) => x.id === r.range)?.label}, ranked by likely impact.</p>
        </div>
        <ol className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
          {tips.map((t, i) => (
            <li key={t.id} className="flex flex-col gap-2 rounded-2xl bg-white p-4 text-ink">
              <span className="flex items-start gap-2.5">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-lime font-mono text-xs font-bold text-forest">
                  {i + 1}
                </span>
                <span className="text-[16px] leading-snug font-semibold">{t.title}</span>
              </span>
              <p className="m-0 text-sm leading-relaxed text-ink-2">{t.why}</p>
              <ButtonLink href={t.action.href} variant="soft" className="mt-auto h-10 self-start px-3 text-sm">
                {t.action.label}
                <ArrowRightIcon size={15} />
              </ButtonLink>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <EngagementChart r={r} />
        <Platforms r={r} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Heatmap r={r} />
        <Formats r={r} />
      </div>

      <TopPosts r={r} />
    </>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return <span className="text-sm text-muted">No earlier data</span>;
  const change = (now - before) / before;
  const up = change >= 0;
  return (
    <span className={`flex items-center gap-1 text-sm font-semibold ${up ? "text-primary-ink" : "text-danger-ink"}`}>
      <ArrowRightIcon size={14} strokeWidth={2.4} className={up ? "-rotate-45" : "rotate-45"} />
      <span className="sr-only">{up ? "Up" : "Down"}</span>
      {Math.abs(Math.round(change * 100))}%<span className="font-normal text-muted"> vs before</span>
    </span>
  );
}

function Kpis({ r }: { r: AnalyticsReport }) {
  const items = [
    { label: "Reach", value: compact(r.totals.reach), now: r.totals.reach, before: r.previous.reach },
    { label: "Engagements", value: compact(r.totals.engagements), now: r.totals.engagements, before: r.previous.engagements },
    { label: "Engagement rate", value: percent(rateOf(r.totals)), now: rateOf(r.totals), before: rateOf(r.previous) },
    { label: "New followers", value: `+${compact(r.totals.followers)}`, now: r.totals.followers, before: r.previous.followers },
  ];
  return (
    <ul className="m-0 grid list-none grid-cols-4 gap-3 p-0 max-md:grid-cols-2">
      {items.map((k) => (
        <li key={k.label} className={`${card} flex flex-col gap-2 p-[18px] max-md:p-3.5`}>
          <span className="text-xs font-semibold text-muted">{k.label}</span>
          <span className="font-display text-[34px] leading-none font-bold tracking-[-0.03em] max-md:text-[24px]">{k.value}</span>
          <Delta now={k.now} before={k.before} />
        </li>
      ))}
    </ul>
  );
}

function Panel({ id, title, sub, children, className = "" }: { id: string; title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`${card} flex min-w-0 flex-col gap-4 p-5 max-md:p-4 ${className}`}>
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className={h2}>
          {title}
        </h2>
        {sub && <span className="text-sm text-muted">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function EngagementChart({ r }: { r: AnalyticsReport }) {
  const W = 640;
  const H = 220;
  const pad = { l: 36, r: 8, t: 10, b: 24 };
  const max = Math.max(1, ...r.daily.flatMap((d) => [d.engagements, d.previous]));
  const top = Math.ceil(max / 100) * 100;
  const x = (i: number) => pad.l + (i / Math.max(1, r.daily.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const line = (key: "engagements" | "previous") => r.daily.map((d, i) => `${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const area = `${pad.l},${y(0)} ${line("engagements")} ${x(r.daily.length - 1)},${y(0)}`;
  const label = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" });

  return (
    <Panel id="eng-h" title="Engagement" sub="Likes, comments, shares and saves per day">
      <div className="flex gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0.5 w-4 rounded bg-primary" /> This period
        </span>
        <span className="flex items-center gap-1.5 text-muted">
          <span aria-hidden="true" className="h-0.5 w-4 rounded bg-[#9AA39C]" /> Previous
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Engagement per day from ${label(r.from)} to ${label(r.to)}. Total ${r.totals.engagements.toLocaleString()}, previous period ${r.previous.engagements.toLocaleString()}.`}
        className="h-auto w-full"
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(top * f)} y2={y(top * f)} stroke="var(--color-line)" />
            <text x={pad.l - 6} y={y(top * f) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">
              {compact(Math.round(top * f))}
            </text>
          </g>
        ))}
        <polygon points={area} fill="var(--color-primary)" opacity="0.08" />
        <polyline points={line("previous")} fill="none" stroke="#9AA39C" strokeWidth="2" strokeDasharray="4 4" strokeLinejoin="round" />
        <polyline points={line("engagements")} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x={pad.l} y={H - 4} fontSize="11" fill="var(--color-muted)">
          {label(r.from)}
        </text>
        <text x={W - pad.r} y={H - 4} fontSize="11" textAnchor="end" fill="var(--color-muted)">
          {label(r.to)}
        </text>
      </svg>
    </Panel>
  );
}

function Platforms({ r }: { r: AnalyticsReport }) {
  const total = r.platforms.reduce((s, p) => s + p.engagements, 0) || 1;
  return (
    <Panel id="pf-h" title="By platform" sub="Share of engagement">
      {r.platforms.length === 0 ? (
        <p className="m-0 text-sm text-muted">No posts in this period yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
          {r.platforms.map((p) => (
            <li key={p.id} className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className="inline-flex size-6 items-center justify-center rounded-[7px] text-[10px] font-semibold text-white"
                  style={{ background: p.bg }}
                >
                  {p.k}
                </span>
                <span className="font-semibold">{p.name}</span>
                <span className="ml-auto text-muted">
                  {compact(p.engagements)} · {Math.round((p.engagements / total) * 100)}%
                </span>
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-page">
                <span className="block h-full rounded-full" style={{ width: `${(p.engagements / total) * 100}%`, background: p.bg }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Heatmap({ r }: { r: AnalyticsReport }) {
  const best = bestSlots(r.heatmap, 1)[0];
  return (
    <Panel
      id="time-h"
      title="Best time to post"
      sub={best ? `Busiest: ${WEEKDAYS[best.day]}, ${SLOTS[best.slot]}` : "When your followers are online"}
    >
      {/* Focusable so keyboard users can scroll it on narrow screens. */}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Follower activity by day and time">
        <table className="w-full min-w-[420px] border-separate border-spacing-1 text-xs">
          <caption className="sr-only">Follower activity by day and time. Darker is busier.</caption>
          <thead>
            <tr>
              <th scope="col" className="w-10" />
              {SLOTS.map((s) => (
                <th key={s} scope="col" className="pb-1 font-medium whitespace-nowrap text-muted">
                  {s.replace(" AM", "a").replace(" PM", "p").replace(/ /g, "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.heatmap.map((row, day) => (
              <tr key={day}>
                <th scope="row" className="pr-1 text-left font-medium text-muted">
                  {WEEKDAYS[day].slice(0, 3)}
                </th>
                {row.map((v, slot) => (
                  <td
                    key={slot}
                    title={`${WEEKDAYS[day]} ${SLOTS[slot]}: ${Math.round(v * 100)}% activity`}
                    className="h-8 rounded-md"
                    style={{ background: `rgba(18, 161, 80, ${0.08 + v * 0.85})` }}
                  >
                    <span className="sr-only">{Math.round(v * 100)}%</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div aria-hidden="true" className="flex items-center gap-2 text-xs text-muted">
        Less
        {[0.1, 0.35, 0.6, 0.9].map((v) => (
          <span key={v} className="size-3.5 rounded" style={{ background: `rgba(18, 161, 80, ${0.08 + v * 0.85})` }} />
        ))}
        More
      </div>
    </Panel>
  );
}

function Formats({ r }: { r: AnalyticsReport }) {
  const by = new Map<PostFormat, { n: number; eng: number }>();
  r.posts.forEach((p) => {
    const cur = by.get(p.format) ?? { n: 0, eng: 0 };
    by.set(p.format, { n: cur.n + 1, eng: cur.eng + p.engagements });
  });
  const rows = [...by.entries()].map(([f, v]) => ({ f, n: v.n, avg: Math.round(v.eng / v.n) })).sort((a, b) => b.avg - a.avg);
  const max = Math.max(1, ...rows.map((x) => x.avg));
  return (
    <Panel id="fmt-h" title="By format" sub="Average engagement per post">
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-muted">No posts in this period yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
          {rows.map((x) => (
            <li key={x.f} className="flex flex-col gap-1.5">
              <span className="flex items-baseline gap-2 text-sm">
                <span className="font-semibold">{x.f}</span>
                <span className="text-muted">
                  {x.n} post{x.n === 1 ? "" : "s"}
                </span>
                <span className="ml-auto font-semibold">{compact(x.avg)}</span>
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-page">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${(x.avg / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TopPosts({ r }: { r: AnalyticsReport }) {
  const top = [...r.posts].sort((a, b) => b.engagements - a.engagements).slice(0, 5);
  const date = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  return (
    <section id="top-posts" aria-labelledby="top-h" className={`${card} flex scroll-mt-6 flex-col gap-3 p-5 max-md:p-4`}>
      <h2 id="top-h" className={h2}>
        Top posts
      </h2>
      {top.length === 0 ? (
        <p className="m-0 text-sm text-muted">
          Nothing published in this period. <Link href="/app/compose">Write a post</Link>
        </p>
      ) : (
        <ol className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {top.map((p, i) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
              <span className="w-5 font-mono text-sm text-muted">{i + 1}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{p.title}</span>
                <span className="text-[13px] text-muted">
                  {p.format} · {date(p.postedAt)} · {p.platforms.map((x) => x.toUpperCase()).join(", ")}
                </span>
              </span>
              <dl className="m-0 grid grid-cols-3 gap-4 text-right text-sm max-sm:w-full max-sm:pl-9 max-sm:text-left">
                <div>
                  <dt className="text-xs text-muted">Reach</dt>
                  <dd className="m-0 font-semibold">{compact(p.reach)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Eng. rate</dt>
                  <dd className="m-0 font-semibold">{percent(p.reach ? p.engagements / p.reach : 0)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Saves</dt>
                  <dd className="m-0 font-semibold">{compact(p.saves)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
