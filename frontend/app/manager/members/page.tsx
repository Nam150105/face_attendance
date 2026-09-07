"use client";

import { useCallback, useEffect, useState } from "react";

import { Dialog } from "../../../components/Dialog";
import { ManagerShell } from "../../../components/ManagerShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Empty,
  Field,
  LoadingRows,
  SelectField,
  TextAreaField,
} from "../../../components/ui";
import { api } from "../../../lib/api";
import { BULK_STATUS_LABELS, describeError } from "../../../lib/messages";
import type { BulkAddResult, ManagedMember, ManagerLocation } from "../../../lib/types";

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2)).toUpperCase();
}

export default function ManagerMembersPage() {
  const [members, setMembers] = useState<ManagedMember[] | null>(null);
  const [locations, setLocations] = useState<ManagerLocation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [emails, setEmails] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BulkAddResult | null>(null);

  const [selected, setSelected] = useState<ManagedMember | null>(null);
  const [assigned, setAssigned] = useState<ManagerLocation[] | null>(null);
  const [locationId, setLocationId] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);


  const load = useCallback(async () => {
    try {
      const [memberRows, locationRows] = await Promise.all([api.managerMembers(), api.managerLocations()]);
      setMembers(memberRows);
      setLocations(locationRows.filter((item) => item.is_active));
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const parsedEmails = emails
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  async function addMembers(event: React.FormEvent) {
    event.preventDefault();
    setAdding(true);
    setAddError(null);
    setOutcome(null);
    try {
      const result = await api.bulkAddMembers(parsedEmails);
      setOutcome(result);
      if (result.failed === 0) {
        setEmails("");
      } else {
        setEmails(
          result.results
            .filter((item) => item.status === "NOT_REGISTERED" || item.status === "INVALID_EMAIL")
            .map((item) => item.email)
            .join("\n"),
        );
      }
      await load();
    } catch (cause) {
      setAddError(describeError(cause));
    } finally {
      setAdding(false);
    }
  }

  async function openAssign(member: ManagedMember) {
    setSelected(member);
    setAssigned(null);
    setDialogError(null);
    setLocationId(locations[0]?.id ?? "");
    setIsDefault(true);
    try {
      setAssigned(await api.assignedLocations(member.user_id));
    } catch (cause) {
      setDialogError(describeError(cause));
    }
  }



  async function assign() {
    if (!selected || !locationId) {
      return;
    }
    setBusy(true);
    setDialogError(null);
    try {
      await api.assignLocation(selected.user_id, locationId, isDefault);
      setAssigned(await api.assignedLocations(selected.user_id));
    } catch (cause) {
      setDialogError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function unassign(location: ManagerLocation) {
    if (!selected) {
      return;
    }
    setBusy(true);
    setDialogError(null);
    try {
      await api.unassignLocation(selected.user_id, location.id);
      setAssigned(await api.assignedLocations(selected.user_id));
    } catch (cause) {
      setDialogError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: ManagedMember) {
    const label = member.full_name ?? member.email;
    if (!window.confirm(`Gỡ ${label} khỏi danh sách bạn quản lý? Bản ghi chấm công cũ vẫn được giữ lại.`)) {
      return;
    }
    try {
      await api.removeMember(member.user_id);
      await load();
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  async function changeStatus(member: ManagedMember, status: string) {
    try {
      await api.updateMembership(member.user_id, status);
      await load();
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  const filteredMembers = (members ?? []).filter((m) => {
    const q = search.toLowerCase();
    return (
      m.email.toLowerCase().includes(q) ||
      (m.full_name && m.full_name.toLowerCase().includes(q)) ||
      (m.department && m.department.toLowerCase().includes(q)) ||
      (m.employee_code && m.employee_code.toLowerCase().includes(q))
    );
  });

  return (
    <ManagerShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Thành viên</h1>
          <p className="page-lead">Những người bạn đang quản lý và nơi từng người được phép chấm công.</p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {/* Bulk Add Member Card */}
      <Card
        title="Thêm thành viên"
        subtitle="Nhập email của người đã có tài khoản — mỗi email một dòng hoặc ngăn cách bằng dấu phẩy."
      >
        <form className="stack" onSubmit={addMembers}>
          <TextAreaField
            label="Danh sách email"
            hint={`Đã nhận ${parsedEmails.length} email · tối đa 200 email mỗi lần.`}
            required
            rows={3}
            placeholder={"an.nguyen@tochuc.vn\nbinh.tran@tochuc.vn"}
            value={emails}
            onChange={(event) => setEmails(event.target.value)}
          />

          {addError ? <Alert tone="danger">{addError}</Alert> : null}

          {outcome ? (
            <div
              style={{
                background: "var(--surface-input)",
                padding: "var(--space-2)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <p style={{ fontSize: "var(--text-sm)", fontWeight: 700, marginBottom: "8px" }}>
                Kết quả: {outcome.succeeded} thành công · {outcome.failed} cần xem lại
              </p>
              <div className="stack stack--tight">
                {outcome.results.map((item) => {
                  const meta = BULK_STATUS_LABELS[item.status] ?? { label: item.status, tone: "neutral" as const };
                  return (
                    <div className="row row--between" key={item.email} style={{ fontSize: "var(--text-xs)" }}>
                      <span>{item.email}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <Button type="submit" loading={adding} disabled={parsedEmails.length === 0} block>
            {parsedEmails.length > 0 ? `Thêm ${parsedEmails.length} thành viên` : "Thêm thành viên"}
          </Button>
        </form>
      </Card>

      {/* Members Directory Card */}
      <Card
        title={`Danh sách thành viên (${filteredMembers.length})`}
        action={
          <div className="search-input-wrap">
            <svg
              className="search-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="input search-input"
              aria-label="Tìm thành viên"
              placeholder="Tìm theo tên, email, đơn vị…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
      >
        {members === null ? (
          <LoadingRows count={4} />
        ) : filteredMembers.length === 0 ? (
          <Empty>Không tìm thấy thành viên nào phù hợp.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Thành viên</th>
                  <th>Đơn vị / Mã</th>
                  <th>Chức danh / Điện thoại</th>
                  <th>Trạng thái</th>
                  <th aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((member) => (
                  <tr key={member.user_id}>
                    <td data-label="Thành viên">
                      <div className="row">
                        <span className="person__avatar" aria-hidden="true">
                          {initials(member.full_name, member.email)}
                        </span>
                        <div>
                          <p className="person__name">{member.full_name ?? member.email}</p>
                          <p className="event__meta">{member.email}</p>
                        </div>
                      </div>
                    </td>
                    <td data-label="Đơn vị">
                      <p className="event__label">{member.department ?? "—"}</p>
                      {member.employee_code ? (
                        <p className="event__meta mono">{member.employee_code}</p>
                      ) : null}
                    </td>
                    <td data-label="Chức danh">
                      <p className="event__label">{member.position ?? "—"}</p>
                      {member.phone ? <p className="event__meta">{member.phone}</p> : null}
                    </td>
                    <td data-label="Trạng thái">
                      <Badge tone={member.membership_status === "ACTIVE" ? "success" : "neutral"}>
                        {member.membership_status === "ACTIVE" ? "Đang hoạt động" : "Tạm ngưng"}
                      </Badge>
                    </td>
                    <td data-label="Thao tác">
                      <div className="row">
                        <Button size="sm" variant="secondary" onClick={() => void openAssign(member)}>
                          Địa điểm
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void changeStatus(member, member.membership_status === "ACTIVE" ? "SUSPENDED" : "ACTIVE")}
                          style={{ color: member.membership_status === "ACTIVE" ? "var(--color-warning)" : "var(--color-success)" }}
                        >
                          {member.membership_status === "ACTIVE" ? "Tạm ngưng" : "Kích hoạt"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void removeMember(member)}
                          style={{ color: "var(--color-danger)" }}
                        >
                          Gỡ
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Which places this member may check in at */}
      {selected ? (
        <Dialog
          title={`Nơi chấm công của ${selected.full_name ?? selected.email}`}
          onClose={() => setSelected(null)}
        >
          <div className="stack">
            {dialogError ? <Alert tone="danger">{dialogError}</Alert> : null}

            <div>
              <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 700, marginBottom: "8px" }}>
                Đang được chấm công tại
              </h3>
              {assigned === null ? (
                <LoadingRows count={2} />
              ) : assigned.length === 0 ? (
                <Empty>Chưa gắn với địa điểm nào, nên chưa chấm công được ở đâu cả.</Empty>
              ) : (
                <div className="stack stack--tight">
                  {assigned.map((location) => (
                    <div className="event" key={location.id}>
                      <div>
                        <p className="event__label">{location.name}</p>
                        <p className="event__meta">
                          Phạm vi {location.allow_radius_meters}m {location.is_default ? "· Mặc định" : ""}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void unassign(location)}>
                        Gỡ
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <hr className="divider" />

            {locations.length > 0 ? (
              <div className="stack">
                <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 700 }}>Thêm địa điểm</h3>
                <SelectField
                  label="Chọn địa điểm"
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                >
                  {locations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </SelectField>

                <Checkbox
                  label="Đặt làm địa điểm mặc định"
                  checked={isDefault}
                  onChange={setIsDefault}
                />

                <Button onClick={assign} loading={busy} block>
                  Thêm địa điểm này
                </Button>
              </div>
            ) : (
              <Alert tone="warning">Chưa có địa điểm nào đang bật. Hãy tạo địa điểm trước.</Alert>
            )}

          </div>
        </Dialog>
      ) : null}
    </ManagerShell>
  );
}
