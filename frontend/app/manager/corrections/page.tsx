"use client";

import { useCallback, useEffect, useState } from "react";

import { Dialog } from "../../../components/Dialog";
import { ManagerShell } from "../../../components/ManagerShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataList,
  Empty,
  LoadingRows,
  SelectField,
  TextAreaField,
} from "../../../components/ui";
import { api } from "../../../lib/api";
import { formatDateTime } from "../../../lib/geo";
import { CORRECTION_STATUS, CORRECTION_TYPE, clockOf, dayLabel } from "../../../lib/member";
import { describeError } from "../../../lib/messages";
import type { CorrectionRequest, CorrectionsResponse } from "../../../lib/types";

export default function ManagerCorrectionsPage() {
  const [status, setStatus] = useState("PENDING");
  const [data, setData] = useState<CorrectionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CorrectionRequest | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(null);
    try {
      setData(await api.correctionsQueue(status || undefined));
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
      setData({ total: 0, items: [] });
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (!selected) {
      return;
    }
    setBusy(true);
    setDialogError(null);
    try {
      await api.reviewCorrection(selected.id, decision, note.trim() || undefined);
      setSelected(null);
      setNote("");
      await load();
    } catch (cause) {
      setDialogError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ManagerShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Yêu cầu chỉnh công</h1>
          <p className="page-lead">Duyệt hoặc từ chối đề nghị chỉnh sửa của thành viên bạn quản lý.</p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card
        title={data ? `Danh sách (${data.total})` : "Danh sách"}
        action={
          <div style={{ minWidth: 200 }}>
            <SelectField label="Trạng thái" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="PENDING">Chờ duyệt</option>
              <option value="APPROVED">Đã duyệt</option>
              <option value="REJECTED">Bị từ chối</option>
              <option value="">Tất cả</option>
            </SelectField>
          </div>
        }
      >
        {data === null && !error ? (
          <LoadingRows count={4} />
        ) : data && data.items.length === 0 ? (
          <Empty>Không có yêu cầu nào trong nhóm này.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Thành viên</th>
                  <th>Ngày</th>
                  <th>Loại</th>
                  <th>Lý do</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((item) => {
                  const meta = CORRECTION_STATUS[item.status];
                  return (
                    <tr key={item.id}>
                      <td data-label="Thành viên">
                        <p className="person__name">{item.member_name ?? item.member_email}</p>
                        {item.member_name ? <p className="event__meta">{item.member_email}</p> : null}
                      </td>
                      <td data-label="Ngày">{dayLabel(item.work_date)}</td>
                      <td data-label="Loại">{CORRECTION_TYPE[item.request_type]}</td>
                      <td data-label="Lý do">{item.reason}</td>
                      <td data-label="Trạng thái">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td data-label="Thao tác">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setSelected(item);
                            setNote("");
                            setDialogError(null);
                          }}
                        >
                          {item.status === "PENDING" ? "Duyệt" : "Xem"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected ? (
        <Dialog title="Xét duyệt yêu cầu chỉnh công" onClose={() => setSelected(null)}>
          <div className="stack">
            {dialogError ? <Alert tone="danger">{dialogError}</Alert> : null}

            <DataList
              rows={[
                { key: "Thành viên", value: selected.member_name ?? selected.member_email ?? "—" },
                { key: "Ngày", value: dayLabel(selected.work_date) },
                { key: "Loại yêu cầu", value: CORRECTION_TYPE[selected.request_type] },
                { key: "Check-in đề nghị", value: clockOf(selected.requested_check_in) },
                { key: "Check-out đề nghị", value: clockOf(selected.requested_check_out) },
                { key: "Lý do", value: selected.reason },
                { key: "Gửi lúc", value: formatDateTime(selected.created_at) },
                {
                  key: "Trạng thái",
                  value: (
                    <Badge tone={CORRECTION_STATUS[selected.status].tone}>
                      {CORRECTION_STATUS[selected.status].label}
                    </Badge>
                  ),
                },
              ]}
            />

            {selected.status === "PENDING" ? (
              <>
                <TextAreaField
                  label="Ghi chú phản hồi (tuỳ chọn)"
                  placeholder="Thành viên sẽ nhìn thấy ghi chú này trong thông báo."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="row">
                  <Button onClick={() => void decide("APPROVED")} loading={busy} block>
                    Duyệt
                  </Button>
                  <Button variant="secondary" onClick={() => void decide("REJECTED")} disabled={busy} block>
                    Từ chối
                  </Button>
                </div>
                <p className="field__hint">
                  Quyết định được ghi vào nhật ký hoạt động và gửi thông báo cho thành viên. Bản ghi chấm công gốc
                  không bị thay đổi tự động — nếu cần sửa, hãy dùng mục Bản ghi.
                </p>
              </>
            ) : (
              <Alert tone="info">
                Yêu cầu này đã được xử lý{selected.review_note ? `: ${selected.review_note}` : "."}
              </Alert>
            )}
          </div>
        </Dialog>
      ) : null}
    </ManagerShell>
  );
}
