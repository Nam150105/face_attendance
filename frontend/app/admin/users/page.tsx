"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "../../../components/AdminShell";
import { Dialog } from "../../../components/Dialog";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataList,
  Empty,
  Field,
  LoadingRows,
  SelectField,
  TextAreaField,
} from "../../../components/ui";
import { api } from "../../../lib/api";
import { formatDateTime } from "../../../lib/geo";
import { describeError } from "../../../lib/messages";
import type { AdminUser, AdminUsersResponse } from "../../../lib/types";

const ROLE_LABEL: Record<string, { label: string; tone: "info" | "warning" | "danger" | "neutral" }> = {
  MEMBER: { label: "Thành viên", tone: "neutral" },
  MANAGER: { label: "Người quản lý", tone: "info" },
  SUPER_ADMIN: { label: "Quản trị hệ thống", tone: "danger" },
};

export default function AdminUsersPage() {
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [newRole, setNewRole] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(null);
    try {
      setData(await api.adminUsers({ search: search || undefined, role: role || undefined }));
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
      setData({ total: 0, items: [] });
    }
  }, [search, role]);

  useEffect(() => {
    void load();
  }, [load]);

  function open(user: AdminUser) {
    setSelected(user);
    setNewRole(user.role);
    setNewStatus(user.status);
    setNewPassword("");
    setDeleteReason("");
    setDialogError(null);
  }

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setDialogError(null);
    try {
      await action();
      setNotice(message);
      setSelected(null);
      await load();
    } catch (cause) {
      setDialogError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tài khoản</h1>
          <p className="page-lead">Toàn bộ người dùng của hệ thống, không phân biệt người quản lý nào.</p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card className="filter-card">
        <div className="filters-bar filters-bar--compact">
          <Field
            label="Tìm theo tên hoặc email"
            placeholder="Nhập rồi nhấn Enter"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <SelectField label="Vai trò" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Tất cả vai trò</option>
            <option value="MEMBER">Thành viên</option>
            <option value="MANAGER">Người quản lý</option>
            <option value="SUPER_ADMIN">Quản trị hệ thống</option>
          </SelectField>
        </div>
      </Card>

      <Card title={data ? `Danh sách (${data.total})` : "Danh sách"}>
        {data === null && !error ? (
          <LoadingRows count={5} />
        ) : data && data.items.length === 0 ? (
          <Empty>Không có tài khoản nào khớp.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Người dùng</th>
                  <th>Vai trò</th>
                  <th>Trạng thái</th>
                  <th>Dữ liệu</th>
                  <th>Đăng nhập gần nhất</th>
                  <th aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((user) => {
                  const meta = ROLE_LABEL[user.role] ?? { label: user.role, tone: "neutral" as const };
                  return (
                    <tr key={user.id}>
                      <td data-label="Người dùng">
                        <p className="person__name">{user.full_name ?? user.email}</p>
                        {user.full_name ? <p className="event__meta">{user.email}</p> : null}
                      </td>
                      <td data-label="Vai trò">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td data-label="Trạng thái">
                        <Badge tone={user.status === "ACTIVE" ? "success" : "warning"}>
                          {user.status === "ACTIVE" ? "Đang dùng được" : "Bị khoá"}
                        </Badge>
                      </td>
                      <td data-label="Dữ liệu">
                        <p className="event__meta">{user.attendance_count} bản ghi chấm công</p>
                        {user.managed_members > 0 ? (
                          <p className="event__meta">Quản lý {user.managed_members} người</p>
                        ) : null}
                      </td>
                      <td data-label="Đăng nhập gần nhất">
                        {user.last_login_at ? formatDateTime(user.last_login_at) : "Chưa bao giờ"}
                      </td>
                      <td data-label="Thao tác">
                        <Button size="sm" variant="secondary" onClick={() => open(user)}>
                          Quản lý
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected ? (
        <Dialog title={selected.full_name ?? selected.email} onClose={() => setSelected(null)}>
          <div className="stack">
            {dialogError ? <Alert tone="danger">{dialogError}</Alert> : null}

            <DataList
              rows={[
                { key: "Email", value: selected.email },
                { key: "Mã định danh", value: selected.employee_code ?? "Chưa có" },
                { key: "Tạo lúc", value: formatDateTime(selected.created_at) },
                { key: "Bản ghi chấm công", value: `${selected.attendance_count}` },
              ]}
            />

            <hr className="divider" />

            <div className="field-pair">
              <SelectField label="Vai trò" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                <option value="MEMBER">Thành viên</option>
                <option value="MANAGER">Người quản lý</option>
                <option value="SUPER_ADMIN">Quản trị hệ thống</option>
              </SelectField>
              <SelectField label="Trạng thái" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                <option value="ACTIVE">Đang dùng được</option>
                <option value="SUSPENDED">Khoá tài khoản</option>
              </SelectField>
            </div>
            <p className="field__hint">
              Đổi vai trò hoặc khoá tài khoản sẽ đăng xuất người này khỏi mọi thiết bị ngay lập tức.
            </p>
            <Button
              onClick={() =>
                void run(
                  () => api.adminUpdateUser(selected.id, { role: newRole, status: newStatus }),
                  "Đã cập nhật tài khoản.",
                )
              }
              loading={busy}
              disabled={newRole === selected.role && newStatus === selected.status}
              block
            >
              Lưu thay đổi
            </Button>

            <hr className="divider" />

            <Field
              label="Đặt lại mật khẩu"
              type="password"
              placeholder="Mật khẩu mới, tối thiểu 8 ký tự"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              hint="Người dùng sẽ bị đăng xuất và phải đăng nhập lại bằng mật khẩu mới."
            />
            <Button
              variant="secondary"
              onClick={() =>
                void run(
                  () => api.adminResetPassword(selected.id, newPassword),
                  "Đã đặt lại mật khẩu.",
                )
              }
              loading={busy}
              disabled={newPassword.trim().length < 8}
              block
            >
              Đặt lại mật khẩu
            </Button>

            <hr className="divider" />

            <TextAreaField
              label="Lý do xoá tài khoản"
              placeholder="Bắt buộc. Lý do này được lưu vào nhật ký."
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
            />
            <Alert tone="danger">
              Xoá tài khoản là vĩnh viễn: mất toàn bộ bản ghi chấm công, ảnh và dữ liệu khuôn mặt của người này.
            </Alert>
            <Button
              variant="danger"
              onClick={() => {
                if (!window.confirm(`Xoá vĩnh viễn ${selected.email}? Không hoàn tác được.`)) {
                  return;
                }
                void run(() => api.adminDeleteUser(selected.id, deleteReason), "Đã xoá tài khoản.");
              }}
              loading={busy}
              disabled={deleteReason.trim().length < 3}
              block
            >
              Xoá tài khoản này
            </Button>
          </div>
        </Dialog>
      ) : null}
    </AdminShell>
  );
}
