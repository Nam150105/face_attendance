"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ManagerShell } from "../../components/ManagerShell";
import { Alert, Card, LoadingRows } from "../../components/ui";
import { api } from "../../lib/api";
import { describeError } from "../../lib/messages";
import type { ManagerDashboard } from "../../lib/types";

const TILES: Array<{ key: keyof ManagerDashboard; label: string }> = [
  { key: "active_members", label: "Thành viên" },
  { key: "currently_checked_in", label: "Đang trong ca" },
  { key: "events_today", label: "Sự kiện hôm nay" },
  { key: "members_with_face", label: "Đã có khuôn mặt" },
  { key: "active_locations", label: "Địa điểm" },
];

export default function ManagerHomePage() {
  const [data, setData] = useState<ManagerDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.managerDashboard().then(setData).catch((cause) => setError(describeError(cause)));
  }, []);

  return (
    <ManagerShell>
      <h1 className="page-title">Tổng quan</h1>
      <p className="page-lead">Phạm vi: thành viên bạn quản lý.</p>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {data ? (
        <div className="stats">
          {TILES.map((tile) => (
            <div className="stat" key={tile.key}>
              <p className="stat__value">{data[tile.key]}</p>
              <p className="stat__label">{tile.label}</p>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <LoadingRows count={3} />
        </Card>
      )}

      <Card title="Bắt đầu">
        <div className="stack stack--tight">
          <p className="card__subtitle">
            <Link className="link" href="/manager/locations">
              Địa điểm
            </Link>{" "}
            — tạo và sửa vị trí bằng bản đồ, link Google Maps hoặc địa chỉ.
          </p>
          <p className="card__subtitle">
            <Link className="link" href="/manager/members">
              Thành viên
            </Link>{" "}
            — thêm member theo email và gán địa điểm.
          </p>
          <p className="card__subtitle">
            <Link className="link" href="/manager/attendance">
              Chấm công
            </Link>{" "}
            — lọc, xem ảnh bằng chứng, điều chỉnh thủ công.
          </p>
        </div>
      </Card>
    </ManagerShell>
  );
}
