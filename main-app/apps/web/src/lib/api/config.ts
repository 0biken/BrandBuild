/**
 * Which back end the app talks to.
 *  - "mock" (default): in-browser store in src/lib/mock, no server needed.
 *  - "http": the Rust API at NEXT_PUBLIC_API_URL.
 */
export const API_MODE: "mock" | "http" =
  process.env.NEXT_PUBLIC_API_MODE === "http" ? "http" : "mock";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
