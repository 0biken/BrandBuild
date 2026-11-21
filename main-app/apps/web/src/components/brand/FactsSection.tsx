"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select, Textarea } from "@/components/ui/FormControls";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/StatusChip";
import { useToast } from "@/components/ui/Toast";
import { getSession } from "@/lib/api/auth";
import { createFact, deleteFact, listFacts, verifyFact } from "@/lib/api/facts";
import { invalidate, useQuery } from "@/lib/api/hooks";
import type { BrandFact, BrandFactKind } from "@/lib/api/types";

const KIND_LABEL: Record<BrandFactKind, string> = {
  offer: "Offer",
  price: "Price",
  hours: "Opening hours",
  claim: "Claim",
  other: "Other",
};

const STATUS: Record<BrandFact["status"], { label: string; tone: "primary" | "amber" | "neutral" }> = {
  verified: { label: "Verified", tone: "primary" },
  unverified: { label: "Needs checking", tone: "amber" },
  expired: { label: "Expired", tone: "neutral" },
};

const empty = { kind: "offer" as BrandFactKind, label: "", value: "", price: "", currency: "NGN", endsAt: "" };

/**
 * Offers, prices, opening hours and claims. Brandbuild only writes a price or claim in a
 * post when it matches a verified fact here, so a wrong price can't slip into a draft.
 */
export function FactsSection() {
  const toast = useToast();
  const facts = useQuery("facts", listFacts);
  const session = useQuery("session", getSession);
  const canVerify = session.data ? session.data.role !== "editor" : false;
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!form.label.trim() || !form.value.trim()) {
      setError("Add a name and what the fact says.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await createFact({
      kind: form.kind,
      label: form.label,
      value: form.value,
      price: form.price || null,
      currency: form.price ? form.currency : null,
      endsAt: form.endsAt ? new Date(`${form.endsAt}T23:59:59`).toISOString() : null,
    });
    setBusy(false);
    if (!res.ok) {
      setError("We couldn't save that fact. Check the price is a plain number, like 4500.");
      return;
    }
    setForm(empty);
    invalidate("facts");
    toast({ tone: "success", message: canVerify ? "Fact added. Verify it so posts can use it." : "Fact added. An owner or reviewer will verify it." });
  }

  async function act(run: () => Promise<{ ok: boolean }>, done: string) {
    const res = await run();
    if (!res.ok) {
      toast({ tone: "error", message: "That didn't work. Try again." });
      return;
    }
    invalidate("facts");
    toast({ tone: "success", message: done });
  }

  return (
    <section id="facts" aria-labelledby="facts-title" className="flex scroll-mt-6 flex-col gap-5 border-t border-line pt-7">
      <div className="flex flex-col gap-1.5">
        <h2 id="facts-title" className="m-0 font-display text-xl font-bold tracking-[-0.02em]">
          Facts and offers
        </h2>
        <p className="m-0 text-[15px] leading-relaxed text-ink-2">
          Prices, offers, opening hours and claims. Posts only mention a price or claim that matches a verified fact here.
        </p>
      </div>

      {facts.data ? (
        facts.data.length ? (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {facts.data.map((f) => (
              <li key={f.id} className="flex flex-wrap items-start gap-3 rounded-[16px] border border-line bg-surface p-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{f.label}</span>
                    <Badge tone={STATUS[f.status].tone}>{STATUS[f.status].label}</Badge>
                    <span className="text-xs text-muted">{KIND_LABEL[f.kind]}</span>
                  </span>
                  <span className="text-[15px] break-words text-ink-2">
                    {f.value}
                    {f.price && ` · ${f.currency ?? ""} ${Number(f.price).toLocaleString()}`.trimEnd()}
                  </span>
                  {f.endsAt && (
                    <span className="text-xs text-muted">Ends {new Date(f.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  {canVerify && f.status === "unverified" && (
                    <Button variant="soft" onClick={() => act(() => verifyFact(f.id), "Verified. Posts can now use it.")}>
                      Verify
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => act(() => deleteFact(f.id), "Fact removed.")}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 rounded-[16px] border border-dashed border-line-strong p-4 text-sm text-muted">
            No facts yet. Add your current offers and prices so posts can mention them.
          </p>
        )
      ) : facts.error ? (
        <Alert tone="error">We couldn&apos;t load your facts. Refresh to try again.</Alert>
      ) : (
        <Skeleton className="h-24 rounded-[16px]" />
      )}

      <form onSubmit={add} noValidate className="grid gap-4 rounded-[16px] bg-surface-2 p-4 sm:grid-cols-2">
        <Select id="fact-kind" label="Type" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as BrandFactKind })}>
          {Object.entries(KIND_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        <Field id="fact-label" label="Name" placeholder="Weekend deal" maxLength={200} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <div className="sm:col-span-2">
          <Textarea id="fact-value" label="What it says" placeholder="20% off all lip gloss, Friday to Sunday" limit={1000} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
        </div>
        <Field id="fact-price" label="Price (optional)" inputMode="decimal" placeholder="4500" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <Field id="fact-ends" label="Ends on (optional)" type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Adding..." : "Add fact"}
          </Button>
        </div>
      </form>
    </section>
  );
}
