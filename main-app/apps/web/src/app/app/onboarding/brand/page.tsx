import type { Metadata } from "next";
import { BrandStep } from "@/components/onboarding/BrandStep";

export const metadata: Metadata = { title: "Brand voice" };

export default function BrandPage() {
  return <BrandStep />;
}
