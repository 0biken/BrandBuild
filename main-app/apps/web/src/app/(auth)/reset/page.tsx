import type { Metadata } from "next";
import { CenterShell } from "@/components/auth/AuthShell";
import { ResetFlow } from "@/components/auth/ResetFlow";

export const metadata: Metadata = { title: "Reset your password" };

export default function ResetPage() {
  return (
    <CenterShell>
      <ResetFlow />
    </CenterShell>
  );
}
