import type { Metadata } from "next";
import { BillingScreen } from "@/components/billing/BillingScreen";

export const metadata: Metadata = { title: "Plan and billing" };

export default function BillingPage() {
  return <BillingScreen />;
}
