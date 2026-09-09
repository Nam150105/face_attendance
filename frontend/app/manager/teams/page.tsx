"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ManagerShell } from "../../../components/ManagerShell";
import { MemberDetail } from "../../../components/MemberDetail";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  LoadingRows,
  SelectField,
  TextAreaField,
} from "../../../components/ui";
import { api } from "../../../lib/api";
import { formatDateTime } from "../../../lib/geo";
import { CORRECTION_TYPE, clockOf, dayLabel } from "../../../lib/member";
import { describeError } from "../../../lib/messages";
import { usePermissions } from "../../../lib/permissions";
import type { CorrectionRequest, ManagedMember, ManagerLocation } from "../../../lib/types";

interface Team {
  id: string;
  code: string;
  name: string;
  is_open: boolean;
  pending: number;
  members: number;
}

interface TeamPlace {
  id: string;
  name: string;
  address: string | null;
  is_active: boolean;
  is_default: boolean;
}

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

type Queue = "join" | "face" | "correction";

/**
 * One screen for running a unit.
 *
 * Everything a manager does to people — take them in, give them somewhere to
 * check in at, approve a corrected day, approve a new face photo — used to be
 * five entries in the sidebar. They are one job, and a job split across five
 * screens is a job where something gets forgotten. The queues at the top say
 * what is waiting; the list below is the units themselves, and a unit opens
 * where it stands.
 */
export default function TeamsPage() {
  const may = usePermissions("members");
  const mayJoin = usePermissions("join-requests");
  const mayFace = usePermissions("face-requests");
  const mayCorrect = usePermissions("corrections");

  const [teams, setTeams] = useState<Team[] | null>(null);
  const [locations, setLocations] = useState<ManagerLocation[]>([]);
  const [joins, setJoins] = useState<JoinRequest[]>([]);
  const [faces, setFaces] = useState<FaceRequest[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRequest[]>([]);
  const [photos, setPhotos] = useState<Record<string, { current?: string; next?: string }>>({});

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<Queue | null>(null);

  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [places, setPlaces] = useState<TeamPlace[] | null>(null);
  const [roster, setRoster] = useState<ManagedMember[] | null>(null);
  const [placeToAdd, setPlaceToAdd] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

  const [newTeam, setNewTeam] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<ManagedMember | null>(null);
  const [rejecting, setRejecting] = useState<{ kind: Queue; id: string; label: string } | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const [teamRows, locationRows] = await Promise.all([api.managerTeams(), api.managerLocations()]);
      setTeams(teamRows);
      setLocations(locationRows.filter((row) => row.is_active));
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
      setTeams([]);
    }

    // Queues are optional: a manager without the face-request permission still
    // gets the rest of the page instead of an error about a door they cannot open.
    if (mayJoin.view) {
      await api.joinRequests().then(setJoins).catch(() => setJoins([]));
    }
    if (mayFace.view) {
      await api.faceChangeRequests().then(setFaces).catch(() => setFaces([]));
    }
    if (mayCorrect.view) {
      await api
        .correctionsQueue("PENDING")
        .then((result) => setCorrections(result.items))
        .catch(() => setCorrections([]));
    }
  }, [mayJoin.view, mayFace.view, mayCorrect.view]);

  useEffect(() => {
    void load();
  }, [load]);

  // Both photos of a face request, so approving is a comparison and not a
  // rubber stamp. Fetched only when the queue is actually open.
  useEffect(() => {
    if (queue !== "face") {
      return;
    }
    let live = true;
    void (async () => {
      for (const row of faces) {
        if (photos[row.id]) {
          continue;
        }
        const pair: { current?: string; next?: string } = {};
        if (row.has_current_photo) {
          pair.current = await api.memberFacePhoto(row.member_id).catch(() => undefined);
        }
        if (row.has_new_photo) {
          pair.next = await api.faceRequestPhoto(row.id).catch(() => undefined);
        }
        if (live) {
          setPhotos((current) => ({ ...current, [row.id]: pair }));
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [queue, faces, photos]);

  async function toggleTeam(team: Team) {
    if (openTeam === team.id) {
      setOpenTeam(null);
      return;
    }
    setOpenTeam(team.id);
    setPlaces(null);
    setRoster(null);
    setPlaceToAdd("");
    setInviteEmail("");
    try {
      const [teamPlaces, teamRoster] = await Promise.all([
        api.teamLocations(team.id),
        api.teamMembers(team.id),
      ]);
      setPlaces(teamPlaces);
      setRoster(teamRoster as ManagedMember[]);
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  async function refreshTeam(teamId: string) {
    const [teamPlaces, teamRoster] = await Promise.all([
      api.teamLocations(teamId),
      api.teamMembers(teamId),
    ]);
    setPlaces(teamPlaces);
    setRoster(teamRoster as ManagedMember[]);
  }

  async function run(work: () => Promise<string | void>) {
    setBusy(true);
    setError(null);
    try {
      const message = await work();
      if (message) {
        setNotice(message);
      }
      await load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createTeam(event: React.FormEvent) {
    event.preventDefault();
    const name = newTeam.trim();
    if (!name) {
      return;
    }
    await run(async () => {
      const team = await api.createTeam(name);
      setNewTeam("");
      return `Đã tạo "${team.name}". Mã để phát cho người mới: ${team.code}`;
    });
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // The browser may refuse clipboard access; the code is on screen anyway.
    }
  }

  async function addPlace(teamId: string) {
    if (!placeToAdd) {
      return;
    }
    await run(async () => {
      await api.attachTeamLocation(teamId, placeToAdd, (places ?? []).length === 0);
      setPlaceToAdd("");
      await refreshTeam(teamId);
      return "Đã gắn địa điểm. Ai trong nhóm cũng chấm công được ở đó.";
    });
  }

  async function removePlace(teamId: string, locationId: string) {
    await run(async () => {
      await api.detachTeamLocation(teamId, locationId);
      await refreshTeam(teamId);
    });
  }

  async function invite(teamId: string) {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      return;
    }
    await run(async () => {
      await api.addMemberByEmail(email, teamId);
      setInviteEmail("");
      await refreshTeam(teamId);
      return `Đã thêm ${email} vào nhóm.`;
    });
  }

  async function setMemberStatus(teamId: string, memberId: string, status: string, label: string) {
    if (!window.confirm(`${label}?`)) {
      return;
    }
    await run(async () => {
      await api.updateMembership(memberId, status);
      await refreshTeam(teamId);
    });
  }

  async function decide(kind: Queue, id: string, approve: boolean, reason?: string) {
    await run(async () => {
      if (kind === "join") {
        await api.decideJoinRequest(id, approve, reason);
      } else if (kind === "face") {
        await api.decideFaceRequest(id, approve, reason);
      } else {
        await api.reviewCorrection(id, approve ? "APPROVED" : "REJECTED", reason);
      }
      setRejecting(null);
      setNote("");
      if (openTeam) {
        await refreshTeam(openTeam);
      }
      return approve ? "Đã duyệt." : "Đã từ chối và ghi lại lý do.";
    });
  }

  const queues: { key: Queue; label: string; count: number; visible: boolean }[] = [
    { key: "join", label: "Yêu cầu vào nhóm", count: joins.length, visible: mayJoin.view },
    { key: "face", label: "Đổi khuôn mặt", count: faces.length, visible: mayFace.view },
    { key: "correction", label: "Chỉnh công", count: corrections.length, visible: mayCorrect.view },
  ];

  return (
    <ManagerShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Quản lý nhóm</h1>
          <p className="page-lead">
            Nhóm, người trong nhóm, nơi họ chấm công và những việc đang chờ bạn duyệt.
          </p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="queue-bar">
        {queues
          .filter((item) => item.visible)
          .map((item) => (
            <button
              type="button"
              key={item.key}
              className={`queue-tile${queue === item.key ? " is-open" : ""}${item.count > 0 ? " has-work" : ""}`}
              aria-expanded={queue === item.key}
              onClick={() => setQueue((current) => (current === item.key ? null : item.key))}
            >
              <span className="queue-tile__count">{item.count}</span>
              <span className="queue-tile__label">{item.label}</span>
            </button>
          ))}
      </div>

      {queue === "join" ? (
        <Card title={`Yêu cầu vào nhóm (${joins.length})`}>
          {joins.length === 0 ? (
            <Empty>Không có ai đang chờ. Người nhập mã nhóm sẽ hiện ở đây.</Empty>
          ) : (
            <div className="stack stack--tight">
              {joins.map((request) => (
                <div className="request" key={request.member_id}>
                  <div className="request__body">
                    <p className="person__name">{request.full_name ?? request.email}</p>
                    <p className="event__meta">
                      {request.full_name ? `${request.email} · ` : ""}
                      {request.phone ?? "chưa có số điện thoại"}
                      {request.role === "MANAGER" ? " · là người quản lý" : ""}
                    </p>
                    <p className="event__meta">
                      Xin vào {request.team_name ?? "nhóm"} · {formatDateTime(request.requested_at)}
                    </p>
                  </div>
                  {mayJoin.edit ? (
                    <div className="row">
                      <Button size="sm" disabled={busy} onClick={() => void decide("join", request.member_id, true)}>
                        Duyệt
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setRejecting({
                            kind: "join",
                            id: request.member_id,
                            label: request.full_name ?? request.email,
                          });
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
      ) : null}

      {queue === "face" ? (
        <Card title={`Yêu cầu đổi khuôn mặt (${faces.length})`}>
          {faces.length === 0 ? (
            <Empty>Không có yêu cầu nào. Ai xin đổi ảnh khuôn mặt sẽ hiện ở đây.</Empty>
          ) : (
            <div className="stack">
              {faces.map((request) => (
                <div className="request request--stacked" key={request.id}>
                  <div>
                    <p className="person__name">{request.full_name ?? request.email}</p>
                    <p className="event__meta">
                      {request.email} · {formatDateTime(request.created_at)}
                    </p>
                  </div>
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
                  <p className="event__meta">
                    <strong>Lý do họ nêu:</strong> {request.reason}
                  </p>
                  {mayFace.edit ? (
                    <div className="row">
                      <Button size="sm" disabled={busy} onClick={() => void decide("face", request.id, true)}>
                        Duyệt đổi ảnh
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setRejecting({
                            kind: "face",
                            id: request.id,
                            label: request.full_name ?? request.email,
                          });
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
      ) : null}

      {queue === "correction" ? (
        <Card title={`Yêu cầu chỉnh công (${corrections.length})`}>
          {corrections.length === 0 ? (
            <Empty>Không có yêu cầu nào đang chờ.</Empty>
          ) : (
            <div className="stack stack--tight">
              {corrections.map((item) => (
                <div className="request" key={item.id}>
                  <div className="request__body">
                    <p className="person__name">{item.member_name ?? item.member_email}</p>
                    <p className="event__meta">
                      {dayLabel(item.work_date)} · {CORRECTION_TYPE[item.request_type]}
                      {item.requested_check_in ? ` · vào ${clockOf(item.requested_check_in)}` : ""}
                      {item.requested_check_out ? ` · ra ${clockOf(item.requested_check_out)}` : ""}
                    </p>
                    <p className="event__meta">{item.reason}</p>
                  </div>
                  {mayCorrect.edit ? (
                    <div className="row">
                      <Button size="sm" disabled={busy} onClick={() => void decide("correction", item.id, true)}>
                        Duyệt
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setRejecting({
                            kind: "correction",
                            id: item.id,
                            label: item.member_name ?? item.member_email ?? "yêu cầu này",
                          });
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
      ) : null}

      {rejecting ? (
        <Card title={`Từ chối · ${rejecting.label}`}>
          <div className="stack">
            <TextAreaField
              label="Lý do (người đó sẽ đọc được)"
              placeholder="Viết ngắn gọn để họ biết cần làm gì tiếp."
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="row">
              <Button
                variant="danger"
                loading={busy}
                onClick={() => void decide(rejecting.kind, rejecting.id, false, note.trim() || undefined)}
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

      <Card
        title="Nhóm của bạn"
        subtitle="Bấm vào một nhóm để xem người và địa điểm của nhóm đó."
        action={
          may.create ? (
            <form className="row" onSubmit={createTeam}>
              <input
                className="input"
                placeholder="Tên nhóm mới"
                value={newTeam}
                onChange={(event) => setNewTeam(event.target.value)}
                aria-label="Tên nhóm mới"
              />
              <Button type="submit" size="sm" loading={busy} disabled={!newTeam.trim()}>
                Tạo nhóm
              </Button>
            </form>
          ) : null
        }
      >
        {teams === null ? (
          <LoadingRows count={3} />
        ) : teams.length === 0 ? (
          <Empty>Chưa có nhóm nào. Tạo một nhóm để lấy mã phát cho người mới.</Empty>
        ) : (
          <div className="stack stack--tight">
            {teams.map((team) => {
              const isOpen = openTeam === team.id;
              const waiting = joins.filter((row) => row.team_code === team.code);
              return (
                <div className={`unit${isOpen ? " is-open" : ""}`} key={team.id}>
                  <button
                    type="button"
                    className="unit__head"
                    aria-expanded={isOpen}
                    onClick={() => void toggleTeam(team)}
                  >
                    <span className="unit__chevron" aria-hidden="true">
                      {isOpen ? "−" : "+"}
                    </span>
                    <span className="unit__title">
                      <span className="person__name">{team.name}</span>
                      <span className="event__meta">
                        {team.members} người
                        {team.pending > 0 ? ` · ${team.pending} chờ duyệt` : ""}
                        {team.is_open ? "" : " · đang đóng nhận"}
                      </span>
                    </span>
                    <span
                      className="team__code"
                      role="button"
                      tabIndex={0}
                      title="Bấm để sao chép mã"
                      onClick={(event) => {
                        event.stopPropagation();
                        void copyCode(team.code);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.stopPropagation();
                          event.preventDefault();
                          void copyCode(team.code);
                        }
                      }}
                    >
                      {copied === team.code ? "Đã chép" : team.code}
                    </span>
                  </button>

                  {isOpen ? (
                    <div className="unit__body">
                      {may.edit ? (
                        <div className="row row--end">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await api.updateTeam(team.id, { is_open: !team.is_open });
                                return team.is_open ? "Đã đóng nhận người mới." : "Đã mở nhận người mới.";
                              })
                            }
                          >
                            {team.is_open ? "Đóng nhận" : "Mở nhận"}
                          </Button>
                        </div>
                      ) : null}

                      <section className="unit__section">
                        <h3 className="subhead">Địa điểm chấm công</h3>
                        {places === null ? (
                          <LoadingRows count={2} />
                        ) : places.length === 0 ? (
                          <Empty>Chưa gắn địa điểm nào. Người trong nhóm chưa chấm công được.</Empty>
                        ) : (
                          <div className="stack stack--tight">
                            {places.map((place) => (
                              <div className="line" key={place.id}>
                                <div className="line__body">
                                  <p className="person__name">{place.name}</p>
                                  <p className="event__meta">
                                    {place.address ?? "Chưa có địa chỉ"}
                                    {place.is_default ? " · mặc định" : ""}
                                  </p>
                                </div>
                                {may.edit ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() => void removePlace(team.id, place.id)}
                                    style={{ color: "var(--color-danger)" }}
                                  >
                                    Gỡ
                                  </Button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}

                        {may.edit ? (
                          <div className="row row--form">
                            <SelectField
                              label="Thêm địa điểm cho nhóm"
                              value={placeToAdd}
                              onChange={(event) => setPlaceToAdd(event.target.value)}
                            >
                              <option value="">Chọn địa điểm…</option>
                              {locations
                                .filter((row) => !(places ?? []).some((place) => place.id === row.id))
                                .map((row) => (
                                  <option key={row.id} value={row.id}>
                                    {row.name}
                                  </option>
                                ))}
                            </SelectField>
                            <Button size="sm" onClick={() => void addPlace(team.id)} loading={busy} disabled={!placeToAdd}>
                              Gắn
                            </Button>
                            <Link className="link" href="/manager/locations">
                              Tạo địa điểm mới
                            </Link>
                          </div>
                        ) : null}
                      </section>

                      {waiting.length > 0 ? (
                        <section className="unit__section">
                          <h3 className="subhead">Đang chờ vào nhóm ({waiting.length})</h3>
                          <div className="stack stack--tight">
                            {waiting.map((request) => (
                              <div className="line" key={request.member_id}>
                                <div className="line__body">
                                  <p className="person__name">{request.full_name ?? request.email}</p>
                                  <p className="event__meta">
                                    {request.full_name ? request.email : "Chưa điền hồ sơ"}
                                  </p>
                                </div>
                                {mayJoin.edit ? (
                                  <div className="row">
                                    <Button
                                      size="sm"
                                      disabled={busy}
                                      onClick={() => void decide("join", request.member_id, true)}
                                    >
                                      Duyệt
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={busy}
                                      onClick={() => {
                                        setRejecting({
                                          kind: "join",
                                          id: request.member_id,
                                          label: request.full_name ?? request.email,
                                        });
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
                        </section>
                      ) : null}

                      <section className="unit__section">
                        <h3 className="subhead">Người trong nhóm</h3>
                        {roster === null ? (
                          <LoadingRows count={3} />
                        ) : roster.length === 0 ? (
                          <Empty>Chưa ai ở trong nhóm này.</Empty>
                        ) : (
                          <div className="stack stack--tight">
                            {roster.map((member) => (
                              <div className="line" key={member.user_id}>
                                <button
                                  type="button"
                                  className="line__body line__body--action"
                                  onClick={() => setDetailFor(member)}
                                  title="Xem chi tiết"
                                >
                                  <p className="person__name">{member.full_name ?? member.email}</p>
                                  <p className="event__meta">
                                    {member.full_name ? member.email : "Chưa điền hồ sơ"}
                                    {member.position ? ` · ${member.position}` : ""}
                                  </p>
                                </button>
                                <Badge tone={member.membership_status === "ACTIVE" ? "success" : "warning"}>
                                  {member.membership_status === "ACTIVE" ? "Đang hoạt động" : "Tạm ngưng"}
                                </Badge>
                                {may.edit ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() =>
                                      void setMemberStatus(
                                        team.id,
                                        member.user_id,
                                        member.membership_status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
                                        member.membership_status === "ACTIVE"
                                          ? `Tạm ngưng ${member.full_name ?? member.email}`
                                          : `Cho ${member.full_name ?? member.email} hoạt động lại`,
                                      )
                                    }
                                  >
                                    {member.membership_status === "ACTIVE" ? "Tạm ngưng" : "Mở lại"}
                                  </Button>
                                ) : null}
                                {may.delete ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() =>
                                      void setMemberStatus(
                                        team.id,
                                        member.user_id,
                                        "REMOVED",
                                        `Gỡ ${member.full_name ?? member.email} khỏi nhóm`,
                                      )
                                    }
                                    style={{ color: "var(--color-danger)" }}
                                  >
                                    Gỡ
                                  </Button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}

                        {may.create ? (
                          <div className="row row--form">
                            <input
                              className="input"
                              type="email"
                              placeholder="Thêm bằng email đã có tài khoản"
                              value={inviteEmail}
                              onChange={(event) => setInviteEmail(event.target.value)}
                              aria-label="Email người cần thêm"
                            />
                            <Button
                              size="sm"
                              loading={busy}
                              disabled={!inviteEmail.trim()}
                              onClick={() => void invite(team.id)}
                            >
                              Thêm
                            </Button>
                          </div>
                        ) : null}
                      </section>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {detailFor ? <MemberDetail member={detailFor} onClose={() => setDetailFor(null)} /> : null}
    </ManagerShell>
  );
}
