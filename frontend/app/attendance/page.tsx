"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { CameraCapture, type CapturePhase, type CapturedImage, type PhaseLabels } from "../../components/CameraCapture";
import { PermissionHelp } from "../../components/PermissionHelp";
import { ResultCard } from "../../components/ResultCard";
import { Alert, Badge, Button, Card, SelectField, TextAreaField, playChime } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import {
  GeolocationUnavailableError,
  formatDistance,
  newIdempotencyKey,
  readPosition,
  type FixedPosition,
} from "../../lib/geo";
import { permissionState, rememberGranted } from "../../lib/device";
import { describeError, isRetryableTransport } from "../../lib/messages";
import type { AttendanceState, CurrentUser, MemberLocation } from "../../lib/types";

const LABELS: PhaseLabels = { working: "Đang đối chiếu khuôn mặt và vị trí…" };

/** The headline of a refusal, from the code the server returned. */
function refusalTitle(code: string): string {
  if (code === "FACE_NOT_MATCHED") return "Khuôn mặt không khớp với ảnh đã đăng ký";
  if (code === "FACE_NOT_FOUND") return "Không thấy khuôn mặt trong ảnh";
  if (code === "MULTIPLE_FACES") return "Có nhiều hơn một người trong ảnh";
  if (code === "FACE_TOO_BLURRY" || code === "FACE_NOT_CLEAR" || code === "FACE_QUALITY_LOW") return "Ảnh chưa đủ nét";
  if (code === "LIGHTING_TOO_DARK") return "Ảnh quá tối";
  if (code === "LIGHTING_TOO_BRIGHT") return "Ảnh quá chói";
  if (code === "OUTSIDE_ALLOWED_ZONE") return "Bạn đang ở ngoài phạm vi chấm công";
  if (code === "GPS_ACCURACY_LOW") return "Định vị chưa đủ chính xác";
  if (code === "CHECK_IN_TOO_LATE") return "Đã quá giờ được phép chấm vào";
  if (code === "FACE_NOT_ENROLLED") return "Bạn chưa đăng ký khuôn mặt";
  return "Chưa ghi nhận được";
}

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
  "Đang ở một địa điểm khác của tổ chức",
  "Hoạt động bên ngoài (công tác, ngoại khoá)",
  "Tín hiệu định vị lệch do trong nhà",
  "Đã báo trước với người quản lý",
];

/**
 * Why check-in is unavailable, in a sentence the person can act on.
 *
 * The server decides this (`can_check_in`), not the screen: the same rule then
 * holds for anybody who reaches the page by typing the address.
 */
const BLOCKED_TEXT: Record<string, { title: string; body: string; action?: { label: string; href: string } }> = {
  NO_MANAGER: {
    title: "Bạn chưa được duyệt vào nhóm nào",
    body: "Người quản lý duyệt xong bạn mới chấm công được. Nếu đã có mã nhóm, vào Hồ sơ nhập mã rồi chờ duyệt.",
    action: { label: "Mở hồ sơ", href: "/profile" },
  },
  NO_LOCATION: {
    title: "Bạn chưa được gán nơi chấm công",
    body: "Nhóm của bạn chưa có địa điểm nào, hoặc bạn chưa được gán vào địa điểm nào. Hãy báo người quản lý.",
  },
  NO_FACE: {
    title: "Bạn chưa đăng ký khuôn mặt",
    body: "Chụp một ảnh để hệ thống nhận ra bạn, chỉ mất chưa tới một phút.",
    action: { label: "Đăng ký khuôn mặt", href: "/enroll" },
  },
};

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
  // Leaving from a site other than the one the day was opened at. A separate
  // field from the geofence reason: they answer different questions.
  const [placeReason, setPlaceReason] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const [failCode, setFailCode] = useState<string | null>(null);
  // A fix taken while the camera is still open, so the photo does not wait
  // on the GPS afterwards. Only when the browser already allows it: asking
  // for the location before the person has done anything is the kind of
  // prompt people refuse.
  const warmFix = useRef<Promise<FixedPosition> | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [fix, setFix] = useState<FixedPosition | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [gpsPhase, setGpsPhase] = useState<"idle" | "locating" | "ready" | "failed">("idle");
  const [successInfo, setSuccessInfo] = useState<{
    /** Which half was just recorded — the state flips the moment it is. */
    action: "in" | "out";
    distance: number;
    locationName: string;
    time: string;
    // The face comparison behind this record, kept so the person can see the
    // number rather than being told to trust it.
    faceDistance?: number | null;
    faceThreshold?: number | null;
    faceEngine?: string | null;
  } | null>(null);

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

  useEffect(() => {
    void permissionState("location").then((state) => {
      if (state === "granted") {
        warmFix.current = readPosition().then((position) => {
          rememberGranted("location");
          return position;
        });
        warmFix.current.catch(() => {
          warmFix.current = null;
        });
      }
    });
  }, []);

  const activeLocation = useMemo(
    () => locations.find((item) => item.id === locationId) ?? null,
    [locations, locationId],
  );
  const openedAt = useMemo(
    () => locations.find((item) => item.id === state?.open_check_in_location_id) ?? null,
    [locations, state?.open_check_in_location_id],
  );
  // Checking out somewhere other than where the day started.
  const movedPlace = Boolean(checkedIn && openedAt && locationId !== openedAt.id);

  const send = useCallback(
    async (image: Blob, position: FixedPosition, withReason?: string) => {
      const shared = {
        latitude: position.latitude,
        longitude: position.longitude,
        gpsAccuracyMeters: position.accuracyMeters,
        image,
      };
      return checkedIn
        ? api.checkOut({
            ...shared,
            idempotencyKey: newIdempotencyKey("checkout"),
            locationId,
            reason: movedPlace ? placeReason.trim() : undefined,
          })
        : api.checkIn({ ...shared, locationId, idempotencyKey: newIdempotencyKey("checkin"), reason: withReason });
    },
    [checkedIn, locationId, movedPlace, placeReason],
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
          action: checkedIn ? "out" : "in",
          distance: response.distance_meters,
          locationName: activeLocation?.name ?? "địa điểm",
          time: new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()),
          faceDistance: response.face_distance,
          faceThreshold: response.face_threshold,
          faceEngine: response.face_engine,
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
          setMessage("Bạn đang đứng hơi xa nơi làm việc. Cho biết lý do rồi gửi lại giúp nhé.");
          return;
        }
        setPhase("failed");
        setTone("danger");
        setFailCode(code || null);
        setMessage(describeError(cause));
        // The photo and the fix are still in hand, so a transport failure only
        // needs re-sending — not a whole new capture.
        const transport = isRetryableTransport(code);
        setRetryable(transport && pendingRef.current !== null);
        setBlocked(!transport && (BLOCKING.has(code) || !RETRYABLE.has(code)));
      }
    },
    [activeLocation?.name, checkedIn, send],
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
        setFailCode(null);
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
      const fresh = warmFix.current?.then((position) =>
        Date.now() - position.timestamp < 60000 ? position : readPosition(),
      );
      void (fresh ?? readPosition())
        .then((position) => {
          pendingRef.current = { image: image.blob, position };
          rememberGranted("location");
          setFix(position);
          setGpsPhase("ready");
          return run(image.blob, position);
        })
        .catch((cause) => {
          setPhase("failed");
          setTone("danger");
          setFailCode("LOCATION");
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

  // While the verdict is on screen the words follow what was just done, not
  // the state it produced ("Đã chấm vào" under a "Chấm ra" heading was wrong).
  const doingOut = successInfo ? successInfo.action === "out" : checkedIn;
  const actionName = doingOut ? "Chấm ra" : "Chấm vào";
  // An open session is always closable: somebody who checked in must be able to
  // check out even if their manager removed the place in the meantime.
  const gate =
    state && !state.can_check_in && !checkedIn
      ? BLOCKED_TEXT[state.blocked_reason ?? ""] ?? null
      : state?.state === "DONE_FOR_TODAY"
        ? {
            title: "Hôm nay đã chấm đủ vào ra",
            body: "Mỗi ngày công một phiên. Nút chấm vào mở lại khi sang ngày công mới (ca ngày: sau 00:00; ca đêm: đầu giờ chiều). Giờ ghi nhận chưa đúng thì gửi yêu cầu chỉnh công.",
            action: { href: "/corrections", label: "Yêu cầu chỉnh công" },
          }
        : null;

  return (
    <AppShell email={user?.email}>

      <div className="page-header">
        <div>
          <h1 className="page-title">{actionName}</h1>
          <p className="page-lead">
            {successInfo
              ? "Đã ghi nhận. Bạn có thể đóng trang này."
              : checkedIn
                ? "Chụp một ảnh để kết thúc phiên đang mở."
                : "Đưa mặt vào khung, đủ bốn mục là chụp được."}
          </p>
        </div>
        <Badge tone={checkedIn ? "success" : "info"}>
          {checkedIn ? "Đang trong phiên" : state?.state === "DONE_FOR_TODAY" ? "Hôm nay đã xong" : "Chưa mở phiên"}
        </Badge>
      </div>

      {gate ? (
        // Reached by typing the address, or the situation changed while the page
        // was open. Either way the camera stays shut: sending a photo that the
        // server will refuse teaches nobody anything.
        <Card title={gate.title}>
          <div className="stack">
            <p className="page-lead">{gate.body}</p>
            <div className="row">
              {gate.action ? (
                <Button onClick={() => router.push(gate.action!.href)}>{gate.action.label}</Button>
              ) : null}
              <Button variant="secondary" onClick={() => router.push("/")}>
                Về trang chính
              </Button>
            </div>
          </div>
        </Card>
      ) : (
      <Card title={actionName} subtitle={activeLocation ? activeLocation.name : "Giữ điện thoại ngang tầm mắt."}>
        <div className="stack">
          {!successInfo && locations.length > 1 ? (
            <div className="stack stack--tight">
              <SelectField
                label={checkedIn ? "Nơi chấm ra" : "Nơi chấm công hôm nay"}
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
              >
                {locations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {checkedIn && item.id === state?.open_check_in_location_id ? " (nơi bạn chấm vào)" : ""}
                    {!checkedIn && item.is_default ? " (mặc định)" : ""}
                  </option>
                ))}
              </SelectField>

              {movedPlace ? (
                <TextAreaField
                  label={`Vì sao chấm ra ở ${activeLocation?.name ?? "nơi khác"}?`}
                  required
                  placeholder={`Bạn chấm vào ở ${openedAt?.name ?? "nơi khác"}. Nêu lý do để người quản lý nắm được.`}
                  value={placeReason}
                  onChange={(event) => setPlaceReason(event.target.value)}
                />
              ) : null}
            </div>
          ) : null}
          {successInfo ? (
            <ResultCard
              tone="success"
              title={`${successInfo.action === "out" ? "Đã chấm ra" : "Đã chấm vào"} lúc ${successInfo.time}`}
              body={`${successInfo.locationName} · cách ${formatDistance(successInfo.distance)}`}
              details={[
                ...(successInfo.faceDistance !== null && successInfo.faceDistance !== undefined
                  ? [
                      {
                        key: "Khớp khuôn mặt",
                        value: `khoảng cách ${successInfo.faceDistance.toFixed(3)}${successInfo.faceThreshold ? ` / ngưỡng ${successInfo.faceThreshold}` : ""}`,
                      },
                    ]
                  : []),
                { key: "Bộ nhận diện", value: successInfo.faceEngine ?? "face_recognition" },
                ...(fix ? [{ key: "Sai số định vị", value: `±${fix.accuracyMeters.toFixed(0)} m` }] : []),
              ]}
            >
              <Button onClick={() => router.push("/")} block>
                Về trang chính
              </Button>
            </ResultCard>
          ) : (
            <CameraCapture
              captureLabel={checkedIn ? "Chấm ra" : "Chấm vào"}
              labels={LABELS}
              onCaptured={onCaptured}
              phase={phase}
              disabled={
                phase === "working" ||
                (needsReason && !reason.trim()) ||
                (movedPlace && placeReason.trim().length < 5)
              }
            />
          )}

          {message && !successInfo && phase === "failed" ? (
            <ResultCard tone="danger" title={refusalTitle(failCode ?? "")} body={message} />
          ) : message && !successInfo ? (
            <Alert tone={tone}>{message}</Alert>
          ) : null}

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
      )}
    </AppShell>
  );
}
