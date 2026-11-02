import type { Metadata } from "next";
import { ApprovalsScreen } from "@/components/approvals/ApprovalsScreen";

export const metadata: Metadata = { title: "Approvals" };

type Search = { post?: string };

/** `?post=<id>` opens that post for review (links from emails and Post detail). */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { post } = await searchParams;
  return <ApprovalsScreen key={post ?? ""} initialId={post} />;
}
