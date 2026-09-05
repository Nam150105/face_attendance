"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ManagerShell } from "../../components/ManagerShell";
import { Alert, Card, LoadingRows } from "../../components/ui";
import { api } from "../../lib/api";
import { describeError } from "../../lib/messages";
import type { ManagerDashboard } from "../../lib/types";

const TILES: Array<{ key: keyof ManagerDashboard; label: string }> = [
  { key: "active_members", label: "Thành viên đang quản lý" },
  { key: "currently_checked_in", label: "Đang trong ca" },
  { key: "events_today", label: "Sự kiện hôm nay" },
  { key: "members_with_face", label: "Đã đăng ký khuôn mặt" },
  { key: "active_locations", label: "Địa điểm đang hoạt động" },
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
      <p className="page-lead">Số liệu tính trên phạm vi thành viên bạn đang quản lý.</p>

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

      <Card title="Bắt đầu từ đâu">
        <div className="stack stack--tight">
          <p className="card__subtitle">
            <Link className="link" href="/manager/locations">
              Địa điểm
            </Link>{" "}
            — tạo hoặc sửa vị trí check-in, có nút lấy thẳng toạ độ GPS của thiết bị bạn đang dùng.
          </p>
          <p className="card__subtitle">
            <Link className="link" href="/manager/members">
              Thành viên
            </Link>{" "}
            — thêm member bằng email đã đăng ký và gán địa điểm cho họ.
          </p>
          <p className="card__subtitle">
            <Link className="link" href="/manager/attendance">
              Chấm công
            </Link>{" "}
            — lọc theo ngày, thành viên, trạng thái; xem ảnh bằng chứng và điều chỉnh thủ công.
          </p>
        </div>
      </Card>
    </ManagerShell>
  );
}
