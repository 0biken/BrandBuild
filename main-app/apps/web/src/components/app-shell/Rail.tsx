"use client";

import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import {
  AlertIcon,
  ApprovalsIcon,
  BrandProfileIcon,
  CalendarIcon,
  ChartIcon,
  CheckIcon,
  DraftsIcon,
  HomeIcon,
  PlusIcon,
  SettingsIcon,
} from "@/components/ui/icons";
import { listAccounts } from "@/lib/api/accounts";
import { getBrand } from "@/lib/api/brand";
import { useQuery } from "@/lib/api/hooks";
import { listPosts } from "@/lib/api/posts";
import { ROUTES } from "@/lib/routes";
import { NavItem } from "./NavItem";

/** Desktop navigation (240px). Hidden below 860px, where TabBar takes over. */
export function Rail() {
  const posts = useQuery("posts", listPosts);
  const accounts = useQuery("accounts", listAccounts);
  const brand = useQuery("brand", getBrand);
  const awaiting = posts.data?.filter((p) => p.state === "approval").length ?? 0;

  return (
    <nav
      aria-label="Main"
      className="sticky top-0 flex h-screen w-60 shrink-0 flex-col gap-7 overflow-y-auto border-r border-line bg-surface-2 px-4 py-6 max-md:hidden [&>*]:shrink-0"
    >
      <Logo href={ROUTES.home} className="px-2" />
      <ButtonLink href={ROUTES.compose} block>
        <PlusIcon size={18} />
        New post
      </ButtonLink>

      <div className="flex flex-col gap-0.5">
        <NavItem href={ROUTES.home} label="Home" icon={HomeIcon} exact />
        <NavItem href={ROUTES.calendar} label="Calendar" icon={CalendarIcon} />
        <NavItem href={ROUTES.drafts} label="Drafts" icon={DraftsIcon} />
        <NavItem
          href={ROUTES.approvals}
          label="Approvals"
          icon={ApprovalsIcon}
          badge={awaiting > 0 ? awaiting : undefined}
          badgeLabel={`${awaiting} awaiting approval`}
        />
        <NavItem href={ROUTES.analytics} label="Analytics" icon={ChartIcon} />
        <NavItem href={ROUTES.brand} label="Brand profile" icon={BrandProfileIcon} />
        <NavItem href={ROUTES.settings} label="Settings" icon={SettingsIcon} />
      </div>

      <div className="mt-auto flex flex-col gap-2.5">
        <h2 className="m-0 px-3 text-xs font-semibold text-muted">Accounts</h2>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {accounts.data?.map((a) => {
            const ok = a.status === "connected";
            return (
              <li key={a.id}>
                <Link
                  href={ok ? ROUTES.settings : ROUTES.connect}
                  className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm text-ink no-underline fine:bg-page-hover"
                >
                  <span
                    aria-hidden="true"
                    className="inline-flex size-6 items-center justify-center rounded-[7px] text-[10px] font-semibold text-white"
                    style={{ background: a.badgeBg }}
                  >
                    {a.badge}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{a.handle}</span>
                  {ok ? (
                    <CheckIcon size={14} className="text-primary-ink" />
                  ) : (
                    <AlertIcon size={16} className="text-amber-ink" />
                  )}
                  <span className="sr-only">{ok ? ", connected" : ", needs reconnecting"}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        {brand.data?.plan === "student" && (
          <div className="flex flex-col gap-1 rounded-[14px] bg-forest p-3.5 text-forest-text">
            <span className="text-xs font-semibold text-lime">Student Access</span>
            <span className="text-sm">Free until {brand.data.planEndsLabel}</span>
            <Link href={ROUTES.billing} className="mt-1 w-fit text-sm font-semibold text-white underline-offset-2 fine:underline">
              See plans
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}
