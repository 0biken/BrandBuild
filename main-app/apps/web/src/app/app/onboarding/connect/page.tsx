import type { Metadata } from "next";
import { ConnectStep } from "@/components/onboarding/ConnectStep";

export const metadata: Metadata = { title: "Connect accounts" };

export default function ConnectPage() {
  return <ConnectStep />;
}
