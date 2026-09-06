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
import { shortTime, weekdayLabel } from "../../../lib/member";
import type { BulkAddResult, ManagedMember, ManagerLocation, Shift } from "../../../lib/types";

const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0];

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

  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [shiftWeekday, setShiftWeekday] = useState("1");
  const [shiftStart, setShiftStart] = useState("08:00");
  const [shiftEnd, setShiftEnd] = useState("17:00");
  const [shiftGrace, setShiftGrace] = useState("10");

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
    setShifts(null);
    setDialogError(null);
    setLocationId(locations[0]?.id ?? "");
    setIsDefault(true);
    try {
      const [assignedLocations, memberShifts] = await Promise.all([
        api.assignedLocations(member.user_id),
        api.memberSchedules(member.user_id),
      ]);
      setAssigned(assignedLocations);
      setShifts(memberShifts);
    } catch (cause) {
      setDialogError(describeError(cause));
    }
  }

  async function addShift() {
    if (!selected) {
      return;
    }
    setBusy(true);
    setDialogError(null);
    try {
      await api.createMemberSchedule(selected.user_id, {
        weekday: Number(shiftWeekday),
        start_time: `${shiftStart}:00`,
        end_time: `${shiftEnd}:00`,
        grace_minutes: Number(shiftGrace) || 0,
        location_id: locationId || null,
      });
      setShifts(await api.memberSchedules(selected.user_id));
    } catch (cause) {
      setDialogError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function removeShift(shiftId: string) {
    if (!selected) {
      return;
    }
    setBusy(true);
    try {
      await api.deleteMemberSchedule(selected.user_id, shiftId);
      setShifts(await api.memberSchedules(selected.user_id));
    } catch (cause) {
      setDialogError(describeError(cause));
    } finally {
      setBusy(false);
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
          <p className="page-lead">Danh sách người bạn quản lý, trạng thái hồ sơ và phân công địa điểm.</p>
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
                          Phân công
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

      {/* Location Assignment Dialog */}
      {selected ? (
        <Dialog
          title={`Phân công: ${selected.full_name ?? selected.email}`}
          onClose={() => setSelected(null)}
        >
          <div className="stack">
            {dialogError ? <Alert tone="danger">{dialogError}</Alert> : null}

            <div>
              <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 700, marginBottom: "8px" }}>
                Địa điểm đang được phân công
              </h3>
              {assigned === null ? (
                <LoadingRows count={2} />
              ) : assigned.length === 0 ? (
                <Empty>Chưa được phân công địa điểm nào.</Empty>
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
                  Phân công địa điểm
                </Button>
              </div>
            ) : (
              <Alert tone="warning">Chưa có địa điểm nào đang bật. Hãy tạo địa điểm trước.</Alert>
            )}

            <hr className="divider" />

            <div className="stack">
              <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 700 }}>Ca làm việc hằng tuần</h3>
              <p className="field__hint">
                Ca là căn cứ để hệ thống xác định đi muộn. Không có ca thì mọi lượt check-in đúng phạm vi đều tính
                là hợp lệ.
              </p>

              {shifts === null ? (
                <LoadingRows count={2} />
              ) : shifts.length === 0 ? (
                <Empty>Chưa có ca nào.</Empty>
              ) : (
                <div className="stack stack--tight">
                  {shifts.map((shift) => (
                    <div className="event" key={shift.id}>
                      <div>
                        <p className="event__label">
                          {shift.work_date ? shift.work_date : weekdayLabel(shift.weekday)}
                        </p>
                        <p className="event__meta">
                          {shortTime(shift.start_time)} – {shortTime(shift.end_time)} · cho phép muộn{" "}
                          {shift.grace_minutes} phút
                          {shift.location_name ? ` · ${shift.location_name}` : ""}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void removeShift(shift.id)}>
                        Gỡ
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="filters-bar">
                <SelectField label="Thứ" value={shiftWeekday} onChange={(e) => setShiftWeekday(e.target.value)}>
                  {WEEKDAY_OPTIONS.map((day) => (
                    <option key={day} value={String(day)}>
                      {weekdayLabel(day)}
                    </option>
                  ))}
                </SelectField>
                <Field
                  label="Bắt đầu"
                  type="time"
                  value={shiftStart}
                  onChange={(e) => setShiftStart(e.target.value)}
                />
                <Field label="Kết thúc" type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
                <Field
                  label="Cho phép muộn (phút)"
                  type="number"
                  min={0}
                  max={240}
                  value={shiftGrace}
                  onChange={(e) => setShiftGrace(e.target.value)}
                />
              </div>

              <Button variant="secondary" onClick={() => void addShift()} loading={busy} block>
                Thêm ca làm việc
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </ManagerShell>
  );
}
