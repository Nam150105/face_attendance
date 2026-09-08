"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { Alert, Badge, Button, Card, Empty, LoadingRows } from "../../components/ui";
import { api } from "../../lib/api";
import { formatDateTime } from "../../lib/geo";
import { NOTIFICATION_CATEGORY } from "../../lib/member";
import { describeError } from "../../lib/messages";
import type { CurrentUser, NotificationsResponse } from "../../lib/types";

export default function NotificationsPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.notifications({ unread_only: unreadOnly, limit: 50 }));
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [unreadOnly]);

  useEffect(() => {
    api.me().then(setUser).catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markOne(id: string) {
    try {
      await api.markNotificationRead(id);
      await load();
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  async function markAll() {
    setBusy(true);
    try {
      await api.markAllNotificationsRead();
      await load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell email={user?.email} wide>

      <div className="page-header">
        <div>
          <h1 className="page-title">Thông báo</h1>
          <p className="page-lead">Kết quả chấm công, thay đổi ca và phản hồi yêu cầu chỉnh công.</p>
        </div>
        <div className="row">
          <Button size="sm" variant="secondary" onClick={() => setUnreadOnly((current) => !current)}>
            {unreadOnly ? "Xem tất cả" : "Chỉ chưa đọc"}
          </Button>
          <Button size="sm" onClick={() => void markAll()} loading={busy} disabled={!data || data.unread === 0}>
            Đánh dấu đã đọc
          </Button>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card title={data ? `Hộp thông báo (${data.unread} chưa đọc)` : "Hộp thông báo"}>
        {data === null && !error ? (
          <LoadingRows count={4} />
        ) : data && data.items.length === 0 ? (
          <Empty>{unreadOnly ? "Không có thông báo chưa đọc." : "Chưa có thông báo nào."}</Empty>
        ) : (
          <div className="stack stack--tight">
            {(data?.items ?? []).map((item) => {
              const meta = NOTIFICATION_CATEGORY[item.category] ?? { label: item.category, tone: "neutral" as const };
              return (
                <div
                  className="event"
                  key={item.id}
                  style={item.read_at ? undefined : { borderColor: "var(--border-primary)" }}
                >
                  <div>
                    <p className="event__label">
                      {item.read_at ? null : <span aria-label="Chưa đọc">● </span>}
                      {item.title}
                    </p>
                    {item.body ? <p className="event__meta">{item.body}</p> : null}
                    <p className="event__meta">{formatDateTime(item.created_at)}</p>
                  </div>
                  <div className="person__tags">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {item.read_at ? null : (
                      <Button size="sm" variant="ghost" onClick={() => void markOne(item.id)}>
                        Đã đọc
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </AppShell>
  );
}
