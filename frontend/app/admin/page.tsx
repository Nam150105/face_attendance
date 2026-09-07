"use client";

import { useEffect, useState } from "react";

import { AdminShell } from "../../components/AdminShell";
import { Alert, Card, LoadingRows } from "../../components/ui";
import { api } from "../../lib/api";
import { describeError } from "../../lib/messages";
import type { AdminOverview } from "../../lib/types";

export default function AdminHomePage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminOverview()
      .then(setData)
      .catch((cause) => setError(describeError(cause)));
  }, []);

  return (
    <AdminShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Toàn hệ thống</h1>
          <p className="page-lead">Bạn đang xem dữ liệu của tất cả người quản lý, không giới hạn phạm vi.</p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Alert tone="warning">
        Mọi thay đổi ở khu vực này đều được ghi vào nhật ký kèm tên bạn. Xoá tài khoản là vĩnh viễn, bao gồm cả
        dữ liệu khuôn mặt và toàn bộ bản ghi chấm công của người đó.
      </Alert>

      {data === null && !error ? (
        <Card>
          <LoadingRows count={4} />
        </Card>
      ) : data ? (
        <>
          <div className="tiles">
            <div className="tile tile--primary">
              <div className="tile__head">
                <span className="tile__label">Thành viên</span>
              </div>
              <p className="tile__value">{data.members}</p>
              <p className="tile__foot">Người chấm công</p>
            </div>
            <div className="tile">
              <div className="tile__head">
                <span className="tile__label">Người quản lý</span>
              </div>
              <p className="tile__value">{data.managers}</p>
              <p className="tile__foot">{data.super_admins} quản trị hệ thống</p>
            </div>
            <div className={`tile ${data.inactive_users > 0 ? "tile--warning" : ""}`}>
              <div className="tile__head">
                <span className="tile__label">Tài khoản bị khoá</span>
              </div>
              <p className="tile__value">{data.inactive_users}</p>
              <p className="tile__foot">Không đăng nhập được</p>
            </div>
            <div className="tile">
              <div className="tile__head">
                <span className="tile__label">Đang đăng nhập</span>
              </div>
              <p className="tile__value">{data.active_sessions}</p>
              <p className="tile__foot">Phiên còn hiệu lực</p>
            </div>
          </div>

          <div className="tiles">
            <div className="tile">
              <div className="tile__head">
                <span className="tile__label">Bản ghi chấm công</span>
              </div>
              <p className="tile__value">{data.attendance_events}</p>
              <p className="tile__foot">{data.deleted_events} bản ghi đã bị xoá</p>
            </div>
            <div className="tile">
              <div className="tile__head">
                <span className="tile__label">Nơi làm việc</span>
              </div>
              <p className="tile__value">{data.locations}</p>
              <p className="tile__foot">Của tất cả người quản lý</p>
            </div>
            <div className="tile">
              <div className="tile__head">
                <span className="tile__label">Đã đăng ký khuôn mặt</span>
              </div>
              <p className="tile__value">{data.enrolled_faces}</p>
              <p className="tile__foot">Hồ sơ sinh trắc học đang lưu</p>
            </div>
          </div>
        </>
      ) : null}
    </AdminShell>
  );
}
