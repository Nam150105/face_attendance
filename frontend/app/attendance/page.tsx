"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { MemberNav } from "../../components/MemberNav";
import { CameraCapture, type CapturePhase, type CapturedImage, type PhaseLabels } from "../../components/CameraCapture";
import { PermissionHelp } from "../../components/PermissionHelp";
import { Alert, Badge, Button, Card, SelectField, TextAreaField, playChime } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import {
  GeolocationUnavailableError,
  formatDistance,
  newIdempotencyKey,
  readPosition,
  type FixedPosition,
} from "../../lib/geo";
import { describeError, isRetryableTransport } from "../../lib/messages";
import type { AttendanceState, CurrentUser, MemberLocation } from "../../lib/types";

const LABELS: PhaseLabels = {
  framing: "Đưa khuôn mặt vào giữa vòng tròn",
  holding: "Giữ yên thiết bị…",
  working: "Đang kiểm tra khuôn mặt và vị trí…",
  done: "Đã ghi nhận",
  failed: "Chưa xong, xem hướng dẫn bên dưới",
};

const RETRYABLE = new Set([
  "FACE_NOT_MATCHED",
  "FACE_NOT_FOUND",
  "MULTIPLE_FACES",
  "FACE_QUALITY_LOW",
  "IMAGE_INVALID",
  "IMAGE_TOO_SMALL",
]);
const BLOCKING = new Set(["OUTSIDE_ALLOWED_ZONE", "GPS_ACCURACY_LOW"]);

const QUICK_REASONS = [
  "Đang ở địa điểm khác theo phân công",
  "Hoạt động bên ngoài (công tác, ngoại khoá)",
  "Tín hiệu định vị lệch do trong nhà",
  "Đã báo trước với người quản lý",
];

export default function AttendancePage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [state, setState] = useState<AttendanceState | null>(null);
  const [locations, setLocations] = useState<MemberLocation[]>([]);
  const [locationId, setLocationId] = useState("");

  const [phase, setPhase] = useState<CapturePhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"info" | "success" | "warning" | "danger">("info");
  const [needsReason, setNeedsReason] = useState(false);
  const [reason, setReason] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [fix, setFix] = useState<FixedPosition | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [gpsPhase, setGpsPhase] = useState<"idle" | "locating" | "ready" | "failed">("idle");
  const [successInfo, setSuccessInfo] = useState<{ distance: number; locationName: string; time: string } | null>(null);

  const pendingRef = useRef<{ image: Blob; position: FixedPosition } | null>(null);
  const checkedIn = state?.state === "CHECKED_IN";

  const load = useCallback(async () => {
    try {
      const [me, currentState, memberLocations] = await Promise.all([
        api.me(),
        api.attendanceState(),
        api.memberLocations(),
      ]);
      setUser(me);
      setState(currentState);
      setLocations(memberLocations);
      setLocationId(
        currentState.open_check_in_location_id ??
          memberLocations.find((item) => item.is_default)?.id ??
          memberLocations[0]?.id ??
          "",
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.statusCode === 401) {
        router.replace("/login");
        return;
      }
      setTone("danger");
      setMessage(describeError(cause));
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeLocation = useMemo(
    () => locations.find((item) => item.id === locationId) ?? null,
    [locations, locationId],
  );

  const send = useCallback(
    async (image: Blob, position: FixedPosition, withReason?: string) => {
      const shared = {
        latitude: position.latitude,
        longitude: position.longitude,
        gpsAccuracyMeters: position.accuracyMeters,
        image,
      };
      return checkedIn
        ? api.checkOut({ ...shared, idempotencyKey: newIdempotencyKey("checkout") })
        : api.checkIn({ ...shared, locationId, idempotencyKey: newIdempotencyKey("checkin"), reason: withReason });
    },
    [checkedIn, locationId],
  );

  const run = useCallback(
    async (image: Blob, position: FixedPosition, withReason?: string) => {
      setPhase("working");
      setMessage(null);
      try {
        const response = await send(image, position, withReason);
        setPhase("done");
        setTone("success");
        playChime("success");
        setMessage(`Đã ghi nhận. Vị trí cách địa điểm ${formatDistance(response.distance_meters)}.`);
        setSuccessInfo({
          distance: response.distance_meters,
          locationName: activeLocation?.name ?? "địa điểm",
          time: new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()),
        });
        setNeedsReason(false);
        setReason("");
        setRetryable(false);
        setDistance(response.distance_meters);
        pendingRef.current = null;
        setState(await api.attendanceState());
      } catch (cause) {
        const code = cause instanceof ApiError ? cause.code : "";
        if (code === "WARNING_REASON_REQUIRED") {
          setPhase("idle");
          setNeedsReason(true);
          setTone("warning");
          setMessage("Bạn đang ở ngoài phạm vi chuẩn của địa điểm. Vui lòng chọn hoặc nhập lý do để tiếp tục.");
          return;
        }
        setPhase("failed");
        setTone("danger");
        setMessage(describeError(cause));
        // The photo and the fix are still in hand, so a transport failure only
        // needs re-sending — not a whole new capture.
        const transport = isRetryableTransport(code);
        setRetryable(transport && pendingRef.current !== null);
        setBlocked(!transport && (BLOCKING.has(code) || !RETRYABLE.has(code)));
      }
    },
    [activeLocation?.name, send],
  );

  const onCaptured = useCallback(
    (image: CapturedImage | null) => {
      if (!image) {
        pendingRef.current = null;
        setPhase("idle");
        setMessage(null);
        setNeedsReason(false);
        setBlocked(false);
        setRetryable(false);
        setLocationDenied(false);
        setSuccessInfo(null);
        setGpsPhase("idle");
        setFix(null);
        setDistance(null);
        return;
      }
      setPhase("working");
      setMessage(null);
      setLocationDenied(false);
      setGpsPhase("locating");
      void readPosition()
        .then((position) => {
          pendingRef.current = { image: image.blob, position };
          setFix(position);
          setGpsPhase("ready");
          return run(image.blob, position);
        })
        .catch((cause) => {
          setPhase("failed");
          setTone("danger");
          const denied = cause instanceof GeolocationUnavailableError && cause.reason === "DENIED";
          setLocationDenied(denied);
          setGpsPhase("failed");
          setBlocked(true);
          setMessage(describeError(cause));
        });
    },
    [run],
  );

  const confirmWithReason = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending || reason.trim().length === 0) {
      return;
    }
    void run(pending.image, pending.position, reason.trim());
  }, [reason, run]);

  const resend = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) {
      return;
    }
    setRetryable(false);
    void run(pending.image, pending.position, reason.trim() || undefined);
  }, [reason, run]);

  const actionName = checkedIn ? "Check-out" : "Check-in";

  return (
    <AppShell email={user?.email}>
      <MemberNav />

      <div className="page-header">
        <div>
          <h1 className="page-title">{actionName}</h1>
          <p className="page-lead">
            {checkedIn
              ? "Xác thực khuôn mặt để kết thúc phiên đang mở."
              : "Nhìn thẳng vào camera và cho phép trình duyệt lấy vị trí hiện tại."}
          </p>
        </div>
        <Badge tone={checkedIn ? "success" : "info"}>
          {checkedIn ? "Đang trong phiên" : "Chưa mở phiên"}
        </Badge>
      </div>

      {!checkedIn && locations.length > 1 ? (
        <Card title="Địa điểm">
          <SelectField
            label="Chọn địa điểm ghi nhận hôm nay"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            {locations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} {item.is_default ? "(Mặc định)" : ""} · phạm vi {item.allow_radius_meters}m
              </option>
            ))}
          </SelectField>
        </Card>
      ) : null}

      <div className="readiness">
        <div className="readiness__item">
          <span
            className={`readiness__dot ${
              gpsPhase === "ready" ? "readiness__dot--ok" : gpsPhase === "locating" ? "readiness__dot--busy" : gpsPhase === "failed" ? "readiness__dot--bad" : ""
            }`}
          />
          <div className="readiness__text">
            <p className="readiness__label">Vị trí</p>
            <p className="readiness__value">
              {gpsPhase === "ready" && fix
                ? "Đã xác định"
                : gpsPhase === "locating"
                  ? "Đang tìm…"
                  : gpsPhase === "failed"
                    ? "Chưa lấy được"
                    : "Chưa đo"}
            </p>
          </div>
        </div>

        <div className="readiness__item">
          <span className={`readiness__dot ${distance === null ? "" : "readiness__dot--ok"}`} />
          <div className="readiness__text">
            <p className="readiness__label">Cách nơi làm việc</p>
            <p className="readiness__value">
              {distance !== null
                ? formatDistance(distance)
                : activeLocation
                  ? `Cần trong ${activeLocation.allow_radius_meters} m`
                  : "—"}
            </p>
          </div>
        </div>

        <div className="readiness__item">
          <span
            className={`readiness__dot ${
              phase === "done" ? "readiness__dot--ok" : phase === "working" ? "readiness__dot--busy" : phase === "failed" ? "readiness__dot--bad" : ""
            }`}
          />
          <div className="readiness__text">
            <p className="readiness__label">Khuôn mặt</p>
            <p className="readiness__value">
              {phase === "done"
                ? "Đã nhận ra bạn"
                : phase === "working"
                  ? "Đang đối chiếu…"
                  : phase === "failed"
                    ? "Chưa nhận ra"
                    : "Chờ chụp ảnh"}
            </p>
          </div>
        </div>
      </div>

      <Card
        title="Xác thực khuôn mặt"
        subtitle={
          activeLocation
            ? `${activeLocation.name} · chấm công được khi ở trong ${activeLocation.allow_radius_meters}m`
            : "Giữ điện thoại ngang tầm mắt."
        }
      >
        <div className="stack">
          {successInfo ? (
            <div
              style={{
                textAlign: "center",
                padding: "var(--space-4) var(--space-2)",
                background: "linear-gradient(145deg, rgba(16, 185, 129, 0.15), var(--surface-panel))",
                borderRadius: "var(--radius-lg)",
                border: "1px solid rgba(16, 185, 129, 0.35)",
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "var(--color-success)",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  margin: "0 auto 16px",
                  boxShadow: "0 0 20px var(--color-success-glow)",
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h2 style={{ fontSize: "var(--text-xl)", fontWeight: 800, marginBottom: "4px" }}>
                {checkedIn ? "Đã check-in" : "Đã check-out"}
              </h2>
              <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginBottom: "16px" }}>
                Thời điểm ghi nhận: <strong style={{ color: "var(--text-primary)" }}>{successInfo.time}</strong>
                <br />
                Cách {successInfo.locationName}: <strong style={{ color: "var(--color-cyan)" }}>{formatDistance(successInfo.distance)}</strong>
              </p>
              <Button onClick={() => router.push("/")} block>
                Về trang chính
              </Button>
            </div>
          ) : (
            <CameraCapture
              captureLabel={checkedIn ? "Chụp ảnh check-out" : "Chụp ảnh check-in"}
              labels={LABELS}
              onCaptured={onCaptured}
              phase={phase}
              disabled={phase === "working" || (needsReason && !reason.trim())}
            />
          )}

          {message && !successInfo ? <Alert tone={tone}>{message}</Alert> : null}

          {locationDenied ? <PermissionHelp kind="location" /> : null}

          {retryable ? (
            <Button variant="secondary" onClick={resend} loading={phase === "working"} block>
              Gửi lại — ảnh vừa chụp vẫn được giữ
            </Button>
          ) : null}

          {/* Quick Reason Form for Warning Geofence Area */}
          {needsReason ? (
            <div
              style={{
                background: "var(--surface-card)",
                padding: "var(--space-3)",
                borderRadius: "var(--radius-lg)",
                border: "1px solid rgba(245, 158, 11, 0.35)",
              }}
            >
              <h3 style={{ fontSize: "var(--text-md)", fontWeight: 700, color: "var(--color-warning)", marginBottom: "8px" }}>
                Bạn đang đứng hơi xa
              </h3>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: "12px" }}>
                Chọn một lý do có sẵn hoặc tự ghi để người quản lý nắm được.
              </p>

              <div className="filter-pills" style={{ marginBottom: "12px" }}>
                {QUICK_REASONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className={`pill-chip ${reason === q ? "pill-chip--active" : ""}`}
                    onClick={() => setReason(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>

              <TextAreaField
                label="Lý do chi tiết"
                required
                placeholder="Mô tả ngắn gọn lý do hoặc vị trí thực tế của bạn…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />

              <Button
                style={{ marginTop: "12px" }}
                onClick={confirmWithReason}
                disabled={reason.trim().length === 0 || phase === "working"}
                loading={phase === "working"}
                block
              >
                Xác nhận và ghi nhận
              </Button>
            </div>
          ) : null}

          {blocked ? (
            <div className="row">
              <Button variant="secondary" onClick={() => router.push("/")} block>
                Về trang chính
              </Button>
            </div>
          ) : null}
        </div>
      </Card>
    </AppShell>
  );
}
