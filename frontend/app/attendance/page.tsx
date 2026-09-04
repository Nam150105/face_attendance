"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { CameraCapture, type CapturedImage } from "../../components/CameraCapture";
import { Alert, Badge, Button, Card, DataList, SelectField, TextAreaField } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { formatDistance, newIdempotencyKey, readPosition, type FixedPosition } from "../../lib/geo";
import { GEOFENCE_MESSAGES, describeError } from "../../lib/messages";
import type { AttendanceState, CurrentUser, GeofenceDecision, MemberLocation } from "../../lib/types";

export default function AttendancePage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [state, setState] = useState<AttendanceState | null>(null);
  const [locations, setLocations] = useState<MemberLocation[]>([]);
  const [locationId, setLocationId] = useState("");
  const [position, setPosition] = useState<FixedPosition | null>(null);
  const [decision, setDecision] = useState<GeofenceDecision | null>(null);
  const [captured, setCaptured] = useState<CapturedImage | null>(null);
  const [reason, setReason] = useState("");
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

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
      const preferred =
        currentState.open_check_in_location_id ??
        memberLocations.find((item) => item.is_default)?.id ??
        memberLocations[0]?.id ??
        "";
      setLocationId(preferred);
    } catch (cause) {
      if (cause instanceof ApiError && cause.statusCode === 401) {
        router.replace("/login");
        return;
      }
      setError(describeError(cause));
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeLocation = useMemo(
    () => locations.find((item) => item.id === locationId) ?? null,
    [locations, locationId],
  );

  const locate = useCallback(async () => {
    setLocating(true);
    setError(null);
    setDecision(null);
    try {
      const fix = await readPosition();
      setPosition(fix);
      if (locationId) {
        setDecision(
          await api.evaluateGeofence(locationId, {
            latitude: fix.latitude,
            longitude: fix.longitude,
            gps_accuracy_meters: fix.accuracyMeters,
          }),
        );
      }
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLocating(false);
    }
  }, [locationId]);

  const reasonRequired = decision?.status === "WARNING_REASON_REQUIRED";
  const blocked = decision?.status === "BLOCK" || decision?.status === "GPS_ACCURACY_LOW";
  const canSubmit =
    Boolean(captured) && Boolean(position) && !blocked && (!reasonRequired || reason.trim().length > 0) && !submitting;

  async function submit() {
    if (!captured || !position) {
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const response = checkedIn
        ? await api.checkOut({
            latitude: position.latitude,
            longitude: position.longitude,
            gpsAccuracyMeters: position.accuracyMeters,
            idempotencyKey: newIdempotencyKey("checkout"),
            image: captured.blob,
          })
        : await api.checkIn({
            locationId,
            latitude: position.latitude,
            longitude: position.longitude,
            gpsAccuracyMeters: position.accuracyMeters,
            idempotencyKey: newIdempotencyKey("checkin"),
            reason: reasonRequired ? reason.trim() : undefined,
            image: captured.blob,
          });
      setResult(`${response.message} (cách ${formatDistance(response.distance_meters)})`);
      setCaptured(null);
      setReason("");
      setDecision(null);
      setPosition(null);
      setState(await api.attendanceState());
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  const geofenceTone =
    decision?.status === "ALLOW" ? "success" : decision?.status === "WARNING_REASON_REQUIRED" ? "warning" : "danger";

  return (
    <AppShell email={user?.email}>
      <h1 className="page-title">{checkedIn ? "Check-out" : "Check-in"}</h1>
      <p className="page-lead">
        Vị trí và khuôn mặt đều được máy chủ kiểm tra lại. Dữ liệu gửi từ trình duyệt chỉ là đầu vào.
      </p>

      {state && !state.face_enrolled ? (
        <Card title="Chưa đăng ký khuôn mặt">
          <div className="stack">
            <Alert tone="warning">Bạn cần đăng ký khuôn mặt trước khi chấm công.</Alert>
            <Button onClick={() => router.push("/enroll")} block>
              Đăng ký khuôn mặt
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Card title="1. Vị trí" subtitle={checkedIn ? "Check-out dùng lại địa điểm đã check-in." : undefined}>
            <div className="stack">
              {checkedIn ? (
                <DataList rows={[{ key: "Địa điểm", value: activeLocation?.name ?? "—" }]} />
              ) : locations.length === 0 ? (
                <Alert tone="warning">Chưa có địa điểm nào được gán cho bạn.</Alert>
              ) : (
                <SelectField
                  label="Địa điểm check-in"
                  value={locationId}
                  onChange={(event) => {
                    setLocationId(event.target.value);
                    setDecision(null);
                  }}
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                      {location.is_default ? " (mặc định)" : ""}
                    </option>
                  ))}
                </SelectField>
              )}

              <Button variant="secondary" onClick={() => void locate()} loading={locating} disabled={!locationId}>
                {position ? "Cập nhật vị trí" : "Lấy vị trí hiện tại"}
              </Button>

              {position ? (
                <DataList
                  rows={[
                    { key: "Toạ độ", value: `${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}` },
                    { key: "Sai số GPS", value: `${position.accuracyMeters.toFixed(0)} m` },
                    ...(decision
                      ? [
                          { key: "Khoảng cách", value: formatDistance(decision.distance_meters) },
                          {
                            key: "Kết quả",
                            value: <Badge tone={geofenceTone}>{decision.status}</Badge>,
                          },
                        ]
                      : []),
                  ]}
                />
              ) : null}

              {decision ? (
                <Alert tone={geofenceTone}>{GEOFENCE_MESSAGES[decision.status] ?? decision.status}</Alert>
              ) : null}

              {reasonRequired ? (
                <TextAreaField
                  label="Lý do giải trình"
                  hint="Bắt buộc khi bạn ở ngoài bán kính cho phép."
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              ) : null}
            </div>
          </Card>

          <Card title="2. Khuôn mặt" subtitle="Chụp ảnh trực tiếp, không dùng ảnh có sẵn.">
            <CameraCapture
              captureLabel={checkedIn ? "Chụp ảnh check-out" : "Chụp ảnh check-in"}
              onCaptured={setCaptured}
              disabled={submitting}
            />
          </Card>

          <Card title="3. Xác nhận">
            <div className="stack">
              {!position ? <Alert tone="info">Lấy vị trí trước khi gửi.</Alert> : null}
              {position && !captured ? <Alert tone="info">Chụp ảnh khuôn mặt trước khi gửi.</Alert> : null}
              {error ? <Alert tone="danger">{error}</Alert> : null}
              {result ? <Alert tone="success">{result}</Alert> : null}

              <Button onClick={() => void submit()} loading={submitting} disabled={!canSubmit} block>
                {checkedIn ? "Xác nhận check-out" : "Xác nhận check-in"}
              </Button>
              <Button variant="ghost" onClick={() => router.push("/")}>
                Về bảng điều khiển
              </Button>
            </div>
          </Card>
        </>
      )}
    </AppShell>
  );
}
