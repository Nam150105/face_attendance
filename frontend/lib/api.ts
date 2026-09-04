import { clearTokens, readTokens, writeTokens } from "./session";
import type {
  AttendanceEvent,
  AttendanceResult,
  AttendanceState,
  CurrentUser,
  EnrollmentChallenge,
  EnrollmentResult,
  FaceEnrollmentStatus,
  GeofenceDecision,
  MemberLocation,
  MemberProfile,
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

async function refreshTokens(): Promise<TokenPair | null> {
  const tokens = readTokens();
  if (!tokens) {
    return null;
  }
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  });
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
    headers.Authorization = `Bearer ${tokens.access_token}`;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: form ?? (json !== undefined ? JSON.stringify(json) : undefined),
  });
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
  updateMemberProfile(payload: { full_name: string; phone?: string | null }) {
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
};
