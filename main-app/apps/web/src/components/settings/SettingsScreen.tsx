"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { AlertIcon, CheckIcon, ChevronRightIcon } from "@/components/ui/icons";
import { listAccounts } from "@/lib/api/accounts";
import { getSession, logOut } from "@/lib/api/auth";
import { getBrand } from "@/lib/api/brand";
import { invalidate, useQuery } from "@/lib/api/hooks";
import { getNotificationPrefs, updateNotificationPrefs } from "@/lib/api/settings";
import type { ConnectedAccount, NotificationPrefs } from "@/lib/api/types";
import { ROUTES } from "@/lib/routes";

const PREFS: { key: keyof NotificationPrefs; label: string; description: string }[] = [
  { key: "postReminders", label: "Post reminders", description: "A nudge when a post needs your attention." },
  { key: "scheduledAlerts", label: "Scheduled post alerts", description: "Know when a post goes out, or fails to." },
  { key: "weeklyInsights", label: "Weekly insights", description: "A short summary of how your posts did." },
];

const SUPPORT: { label: string; href: string }[] = [
  { label: "Help centre", href: "mailto:hello@brandbuild.co?subject=Help" },
  { label: "Contact support", href: "mailto:hello@brandbuild.co?subject=Support" },
  { label: "Report a bug", href: "mailto:hello@brandbuild.co?subject=Bug%20report" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 font-display text-xl font-bold tracking-[-0.02em]">{title}</h2>
      <div className="rounded-2xl border border-line bg-surface px-4 py-1">{children}</div>
    </section>
  );
}

function accountStatus(a: ConnectedAccount) {
  if (a.status === "connected") return { label: "Connected", className: "text-primary-ink", Icon: CheckIcon };
  if (a.status === "needs_attention") return { label: "Reconnect", className: "text-amber-ink", Icon: AlertIcon };
  return { label: "Not connected", className: "text-muted", Icon: null };
}

export function SettingsScreen() {
  const router = useRouter();
  const toast = useToast();
  const session = useQuery("session", getSession);
  const brand = useQuery("brand", getBrand);
  const accounts = useQuery("accounts", listAccounts);
  const prefs = useQuery("notification-prefs", getNotificationPrefs);
  const [signingOut, setSigningOut] = useState(false);

  async function toggle(key: keyof NotificationPrefs, value: boolean) {
    const res = await updateNotificationPrefs({ [key]: value });
    if (!res.ok) toast({ tone: "error", message: "We couldn't save that. Try again." });
    invalidate("notification-prefs");
  }

  async function signOut() {
    setSigningOut(true);
    await logOut();
    router.replace("/login");
  }

  const listed = (accounts.data ?? []).filter((a) => a.status !== "disconnected");

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-7">
      <h1 className="m-0 font-display text-[34px] leading-tight font-bold tracking-[-0.03em] max-md:text-[28px]">
        Settings
      </h1>

      <div className="flex items-center gap-3">
        {session.data ? (
          <>
            <Avatar name={session.data.name} size={48} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold">{session.data.name}</span>
              <span className="truncate text-sm text-muted">{session.data.identifier}</span>
            </div>
            <ButtonLink href={ROUTES.brand} variant="outline">
              Brand profile
            </ButtonLink>
          </>
        ) : (
          <Skeleton className="h-12 w-full" />
        )}
      </div>

      <Section title="Connected accounts">
        {accounts.loading && !accounts.data ? (
          <Skeleton className="my-3 h-10 w-full" />
        ) : listed.length === 0 ? (
          <p className="m-0 py-3 text-[15px] text-muted">No accounts connected yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {listed.map((a) => {
              const s = accountStatus(a);
              return (
                <li key={a.id} className="flex min-h-14 items-center gap-3">
                  <PlatformBadge platform={{ k: a.badge, bg: a.badgeBg, name: a.platform }} size={28} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{a.handle || a.platform}</span>
                  <span className={`inline-flex items-center gap-1 text-sm font-semibold ${s.className}`}>
                    {s.Icon && <s.Icon size={14} />}
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href={ROUTES.connect}
          className="flex min-h-11 items-center border-t border-line text-[15px] font-semibold text-primary-ink no-underline"
        >
          Manage accounts
        </Link>
      </Section>

      <Section title="Notifications">
        {prefs.data ? (
          <div className="divide-y divide-line">
            {PREFS.map((p) => (
              <Switch
                key={p.key}
                label={p.label}
                description={p.description}
                checked={prefs.data![p.key]}
                onChange={(e) => toggle(p.key, e.target.checked)}
                className="py-2"
              />
            ))}
          </div>
        ) : (
          <Skeleton className="my-3 h-28 w-full" />
        )}
      </Section>

      <Section title="Your plan">
        <div className="flex min-h-16 items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold capitalize">{brand.data ? `${brand.data.plan} access` : " "}</span>
            <span className="text-sm text-muted">
              {brand.data?.plan === "student" ? `Free until ${brand.data.planEndsLabel}` : " "}
            </span>
          </div>
          <ButtonLink href={ROUTES.billing}>Upgrade plan</ButtonLink>
        </div>
      </Section>

      <Section title="Support">
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {SUPPORT.map((s) => (
            <li key={s.label}>
              <a
                href={s.href}
                className="flex min-h-12 items-center justify-between text-[15px] font-semibold text-ink no-underline"
              >
                {s.label}
                <ChevronRightIcon size={18} />
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Button variant="outline" onClick={signOut} disabled={signingOut} block>
        Sign out
      </Button>
    </div>
  );
}
