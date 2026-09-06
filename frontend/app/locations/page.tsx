"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { MemberNav } from "../../components/MemberNav";
import { Alert, Badge, Button, Card, DataList, Empty, LoadingRows } from "../../components/ui";
import { api } from "../../lib/api";
import { GeolocationUnavailableError, formatDistance, readPosition, type FixedPosition } from "../../lib/geo";
import { describeError } from "../../lib/messages";
import { PermissionHelp } from "../../components/PermissionHelp";
import type { CurrentUser, GeofenceDecision, MemberLocation } from "../../lib/types";

interface Evaluated {
  decision: GeofenceDecision;
  checkedAt: string;
}

const DECISION_TEXT: Record<string, { label: string; tone: "success" | "warning" | "danger"; hint: string }> = {
  ALLOW: { label: "Có thể check-in", tone: "success", hint: "Bạn đang trong phạm vi cho phép." },
  WARNING_REASON_REQUIRED: {
    label: "Cần nhập lý do",
    tone: "warning",
    hint: "Ngoài phạm vi chuẩn nhưng vẫn trong vùng cảnh báo.",
  },
  BLOCK: { label: "Không thể check-in", tone: "danger", hint: "Bạn ở quá xa địa điểm này." },
  GPS_ACCURACY_LOW: {
    label: "Tín hiệu định vị yếu",
    tone: "warning",
    hint: "Cần định vị chính xác hơn mới ghi nhận được.",
  },
};

export default function MemberLocationsPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [locations, setLocations] = useState<MemberLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<FixedPosition | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<Record<string, Evaluated>>({});

  useEffect(() => {
    api.me().then(setUser).catch(() => undefined);
    api
      .memberLocations()
      .then(setLocations)
      .catch((cause) => setError(describeError(cause)));
  }, []);

  const measure = useCallback(async () => {
    setChecking(true);
    setPositionError(null);
    setLocationDenied(false);
    try {
      const fix = await readPosition();
      setPosition(fix);
      // The server recomputes the distance; the browser value is never trusted.
      const evaluated: Record<string, Evaluated> = {};
      for (const location of locations ?? []) {
        try {
          const decision = await api.evaluateGeofence(location.id, {
            latitude: fix.latitude,
            longitude: fix.longitude,
            gps_accuracy_meters: fix.accuracyMeters,
          });
          evaluated[location.id] = { decision, checkedAt: new Date().toISOString() };
        } catch {
          // One unreachable location must not hide the others.
        }
      }
      setResults(evaluated);
    } catch (cause) {
      setLocationDenied(cause instanceof GeolocationUnavailableError && cause.reason === "DENIED");
      setPositionError(describeError(cause));
    } finally {
      setChecking(false);
    }
  }, [locations]);

  return (
    <AppShell email={user?.email} wide>
      <MemberNav />

      <div className="page-header">
        <div>
          <h1 className="page-title">Địa điểm của bạn</h1>
          <p className="page-lead">Địa điểm được phân công, phạm vi cho phép và khoảng cách hiện tại.</p>
        </div>
        <Button onClick={() => void measure()} loading={checking} disabled={!locations || locations.length === 0}>
          Đo khoảng cách hiện tại
        </Button>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {positionError ? <Alert tone="warning">{positionError}</Alert> : null}
      {locationDenied ? <PermissionHelp kind="location" /> : null}

      {position ? (
        <Alert tone="info">
          Đã lấy vị trí với độ chính xác ±{position.accuracyMeters.toFixed(0)} m. Khoảng cách bên dưới do máy chủ tính
          lại, không lấy từ trình duyệt.
        </Alert>
      ) : null}

      {locations === null && !error ? (
        <Card>
          <LoadingRows count={3} />
        </Card>
      ) : locations && locations.length === 0 ? (
        <Card>
          <Empty>Bạn chưa được phân công địa điểm nào. Hãy liên hệ người quản lý.</Empty>
        </Card>
      ) : (
        (locations ?? []).map((location) => {
          const result = results[location.id];
          const meta = result ? DECISION_TEXT[result.decision.status] : null;
          return (
            <Card
              key={location.id}
              title={location.name}
              subtitle={location.address ?? undefined}
              action={location.is_default ? <Badge tone="info">Mặc định</Badge> : null}
            >
              <DataList
                rows={[
                  { key: "Phạm vi cho phép", value: `${location.allow_radius_meters} m` },
                  { key: "Phạm vi cảnh báo", value: `${location.warning_radius_meters} m` },
                  {
                    key: "Khoảng cách hiện tại",
                    value: result ? formatDistance(result.decision.distance_meters) : "Chưa đo",
                  },
                  {
                    key: "Trạng thái",
                    value: meta ? (
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    ) : (
                      <Badge tone="neutral">Nhấn “Đo khoảng cách hiện tại”</Badge>
                    ),
                  },
                  {
                    key: "Địa điểm đang bật",
                    value: location.is_active ? (
                      <Badge tone="success">Đang hoạt động</Badge>
                    ) : (
                      <Badge tone="danger">Đã tắt</Badge>
                    ),
                  },
                ]}
              />
              {meta ? <p className="field__hint" style={{ marginTop: 8 }}>{meta.hint}</p> : null}
            </Card>
          );
        })
      )}
    </AppShell>
  );
}
