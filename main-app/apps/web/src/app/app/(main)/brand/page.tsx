import type { Metadata } from "next";
import { BrandProfileScreen } from "@/components/brand/BrandProfileScreen";

export const metadata: Metadata = { title: "Brand kit" };

export default function BrandProfilePage() {
  return <BrandProfileScreen />;
}
