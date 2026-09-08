"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "../../../components/AdminShell";
import { Alert, Card, LoadingRows } from "../../../components/ui";
import { api } from "../../../lib/api";
import { describeError } from "../../../lib/messages";
import { GROUPS, SCREENS } from "../../../lib/screens";

const ROLES = [
  { key: "MEMBER", label: "Thành viên" },
  { key: "MANAGER", label: "Người quản lý" },
  { key: "SUPER_ADMIN", label: "Quản trị hệ thống" },
];

interface Grid {
  roles: Record<string, Record<string, boolean>>;
  locked: Record<string, string[]>;
}

export default function AdminRolesPage() {
  const [grid, setGrid] = useState<Grid | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.adminPermissions();
      setGrid({ roles: result.roles, locked: result.locked });
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(role: string, screen: string, next: boolean) {
    setBusy(`${role}:${screen}`);
    setNotice(null);
    // Move the tick immediately, then put it back if the server refuses. A grid
    // that lags behind the click invites people to click twice.
    setGrid((current) =>
      current ? { ...current, roles: { ...current.roles, [role]: { ...current.roles[role], [screen]: next } } } : current,
    );
    try {
      await api.setPermission(role, screen, next);
      setError(null);
      setNotice(
        next
          ? "Đã mở mục này cho nhóm. Người đang đăng nhập sẽ thấy sau khi tải lại trang."
          : "Đã gỡ mục này khỏi nhóm.",
      );
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
            Tick vào ô để cho một nhóm mở mục tương ứng trong menu bên trái.
          </p>
        </div>
      </div>

      <Alert tone="info">
        Mở một mục chỉ cho phép vào màn hình đó. Dữ liệu hiện ra vẫn theo phạm vi của từng người:
        thành viên chỉ thấy bản ghi của chính mình, người quản lý thấy nhóm mình, quản trị hệ thống
        thấy tất cả.
      </Alert>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {grid === null ? (
        <LoadingRows count={8} />
      ) : (
        GROUPS.map((group) => (
          <Card title={group} key={group}>
            <div className="table-wrap">
              <table className="table table--matrix">
                <thead>
                  <tr>
                    <th>Mục trong menu</th>
                    {ROLES.map((role) => (
                      <th key={role.key}>{role.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SCREENS.filter((screen) => screen.group === group).map((screen) => (
                    <tr key={screen.key}>
                      <td data-label="Mục">
                        <p className="person__name">{screen.label}</p>
                        <p className="event__meta mono">{screen.href}</p>
                      </td>
                      {ROLES.map((role) => {
                        const locked = (grid.locked[role.key] ?? []).includes(screen.key);
                        const checked = grid.roles[role.key]?.[screen.key] ?? false;
                        return (
                          <td key={role.key} data-label={role.label}>
                            <label className="checkbox">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={locked || busy === `${role.key}:${screen.key}`}
                                onChange={(event) => void toggle(role.key, screen.key, event.target.checked)}
                                aria-label={`${role.label} xem ${screen.label}`}
                              />
                              {locked ? <span className="event__meta">Cố định</span> : null}
                            </label>
                          </td>
                        );
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
