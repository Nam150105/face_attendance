export type UserRole = "MANAGER" | "MEMBER" | "SUPER_ADMIN";

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

export interface RecognitionEngine {
  engine: string;
  available: boolean;
  detector?: string;
  encoder?: string;
  dimension?: number;
  tolerance?: number;
  jitters?: number;
  preprocessing?: string[];
  versions?: Record<string, string>;
  error?: string;
}

export interface FaceEnrollmentStatus {
  enrolled: boolean;
  embedding_id: string | null;
  model_name: string | null;
  model_version: string | null;
  enrolled_at: string | null;
  has_photo: boolean;
  needs_reenrollment: boolean;
  engine: RecognitionEngine;
}

export interface EnrollmentChallenge {
  challenge_id: string;
  challenge: string;
  expires_in_seconds: number;
}

export interface EnrollmentResult {
  // PENDING_APPROVAL: the face is already on file, so the replacement waits
  // for a manager rather than applying itself.
  status: "ENROLLED" | "REJECTED" | "PENDING_APPROVAL";
  code?: string;
  face_count?: number;
  blur_score?: number;
  brightness_score?: number;
  model_name?: string;
  model_version?: string;
  detector?: string;
  encoder?: string;
  dimension?: number;
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
  failure_code: string | null;
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
  /** What the recognition engine measured for this photo, when it ran. */
  face_distance?: number | null;
  face_threshold?: number | null;
  face_metric?: string | null;
  face_engine?: string | null;
  face_detector?: string | null;
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
  expected_check_in: string | null;
  expected_check_out: string | null;
  grace_minutes: number;
  enforce_hours: boolean;
}

export interface LocationInput {
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  allow_radius_meters: number;
  warning_radius_meters: number;
  is_active: boolean;
  expected_check_in: string | null;
  expected_check_out: string | null;
  grace_minutes: number;
  enforce_hours: boolean;
}

export type CalendarDayStatus = "ON_TIME" | "LATE" | "OPEN" | "REJECTED";

export interface CalendarPerson {
  member_id: string;
  member_email: string;
  member_name: string | null;
  check_in: string | null;
  check_out: string | null;
  minutes_late: number;
  minutes_early_leave: number;
  rejected: number;
  off_radius: number;
  location_name: string | null;
  status: CalendarDayStatus;
}

export interface CalendarDay {
  date: string;
  people: CalendarPerson[];
}

export interface AttendanceCalendar {
  month: string;
  summary: {
    events: number;
    attended: number;
    late: number;
    open_sessions: number;
    off_radius: number;
    rejected: number;
  };
  days: CalendarDay[];
}

export interface LoginAttempt {
  outcome: "SUCCESS" | "BAD_PASSWORD" | "NO_ACCOUNT" | "SUSPENDED" | "RATE_LIMITED";
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface LoginHistory {
  totals: Record<string, number>;
  items: LoginAttempt[];
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
  failure_code: string | null;
  minutes_late: number | null;
  minutes_early_leave: number | null;
  deleted_at?: string | null;
  face_distance: number | null;
  face_engine: string | null;
  has_enrollment_photo: boolean;
  /** A person's verdict beside the machine's; null means nobody overrode it. */
  face_verdict_override: boolean | null;
  location_verdict_override: boolean | null;
  original_server_time: string | null;
  edited_at: string | null;
  edit_reason: string | null;
  edited_by_email: string | null;
}

export interface AttendanceFilters {
  include_invalid?: boolean;
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

export type BulkAddStatus =
  | "ADDED"
  | "REACTIVATED"
  | "ALREADY_MANAGED"
  | "HAS_OTHER_MANAGER"
  | "NOT_REGISTERED"
  | "INVALID_EMAIL";

export interface BulkAddResult {
  requested: number;
  succeeded: number;
  already_managed: number;
  has_other_manager: number;
  failed: number;
  results: Array<{ email: string; status: BulkAddStatus }>;
}

// --- Member portal ---------------------------------------------------------

export type DayStatus = "VALID" | "LATE" | "MISSING_CHECK_OUT" | "INVALID" | "ABSENT";

export interface AttendanceDay {
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  worked_minutes: number | null;
  status: DayStatus;
  rejected_count: number;
  warning_count: number;
  event_count: number;
  location_name: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
}

export interface AttendanceDaysResponse {
  date_from: string;
  date_to: string;
  days: AttendanceDay[];
  summary: {
    days_present: number;
    days_late: number;
    days_missing_check_out: number;
    days_invalid: number;
    total_worked_minutes: number;
  };
}

export interface AttendanceDayEvent {
  id: string;
  event_type: "CHECK_IN" | "CHECK_OUT";
  status: AttendanceStatus;
  server_time: string;
  distance_meters: number;
  gps_accuracy_meters: number;
  failure_code: string | null;
  reason: string | null;
  location_name: string;
  has_image: boolean;
}

export interface Shift {
  id: string;
  weekday: number | null;
  work_date: string | null;
  start_time: string;
  end_time: string;
  timezone: string;
  grace_minutes: number;
  location_name: string | null;
  location_address: string | null;
  location_id: string | null;
}

export interface ScheduleResponse {
  date_from: string;
  date_to: string;
  shifts: Shift[];
  today: {
    date: string;
    has_shift: boolean;
    start_time: string | null;
    end_time: string | null;
    grace_minutes: number | null;
    checked_in_at: string | null;
  };
}

export interface AppNotification {
  id: string;
  category: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationsResponse {
  total: number;
  unread: number;
  items: AppNotification[];
}

export type CorrectionType = "MISSING_CHECK_IN" | "MISSING_CHECK_OUT" | "WRONG_TIME" | "OTHER";
export type CorrectionStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface CorrectionRequest {
  id: string;
  work_date: string;
  request_type: CorrectionType;
  requested_check_in: string | null;
  requested_check_out: string | null;
  reason: string;
  status: CorrectionStatus;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  member_name?: string | null;
  member_email?: string | null;
}

export interface CorrectionsResponse {
  total: number;
  items: CorrectionRequest[];
}


// --- System administration --------------------------------------------------

export interface AdminOverview {
  members: number;
  managers: number;
  super_admins: number;
  inactive_users: number;
  locations: number;
  attendance_events: number;
  deleted_events: number;
  enrolled_faces: number;
  active_sessions: number;
}

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  status: string;
  created_at: string;
  last_login_at: string | null;
  full_name: string | null;
  employee_code: string | null;
  attendance_count: number;
  managed_members: number;
}

export interface AdminUsersResponse {
  total: number;
  items: AdminUser[];
}

export interface AdminAttendanceRow {
  id: string;
  member_email: string;
  member_name: string | null;
  event_type: AttendanceEventType;
  status: AttendanceStatus;
  server_time: string;
  location_name: string;
  distance_meters: number;
  failure_code: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
  deleted_by_email: string | null;
}

export interface AdminAttendanceResponse {
  total: number;
  items: AdminAttendanceRow[];
}
