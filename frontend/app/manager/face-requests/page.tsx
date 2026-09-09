"use client";

import { useCallback, useEffect, useState } from "react";

import { ManagerShell } from "../../../components/ManagerShell";
import { Alert, Button, Card, Empty, LoadingRows, TextAreaField } from "../../../components/ui";
import { api } from "../../../lib/api";
import { formatDateTime } from "../../../lib/geo";
import { describeError } from "../../../lib/messages";
import { usePermissions } from "../../../lib/permissions";

interface FaceRequest {
  id: string;
  member_id: string;
  email: string;
  full_name: string | null;
  department: string | null;
  reason: string;
  created_at: string;
  has_new_photo: boolean;
  has_current_photo: boolean;
}

export default function FaceRequestsPage() {
  const may = usePermissions("face-requests");
  const [requests, setRequests] = useState<FaceRequest[] | null>(null);
  const [photos, setPhotos] = useState<Record<string, { current?: string; next?: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<FaceRequest | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await api.faceChangeRequests();
      setRequests(rows);
      setError(null);

      // Both photos, fetched per request: a decision made without seeing them
      // is not a comparison, it is a rubber stamp.
      for (const row of rows) {
        const pair: { current?: string; next?: string } = {};
        if (row.has_current_photo) {
          pair.current = await api.memberFacePhoto(row.member_id).catch(() => undefined);
        }
        if (row.has_new_photo) {
          pair.next = await api.faceRequestPhoto(row.id).catch(() => undefined);
        }
        setPhotos((current) => ({ ...current, [row.id]: pair }));
      }
    } catch (cause) {
      setError(describeError(cause));
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(request: FaceRequest, approve: boolean, reason?: string) {
    setBusy(request.id);
    try {
      await api.decideFaceRequest(request.id, approve, reason);
      setNotice(
        approve
          ? `Đã đổi sang ảnh mới cho ${request.full_name ?? request.email}.`
          : `Đã giữ nguyên ảnh cũ của ${request.full_name ?? request.email}.`,
      );
      setRejecting(null);
      setNote("");
      await load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ManagerShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Đổi khuôn mặt</h1>
          <p className="page-lead">
            So ảnh đang dùng với ảnh mới. Chỉ duyệt khi bạn chắc chắn vẫn là một người.
          </p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {requests === null ? (
        <LoadingRows count={3} />
      ) : requests.length === 0 ? (
        <Card>
          <Empty>Không có yêu cầu nào. Khi ai đó xin đổi ảnh khuôn mặt, họ sẽ hiện ở đây.</Empty>
        </Card>
      ) : (
        requests.map((request) => (
          <Card key={request.id} title={request.full_name ?? request.email}>
            <div className="stack">
              <p className="event__meta">
                {request.email}
                {request.department ? ` · ${request.department}` : ""} ·{" "}
                {formatDateTime(request.created_at)}
              </p>

              <div className="face-compare">
                <div className="face-compare__cell">
                  <span className="face-compare__label">Ảnh đang dùng</span>
                  <div className="face-compare__frame">
                    {photos[request.id]?.current ? (
                      <img src={photos[request.id].current} alt="Ảnh khuôn mặt đang dùng" />
                    ) : (
                      <p className="face-compare__missing">
                        {request.has_current_photo ? "Đang tải…" : "Không có ảnh cũ để đối chiếu."}
                      </p>
                    )}
                  </div>
                </div>
                <div className="face-compare__cell">
                  <span className="face-compare__label">Ảnh xin đổi sang</span>
                  <div className="face-compare__frame">
                    {photos[request.id]?.next ? (
                      <img src={photos[request.id].next} alt="Ảnh khuôn mặt mới" />
                    ) : (
                      <p className="face-compare__missing">Đang tải…</p>
                    )}
                  </div>
                </div>
              </div>

              <Alert tone="info">
                <strong>Lý do họ nêu:</strong> {request.reason}
              </Alert>

              {may.edit ? (
                <div className="row">
                  <Button disabled={busy === request.id} onClick={() => void decide(request, true)}>
                    Duyệt đổi ảnh
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy === request.id}
                    onClick={() => {
                      setRejecting(request);
                      setNote("");
                    }}
                    style={{ color: "var(--color-danger)" }}
                  >
                    Từ chối
                  </Button>
                </div>
              ) : null}

              {rejecting?.id === request.id ? (
                <div className="stack">
                  <TextAreaField
                    label="Lý do từ chối (người đó sẽ đọc được)"
                    placeholder="Ví dụ: Ảnh mới không giống người trong hồ sơ, bạn chụp lại nhé."
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <div className="row">
                    <Button
                      variant="danger"
                      loading={busy === request.id}
                      onClick={() => void decide(request, false, note.trim() || undefined)}
                    >
                      Từ chối, giữ ảnh cũ
                    </Button>
                    <Button variant="secondary" onClick={() => setRejecting(null)}>
                      Huỷ
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </Card>
        ))
      )}
    </ManagerShell>
  );
}
