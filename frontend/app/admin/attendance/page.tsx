"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "../../../components/AdminShell";
import { Alert, Badge, Button, Card, Empty, Field, LoadingRows } from "../../../components/ui";
import { api } from "../../../lib/api";
import { formatDateTime, formatDistance } from "../../../lib/geo";
import { describeError, describeFailure } from "../../../lib/messages";
import type { AdminAttendanceResponse } from "../../../lib/types";

export default function AdminAttendancePage() {
  const [data, setData] = useState<AdminAttendanceResponse | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setData(null);
    try {
      setData(
        await api.adminAttendance({
          date_from: from || undefined,
          date_to: to || undefined,
          include_deleted: includeDeleted,
        }),
      );
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
      setData({ total: 0, items: [] });
    }
  }, [from, to, includeDeleted]);

  useEffect(() => {
    void load();
  }, [load]);

  async function purge(id: string, label: string) {
    const reason = window.prompt(`Xoá vĩnh viễn bản ghi của ${label}? Nhập lý do:`);
    if (!reason || reason.trim().length < 3) {
      return;
    }
    setBusy(true);
    try {
      await api.adminPurgeAttendance(id, reason.trim());
      setNotice("Đã xoá vĩnh viễn bản ghi.");
      await load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function restore(id: string) {
    setBusy(true);
    try {
      await api.adminRestoreAttendance(id);
      setNotice("Đã khôi phục bản ghi.");
      await load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Bản ghi toàn hệ thống</h1>
          <p className="page-lead">Bao gồm cả những bản ghi người quản lý đã xoá — bạn khôi phục hoặc xoá hẳn được.</p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card className="filter-card">
        <div className="filters-bar filters-bar--compact">
          <Field label="Từ ngày" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Field label="Đến ngày" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => setIncludeDeleted(e.target.checked)}
          />
          <span>Hiện cả bản ghi đã bị xoá</span>
        </label>
      </Card>

      <Card title={data ? `Bản ghi (${data.total})` : "Bản ghi"}>
        {data === null && !error ? (
          <LoadingRows count={5} />
        ) : data && data.items.length === 0 ? (
          <Empty>Không có bản ghi nào trong khoảng này.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Thành viên</th>
                  <th>Sự kiện</th>
                  <th>Nơi</th>
                  <th>Thời điểm</th>
                  <th>Tình trạng</th>
                  <th aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((row) => {
                  const label = row.member_name ?? row.member_email;
                  return (
                    <tr key={row.id} style={row.deleted_at ? { opacity: 0.65 } : undefined}>
                      <td data-label="Thành viên">
                        <p className="person__name">{label}</p>
                        {row.member_name ? <p className="event__meta">{row.member_email}</p> : null}
                      </td>
                      <td data-label="Sự kiện">
                        {row.event_type === "CHECK_IN" ? "Vào" : "Ra"}
                        <p className="event__meta">cách {formatDistance(row.distance_meters)}</p>
                      </td>
                      <td data-label="Nơi">{row.location_name}</td>
                      <td data-label="Thời điểm">{formatDateTime(row.server_time)}</td>
                      <td data-label="Tình trạng">
                        {row.deleted_at ? (
                          <>
                            <Badge tone="danger">Đã xoá</Badge>
                            <p className="event__meta">
                              {row.deleted_by_email} · {row.delete_reason}
                            </p>
                          </>
                        ) : (
                          <>
                            <Badge tone={row.status === "SUCCESS" ? "success" : "warning"}>
                              {row.status === "SUCCESS" ? "Hợp lệ" : row.status}
                            </Badge>
                            {row.failure_code ? (
                              <p className="event__meta">{describeFailure(row.failure_code)}</p>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td data-label="Thao tác">
                        <div className="row">
                          {row.deleted_at ? (
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void restore(row.id)}>
                              Khôi phục
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void purge(row.id, label)}
                            style={{ color: "var(--color-danger)" }}
                          >
                            Xoá hẳn
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AdminShell>
  );
}
