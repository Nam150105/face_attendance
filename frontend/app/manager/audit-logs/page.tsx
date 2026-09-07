"use client";

import { useCallback, useEffect, useState } from "react";

import { ManagerShell } from "../../../components/ManagerShell";
import { Alert, Badge, Button, Card, Empty, LoadingRows, SelectField } from "../../../components/ui";
import { api } from "../../../lib/api";
import { auditChanges, auditLabel, auditTone } from "../../../lib/audit";
import { formatDateTime } from "../../../lib/geo";
import { describeError } from "../../../lib/messages";
import type { AuditLogEntry } from "../../../lib/types";

const PAGE_SIZE = 25;

const ENTITY_LABELS: Array<{ value: string; label: string }> = [
  { value: "", label: "Tất cả hoạt động" },
  { value: "attendance_event", label: "Bản ghi ghi nhận" },
  { value: "location", label: "Địa điểm" },
  { value: "member_location", label: "Gắn địa điểm" },
  { value: "manager_membership", label: "Thành viên" },
  { value: "face_embedding", label: "Đăng ký khuôn mặt" },
];

export default function ManagerAuditLogsPage() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setEntries(null);
    try {
      const result = await api.auditLogs({
        entity_type: entityType || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setEntries(result.items);
      setTotal(result.total);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
      setEntries([]);
    }
  }, [entityType, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <ManagerShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Nhật ký hoạt động</h1>
          <p className="page-lead">
            Lưu vết mọi thay đổi về thành viên, địa điểm và bản ghi, kèm người thực hiện.
          </p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card
        title={`Lịch sử thay đổi (${total})`}
        action={
          <div style={{ minWidth: 220 }}>
            <SelectField
              label="Loại hoạt động"
              value={entityType}
              onChange={(event) => {
                setPage(0);
                setEntityType(event.target.value);
              }}
            >
              {ENTITY_LABELS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </SelectField>
          </div>
        }
      >
        {entries === null ? (
          <LoadingRows count={4} />
        ) : entries.length === 0 ? (
          <Empty>Chưa có thay đổi nào trong nhóm này.</Empty>
        ) : (
          <>
            <ol className="timeline">
              {entries.map((entry) => {
                const changes = auditChanges(entry);
                return (
                  <li className="timeline__item" key={entry.id}>
                    <span className={`timeline__dot timeline__dot--${auditTone(entry.action)}`} aria-hidden="true" />
                    <div className="timeline__body">
                      <div className="timeline__head">
                        <span className="timeline__title">{auditLabel(entry.action)}</span>
                        <time className="event__meta">{formatDateTime(entry.created_at)}</time>
                      </div>

                      {changes.length > 0 ? (
                        <ul className="changes">
                          {changes.map((change) => (
                            <li className="changes__row" key={change.field}>
                              <span className="changes__field">{change.field}:</span>
                              {change.before !== null ? (
                                <>
                                  <span className="changes__before" style={{ textDecoration: "line-through", color: "var(--text-muted)" }}>
                                    {change.before}
                                  </span>
                                  <span className="changes__arrow" aria-label="thành">
                                    →
                                  </span>
                                </>
                              ) : null}
                              <span className="changes__after" style={{ color: "var(--color-cyan)", fontWeight: 600 }}>
                                {change.after ?? "đã gỡ bỏ"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {entry.reason ? (
                        <p className="timeline__reason">
                          Lý do: <strong>{entry.reason}</strong>
                        </p>
                      ) : null}
                      <p className="event__meta" style={{ marginTop: 4 }}>
                        Người thực hiện: <Badge tone="neutral">{entry.actor_email}</Badge>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="pagination">
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                ← Trước
              </Button>
              <span className="mono">
                Trang {page + 1} / {lastPage + 1} ({total} bản ghi)
              </span>
              <Button variant="secondary" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
                Sau →
              </Button>
            </div>
          </>
        )}
      </Card>
    </ManagerShell>
  );
}
