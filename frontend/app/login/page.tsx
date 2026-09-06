"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { Alert, Button, Card, Field, SelectField } from "../../components/ui";
import { api } from "../../lib/api";
import { describeCode, describeError } from "../../lib/messages";
import { takeSessionEndedReason, writeTokens } from "../../lib/session";
import type { UserRole } from "../../lib/types";

type Mode = "login" | "register";

const EMPTY_PROFILE = {
  full_name: "",
  phone: "",
  employee_code: "",
  position: "",
  department: "",
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("MEMBER");
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Set by the API client when the server closed the session mid-use.
    const reason = takeSessionEndedReason();
    if (reason) {
      setNotice(describeCode(reason));
    }
  }, []);

  function setProfileField(key: keyof typeof EMPTY_PROFILE, value: string) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        writeTokens(await api.login(email, password));
        router.replace("/");
        return;
      }

      writeTokens(await api.register(email, password, role));
      if (role === "MEMBER") {
        await api.updateMemberProfile({
          full_name: profile.full_name.trim(),
          phone: profile.phone.trim() || null,
          employee_code: profile.employee_code.trim() || null,
          position: profile.position.trim() || null,
          department: profile.department.trim() || null,
        });
      }
      router.replace(role === "MEMBER" ? "/enroll" : "/manager");
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  const registering = mode === "register";

  return (
    <AppShell>
      <div style={{ textAlign: "center", marginBottom: "var(--space-3)" }}>
        <h1 className="page-title" style={{ fontSize: "var(--text-3xl)", marginBottom: "6px" }}>
          {registering ? "Tạo tài khoản" : "Đăng nhập"}
        </h1>
        <p className="page-lead">
          {registering
            ? "Chọn loại tài khoản phù hợp với vai trò của bạn trong tổ chức."
            : "Quản lý hiện diện bằng nhận diện khuôn mặt và xác thực vị trí."}
        </p>

        {/* Mode Switcher Tabs */}
        <div
          style={{
            display: "inline-flex",
            background: "var(--surface-panel)",
            padding: "4px",
            borderRadius: "var(--radius-full)",
            border: "1px solid var(--border-subtle)",
            marginBottom: "var(--space-2)",
          }}
        >
          <button
            type="button"
            className={`pill-chip ${!registering ? "pill-chip--active" : ""}`}
            style={{ border: "none", padding: "8px 22px" }}
            onClick={() => {
              setMode("login");
              setError(null);
            }}
          >
            Đăng nhập
          </button>
          <button
            type="button"
            className={`pill-chip ${registering ? "pill-chip--active" : ""}`}
            style={{ border: "none", padding: "8px 22px" }}
            onClick={() => {
              setMode("register");
              setError(null);
            }}
          >
            Tạo tài khoản
          </button>
        </div>
      </div>

      <Card glow>
        <form className="stack" onSubmit={submit}>
          {registering ? (
            <SelectField
              label="Loại tài khoản"
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
              hint={
                role === "MEMBER"
                  ? "Người tự check-in / check-out bằng khuôn mặt và vị trí."
                  : "Người thiết lập địa điểm, quản lý danh sách và duyệt bản ghi."
              }
            >
              <option value="MEMBER">Thành viên (MEMBER)</option>
              <option value="MANAGER">Quản trị viên (MANAGER)</option>
            </SelectField>
          ) : null}

          <Field
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="ten.ban@tochuc.vn"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <Field
            label="Mật khẩu"
            type="password"
            autoComplete={registering ? "new-password" : "current-password"}
            required
            minLength={8}
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint={registering ? "Tối thiểu 8 ký tự, nên có cả chữ và số." : undefined}
          />

          {registering && role === "MEMBER" ? (
            <>
              <hr className="divider" />
              <Field
                label="Họ và tên"
                autoComplete="name"
                required
                maxLength={200}
                placeholder="Nguyễn Văn A"
                value={profile.full_name}
                onChange={(event) => setProfileField("full_name", event.target.value)}
              />
              <Field
                label="Số điện thoại"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={50}
                placeholder="0901234567"
                value={profile.phone}
                onChange={(event) => setProfileField("phone", event.target.value)}
              />
              <div className="row">
                <div style={{ flex: "1 1 140px" }}>
                  <Field
                    label="Mã định danh"
                    maxLength={100}
                    placeholder="NV-0123 / SV-24001"
                    value={profile.employee_code}
                    onChange={(event) => setProfileField("employee_code", event.target.value)}
                  />
                </div>
                <div style={{ flex: "1 1 140px" }}>
                  <Field
                    label="Đơn vị / Nhóm"
                    maxLength={150}
                    placeholder="Phòng Kỹ thuật / Lớp 12A1"
                    value={profile.department}
                    onChange={(event) => setProfileField("department", event.target.value)}
                  />
                </div>
              </div>
              <Field
                label="Chức danh"
                maxLength={150}
                placeholder="Chuyên viên / Giảng viên / Học viên"
                value={profile.position}
                onChange={(event) => setProfileField("position", event.target.value)}
              />
            </>
          ) : null}

          {notice ? <Alert tone="warning">{notice}</Alert> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <Button type="submit" size="lg" loading={submitting} block>
            {registering ? "Tạo tài khoản" : "Đăng nhập"}
          </Button>
        </form>
      </Card>

      <div style={{ textAlign: "center", marginTop: "var(--space-2)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
        🔒 Dữ liệu khuôn mặt được lưu dưới dạng đặc trưng đã mã hoá và chỉ dùng để đối chiếu khi bạn check-in.
      </div>
    </AppShell>
  );
}
