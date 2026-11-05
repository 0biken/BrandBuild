import { APP_HOME } from "@/lib/api/session";

/** Every customer-app path, in one place. */
export const ROUTES = {
  home: APP_HOME,
  compose: `${APP_HOME}/compose`,
  calendar: `${APP_HOME}/calendar`,
  drafts: `${APP_HOME}/drafts`,
  approvals: `${APP_HOME}/approvals`,
  approval: (id: string) => `${APP_HOME}/approvals?post=${encodeURIComponent(id)}`,
  analytics: `${APP_HOME}/analytics`,
  brand: `${APP_HOME}/brand`,
  settings: `${APP_HOME}/settings`,
  billing: `${APP_HOME}/billing`,
  notifications: `${APP_HOME}/notifications`,
  connect: `${APP_HOME}/onboarding/connect`,
  onboarding: `${APP_HOME}/onboarding`,
  post: (id: string) => `${APP_HOME}/posts/${encodeURIComponent(id)}`,
} as const;

/**
 * Screens in the plan that aren't built yet, with the phase that builds
 * them. The app shows a "coming soon" page for these instead of a 404, so
 * the navigation works throughout the build. Remove entries as they land.
 */
export const UPCOMING: Record<string, { title: string; phase: string }> = {
  analytics: { title: "Analytics", phase: "Phase 3" },
  billing: { title: "Plan and billing", phase: "Phase 3" },
};
