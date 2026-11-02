"use client";

import { useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/StatusChip";
import { AlertIcon, CheckIcon, MoreHorizontalIcon, PlusIcon, RefreshIcon } from "@/components/ui/icons";
import { CONNECTABLE, cancelConnect, disconnectAccount, finishConnect, listAccounts, startConnect } from "@/lib/api/accounts";
import { invalidate, useQuery } from "@/lib/api/hooks";
import type { AccountPlatform, ConnectedAccount } from "@/lib/api/types";
import { OnboardingShell, StepActions } from "./OnboardingShell";
import { useOnboardingNav } from "./useOnboardingNav";

const DECLINED_HELP: Partial<Record<AccountPlatform, string>> = {
  fb: "Brandbuild needs “Manage and publish posts” to schedule for your Page. Nothing is posted without your approval.",
};

export function ConnectStep() {
  const advance = useOnboardingNav();
  const accounts = useQuery("accounts", listAccounts);
  const [busy, setBusy] = useState(false);
  // Optimistic status while a connect is in flight, keyed by platform.
  const [pending, setPending] = useState<Partial<Record<AccountPlatform, ConnectedAccount["status"]>>>({});
  const attempt = useRef(0);

  const byPlatform = new Map(accounts.data?.map((a) => [a.platform, a]));
  const statusOf = (p: AccountPlatform) => pending[p] ?? byPlatform.get(p)?.status ?? "disconnected";
  const connected = CONNECTABLE.filter((c) => statusOf(c.id) === "connected").length;

  async function connect(p: AccountPlatform) {
    const mine = ++attempt.current;
    setPending((s) => ({ ...s, [p]: "connecting" }));
    const start = await startConnect(p);
    if (!start.ok) {
      setPending((s) => ({ ...s, [p]: undefined }));
      return;
    }
    const done = await finishConnect(p);
    invalidate("accounts");
    // Ignore a result that a Cancel (or a newer attempt) overtook.
    if (mine !== attempt.current) return;
    setPending((s) => ({ ...s, [p]: done.ok ? done.data.status : undefined }));
  }

  async function cancel(p: AccountPlatform) {
    attempt.current++;
    await cancelConnect(p);
    setPending((s) => ({ ...s, [p]: undefined }));
    invalidate("accounts");
  }

  async function disconnect(p: AccountPlatform) {
    await disconnectAccount(p);
    setPending((s) => ({ ...s, [p]: undefined }));
    invalidate("accounts");
  }

  async function next(status: "done" | "skipped") {
    // aria-disabled still lets Enter through, so guard here too.
    if (status === "done" && connected === 0) return;
    setBusy(true);
    const ok = await advance("connect", status);
    if (!ok) setBusy(false);
  }

  return (
    <OnboardingShell
      step="connect"
      title="Connect your accounts"
      intro="Brandbuild posts only what you approve. You can add or remove accounts later in Settings."
      panel={
        <>
          <p className="m-0 font-display text-[30px] leading-[1.05] font-bold tracking-[-0.03em] text-white">
            Write once. Post everywhere you&apos;ve connected.
          </p>
          <p className="m-0 text-[15px] text-forest-ink">
            Each connected account gets its own preview, character limit and best posting time.
          </p>
        </>
      }
    >
      {!accounts.data ? (
        <Skeleton className="h-[380px] rounded-[20px]" />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {CONNECTABLE.map((c) => {
            const st = statusOf(c.id);
            const acc = byPlatform.get(c.id);
            const ring =
              st === "connecting"
                ? "shadow-[inset_0_0_0_1px_#E5C98F]"
                : st === "declined"
                  ? "shadow-[inset_0_0_0_1.5px_#E7A29C]"
                  : "shadow-[inset_0_0_0_1px_var(--color-line)]";
            return (
              <li
                key={c.id}
                aria-live={st === "connecting" || st === "declined" ? "polite" : undefined}
                className={`flex flex-col gap-2 rounded-[18px] bg-surface p-3.5 ${ring}`}
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold text-white"
                    style={{ background: c.bg }}
                  >
                    {c.badge}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-semibold">{c.name}</span>
                    <span
                      className={`truncate text-[13px] ${
                        st === "connecting" ? "text-[#6B4300]" : st === "declined" ? "text-danger-ink" : "text-muted"
                      }`}
                    >
                      {st === "connected"
                        ? [acc?.handle, acc?.note].filter(Boolean).join(" · ")
                        : st === "connecting"
                          ? `Finish signing in on the ${c.name} tab`
                          : st === "declined"
                            ? "Permission declined"
                            : st === "needs_attention"
                              ? "Access expired. Reconnect to keep posting."
                              : c.blurb}
                    </span>
                  </span>

                  {st === "connected" && (
                    <>
                      <Badge tone="primary">
                        <CheckIcon size={12} /> Connected
                      </Badge>
                      <Menu
                        label={`${c.name} options`}
                        trigger={<MoreHorizontalIcon size={20} />}
                        items={[{ label: "Disconnect", danger: true, onSelect: () => disconnect(c.id) }]}
                      />
                    </>
                  )}
                  {st === "connecting" && (
                    <>
                      <Badge tone="amber">
                        <RefreshIcon size={12} className="motion-safe:animate-spin" /> Connecting
                      </Badge>
                      <Button variant="ghost" className="h-10 px-3" onClick={() => cancel(c.id)}>
                        Cancel
                      </Button>
                    </>
                  )}
                  {st === "declined" && (
                    <Button variant="dark" className="h-10" onClick={() => connect(c.id)}>
                      Try again
                    </Button>
                  )}
                  {(st === "disconnected" || st === "needs_attention") && (
                    <Button variant="outline" className="h-10" onClick={() => connect(c.id)}>
                      {st === "needs_attention" ? <RefreshIcon size={16} /> : <PlusIcon size={16} />}
                      {st === "needs_attention" ? "Reconnect" : "Connect"}
                    </Button>
                  )}
                </div>
                {st === "declined" && (
                  <p className="m-0 flex items-start gap-2 pl-[52px] text-sm text-ink-2">
                    <AlertIcon size={16} className="mt-0.5 shrink-0 text-danger-ink" />
                    {DECLINED_HELP[c.id] ??
                      `Brandbuild needs permission to publish to ${c.name}. Nothing is posted without your approval.`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Alert tone="info">
        Instagram personal accounts can&apos;t be posted to. If yours is personal, switch it to a free Business or
        Creator account in Instagram&apos;s settings, then connect.
      </Alert>

      <StepActions>
        <Button size="lg" onClick={() => next("done")} disabled={busy} aria-disabled={connected === 0}>
          {connected === 0
            ? "Connect an account to continue"
            : `Continue with ${connected} account${connected === 1 ? "" : "s"}`}
        </Button>
        <Button variant="ghost" onClick={() => next("skipped")} disabled={busy}>
          Skip for now
        </Button>
      </StepActions>
    </OnboardingShell>
  );
}
