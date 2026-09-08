"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
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
  ALLOW: { label: "Chấm công được", tone: "success", hint: "Bạn đang ở đủ gần nơi làm việc." },
  WARNING_REASON_REQUIRED: {
    label: "Được, nhưng cần nêu lý do",
    tone: "warning",
    hint: "Bạn hơi xa nơi làm việc, hệ thống sẽ hỏi lý do khi bạn chấm công.",
  },
  BLOCK: { label: "Chưa chấm công được", tone: "danger", hint: "Bạn đang ở quá xa. Hãy tới gần hơn." },
  GPS_ACCURACY_LOW: {
    label: "Chưa xác định được vị trí",
    tone: "warning",
    hint: "Bật Wi-Fi hoặc ra chỗ thoáng để máy xác định vị trí chính xác hơn.",
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

      <div className="page-header">
        <div>
          <h1 className="page-title">Nơi làm việc của bạn</h1>
          <p className="page-lead">Xem bạn đang cách nơi làm việc bao xa và có chấm công được không.</p>
        </div>
        <Button onClick={() => void measure()} loading={checking} disabled={!locations || locations.length === 0}>
          Kiểm tra xem tôi có chấm công được không
        </Button>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {positionError ? <Alert tone="warning">{positionError}</Alert> : null}
      {locationDenied ? <PermissionHelp kind="location" /> : null}

      {position ? (
        <Alert tone="info">
          Đã xác định được vị trí của bạn. Khoảng cách bên dưới được hệ thống tính lại để đảm bảo chính xác.
        </Alert>
      ) : null}

      {locations === null && !error ? (
        <Card>
          <LoadingRows count={3} />
        </Card>
      ) : locations && locations.length === 0 ? (
        <Card>
          <Empty>Bạn chưa được phân nơi làm việc nào. Hãy nhắn cho người quản lý nhé.</Empty>
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
                  { key: "Chấm công được khi ở trong", value: `${location.allow_radius_meters} m` },
                  {
                    key: "Bạn đang cách đây",
                    value: result ? formatDistance(result.decision.distance_meters) : "Bấm nút phía trên để kiểm tra",
                  },
                  {
                    key: "Kết quả",
                    value: meta ? (
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    ) : (
                      <Badge tone="neutral">Chưa kiểm tra</Badge>
                    ),
                  },
                  {
                    key: "Nơi này",
                    value: location.is_active ? (
                      <Badge tone="success">Đang nhận chấm công</Badge>
                    ) : (
                      <Badge tone="danger">Tạm ngừng</Badge>
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
