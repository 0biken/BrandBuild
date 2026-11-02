import type { Metadata } from "next";
import { Composer } from "@/components/composer/Composer";

export const metadata: Metadata = { title: "New post" };

type Search = { idea?: string; draft?: string; post?: string; date?: string };

export default async function ComposePage({ searchParams }: { searchParams: Promise<Search> }) {
  const { idea, draft, post, date } = await searchParams;
  return (
    // Keyed so moving between drafts/posts starts a fresh composer.
    <Composer key={`${draft ?? ""}${post ?? ""}`} idea={idea} draftId={draft} postId={post} date={date} />
  );
}
