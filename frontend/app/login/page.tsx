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

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("MEMBER");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const tokens = mode === "login" ? await api.login(email, password) : await api.register(email, password, role);
      writeTokens(tokens);
      router.replace("/");
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <h1 className="page-title">{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</h1>
      <p className="page-lead">
        {mode === "login"
          ? "Dùng tài khoản đã đăng ký để chấm công bằng khuôn mặt."
          : "Tài khoản MEMBER dùng để chấm công. Tài khoản MANAGER dùng để quản lý."}
      </p>

      <Card>
        <form className="stack" onSubmit={submit}>
          <Field
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            hint={mode === "register" ? "Dùng tên miền thật, ví dụ example.com." : undefined}
          />
          <Field
            label="Mật khẩu"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint={mode === "register" ? "Tối thiểu 8 ký tự, gồm cả chữ và số." : undefined}
          />
          {mode === "register" ? (
            <SelectField label="Vai trò" value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              <option value="MEMBER">MEMBER — chấm công</option>
              <option value="MANAGER">MANAGER — quản lý</option>
            </SelectField>
          ) : null}

          {error ? <Alert tone="danger">{error}</Alert> : null}

          <Button type="submit" loading={submitting} block>
            {mode === "login" ? "Đăng nhập" : "Đăng ký"}
          </Button>
        </form>
      </Card>

      <p className="page-lead">
        {mode === "login" ? "Chưa có tài khoản? " : "Đã có tài khoản? "}
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "Đăng ký ngay" : "Quay lại đăng nhập"}
        </button>
      </p>
    </AppShell>
  );
}
