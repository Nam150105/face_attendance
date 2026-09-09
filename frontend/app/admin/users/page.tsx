"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "../../../components/AdminShell";
import { Dialog } from "../../../components/Dialog";
import { SelectableTable } from "../../../components/SelectableTable";
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
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<string[] | null>(null);
  const [bulkReason, setBulkReason] = useState("");

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

  async function removeAccounts() {
    if (!removing) {
      return;
    }
    setBusy(true);
    setDialogError(null);
    try {
      for (const id of removing) {
        await api.adminDeleteUser(id, bulkReason.trim());
      }
      setNotice(`Đã xoá ${removing.length} tài khoản.`);
      setRemoving(null);
      setBulkReason("");
      setPicked(new Set());
      await load();
    } catch (cause) {
      setDialogError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  function open(user: AdminUser) {
    setSelected(user);
    setNewRole(user.role);
    setNewStatus(user.status);
    setNewPassword("");
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
        ) : (
          <SelectableTable
            rows={data?.items ?? []}
            idOf={(user) => user.id}
            selected={picked}
            onSelectedChange={setPicked}
            empty={<Empty>Không có tài khoản nào khớp.</Empty>}
            actions={(ids) => (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRemoving(ids);
                  setBulkReason("");
                  setDialogError(null);
                }}
                style={{ color: "var(--color-danger)" }}
              >
                Xoá {ids.length} tài khoản
              </Button>
            )}
            columns={[
              {
                key: "user",
                label: "Người dùng",
                render: (user) => (
                  <>
                    <p className="person__name">{user.full_name ?? user.email}</p>
                    {user.full_name ? <p className="event__meta">{user.email}</p> : null}
                  </>
                ),
              },
              {
                key: "role",
                label: "Vai trò",
                render: (user) => {
                  const meta = ROLE_LABEL[user.role] ?? { label: user.role, tone: "neutral" as const };
                  return <Badge tone={meta.tone}>{meta.label}</Badge>;
                },
              },
              {
                key: "status",
                label: "Trạng thái",
                render: (user) => (
                  <Badge tone={user.status === "ACTIVE" ? "success" : "warning"}>
                    {user.status === "ACTIVE" ? "Đang dùng được" : "Bị khoá"}
                  </Badge>
                ),
              },
              {
                key: "data",
                label: "Dữ liệu",
                numeric: true,
                render: (user) => (
                  <>
                    <p className="event__meta">{user.attendance_count} bản ghi</p>
                    {user.managed_members > 0 ? (
                      <p className="event__meta">Quản lý {user.managed_members} người</p>
                    ) : null}
                  </>
                ),
              },
              {
                key: "seen",
                label: "Đăng nhập gần nhất",
                render: (user) =>
                  user.last_login_at ? formatDateTime(user.last_login_at) : "Chưa bao giờ",
              },
              {
                key: "actions",
                label: "Thao tác",
                render: (user) => (
                  <Button size="sm" variant="secondary" onClick={() => open(user)}>
                    Quản lý
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {removing ? (
        <Dialog
          title={`Xoá ${removing.length} tài khoản`}
          onClose={() => setRemoving(null)}
        >
          <div className="stack">
            {dialogError ? <Alert tone="danger">{dialogError}</Alert> : null}
            <Alert tone="danger">
              Xoá là vĩnh viễn: mất toàn bộ bản ghi chấm công, ảnh và dữ liệu khuôn mặt của những
              người này.
            </Alert>
            <TextAreaField
              label="Lý do xoá"
              placeholder="Bắt buộc. Lý do này được lưu vào nhật ký."
              value={bulkReason}
              onChange={(event) => setBulkReason(event.target.value)}
            />
            <Button
              variant="danger"
              onClick={() => void removeAccounts()}
              loading={busy}
              disabled={bulkReason.trim().length < 3}
              block
            >
              Xoá vĩnh viễn
            </Button>
          </div>
        </Dialog>
      ) : null}

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

          </div>
        </Dialog>
      ) : null}
    </AdminShell>
  );
}
