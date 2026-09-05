"use client";

import { useCallback, useEffect, useState } from "react";

import { ManagerShell } from "../../../components/ManagerShell";
import { Alert, Badge, Button, Card, Empty, LoadingRows, SelectField } from "../../../components/ui";
import { api } from "../../../lib/api";
import { formatDateTime } from "../../../lib/geo";
import { describeError } from "../../../lib/messages";
import type { AuditLogEntry } from "../../../lib/types";

const PAGE_SIZE = 25;

const ENTITY_TYPES = ["attendance_event", "location", "member_location", "manager_membership"];

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

      <Card title={`Bản ghi (${total})`}>
        <div className="filters" style={{ marginBottom: "var(--space-2)" }}>
          <SelectField
            label="Đối tượng"
            value={entityType}
            onChange={(event) => {
              setPage(0);
              setEntityType(event.target.value);
            }}
          >
            <option value="">Tất cả</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </SelectField>
        </div>

        {entries === null ? (
          <LoadingRows count={4} />
        ) : entries.length === 0 ? (
          <Empty>Chưa có bản ghi.</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Hành động</th>
                    <th>Đối tượng</th>
                    <th>Lý do</th>
                    <th>Thay đổi</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td data-label="Thời gian" className="numeric">
                        {formatDateTime(entry.created_at)}
                      </td>
                      <td data-label="Hành động">
                        <Badge tone={entry.action.includes("ADJUST") ? "warning" : "neutral"}>{entry.action}</Badge>
                      </td>
                      <td data-label="Đối tượng">{entry.entity_type}</td>
                      <td data-label="Lý do">{entry.reason ?? "—"}</td>
                      <td data-label="Thay đổi">
                        {entry.before_json || entry.after_json ? (
                          <pre className="code-block">
                            {JSON.stringify({ before: entry.before_json, after: entry.after_json }, null, 1)}
                          </pre>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Trang trước
              </Button>
              <span>
                Trang {page + 1} / {lastPage + 1}
              </span>
              <Button variant="secondary" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
                Trang sau
              </Button>
            </div>
          </>
        )}
      </Card>
    </ManagerShell>
  );
}
