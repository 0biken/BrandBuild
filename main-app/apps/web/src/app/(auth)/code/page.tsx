import type { Metadata } from "next";
import { CenterShell } from "@/components/auth/AuthShell";
import { CodeForm } from "@/components/auth/CodeForm";

export const metadata: Metadata = { title: "Check your email" };

export default function CodePage() {
  return (
    <CenterShell>
      <CodeForm />
    </CenterShell>
  );
}
