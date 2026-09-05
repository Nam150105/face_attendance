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
  { value: "", label: "Tất cả" },
  { value: "attendance_event", label: "Chấm công" },
  { value: "location", label: "Địa điểm" },
  { value: "member_location", label: "Phân công địa điểm" },
  { value: "manager_membership", label: "Thành viên" },
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
      <h1 className="page-title">Nhật ký</h1>
      <p className="page-lead">Mọi thay đổi quản trị từ tài khoản của bạn.</p>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card
        title={`${total} thay đổi`}
        action={
          <div style={{ minWidth: 170 }}>
            <SelectField
              label="Lọc"
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
          <Empty>Chưa có thay đổi nào.</Empty>
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
                              <span className="changes__field">{change.field}</span>
                              {change.before !== null ? (
                                <>
                                  <span className="changes__before">{change.before}</span>
                                  <span className="changes__arrow" aria-label="thành">
                                    →
                                  </span>
                                </>
                              ) : null}
                              <span className="changes__after">{change.after ?? "đã xoá"}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {entry.reason ? <p className="timeline__reason">Lý do: {entry.reason}</p> : null}
                      <p className="event__meta">
                        <Badge tone="neutral">{entry.actor_email}</Badge>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="pagination">
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Trước
              </Button>
              <span>
                {page + 1} / {lastPage + 1}
              </span>
              <Button variant="secondary" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
                Sau
              </Button>
            </div>
          </>
        )}
      </Card>
    </ManagerShell>
  );
}
