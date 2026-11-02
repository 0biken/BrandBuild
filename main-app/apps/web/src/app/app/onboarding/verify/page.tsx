import type { Metadata } from "next";
import { VerifyStep } from "@/components/onboarding/VerifyStep";

export const metadata: Metadata = { title: "Student check" };

export default function VerifyPage() {
  return <VerifyStep />;
}
