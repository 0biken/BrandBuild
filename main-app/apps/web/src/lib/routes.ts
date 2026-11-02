import { APP_HOME } from "@/lib/api/session";

/** Every customer-app path, in one place. */
export const ROUTES = {
  home: APP_HOME,
  compose: `${APP_HOME}/compose`,
  calendar: `${APP_HOME}/calendar`,
  drafts: `${APP_HOME}/drafts`,
  approvals: `${APP_HOME}/approvals`,
  analytics: `${APP_HOME}/analytics`,
  brand: `${APP_HOME}/brand`,
  settings: `${APP_HOME}/settings`,
  billing: `${APP_HOME}/billing`,
  notifications: `${APP_HOME}/notifications`,
  connect: `${APP_HOME}/connect`,
  post: (id: string) => `${APP_HOME}/posts/${encodeURIComponent(id)}`,
} as const;

/**
 * Screens in the plan that aren't built yet, with the phase that builds
 * them. The app shows a "coming soon" page for these instead of a 404, so
 * the navigation works throughout the build. Remove entries as they land.
 */
export const UPCOMING: Record<string, { title: string; phase: string }> = {
  compose: { title: "New post", phase: "Phase 1b" },
  calendar: { title: "Calendar", phase: "Phase 1b" },
  posts: { title: "Post detail", phase: "Phase 1b" },
  connect: { title: "Connect accounts", phase: "Phase 2" },
  approvals: { title: "Approvals", phase: "Phase 3" },
  analytics: { title: "Analytics", phase: "Phase 3" },
  brand: { title: "Brand profile", phase: "Phase 3" },
  settings: { title: "Settings", phase: "Phase 3" },
  billing: { title: "Plan and billing", phase: "Phase 3" },
  notifications: { title: "Notifications", phase: "Phase 3" },
};
