"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { CameraCapture, type CapturePhase, type CapturedImage, type PhaseLabels } from "../../components/CameraCapture";
import { Alert, Button, Card, SelectField, TextAreaField } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { formatDistance, newIdempotencyKey, readPosition, type FixedPosition } from "../../lib/geo";
import { describeError } from "../../lib/messages";
import type { AttendanceState, CurrentUser, MemberLocation } from "../../lib/types";

const LABELS: PhaseLabels = {
  framing: "Đưa mặt vào khung",
  holding: "Giữ yên",
  working: "Đang kiểm tra vị trí và khuôn mặt",
  done: "Đã ghi nhận",
  failed: "Chưa hợp lệ",
};

/** Codes the member can fix by retaking; anything else blocks the action. */
const RETRYABLE = new Set(["FACE_NOT_MATCHED", "FACE_NOT_FOUND", "MULTIPLE_FACES", "FACE_QUALITY_LOW", "IMAGE_INVALID", "IMAGE_TOO_SMALL"]);
const BLOCKING = new Set(["OUTSIDE_ALLOWED_ZONE", "GPS_ACCURACY_LOW"]);

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
        setMessage(`${response.message} · cách ${formatDistance(response.distance_meters)}`);
        setNeedsReason(false);
        setReason("");
        pendingRef.current = null;
        setState(await api.attendanceState());
      } catch (cause) {
        const code = cause instanceof ApiError ? cause.code : "";
        if (code === "WARNING_REASON_REQUIRED") {
          setPhase("idle");
          setNeedsReason(true);
          setTone("warning");
          setMessage("Bạn đang ở ngoài bán kính cho phép. Nhập lý do rồi xác nhận để ghi nhận.");
          return;
        }
        setPhase("failed");
        setTone("danger");
        setMessage(describeError(cause));
        setBlocked(BLOCKING.has(code) || !RETRYABLE.has(code));
      }
    },
    [send],
  );

  const onCaptured = useCallback(
    (image: CapturedImage | null) => {
      if (!image) {
        pendingRef.current = null;
        setPhase("idle");
        setMessage(null);
        setNeedsReason(false);
        setBlocked(false);
        return;
      }
      // Location is read at capture time; the member never has to press a separate button.
      setPhase("working");
      setMessage(null);
      void readPosition()
        .then((position) => {
          pendingRef.current = { image: image.blob, position };
          return run(image.blob, position);
        })
        .catch((cause) => {
          setPhase("failed");
          setTone("danger");
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

  const action = checkedIn ? "Check-out" : "Check-in";

  if (state && !state.face_enrolled) {
    return (
      <AppShell email={user?.email}>
        <h1 className="page-title">{action}</h1>
        <Card>
          <div className="stack">
            <Alert tone="warning">Cần đăng ký khuôn mặt trước khi chấm công.</Alert>
            <Button onClick={() => router.push("/enroll")} block>
              Đăng ký ngay
            </Button>
          </div>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell email={user?.email}>
      <h1 className="page-title">{action}</h1>
      <p className="page-lead">
        {checkedIn ? activeLocation?.name ?? "Đang trong ca" : "Chụp ảnh, hệ thống tự kiểm tra vị trí."}
      </p>

      <Card>
        <div className="stack">
          {!checkedIn && locations.length === 0 ? (
            <Alert tone="warning">Chưa được gán địa điểm nào.</Alert>
          ) : !checkedIn && locations.length > 1 ? (
            <SelectField
              label="Địa điểm"
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
                setBlocked(false);
                setMessage(null);
              }}
              disabled={phase === "working"}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </SelectField>
          ) : null}

          <CameraCapture
            captureLabel={action}
            labels={LABELS}
            onCaptured={onCaptured}
            phase={phase}
            disabled={phase === "working" || !locationId}
          />

          {needsReason ? (
            <>
              <TextAreaField
                label="Lý do"
                hint="Bắt buộc khi ở ngoài bán kính cho phép."
                required
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button onClick={confirmWithReason} disabled={reason.trim().length === 0 || phase === "working"} block>
                Xác nhận {action.toLowerCase()}
              </Button>
            </>
          ) : null}

          {message ? <Alert tone={tone}>{message}</Alert> : null}

          {blocked ? (
            <Alert tone="info">Không thể {action.toLowerCase()} tại đây. Lần thử này đã được ghi lại.</Alert>
          ) : null}

          <Button variant="ghost" onClick={() => router.push("/")}>
            Trang chính
          </Button>
        </div>
      </Card>
    </AppShell>
  );
}
