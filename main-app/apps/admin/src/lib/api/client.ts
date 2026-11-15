export type StaffRole =
  | "support"
  | "operations"
  | "student_reviewer"
  | "staff_admin";

export interface StaffMember {
  id: string;
  email: string;
  displayName: string;
  roles: StaffRole[];
  isActive?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface StaffAuditRow {
  id: string;
  staffUserId: string | null;
  staffEmail: string | null;
  activeRoles: string[];
  action: string;
  workspaceId: string | null;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  reason: string | null;
  ticketRef: string | null;
  supportSessionId: string | null;
  beforeState: unknown;
  afterState: unknown;
  outcome: "success" | "denied" | "error";
  createdAt: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/admin/v1${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const json = (await res.json().catch(() => null)) as
      | { data?: T; error?: { code?: string; message?: string } }
      | null;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: json?.error?.code ?? "request_failed",
        message: json?.error?.message ?? "Request failed",
      };
    }
    return { ok: true, data: json?.data as T };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "network_error",
      message: "Could not reach the admin API.",
    };
  }
}

export function getMe(): Promise<ApiResult<StaffMember>> {
  return request<StaffMember>("/me");
}

export function logout(): Promise<ApiResult<{ loggedOut: boolean }>> {
  return request<{ loggedOut: boolean }>("/auth/logout", { method: "POST" });
}

export function listStaff(): Promise<ApiResult<StaffMember[]>> {
  return request<StaffMember[]>("/staff");
}

export function createStaff(input: {
  email: string;
  displayName: string;
  roles: StaffRole[];
}): Promise<ApiResult<StaffMember>> {
  return request<StaffMember>("/staff", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateStaff(
  id: string,
  input: {
    displayName?: string;
    roles?: StaffRole[];
    isActive?: boolean;
    reason?: string;
  },
): Promise<ApiResult<StaffMember>> {
  return request<StaffMember>(`/staff/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function listAudit(params?: {
  staffUserId?: string;
  workspaceId?: string;
  action?: string;
  limit?: number;
}): Promise<ApiResult<StaffAuditRow[]>> {
  const sp = new URLSearchParams();
  if (params?.staffUserId) sp.set("staffUserId", params.staffUserId);
  if (params?.workspaceId) sp.set("workspaceId", params.workspaceId);
  if (params?.action) sp.set("action", params.action);
  if (params?.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  return request<StaffAuditRow[]>(`/audit${qs ? `?${qs}` : ""}`);
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  support: "Support",
  operations: "Operations",
  student_reviewer: "Student reviewer",
  staff_admin: "Staff admin",
};

export interface OverviewPlatformRow {
  platform: string;
  verified: number;
  acceptedUnverified: number;
  failed: number;
  unclear: number;
}

export interface OverviewSummary {
  generatedAt: string;
  unclear: { count: number; oldestMinutes: number | null };
  studentReviews: { count: number; oldestMinutes: number | null };
  pausedWorkspaces: { count: number; globalPaused?: boolean };
  failedToday: { failed: number; total: number };
  platforms: OverviewPlatformRow[];
  aiToday: {
    runs: number;
    costUsd: number;
    topWorkspace: { id: string; name: string; costUsd: number } | null;
  };
  recentActions: Array<{
    id: string;
    staffEmail: string | null;
    staffName: string;
    action: string;
    workspaceId: string | null;
    targetType: string | null;
    targetId: string | null;
    reason: string | null;
    createdAt: string;
  }>;
  activeIncidents?: ProviderIncident[];
}

export interface PublishingHold {
  id: string;
  scope: "global" | "workspace" | "channel";
  workspaceId?: string | null;
  channelId: string | null;
  internalReason: string;
  customerMessage: string;
  createdBy: string;
  createdAt: string;
}

export interface ProviderIncident {
  id: string;
  title: string;
  platforms: string[];
  customerMessage: string;
  publishBanner: boolean;
  createdBy?: string;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface WorkspaceListItem {
  id: string;
  name: string;
  slug: string;
  plan: string;
  planEndsAt: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  activeChannels: number;
  unclearPosts: number;
  failedPosts7d: number;
  createdAt: string;
}

export interface WorkspaceDetail {
  id: string;
  name: string;
  slug: string;
  plan: string;
  planEndsAt: string | null;
  timezone: string;
  requireSecondApprover: boolean;
  createdAt: string;
  owner: { id: string; email: string; displayName: string | null } | null;
  studentCheck: { status: string; method?: string | null; checkedAt?: string | null };
  team: Array<{
    userId: string;
    email: string;
    displayName: string | null;
    role: string;
  }>;
  channels: Array<{
    id: string;
    provider: string;
    displayName: string | null;
    externalAccountId: string | null;
    scopes: string[];
    isActive: boolean;
    tokenExpiresAt: string | null;
  }>;
  posts: Array<{
    id: string;
    title: string;
    platforms: string[];
    state: string;
    scheduledFor: string | null;
    publishedAt: string | null;
    updatedAt: string;
  }>;
  ai: {
    runsThisMonth: number;
    costUsdThisMonth: number;
    agentRunsLimit: number;
  };
  notes: Array<{
    id: string;
    note: string;
    staffName: string;
    staffEmail: string;
    createdAt: string;
  }>;
  auditEvents: Array<{
    id: string;
    staffEmail: string | null;
    action: string;
    reason: string | null;
    outcome: string;
    createdAt: string;
  }>;
  activeHolds?: PublishingHold[];
}

export function getOverview(): Promise<ApiResult<OverviewSummary>> {
  return request<OverviewSummary>("/overview");
}

export function searchWorkspaces(params?: {
  q?: string;
  plan?: string;
  limit?: number;
  offset?: number;
}): Promise<ApiResult<{ total: number; items: WorkspaceListItem[] }>> {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.plan) sp.set("plan", params.plan);
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.offset) sp.set("offset", String(params.offset));
  const qs = sp.toString();
  return request<{ total: number; items: WorkspaceListItem[] }>(
    `/workspaces${qs ? `?${qs}` : ""}`,
  );
}

export function getWorkspace(id: string): Promise<ApiResult<WorkspaceDetail>> {
  return request<WorkspaceDetail>(`/workspaces/${id}`);
}

export function addWorkspaceNote(
  id: string,
  note: string,
): Promise<ApiResult<WorkspaceDetail["notes"][number]>> {
  return request<WorkspaceDetail["notes"][number]>(`/workspaces/${id}/notes`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function listHolds(params?: {
  workspaceId?: string;
}): Promise<ApiResult<PublishingHold[]>> {
  const sp = new URLSearchParams();
  if (params?.workspaceId) sp.set("workspaceId", params.workspaceId);
  const qs = sp.toString();
  return request<PublishingHold[]>(`/publishing-holds${qs ? `?${qs}` : ""}`);
}

export function createHold(input: {
  scope: "global" | "workspace" | "channel";
  workspaceId?: string;
  channelId?: string;
  internalReason: string;
  customerMessage: string;
}): Promise<ApiResult<PublishingHold>> {
  return request<PublishingHold>("/publishing-holds", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function releaseHold(
  id: string,
  reason?: string,
): Promise<ApiResult<{ id: string; releasedAt: string; heldOverduePosts: number }>> {
  return request<{ id: string; releasedAt: string; heldOverduePosts: number }>(
    `/publishing-holds/${id}/release`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    },
  );
}

export function createIncident(input: {
  title: string;
  platforms: string[];
  customerMessage: string;
  publishBanner?: boolean;
}): Promise<ApiResult<ProviderIncident>> {
  return request<ProviderIncident>("/incidents", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateIncident(
  id: string,
  input: { publishBanner?: boolean; resolve?: boolean },
): Promise<ApiResult<{ publishBanner: boolean; resolvedAt: string | null }>> {
  return request<{ publishBanner: boolean; resolvedAt: string | null }>(
    `/incidents/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export interface AiSpendSummary {
  generatedAt: string;
  policy: {
    globalDailyUsdBudget: number;
    defaultWorkspaceMonthlyUsdBudget: number;
    defaultWorkspaceDailyGenLimit: number;
    alertWarnPct: number;
    alertHardPct: number;
  };
  today: {
    costUsd: number;
    reservedUsd: number;
    uncertainUsd: number;
    runs: number;
    failedButBilledRuns: number;
  };
  month: {
    costUsd: number;
    runs: number;
    failedButBilledRuns: number;
  };
  daily: Array<{
    day: string;
    costUsd: number;
    runs: number;
    failedRuns: number;
  }>;
  byFeature: Array<{
    feature: string;
    runs: number;
    costUsd: number;
  }>;
  topWorkspaces: Array<{
    id: string;
    name: string;
    plan: string;
    runs: number;
    costUsd: number;
    monthlyBudgetUsd: number;
    dailyGenLimit: number;
    suspendedUntil: string | null;
    suspensionReason: string | null;
  }>;
  uncertainRuns: Array<{
    id: string;
    tenantId: string;
    workspaceName: string;
    kind: string;
    model: string;
    reservedUsd: number;
    settledUsd: number | null;
    status: string;
    createdAt: string;
  }>;
}

export function getAiSpend(days = 14): Promise<ApiResult<AiSpendSummary>> {
  return request<AiSpendSummary>(`/ai?days=${days}`);
}

export function updateAiPolicy(input: {
  globalDailyUsdBudget?: number;
  defaultWorkspaceMonthlyUsdBudget?: number;
  defaultWorkspaceDailyGenLimit?: number;
  alertWarnPct?: number;
  alertHardPct?: number;
  reason?: string;
}): Promise<ApiResult<AiSpendSummary["policy"]>> {
  return request<AiSpendSummary["policy"]>("/ai/policy", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function updateWorkspaceAi(
  workspaceId: string,
  input: {
    monthlyUsdBudget?: number;
    dailyGenLimit?: number;
    suspendHours?: number;
    clearSuspension?: boolean;
    reason?: string;
  },
): Promise<ApiResult<unknown>> {
  return request<unknown>(`/ai/workspaces/${workspaceId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export interface StudentReviewItem {
  id: string;
  tenantId: string;
  workspaceName: string;
  ownerEmail: string;
  applicantName: string;
  school: string;
  cardExpiryDate: string;
  mimeType: string;
  fileSizeBytes: number;
  scanStatus: "quarantine" | "ready" | "blocked";
  decisionStatus: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
  version: number;
  previewReady: boolean;
  createdAt: string;
  reviewedAt: string | null;
}

export function listStudentReviews(
  status: "pending" | "approved" | "rejected" | "all" = "pending",
): Promise<ApiResult<StudentReviewItem[]>> {
  return request<StudentReviewItem[]>(`/student-reviews?status=${status}`);
}

export function decideStudentReview(
  id: string,
  input: {
    expectedVersion: number;
    decision: "approved" | "rejected";
    nameMatches?: boolean;
    schoolRecognised?: boolean;
    expiryFutureDated?: boolean;
    genuineCard?: boolean;
    rejectionReason?: string;
  },
): Promise<
  ApiResult<{ id: string; decisionStatus: string; planEndsAt: string | null }>
> {
  return request<{
    id: string;
    decisionStatus: string;
    planEndsAt: string | null;
  }>(`/student-reviews/${id}/decision`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface SupportSession {
  id: string;
  tenantId: string;
  workspaceName: string;
  mode: "read_only" | "read_write";
  ticketRef: string;
  reason: string;
  durationMinutes: number;
  status:
    | "pending_approval"
    | "approved"
    | "active"
    | "ended"
    | "revoked"
    | "rejected"
    | "expired";
  requestedBy: string;
  requestedByName: string;
  requestedByEmail: string;
  approvedBy: string | null;
  approvedByName: string | null;
  customerNotifiedAt: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface SupportWorkspaceView {
  session: {
    id: string;
    mode: "read_only" | "read_write";
    expiresAt: string;
    ticketRef: string;
  };
  workspace: { id: string; name: string; plan: string; timezone: string };
  drafts: Array<{
    id: string;
    title: string;
    body: string;
    platforms: string[];
    state: string;
    scheduledFor: string | null;
    updatedAt: string;
  }>;
  brand: {
    tone: string | null;
    audience: string | null;
    offerings: string | null;
    avoid: string | null;
  } | null;
  facts: Array<{
    id: string;
    kind: string;
    label: string;
    value: string;
    verified: boolean;
  }>;
}

export function listSupportSessions(params?: {
  workspaceId?: string;
  status?: string;
}): Promise<ApiResult<SupportSession[]>> {
  const sp = new URLSearchParams();
  if (params?.workspaceId) sp.set("workspaceId", params.workspaceId);
  if (params?.status) sp.set("status", params.status);
  const qs = sp.toString();
  return request<SupportSession[]>(
    `/support-sessions${qs ? `?${qs}` : ""}`,
  );
}

export function requestSupportSession(input: {
  workspaceId: string;
  mode: "read_only" | "read_write";
  ticketRef: string;
  reason: string;
  durationMinutes?: number;
}): Promise<ApiResult<{ id: string; status: string }>> {
  return request<{ id: string; status: string }>("/support-sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function approveSupportSession(
  id: string,
): Promise<ApiResult<{ id: string; status: string }>> {
  return request<{ id: string; status: string }>(
    `/support-sessions/${id}/approve`,
    { method: "POST" },
  );
}

export function activateSupportSession(
  id: string,
): Promise<ApiResult<{ id: string; status: string; expiresAt: string }>> {
  return request<{ id: string; status: string; expiresAt: string }>(
    `/support-sessions/${id}/activate`,
    { method: "POST" },
  );
}

export function endSupportSession(
  id: string,
): Promise<ApiResult<{ id: string; status: string }>> {
  return request<{ id: string; status: string }>(
    `/support-sessions/${id}/end`,
    { method: "POST" },
  );
}

export function getSupportWorkspace(
  sessionId: string,
): Promise<ApiResult<SupportWorkspaceView>> {
  return request<SupportWorkspaceView>(
    `/support-sessions/${sessionId}/workspace`,
  );
}

export function editSupportDraft(
  sessionId: string,
  postId: string,
  input: { title: string; body: string; reason?: string },
): Promise<ApiResult<{ ok: boolean; id: string; version: number }>> {
  return request<{ ok: boolean; id: string; version: number }>(
    `/support-sessions/${sessionId}/drafts/${postId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export interface UnclearAttempt {
  id: string;
  tenantId: string;
  workspaceName: string;
  postId: string;
  postTitle: string;
  platforms: string[];
  postVersionId: string;
  approvedVersion: number;
  approvedContent: { title?: string; body?: string; hashtags?: string[] };
  channelId: string | null;
  channelProvider: string | null;
  channelName: string | null;
  attemptNo: number;
  state: string;
  platformPostId: string | null;
  response: unknown;
  receipt: unknown;
  reconcileEvidence: {
    status?: string;
    reason?: string;
    retryEligible?: boolean;
    platformPostId?: string;
  } | null;
  workerId: string | null;
  fencedAt: string | null;
  escalated: boolean;
  error: string | null;
  version: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export function listUnclearAttempts(params?: {
  platform?: string;
  workspaceId?: string;
}): Promise<ApiResult<UnclearAttempt[]>> {
  const sp = new URLSearchParams();
  if (params?.platform) sp.set("platform", params.platform);
  if (params?.workspaceId) sp.set("workspaceId", params.workspaceId);
  const qs = sp.toString();
  return request<UnclearAttempt[]>(
    `/publish-attempts${qs ? `?${qs}` : ""}`,
  );
}

export function reconcilePublishAttempt(
  id: string,
): Promise<ApiResult<unknown>> {
  return request<unknown>(`/publish-attempts/${id}/reconcile`, {
    method: "POST",
  });
}

export function resolvePublishAttempt(
  id: string,
  input: {
    expectedVersion: number;
    idempotencyKey: string;
    action: "confirm_published" | "mark_failed" | "retry" | "escalate";
    note: string;
    receipt?: unknown;
  },
): Promise<ApiResult<unknown>> {
  return request<unknown>(`/publish-attempts/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
