"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  getMe,
  logout,
  ROLE_LABELS,
  type StaffMember,
} from "@/lib/api/client";

const TABS = [
  { href: "/", label: "Overview" },
  { href: "/workspaces", label: "Workspaces" },
  { href: "/unclear", label: "Outcome unclear" },
  { href: "/student-reviews", label: "Student reviews" },
  { href: "/ai-spend", label: "AI spend" },
  { href: "/audit", label: "Audit log" },
  { href: "/staff", label: "Staff & Access" },
] as const;

export function AdminShell({
  children,
  showSearch = false,
}: {
  children: (staff: StaffMember) => ReactNode;
  showSearch?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    getMe().then((res) => {
      if (!active) return;
      if (res.ok) {
        setStaff(res.data);
        setStatus("ready");
      } else if (res.status === 401 || res.status === 403) {
        router.replace("/login");
      } else {
        setStatus("error");
      }
    });
    return () => {
      active = false;
    };
  }, [router]);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    router.push(`/workspaces?q=${encodeURIComponent(trimmed)}`);
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-page">
        <header className="h-[58px] bg-ink" />
        <main className="mx-auto max-w-[1360px] p-6 max-md:p-4">
          <div className="h-32 animate-pulse rounded-[18px] bg-surface" />
        </main>
      </div>
    );
  }

  if (status === "error" || !staff) {
    return (
      <div className="min-h-screen bg-page p-6">
        <div className="mx-auto max-w-lg rounded-[18px] bg-surface p-6">
          <h1 className="m-0 font-display text-xl font-bold">
            Unable to load admin session
          </h1>
          <p className="mt-2 text-sm text-muted">
            Check that the backend API is running and try signing in again.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-flex h-10 items-center rounded-[10px] bg-ink px-4 text-sm font-semibold text-white no-underline"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  const primaryRole = staff.roles[0] ? ROLE_LABELS[staff.roles[0]] : "Staff";

  return (
    <div className="min-h-screen w-full bg-page">
      <header className="flex flex-wrap items-center gap-3.5 bg-ink px-6 py-3 text-white max-md:px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 text-white no-underline"
        >
          <svg
            width="20"
            height="22"
            viewBox="0 0 59 66"
            role="img"
            aria-label="Brandbuild"
          >
            <path
              d="M0 63.1688V26.0688C0 24.7053 1.1053 23.6 2.46875 23.6H17.5359C18.8994 23.6 20.0047 24.7053 20.0047 26.0688V40.6953C20.0047 43.4222 22.2153 45.6328 24.9422 45.6328H31.6406C33.0041 45.6328 34.1094 46.7381 34.1094 48.1016V63.1688C34.1094 64.5322 33.0041 65.6375 31.6406 65.6375H2.46875C1.1053 65.6375 0 64.5322 0 63.1688Z"
              fill="#FFFFFF"
            />
            <path
              d="M24.8906 39.5688V2.46875C24.8906 1.1053 25.9959 0 27.3594 0H42.4266C43.79 0 44.8953 1.1053 44.8953 2.46875V17.0953C44.8953 19.8222 47.1059 22.0328 49.8328 22.0328H56.5313C57.8947 22.0328 59 23.1381 59 24.5016V39.5688C59 40.9322 57.8947 42.0375 56.5313 42.0375H27.3594C25.9959 42.0375 24.8906 40.9322 24.8906 39.5688Z"
              fill="#FFFFFF"
            />
          </svg>
          <span className="text-[15px] font-semibold">Admin</span>
        </Link>

        <nav
          aria-label="Admin"
          className="ml-2 flex gap-0.5 overflow-x-auto max-md:ml-0"
        >
          {TABS.map((tab) => {
            const active =
              tab.href === "/"
                ? pathname === "/"
                : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm no-underline transition-colors ${
                  active
                    ? "bg-[#26322A] text-white"
                    : "text-[#B9C2BB] fine:hover:bg-[#1C2620] fine:hover:text-white"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {showSearch && (
            <form onSubmit={handleSearch} className="relative flex items-center">
              <label className="sr-only" htmlFor="admin-quick-search">
                Find a workspace
              </label>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#B9C2BB"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
                className="pointer-events-none absolute left-3"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                id="admin-quick-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Workspace, email or post ID"
                className="h-9 w-[260px] rounded-[10px] border border-[#3A4A3F] bg-[#1C2620] pr-3 pl-9 text-sm text-white placeholder:text-[#8E9B92]"
              />
            </form>
          )}
          <span className="text-sm text-[#B9C2BB]">
            {staff.displayName} · {primaryRole}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="h-8 cursor-pointer rounded-lg border border-[#3A4A3F] bg-transparent px-2.5 text-xs font-medium text-[#E8F1EA] transition-colors fine:hover:bg-[#1C2620]"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1360px] p-6 max-md:p-4">
        {children(staff)}
      </main>
    </div>
  );
}
