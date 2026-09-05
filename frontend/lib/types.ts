export type UserRole = "MANAGER" | "MEMBER";

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  role: UserRole;
  status: string;
}

export interface MemberProfile {
  id: string | null;
  user_id: string;
  email: string;
  role: UserRole;
  status: string;
  full_name: string | null;
  phone: string | null;
  birth_date: string | null;
  employee_code: string | null;
  position: string | null;
  department: string | null;
  avatar_object_key: string | null;
}

export interface MemberLocation {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  allow_radius_meters: number;
  warning_radius_meters: number;
  is_active: boolean;
  is_default: boolean;
}

export interface FaceEnrollmentStatus {
  enrolled: boolean;
  embedding_id: string | null;
  model_name: string | null;
  model_version: string | null;
  enrolled_at: string | null;
}

export interface EnrollmentChallenge {
  challenge_id: string;
  challenge: string;
  expires_in_seconds: number;
}

export interface EnrollmentResult {
  status: "ENROLLED" | "REJECTED";
  code?: string;
  face_count?: number;
  blur_score?: number;
  brightness_score?: number;
  model_name?: string;
  model_version?: string;
}

export type AttendanceEventType = "CHECK_IN" | "CHECK_OUT";

export type AttendanceStatus = "SUCCESS" | "WARNING_CONFIRMED" | "BLOCKED" | "FAILED";

export interface AttendanceEvent {
  id: string;
  event_type: AttendanceEventType;
  status: AttendanceStatus;
  server_time: string;
  location_id: string;
  location_name: string;
  distance_meters: number;
  gps_accuracy_meters: number;
  face_match_score: number | null;
  reason: string | null;
}

export interface AttendanceState {
  state: "NOT_CHECKED_IN" | "CHECKED_IN";
  face_enrolled: boolean;
  open_check_in_id: string | null;
  open_check_in_location_id: string | null;
  open_check_in_time: string | null;
  last_event: AttendanceEvent | null;
}

export type GeofenceStatus = "ALLOW" | "WARNING_REASON_REQUIRED" | "BLOCK" | "GPS_ACCURACY_LOW";

export interface GeofenceDecision {
  status: GeofenceStatus;
  distance_meters: number;
  accuracy_meters: number;
  location_id: string;
}

export interface AttendanceResult {
  status: string;
  event_id: string;
  distance_meters: number;
  message: string;
}

export interface DashboardMember {
  member_id: string;
  email: string;
  full_name: string | null;
  face_enrolled: boolean;
  checked_in_at: string | null;
  last_event_at: string | null;
  last_event_type: AttendanceEventType | null;
}

export interface DashboardDay {
  date: string;
  check_in: number;
  check_out: number;
  warnings: number;
}

export interface ManagerDashboard {
  active_members: number;
  active_locations: number;
  members_with_face: number;
  events_today: number;
  currently_checked_in: number;
  members: DashboardMember[];
  daily: DashboardDay[];
}

export interface ManagedMember {
  id: string | null;
  user_id: string;
  email: string;
  role: UserRole;
  status: string;
  full_name: string | null;
  phone: string | null;
  employee_code: string | null;
  position: string | null;
  department: string | null;
  membership_status: string;
}

export interface ManagerLocation {
  id: string;
  manager_user_id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  allow_radius_meters: number;
  warning_radius_meters: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  is_default?: boolean;
}

export interface LocationInput {
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  allow_radius_meters: number;
  warning_radius_meters: number;
  is_active: boolean;
}

export interface ManagerAttendanceEvent {
  id: string;
  member_id: string;
  member_email: string;
  member_name: string | null;
  event_type: AttendanceEventType;
  status: AttendanceStatus;
  server_time: string;
  location_id: string;
  location_name: string;
  latitude: number;
  longitude: number;
  gps_accuracy_meters: number;
  distance_meters: number;
  face_match_score: number | null;
  liveness_score: number | null;
  has_image: boolean;
  reason: string | null;
  created_at: string;
}

export interface AttendanceFilters {
  member_id?: string;
  location_id?: string;
  date_from?: string;
  date_to?: string;
  status?: AttendanceStatus;
  event_type?: AttendanceEventType;
  limit?: number;
  offset?: number;
}

export interface AuditLogEntry {
  id: string;
  actor_user_id: string;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export interface Paged<T> {
  total: number;
  items: T[];
}
