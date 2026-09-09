"use client";

import { useCallback, useEffect, useState } from "react";

import { ManagerShell } from "../../../components/ManagerShell";
import { Alert, Button, Card, Empty, Field, LoadingRows, TextAreaField } from "../../../components/ui";
import { api } from "../../../lib/api";
import { formatDateTime } from "../../../lib/geo";
import { describeError } from "../../../lib/messages";
import { usePermissions } from "../../../lib/permissions";

interface JoinRequest {
  member_id: string;
  email: string;
  role: string;
  full_name: string | null;
  phone: string | null;
  position: string | null;
  department: string | null;
  team_name: string | null;
  team_code: string | null;
  requested_at: string;
}

interface Team {
  id: string;
  code: string;
  name: string;
  is_open: boolean;
  pending: number;
  members: number;
}

export default function JoinRequestsPage() {
  const may = usePermissions("join-requests");
  const mayManageTeams = usePermissions("members");
  const [requests, setRequests] = useState<JoinRequest[] | null>(null);
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<JoinRequest | null>(null);
  const [note, setNote] = useState("");
  const [newTeam, setNewTeam] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pending, myTeams] = await Promise.all([api.joinRequests(), api.managerTeams()]);
      setRequests(pending);
      setTeams(myTeams);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
      setRequests([]);
      setTeams([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(request: JoinRequest, approve: boolean, reason?: string) {
    setBusy(request.member_id);
    try {
      await api.decideJoinRequest(request.member_id, approve, reason);
      setNotice(
        approve
          ? `Đã nhận ${request.full_name ?? request.email} vào nhóm.`
          : `Đã từ chối ${request.full_name ?? request.email}.`,
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

  async function createTeam(event: React.FormEvent) {
    event.preventDefault();
    if (!newTeam.trim()) {
      return;
    }
    setCreating(true);
    try {
      const team = await api.createTeam(newTeam.trim());
      setNotice(`Đã tạo đơn vị "${team.name}". Mã để phát cho mọi người: ${team.code}`);
      setNewTeam("");
      await load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setCreating(false);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard needs permission the browser may not give; the code is on
      // screen either way, so there is nothing to report.
    }
  }

  return (
    <ManagerShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Yêu cầu vào nhóm</h1>
          <p className="page-lead">
            Người mới nhập mã đơn vị khi tạo tài khoản. Bạn duyệt thì họ mới chấm công được.
          </p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card
        title="Mã đơn vị của bạn"
        subtitle="Đưa mã này cho người mới. Họ nhập lúc tạo tài khoản là yêu cầu về thẳng đây."
      >
        {teams === null ? (
          <LoadingRows count={2} />
        ) : (
          <div className="stack stack--tight">
            {teams.map((team) => (
              <div className="team" key={team.id}>
                <button
                  type="button"
                  className="team__code"
                  onClick={() => void copyCode(team.code)}
                  title="Bấm để sao chép"
                >
                  {copied === team.code ? "Đã chép" : team.code}
                </button>
                <div className="team__body">
                  <p className="person__name">{team.name}</p>
                  <p className="event__meta">
                    {team.members} người · {team.pending > 0 ? `${team.pending} đang chờ` : "không ai chờ"}
                    {team.is_open ? "" : " · đang đóng"}
                  </p>
                </div>
                {mayManageTeams.edit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void api.updateTeam(team.id, { is_open: !team.is_open }).then(load)}
                  >
                    {team.is_open ? "Đóng nhận" : "Mở nhận"}
                  </Button>
                ) : null}
              </div>
            ))}

            {mayManageTeams.create ? (
              <form className="row" onSubmit={createTeam}>
                <Field
                  label="Tên đơn vị mới"
                  placeholder="Ví dụ: Chi nhánh Hà Nội"
                  value={newTeam}
                  onChange={(event) => setNewTeam(event.target.value)}
                />
                <Button type="submit" loading={creating} disabled={!newTeam.trim()}>
                  Tạo nhóm
                </Button>
              </form>
            ) : null}
          </div>
        )}
      </Card>

      <Card title={requests ? `Đang chờ duyệt (${requests.length})` : "Đang chờ duyệt"}>
        {requests === null ? (
          <LoadingRows count={3} />
        ) : requests.length === 0 ? (
          <Empty>Không có ai đang chờ. Khi có người nhập mã đơn vị, họ sẽ hiện ở đây.</Empty>
        ) : (
          <div className="stack stack--tight">
            {requests.map((request) => (
              <div className="request" key={request.member_id}>
                <div className="request__body">
                  <p className="person__name">{request.full_name ?? request.email}</p>
                  <p className="event__meta">
                    {request.email}
                    {request.phone ? ` · ${request.phone}` : ""}
                    {request.role === "MANAGER" ? " · là người quản lý" : ""}
                  </p>
                  <p className="event__meta">
                    Xin vào {request.team_name ?? "đơn vị"} · {formatDateTime(request.requested_at)}
                  </p>
                </div>
                {may.edit ? (
                  <div className="row">
                    <Button
                      size="sm"
                      disabled={busy === request.member_id}
                      onClick={() => void decide(request, true)}
                    >
                      Duyệt
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === request.member_id}
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
              </div>
            ))}
          </div>
        )}
      </Card>

      {rejecting ? (
        <Card title={`Từ chối ${rejecting.full_name ?? rejecting.email}`}>
          <div className="stack">
            <TextAreaField
              label="Lý do (người đó sẽ đọc được)"
              placeholder="Ví dụ: Bạn thuộc chi nhánh khác, dùng mã của chi nhánh mình nhé."
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="row">
              <Button
                variant="danger"
                loading={busy === rejecting.member_id}
                onClick={() => void decide(rejecting, false, note.trim() || undefined)}
              >
                Từ chối
              </Button>
              <Button variant="secondary" onClick={() => setRejecting(null)}>
                Huỷ
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </ManagerShell>
  );
}
