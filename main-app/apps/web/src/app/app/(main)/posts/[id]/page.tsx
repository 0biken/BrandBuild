import type { Metadata } from "next";
import { PostDetailScreen } from "@/components/posts/PostDetailScreen";

export const metadata: Metadata = { title: "Post" };

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostDetailScreen id={decodeURIComponent(id)} />;
}
