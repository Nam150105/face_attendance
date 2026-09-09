import { clearTokens, deviceId, readTokens, rememberSessionEnded, writeTokens } from "./session";
import type {
  AdminAttendanceResponse,
  AdminOverview,
  AdminUsersResponse,
  AppNotification,
  AttendanceDayEvent,
  AttendanceDaysResponse,
  AttendanceEvent,
  AttendanceFilters,
  AttendanceResult,
  AttendanceState,
  AuditLogEntry,
  BulkAddResult,
  CurrentUser,
  EnrollmentChallenge,
  EnrollmentResult,
  FaceEnrollmentStatus,
  RecognitionEngine,
  GeofenceDecision,
  LocationInput,
  ManagedMember,
  AttendanceCalendar,
  LoginHistory,
  ManagerAttendanceEvent,
  ManagerDashboard,
  CorrectionsResponse,
  CorrectionType,
  ManagerLocation,
  MemberLocation,
  MemberProfile,
  NotificationsResponse,
  Paged,
  TokenPair,
  UserRole,
} from "./types";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  /** Present when the server hit a defect and filed it under this code. */
  readonly errorCode: string | null;

  constructor(statusCode: number, code: string, message: string, errorCode: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.errorCode = errorCode;
  }
}

function detailToCode(detail: unknown): string {
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: string };
    return first.msg ?? "VALIDATION_ERROR";
  }
  return "UNKNOWN_ERROR";
}

async function toApiError(response: Response): Promise<ApiError> {
  let code = "UNKNOWN_ERROR";
  let errorCode: string | null = response.headers.get("X-Error-Code");
  try {
    const body = (await response.json()) as { detail?: unknown; error_code?: string };
    code = detailToCode(body.detail);
    errorCode = body.error_code ?? errorCode;
  } catch {
    code = response.statusText || "UNKNOWN_ERROR";
  }
  return new ApiError(response.status, code, code, errorCode);
}

/** Requests that never come back must fail loudly instead of hanging forever. */
const REQUEST_TIMEOUT_MS = 30000;

/**
 * fetch rejects with a bare TypeError for every transport failure, which would
 * otherwise surface to the user as the English string "Failed to fetch".
 * statusCode 0 marks "the request never reached the server".
 */
function toNetworkError(cause: unknown): ApiError {
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return new ApiError(0, "NETWORK_TIMEOUT", "NETWORK_TIMEOUT");
  }
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const code = offline ? "NETWORK_OFFLINE" : "NETWORK_ERROR";
  return new ApiError(0, code, code);
}

export const SESSION_REVOKED = "SESSION_REVOKED";

/**
 * The server closed this session — another device logged in, the account was
 * suspended, or the user logged out elsewhere. Nothing local can recover it, so
 * drop the credentials and hand the user to the login screen with a reason.
 * A full navigation is deliberate: it guarantees no stale state survives.
 */
function endRevokedSession(): void {
  clearTokens();
  if (typeof window === "undefined" || window.location.pathname === "/login") {
    return;
  }
  rememberSessionEnded(SESSION_REVOKED);
  window.location.replace("/login");
}

/** True when the request failed in transit, so retrying the same call is safe. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.statusCode === 0;
}

async function refreshTokens(): Promise<TokenPair | null> {
  const tokens = readTokens();
  if (!tokens) {
    return null;
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
    });
  } catch {
    // A dropped connection is not proof the session is invalid: keep the tokens
    // so the caller can retry once the network is back.
    return null;
  }
  if (!response.ok) {
    clearTokens();
    return null;
  }
  const next = (await response.json()) as TokenPair;
  writeTokens(next);
  return next;
}

interface RequestOptions {
  method?: string;
  json?: unknown;
  form?: FormData;
  auth?: boolean;
  retryOnUnauthorized?: boolean;
}

function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : "";
}

export function authorizedImageUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", json, form, auth = true, retryOnUnauthorized = true } = options;
  const headers: Record<string, string> = {};
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (auth) {
    const tokens = readTokens();
    if (!tokens) {
      throw new ApiError(401, "NOT_AUTHENTICATED", "NOT_AUTHENTICATED");
    }
    headers["X-API-Key"] = tokens.access_token;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: form ?? (json !== undefined ? JSON.stringify(json) : undefined),
      signal: controller.signal,
    });
  } catch (cause) {
    throw toNetworkError(cause);
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 && auth && retryOnUnauthorized) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      return request<T>(path, { ...options, retryOnUnauthorized: false });
    }
  }
  if (!response.ok) {
    const error = await toApiError(response);
    if (auth && error.statusCode === 401 && error.code === SESSION_REVOKED) {
      endRevokedSession();
    }
    throw error;
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Private images come back as bytes, never as a public URL. */
async function requestBlob(path: string): Promise<Blob> {
  const tokens = readTokens();
  if (!tokens) {
    throw new ApiError(401, "NOT_AUTHENTICATED", "NOT_AUTHENTICATED");
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "X-API-Key": tokens.access_token },
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  return response.blob();
}

export const api = {
  register(email: string, password: string, role: UserRole, teamCode?: string) {
    return request<TokenPair>("/auth/register", {
      method: "POST",
      json: { email, password, role, team_code: teamCode || null, device_id: deviceId() },
      auth: false,
    });
  },
  login(email: string, password: string) {
    return request<TokenPair>("/auth/login", {
      method: "POST",
      json: { email, password, device_id: deviceId() },
      auth: false,
    });
  },
  async logout() {
    const tokens = readTokens();
    if (tokens) {
      try {
        await request<void>("/auth/logout", { method: "POST", json: { refresh_token: tokens.refresh_token } });
      } catch {
        // A revoked or expired session is already logged out on the server.
      }
    }
    clearTokens();
  },
  me() {
    return request<CurrentUser>("/auth/me");
  },
  memberProfile() {
    return request<MemberProfile>("/members/me");
  },
  updateMemberProfile(payload: {
    full_name: string;
    phone?: string | null;
    employee_code?: string | null;
    position?: string | null;
    department?: string | null;
  }) {
    return request<MemberProfile>("/members/me", { method: "PUT", json: payload });
  },
  memberLocations() {
    return request<MemberLocation[]>("/members/me/locations");
  },
  faceStatus() {
    return request<FaceEnrollmentStatus>("/faces/me");
  },
  changePassword(current_password: string, new_password: string) {
    return request<void>("/auth/change-password", {
      method: "POST",
      json: { current_password, new_password },
    });
  },
  myManagers() {
    return request<
      { user_id: string; email: string; full_name: string | null; phone: string | null;
        position: string | null; department: string | null }[]
    >("/members/me/managers");
  },
  adminErrors(params: { search?: string; limit?: number; offset?: number } = {}) {
    return request<{
      total: number;
      items: {
        code: string; created_at: string; method: string; path: string; kind: string;
        detail: string; user_email: string | null; request_id: string | null; traceback: string;
      }[];
    }>(`/admin/errors${queryString(params)}`);
  },
  clearAdminErrors(older_than_days: number) {
    return request<{ removed: number }>(`/admin/errors?older_than_days=${older_than_days}`, {
      method: "DELETE",
    });
  },
  teamLocations(teamId: string) {
    return request<
      { id: string; name: string; address: string | null; is_active: boolean; is_default: boolean }[]
    >(`/manager/teams/${teamId}/locations`);
  },
  attachTeamLocation(teamId: string, locationId: string, isDefault: boolean) {
    return request<{ team_id: string }>(`/manager/teams/${teamId}/locations`, {
      method: "POST",
      json: { location_id: locationId, is_default: isDefault },
    });
  },
  detachTeamLocation(teamId: string, locationId: string) {
    return request<{ removed: boolean }>(`/manager/teams/${teamId}/locations/${locationId}`, {
      method: "DELETE",
    });
  },
  teamMembers(teamId: string) {
    return request<ManagedMember[]>(`/manager/teams/${teamId}/members`);
  },
  managerTeams() {
    return request<
      { id: string; code: string; name: string; is_open: boolean; pending: number; members: number }[]
    >("/manager/teams");
  },
  createTeam(name: string, code?: string) {
    return request<{ id: string; code: string; name: string }>("/manager/teams", {
      method: "POST",
      json: { name, code: code || null },
    });
  },
  updateTeam(teamId: string, patch: { name?: string; is_open?: boolean }) {
    return request<{ id: string }>(`/manager/teams/${teamId}`, { method: "PUT", json: patch });
  },
  deleteTeam(teamId: string) {
    return request<{ deleted: boolean }>(`/manager/teams/${teamId}`, { method: "DELETE" });
  },
  joinRequests() {
    return request<
      {
        member_id: string; email: string; role: string; full_name: string | null; phone: string | null;
        position: string | null; department: string | null; team_name: string | null;
        team_code: string | null; requested_at: string;
      }[]
    >("/manager/join-requests");
  },
  decideJoinRequest(memberId: string, approve: boolean, note?: string) {
    return request<{ status: string }>(`/manager/join-requests/${memberId}`, {
      method: "POST",
      json: { approve, note: note || null },
    });
  },
  lookupTeam(code: string) {
    // Called from the sign-up form, where nobody is signed in yet.
    return request<{ name: string; manager_name: string }>(
      `/teams/lookup/${encodeURIComponent(code)}`,
      { auth: false },
    );
  },
  joinTeam(code: string) {
    return request<{ team: string; status: string }>("/teams/join", { method: "POST", json: { code } });
  },
  myJoinRequests() {
    return request<
      { status: string; team_name: string | null; team_code: string | null; note: string | null;
        decided_at: string | null; manager_name: string }[]
    >("/teams/my-requests");
  },
  faceChangeRequests() {
    return request<
      { id: string; member_id: string; email: string; full_name: string | null;
        department: string | null; reason: string; created_at: string;
        has_new_photo: boolean; has_current_photo: boolean }[]
    >("/manager/face-requests");
  },
  async faceRequestPhoto(requestId: string): Promise<string> {
    return URL.createObjectURL(await requestBlob(`/manager/face-requests/${requestId}/photo`));
  },
  decideFaceRequest(requestId: string, approve: boolean, note?: string) {
    return request<{ status: string }>(`/manager/face-requests/${requestId}`, {
      method: "POST",
      json: { approve, note: note || null },
    });
  },
  async myFacePhoto(): Promise<string> {
    return URL.createObjectURL(await requestBlob("/faces/me/photo"));
  },
  myFaceChangeStatus() {
    return request<{
      pending: { id: string; reason: string; created_at: string } | null;
      last: { status: string; note: string | null; decided_at: string } | null;
    }>("/faces/me/change-request");
  },
  myScreens() {
    return request<{
      role: string;
      email: string;
      screens: string[];
      has_face_photo: boolean;
      permissions: Record<string, Record<"view" | "create" | "edit" | "delete", boolean>>;
    }>("/auth/me/screens");
  },
  adminPermissions() {
    return request<{
      screens: string[];
      actions: string[];
      roles: Record<string, Record<string, Record<string, boolean>>>;
      locked: Record<string, string[]>;
    }>("/admin/permissions");
  },
  setPermission(role: string, screen: string, action: string, allowed: boolean) {
    return request<Record<string, unknown>>("/admin/permissions", {
      method: "PUT",
      json: { role, screen, action, allowed },
    });
  },
  resetPermissions() {
    return request<{ restored: number }>("/admin/permissions/reset", { method: "POST" });
  },
  adminTables() {
    return request<{ tables: { name: string; label: string; rows: number }[] }>("/admin/data");
  },
  adminRows(table: string, params: { search?: string; limit?: number; offset?: number } = {}) {
    return request<{
      table: string;
      label: string;
      columns: { name: string; type: string; nullable: boolean; has_default: boolean; readonly: boolean }[];
      total: number;
      items: Record<string, unknown>[];
    }>(`/admin/data/${table}${queryString(params)}`);
  },
  adminInsertRow(table: string, values: Record<string, unknown>) {
    return request<Record<string, unknown>>(`/admin/data/${table}`, { method: "POST", json: { values } });
  },
  adminUpdateRow(table: string, rowId: string, values: Record<string, unknown>) {
    return request<Record<string, unknown>>(`/admin/data/${table}/${rowId}`, { method: "PUT", json: { values } });
  },
  adminDeleteRow(table: string, rowId: string) {
    return request<{ deleted: boolean }>(`/admin/data/${table}/${rowId}`, { method: "DELETE" });
  },
  recognitionEngine() {
    return request<RecognitionEngine>("/faces/engine");
  },
  startEnrollment() {
    return request<EnrollmentChallenge>("/faces/enrollment/start", { method: "POST" });
  },
  verifyEnrollment(challenge: EnrollmentChallenge, image: Blob, reason?: string) {
    const form = new FormData();
    if (reason) {
      form.append("reason", reason);
    }
    form.append("challenge_id", challenge.challenge_id);
    form.append("challenge", challenge.challenge);
    form.append("image", image, "enrollment.jpg");
    return request<EnrollmentResult>("/faces/enrollment/verify", { method: "POST", form });
  },
  attendanceState() {
    return request<AttendanceState>("/attendance/me/state");
  },
  attendanceHistory(limit = 20) {
    return request<AttendanceEvent[]>(`/attendance/me?limit=${limit}`);
  },
  // --- Member portal -------------------------------------------------------
  attendanceDays(range: { date_from?: string; date_to?: string } = {}) {
    return request<AttendanceDaysResponse>(`/attendance/me/daily${queryString(range)}`);
  },
  attendanceDay(workDate: string) {
    return request<AttendanceDayEvent[]>(`/attendance/me/day/${workDate}`);
  },
  notifications(options: { unread_only?: boolean; limit?: number } = {}) {
    return request<NotificationsResponse>(`/notifications${queryString(options)}`);
  },
  markNotificationRead(id: string) {
    return request<{ id: string }>(`/notifications/${id}/read`, { method: "POST" });
  },
  markAllNotificationsRead() {
    return request<{ marked: number }>("/notifications/read-all", { method: "POST" });
  },
  myCorrections() {
    return request<CorrectionsResponse>("/attendance/corrections");
  },
  submitCorrection(payload: {
    work_date: string;
    request_type: CorrectionType;
    requested_check_in?: string | null;
    requested_check_out?: string | null;
    reason: string;
  }) {
    return request<{ id: string; status: string }>("/attendance/corrections", { method: "POST", json: payload });
  },
  cancelCorrection(id: string) {
    return request<{ id: string }>(`/attendance/corrections/${id}`, { method: "DELETE" });
  },

  // --- Manager side of the member portal ------------------------------------
  correctionsQueue(status?: string) {
    return request<CorrectionsResponse>(`/manager/corrections${queryString({ status })}`);
  },
  reviewCorrection(id: string, decision: "APPROVED" | "REJECTED", note?: string) {
    return request<{ id: string; status: string }>(`/manager/corrections/${id}/review`, {
      method: "POST",
      json: { decision, note: note ?? null },
    });
  },

  // --- System administration (SUPER_ADMIN only) -----------------------------
  adminOverview() {
    return request<AdminOverview>("/admin/overview");
  },
  adminUsers(options: { search?: string; role?: string } = {}) {
    return request<AdminUsersResponse>(`/admin/users${queryString(options)}`);
  },
  adminUpdateUser(userId: string, payload: { role?: string; status?: string }) {
    return request<{ id: string }>(`/admin/users/${userId}`, { method: "PUT", json: payload });
  },
  adminResetPassword(userId: string, newPassword: string) {
    return request<{ id: string }>(`/admin/users/${userId}/password`, {
      method: "POST",
      json: { new_password: newPassword },
    });
  },
  adminDeleteUser(userId: string, reason: string) {
    return request<{ id: string }>(`/admin/users/${userId}${queryString({ reason })}`, { method: "DELETE" });
  },
  adminAttendance(options: { date_from?: string; date_to?: string; include_deleted?: boolean } = {}) {
    return request<AdminAttendanceResponse>(`/admin/attendance${queryString(options)}`);
  },
  adminPurgeAttendance(eventId: string, reason: string) {
    return request<{ id: string }>(`/admin/attendance/${eventId}${queryString({ reason })}`, { method: "DELETE" });
  },
  adminRestoreAttendance(eventId: string) {
    return request<{ id: string }>(`/admin/attendance/${eventId}/restore`, { method: "POST" });
  },
  /** Manager-scoped soft delete; the record can still be restored by an admin. */
  deleteAttendanceRecord(eventId: string, reason: string) {
    return request<{ id: string }>(`/manager/attendance/${eventId}${queryString({ reason })}`, { method: "DELETE" });
  },

  evaluateGeofence(locationId: string, position: { latitude: number; longitude: number; gps_accuracy_meters: number }) {
    return request<GeofenceDecision>(`/locations/${locationId}/evaluate`, { method: "POST", json: position });
  },
  checkIn(payload: {
    locationId: string;
    latitude: number;
    longitude: number;
    gpsAccuracyMeters: number;
    idempotencyKey: string;
    reason?: string;
    image: Blob;
  }) {
    const form = new FormData();
    form.append("location_id", payload.locationId);
    form.append("latitude", String(payload.latitude));
    form.append("longitude", String(payload.longitude));
    form.append("gps_accuracy_meters", String(payload.gpsAccuracyMeters));
    form.append("idempotency_key", payload.idempotencyKey);
    if (payload.reason) {
      form.append("reason", payload.reason);
    }
    form.append("image", payload.image, "check-in.jpg");
    return request<AttendanceResult>("/attendance/check-in", { method: "POST", form });
  },
  checkOut(payload: {
    latitude: number;
    longitude: number;
    gpsAccuracyMeters: number;
    idempotencyKey: string;
    image: Blob;
    /** Only when leaving from somewhere other than where the day was opened. */
    locationId?: string;
    reason?: string;
  }) {
    const form = new FormData();
    form.append("latitude", String(payload.latitude));
    form.append("longitude", String(payload.longitude));
    form.append("gps_accuracy_meters", String(payload.gpsAccuracyMeters));
    form.append("idempotency_key", payload.idempotencyKey);
    if (payload.locationId) {
      form.append("location_id", payload.locationId);
    }
    if (payload.reason) {
      form.append("reason", payload.reason);
    }
    form.append("image", payload.image, "check-out.jpg");
    return request<AttendanceResult>("/attendance/check-out", { method: "POST", form });
  },

  resolvePlace(query: string) {
    return request<{ latitude: number; longitude: number; label: string | null; source: string }>(
      "/manager/locations/resolve-place",
      { method: "POST", json: { query } },
    );
  },
  reversePlace(latitude: number, longitude: number) {
    return request<{ label: string | null }>("/manager/locations/reverse-place", {
      method: "POST",
      json: { latitude, longitude },
    });
  },
  managerDashboard() {
    return request<ManagerDashboard>("/manager/dashboard");
  },
  managerMembers() {
    return request<ManagedMember[]>("/manager/members");
  },
  bulkAddMembers(emails: string[]) {
    return request<BulkAddResult>("/manager/members/bulk-add", { method: "POST", json: { emails } });
  },
  addMemberByEmail(email: string, teamId?: string) {
    return request<ManagedMember>("/manager/members/add-by-email", {
      method: "POST",
      json: teamId ? { email, team_id: teamId } : { email },
    });
  },
  updateMembership(memberId: string, status: string) {
    return request<ManagedMember>(`/manager/members/${memberId}`, { method: "PUT", json: { status } });
  },
  removeMember(memberId: string) {
    return request<{ member_id: string }>(`/manager/members/${memberId}`, { method: "DELETE" });
  },
  managerLocations() {
    return request<ManagerLocation[]>("/manager/locations");
  },
  createLocation(payload: LocationInput) {
    return request<ManagerLocation>("/manager/locations", { method: "POST", json: payload });
  },
  updateLocation(locationId: string, payload: LocationInput) {
    return request<ManagerLocation>(`/manager/locations/${locationId}`, { method: "PUT", json: payload });
  },
  /** Permanent removal; only succeeds while no attendance record points at it. */
  destroyLocation(locationId: string) {
    return request<{ location_id: string }>(`/manager/locations/${locationId}/permanent`, { method: "DELETE" });
  },
  deleteLocation(locationId: string) {
    return request<{ location_id: string }>(`/manager/locations/${locationId}`, { method: "DELETE" });
  },
  assignedLocations(memberId: string) {
    return request<ManagerLocation[]>(`/manager/members/${memberId}/locations`);
  },
  assignLocation(memberId: string, locationId: string, isDefault: boolean) {
    return request<{ location_id: string }>(`/manager/members/${memberId}/locations`, {
      method: "POST",
      json: { location_id: locationId, is_default: isDefault },
    });
  },
  unassignLocation(memberId: string, locationId: string) {
    return request<{ location_id: string }>(`/manager/members/${memberId}/locations/${locationId}`, {
      method: "DELETE",
    });
  },
  managerAttendance(filters: AttendanceFilters = {}) {
    return request<Paged<ManagerAttendanceEvent>>(`/manager/attendance${queryString(filters)}`);
  },
  async memberFacePhoto(memberId: string): Promise<string> {
    const blob = await requestBlob(`/manager/members/${memberId}/face-photo`);
    return URL.createObjectURL(blob);
  },
  memberLoginHistory(memberId: string, limit = 50) {
    return request<LoginHistory>(`/manager/members/${memberId}/login-history?limit=${limit}`);
  },
  managerAttendanceSessions(params: {
    member_id?: string;
    location_id?: string;
    date_from?: string;
    date_to?: string;
    include_invalid?: boolean;
    limit?: number;
    offset?: number;
  }) {
    return request<{
      total: number;
      items: {
        work_date: string;
        member_id: string;
        member_email: string;
        member_name: string | null;
        check_in: string | null;
        check_out: string | null;
        minutes_late: number;
        minutes_early_leave: number;
        rejected: number;
        location_name: string | null;
        check_in_id: string | null;
        check_out_id: string | null;
        status: "ON_TIME" | "LATE" | "OPEN" | "REJECTED";
      }[];
    }>(`/manager/attendance/sessions${queryString(params)}`);
  },
  managerAttendanceCalendar(month: string, includeInvalid = false) {
    return request<AttendanceCalendar>(
      `/manager/attendance/calendar?month=${month}&include_invalid=${includeInvalid}`,
    );
  },
  managerAttendanceDetail(eventId: string) {
    return request<ManagerAttendanceEvent>(`/manager/attendance/${eventId}`);
  },
  async managerAttendanceImage(eventId: string): Promise<string> {
    return URL.createObjectURL(await requestBlob(`/manager/attendance/${eventId}/image`));
  },
  manualAdjust(eventId: string, payload: { status?: string; server_time?: string; reason: string }) {
    return request<ManagerAttendanceEvent>(`/manager/attendance/${eventId}/manual-adjust`, {
      method: "POST",
      json: payload,
    });
  },
  auditLogs(params: { entity_type?: string; action?: string; limit?: number; offset?: number } = {}) {
    return request<Paged<AuditLogEntry>>(`/manager/audit-logs${queryString(params)}`);
  },
};
