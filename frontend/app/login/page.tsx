"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppShell } from "../../components/AppShell";
import { Alert, Button, Card, Field, SelectField } from "../../components/ui";
import { api } from "../../lib/api";
import { describeError } from "../../lib/messages";
import { writeTokens } from "../../lib/session";
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
  const [submitting, setSubmitting] = useState(false);

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
      <h1 className="page-title">{registering ? "Tạo tài khoản" : "Đăng nhập"}</h1>
      <p className="page-lead">
        {registering ? "MEMBER để chấm công, MANAGER để quản lý." : "Chấm công bằng khuôn mặt và GPS."}
      </p>

      <Card>
        <form className="stack" onSubmit={submit}>
          <SelectField
            label="Vai trò"
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
            style={registering ? undefined : { display: "none" }}
            aria-hidden={!registering}
          >
            <option value="MEMBER">MEMBER</option>
            <option value="MANAGER">MANAGER</option>
          </SelectField>

          <Field
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint={registering ? "Tối thiểu 8 ký tự, có chữ và số" : undefined}
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
                <div style={{ flex: "1 1 150px" }}>
                  <Field
                    label="Mã nhân viên"
                    maxLength={100}
                    placeholder="Tuỳ chọn"
                    value={profile.employee_code}
                    onChange={(event) => setProfileField("employee_code", event.target.value)}
                  />
                </div>
                <div style={{ flex: "1 1 150px" }}>
                  <Field
                    label="Bộ phận"
                    maxLength={150}
                    placeholder="Tuỳ chọn"
                    value={profile.department}
                    onChange={(event) => setProfileField("department", event.target.value)}
                  />
                </div>
              </div>
              <Field
                label="Chức danh"
                maxLength={150}
                placeholder="Tuỳ chọn"
                value={profile.position}
                onChange={(event) => setProfileField("position", event.target.value)}
              />
            </>
          ) : null}

          {error ? <Alert tone="danger">{error}</Alert> : null}

          <Button type="submit" loading={submitting} block>
            {registering ? "Đăng ký" : "Đăng nhập"}
          </Button>
        </form>
      </Card>

      <p className="page-lead">
        {registering ? "Đã có tài khoản? " : "Chưa có tài khoản? "}
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(registering ? "login" : "register");
            setError(null);
          }}
        >
          {registering ? "Đăng nhập" : "Đăng ký"}
        </button>
      </p>
    </AppShell>
  );
}
