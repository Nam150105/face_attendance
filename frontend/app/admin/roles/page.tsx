"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "../../../components/AdminShell";
import { Alert, Button, Card, LoadingRows } from "../../../components/ui";
import { api } from "../../../lib/api";
import { describeError } from "../../../lib/messages";
import { GROUPS, SCREENS } from "../../../lib/screens";

const ROLES = [
  { key: "MEMBER", label: "Thành viên" },
  { key: "MANAGER", label: "Người quản lý" },
  { key: "SUPER_ADMIN", label: "Quản trị hệ thống" },
];

const ACTIONS = [
  { key: "view", label: "Xem", hint: "Mở được mục này trong menu" },
  { key: "create", label: "Thêm", hint: "Tạo bản ghi mới" },
  { key: "edit", label: "Sửa", hint: "Thay đổi bản ghi đã có" },
  { key: "delete", label: "Xoá", hint: "Gỡ bản ghi" },
];

type Actions = Record<string, boolean>;
type Grid = { roles: Record<string, Record<string, Actions>>; locked: Record<string, string[]> };

interface DevicePolicy {
  role: string;
  allow_multiple_devices: boolean;
  active_sessions: number;
}

export default function AdminRolesPage() {
  const [grid, setGrid] = useState<Grid | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [devices, setDevices] = useState<DevicePolicy[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [result, policies] = await Promise.all([api.adminPermissions(), api.sessionPolicy()]);
      setGrid({ roles: result.roles, locked: result.locked });
      setDevices(policies);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  async function setDevicePolicy(role: string, allowMultiple: boolean) {
    setBusy(`device-${role}`);
    // Optimistic: the switch answers under the finger, and a refusal puts it
    // back where it was.
    setDevices((current) =>
      (current ?? []).map((row) =>
        row.role === role ? { ...row, allow_multiple_devices: allowMultiple } : row,
      ),
    );
    try {
      const result = await api.setSessionPolicy(role, allowMultiple);
      setError(null);
      setNotice(
        allowMultiple
          ? "Đã cho phép đăng nhập nhiều thiết bị cùng lúc."
          : result.sessions_closed > 0
            ? `Đã giới hạn một thiết bị. ${result.sessions_closed} phiên cũ đã bị đóng.`
            : "Đã giới hạn mỗi tài khoản một thiết bị.",
      );
      await load();
    } catch (cause) {
      setError(describeError(cause));
      await load();
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function restoreDefaults() {
    if (!window.confirm("Đưa toàn bộ bảng phân quyền về mặc định ban đầu? Mọi thay đổi bạn đã tick sẽ mất.")) {
      return;
    }
    setResetting(true);
    setNotice(null);
    try {
      const result = await api.resetPermissions();
      await load();
      setNotice(
        result.restored > 0
          ? `Đã đưa ${result.restored} ô về mặc định.`
          : "Bảng phân quyền vốn đã đúng mặc định, không có gì phải đổi.",
      );
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setResetting(false);
    }
  }

  async function toggle(role: string, screen: string, action: string, next: boolean) {
    setBusy(`${role}:${screen}:${action}`);
    setNotice(null);
    // Move the ticks immediately, then reload if the server refuses. Clearing
    // the view clears the rest, so mirror that here or the grid would show a
    // state the server does not hold.
    setGrid((current) => {
      if (!current) {
        return current;
      }
      const before = current.roles[role]?.[screen] ?? {};
      const after =
        action === "view" && !next
          ? { view: false, create: false, edit: false, delete: false }
          : { ...before, [action]: next };
      return {
        ...current,
        roles: { ...current.roles, [role]: { ...current.roles[role], [screen]: after } },
      };
    });
    try {
      await api.setPermission(role, screen, action, next);
      setError(null);
      setNotice("Đã lưu. Người đang đăng nhập sẽ thấy thay đổi sau khi tải lại trang.");
    } catch (cause) {
      setError(describeError(cause));
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Phân quyền</h1>
          <p className="page-lead">
            Với mỗi nhóm, chọn từng mục được xem, được thêm, được sửa và được xoá.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void restoreDefaults()} loading={resetting}>
          Khôi phục mặc định
        </Button>
      </div>

      <Alert tone="info">
        Bỏ tick <strong>Xem</strong> là mất luôn cả ba quyền còn lại — cho phép xoá thứ mình không
        nhìn thấy thì chỉ chuốc rắc rối. Quyền chỉ mở cửa màn hình, còn dữ liệu hiện ra vẫn theo
        phạm vi từng người: thành viên thấy phần của mình, người quản lý thấy nhóm mình, quản trị hệ
        thống thấy tất cả.
      </Alert>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card
        title="Đăng nhập trên bao nhiêu thiết bị"
        subtitle="Giới hạn một thiết bị là cách ngăn một người đưa tài khoản cho người khác chấm công hộ."
      >
        {devices === null ? (
          <LoadingRows count={3} />
        ) : (
          <div className="stack stack--tight">
            {ROLES.map((role) => {
              const policy = devices.find((row) => row.role === role.key);
              const multiple = policy?.allow_multiple_devices ?? true;
              return (
                <div className="line" key={role.key}>
                  <div className="line__body">
                    <p className="person__name">{role.label}</p>
                    <p className="event__meta">
                      {multiple
                        ? "Đăng nhập được ở nhiều máy cùng lúc"
                        : "Mở máy mới là máy cũ bị đẩy ra"}
                      {policy ? ` · ${policy.active_sessions} phiên đang mở` : ""}
                    </p>
                  </div>
                  <div className="segmented segmented--sm" role="group" aria-label={`Thiết bị cho ${role.label}`}>
                    <button
                      type="button"
                      className={multiple ? undefined : "is-active"}
                      aria-pressed={!multiple}
                      disabled={busy === `device-${role.key}`}
                      onClick={() => void setDevicePolicy(role.key, false)}
                    >
                      Một thiết bị
                    </button>
                    <button
                      type="button"
                      className={multiple ? "is-active" : undefined}
                      aria-pressed={multiple}
                      disabled={busy === `device-${role.key}`}
                      onClick={() => void setDevicePolicy(role.key, true)}
                    >
                      Nhiều thiết bị
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {grid === null ? (
        <LoadingRows count={8} />
      ) : (
        GROUPS.map((group) => (
          <Card title={group} key={group}>
            <p className="matrix-hint">Kéo ngang để xem cột Người quản lý và Quản trị hệ thống.</p>
            <div className="table-wrap">
              <table className="table table--matrix">
                <thead>
                  <tr>
                    <th rowSpan={2}>Mục trong menu</th>
                    {ROLES.map((role) => (
                      <th key={role.key} colSpan={ACTIONS.length} className="matrix__role">
                        {role.label}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {ROLES.flatMap((role) =>
                      ACTIONS.map((action) => (
                        <th key={`${role.key}-${action.key}`} className="matrix__action" title={action.hint}>
                          {action.label}
                        </th>
                      )),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {SCREENS.filter((screen) => screen.group === group).map((screen) => (
                    <tr key={screen.key}>
                      <td data-label="Mục">
                        <p className="person__name">{screen.label}</p>
                        <p className="event__meta mono">{screen.href}</p>
                      </td>
                      {ROLES.flatMap((role) => {
                        const locked = (grid.locked[role.key] ?? []).includes(screen.key);
                        const actions = grid.roles[role.key]?.[screen.key] ?? {};
                        return ACTIONS.map((action) => {
                          const checked = actions[action.key] ?? false;
                          // Nothing else can be granted until the screen itself is.
                          const needsView = action.key !== "view" && !actions.view;
                          return (
                            <td
                              key={`${role.key}-${action.key}`}
                              data-label={`${role.label} · ${action.label}`}
                              className="matrix__cell"
                            >
                              <label className="checkbox">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={
                                    (locked && action.key === "view") ||
                                    needsView ||
                                    busy === `${role.key}:${screen.key}:${action.key}`
                                  }
                                  onChange={(event) =>
                                    void toggle(role.key, screen.key, action.key, event.target.checked)
                                  }
                                  aria-label={`${role.label} ${action.label.toLowerCase()} ${screen.label}`}
                                />
                              </label>
                            </td>
                          );
                        });
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}
    </AdminShell>
  );
}
