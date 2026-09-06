import { clearTokens, readTokens, writeTokens } from "./session";
import type {
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
  GeofenceDecision,
  LocationInput,
  ManagedMember,
  ManagerAttendanceEvent,
  ManagerDashboard,
  ManagerLocation,
  MemberLocation,
  MemberProfile,
  Paged,
  TokenPair,
  UserRole,
} from "./types";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
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
  try {
    const body = (await response.json()) as { detail?: unknown };
    code = detailToCode(body.detail);
  } catch {
    code = response.statusText || "UNKNOWN_ERROR";
  }
  return new ApiError(response.status, code, code);
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
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  register(email: string, password: string, role: UserRole) {
    return request<TokenPair>("/auth/register", { method: "POST", json: { email, password, role }, auth: false });
  },
  login(email: string, password: string) {
    return request<TokenPair>("/auth/login", { method: "POST", json: { email, password }, auth: false });
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
  startEnrollment() {
    return request<EnrollmentChallenge>("/faces/enrollment/start", { method: "POST" });
  },
  verifyEnrollment(challenge: EnrollmentChallenge, image: Blob) {
    const form = new FormData();
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
  }) {
    const form = new FormData();
    form.append("latitude", String(payload.latitude));
    form.append("longitude", String(payload.longitude));
    form.append("gps_accuracy_meters", String(payload.gpsAccuracyMeters));
    form.append("idempotency_key", payload.idempotencyKey);
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
  addMemberByEmail(email: string) {
    return request<ManagedMember>("/manager/members/add-by-email", { method: "POST", json: { email } });
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
  managerAttendanceDetail(eventId: string) {
    return request<ManagerAttendanceEvent>(`/manager/attendance/${eventId}`);
  },
  async managerAttendanceImage(eventId: string): Promise<string> {
    const tokens = readTokens();
    if (!tokens) {
      throw new ApiError(401, "NOT_AUTHENTICATED", "NOT_AUTHENTICATED");
    }
    const response = await fetch(`${API_BASE_URL}/manager/attendance/${eventId}/image`, {
      headers: { "X-API-Key": tokens.access_token },
    });
    if (!response.ok) {
      throw await toApiError(response);
    }
    return URL.createObjectURL(await response.blob());
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
