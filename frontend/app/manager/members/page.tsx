"use client";

import { useCallback, useEffect, useState } from "react";

import { Dialog } from "../../../components/Dialog";
import { ManagerShell } from "../../../components/ManagerShell";
import { Alert, Badge, Button, Card, DataList, Empty, Field, LoadingRows, SelectField } from "../../../components/ui";
import { api } from "../../../lib/api";
import { describeError } from "../../../lib/messages";
import type { ManagedMember, ManagerLocation } from "../../../lib/types";

export default function ManagerMembersPage() {
  const [members, setMembers] = useState<ManagedMember[] | null>(null);
  const [locations, setLocations] = useState<ManagerLocation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addNotice, setAddNotice] = useState<string | null>(null);

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

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    setAdding(true);
    setAddError(null);
    setAddNotice(null);
    try {
      const member = await api.addMemberByEmail(email.trim());
      setAddNotice(`Đã thêm ${member.email} vào danh sách quản lý.`);
      setEmail("");
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

  async function changeStatus(member: ManagedMember, status: string) {
    try {
      await api.updateMembership(member.user_id, status);
      await load();
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  return (
    <ManagerShell>
      <h1 className="page-title">Thành viên</h1>
      <p className="page-lead">
        Chỉ thêm được email đã đăng ký tài khoản MEMBER. Mọi thay đổi đều ghi vào nhật ký.
      </p>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card title="Thêm thành viên" subtitle="Nhập email member đã có tài khoản trên hệ thống.">
        <form className="stack" onSubmit={addMember}>
          <Field
            label="Email thành viên"
            type="email"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {addError ? <Alert tone="danger">{addError}</Alert> : null}
          {addNotice ? <Alert tone="success">{addNotice}</Alert> : null}
          <Button type="submit" loading={adding}>
            Thêm vào danh sách
          </Button>
        </form>
      </Card>

      <Card title="Đang quản lý">
        {members === null ? (
          <LoadingRows count={3} />
        ) : members.length === 0 ? (
          <Empty>Chưa có thành viên nào.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Thành viên</th>
                  <th>Bộ phận</th>
                  <th>Trạng thái</th>
                  <th aria-label="Hành động" />
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.user_id}>
                    <td data-label="Thành viên">
                      <span className="event__label">{member.full_name ?? "(chưa có tên)"}</span>
                      <p className="event__meta">{member.email}</p>
                    </td>
                    <td data-label="Bộ phận">{member.department ?? "—"}</td>
                    <td data-label="Trạng thái">
                      <Badge tone={member.membership_status === "ACTIVE" ? "success" : "warning"}>
                        {member.membership_status}
                      </Badge>
                    </td>
                    <td data-label="Hành động">
                      <div className="row">
                        <Button variant="secondary" onClick={() => void openAssign(member)}>
                          Địa điểm
                        </Button>
                        {member.membership_status === "ACTIVE" ? (
                          <Button variant="ghost" onClick={() => void changeStatus(member, "SUSPENDED")}>
                            Tạm ngưng
                          </Button>
                        ) : (
                          <Button variant="ghost" onClick={() => void changeStatus(member, "ACTIVE")}>
                            Kích hoạt
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected ? (
        <Dialog title={`Địa điểm của ${selected.email}`} onClose={() => setSelected(null)}>
          <div className="stack">
            {assigned === null ? (
              <LoadingRows count={2} />
            ) : assigned.length === 0 ? (
              <Alert tone="warning">Thành viên chưa được gán địa điểm nào nên chưa thể check-in.</Alert>
            ) : (
              <div>
                {assigned.map((location) => (
                  <div className="event" key={location.id}>
                    <div>
                      <p className="event__label">{location.name}</p>
                      <p className="event__meta">
                        {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)} · cho phép{" "}
                        {location.allow_radius_meters}m
                      </p>
                    </div>
                    <div className="row">
                      {location.is_default ? <Badge tone="info">Mặc định</Badge> : null}
                      <Button variant="ghost" disabled={busy} onClick={() => void unassign(location)}>
                        Gỡ
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {locations.length === 0 ? (
              <Alert tone="warning">Chưa có địa điểm nào đang hoạt động để gán.</Alert>
            ) : (
              <>
                <SelectField
                  label="Gán thêm địa điểm"
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </SelectField>
                <label className="row" style={{ alignItems: "center", gap: "var(--space-1)" }}>
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={(event) => setIsDefault(event.target.checked)}
                    style={{ width: 20, height: 20 }}
                  />
                  <span className="field__label">Đặt làm địa điểm mặc định</span>
                </label>
                <Button onClick={() => void assign()} loading={busy} disabled={!locationId}>
                  Gán địa điểm
                </Button>
              </>
            )}

            {dialogError ? <Alert tone="danger">{dialogError}</Alert> : null}

            <DataList
              rows={[
                { key: "Email", value: selected.email },
                { key: "Mã nhân viên", value: selected.employee_code ?? "—" },
                { key: "Chức danh", value: selected.position ?? "—" },
              ]}
            />
          </div>
        </Dialog>
      ) : null}
    </ManagerShell>
  );
}
