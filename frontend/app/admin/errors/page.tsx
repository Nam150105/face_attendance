"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "../../../components/AdminShell";
import { Dialog } from "../../../components/Dialog";
import { Alert, Badge, Button, Card, Empty, Field, LoadingRows } from "../../../components/ui";
import { api } from "../../../lib/api";
import { formatDateTime } from "../../../lib/geo";
import { describeError } from "../../../lib/messages";

const PAGE_SIZE = 25;

interface Failure {
  code: string;
  created_at: string;
  method: string;
  path: string;
  kind: string;
  detail: string;
  user_email: string | null;
  request_id: string | null;
  traceback: string;
}

export default function AdminErrorsPage() {
  const [items, setItems] = useState<Failure[] | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setItems(null);
    try {
      const result = await api.adminErrors({
        search: search.trim() || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setItems(result.items);
      setTotal(result.total);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
      setItems([]);
    }
  }, [search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function clearOld() {
    if (!window.confirm("Xoá các sự cố cũ hơn 30 ngày?")) {
      return;
    }
    setBusy(true);
    try {
      const result = await api.clearAdminErrors(30);
      setNotice(`Đã dọn ${result.removed} sự cố cũ.`);
      await load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <AdminShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Sự cố hệ thống</h1>
          <p className="page-lead">
            Người dùng gặp lỗi sẽ đọc cho bạn một mã sáu ký tự. Dán mã vào ô tìm để xem chuyện gì đã
            xảy ra.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void clearOld()} loading={busy}>
          Dọn sự cố cũ
        </Button>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card className="filter-card">
        <Field
          label="Tìm theo mã lỗi, đường dẫn hoặc email"
          placeholder="Ví dụ: K7M2PX"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
      </Card>

      <Card title={items ? `Sự cố (${total})` : "Đang tải"}>
        {items === null ? (
          <LoadingRows count={5} />
        ) : items.length === 0 ? (
          <Empty>
            {search.trim()
              ? "Không có sự cố nào khớp với mã này."
              : "Chưa ghi nhận sự cố nào. Đây là tin tốt."}
          </Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Mã lỗi</th>
                    <th>Thời điểm</th>
                    <th>Ở đâu</th>
                    <th>Ai gặp</th>
                    <th aria-label="Chi tiết" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((failure) => (
                    <tr key={failure.code}>
                      <td data-label="Mã lỗi">
                        <Badge tone="danger">{failure.code}</Badge>
                      </td>
                      <td data-label="Thời điểm">{formatDateTime(failure.created_at)}</td>
                      <td data-label="Ở đâu">
                        <p className="event__label mono">
                          {failure.method} {failure.path}
                        </p>
                        <p className="event__meta">{failure.kind}</p>
                      </td>
                      <td data-label="Ai gặp">{failure.user_email ?? "Chưa đăng nhập"}</td>
                      <td data-label="Chi tiết">
                        <Button size="sm" variant="secondary" onClick={() => setOpen(failure)}>
                          Xem
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                ← Trước
              </Button>
              <span className="mono">
                Trang {page + 1} / {lastPage + 1}
              </span>
              <Button variant="secondary" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
                Sau →
              </Button>
            </div>
          </>
        )}
      </Card>

      {open ? (
        <Dialog title={`Sự cố ${open.code}`} onClose={() => setOpen(null)}>
          <div className="stack">
            <p className="event__meta">
              {formatDateTime(open.created_at)} · {open.method} {open.path}
            </p>
            <Alert tone="danger">{open.detail || open.kind}</Alert>
            <p className="event__meta">
              Người gặp: {open.user_email ?? "chưa đăng nhập"}
              {open.request_id ? ` · request ${open.request_id}` : ""}
            </p>
            <pre className="trace">{open.traceback}</pre>
          </div>
        </Dialog>
      ) : null}
    </AdminShell>
  );
}
