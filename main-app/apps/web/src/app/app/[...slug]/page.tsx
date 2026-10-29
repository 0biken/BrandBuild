import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ClockIcon } from "@/components/ui/icons";
import { ROUTES, UPCOMING } from "@/lib/routes";

type Props = { params: Promise<{ slug: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: UPCOMING[slug[0]]?.title ?? "Not found" };
}

/**
 * Temporary: app screens that later phases build. Known routes show a
 * "coming soon" page so navigation works mid-build; anything else 404s.
 */
export default async function UpcomingScreen({ params }: Props) {
  const { slug } = await params;
  const screen = UPCOMING[slug[0]];
  if (!screen) notFound();
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 pt-10">
      <h1 className="m-0 font-display text-[34px] font-bold tracking-[-0.03em]">{screen.title}</h1>
      <EmptyState
        icon={ClockIcon}
        title="This screen is on its way"
        body={`It's part of ${screen.phase} of the build.`}
        action={<ButtonLink href={ROUTES.home} variant="outline">Back to Home</ButtonLink>}
      />
    </div>
  );
}
