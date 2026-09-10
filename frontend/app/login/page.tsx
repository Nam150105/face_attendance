"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { Alert, Button, Card, Field, SelectField } from "../../components/ui";
import { api } from "../../lib/api";
import { describeCode, describeError } from "../../lib/messages";
import { landingScreen } from "../../lib/screens";
import { takeSessionEndedReason, writeTokens } from "../../lib/session";
import type { UserRole } from "../../lib/types";

type Mode = "login" | "register";

const EMPTY_PROFILE = {
  full_name: "",
  phone: "",
  employee_code: "",
  position: "",
};

/**
 * What a stranger sees first.
 *
 * The form is the point of the page, so it stays at the top and stays short.
 * Below it: what the system does, and which libraries read the face. Naming the
 * recognition stack is deliberate — people are being asked to hand over their
 * face, and the least the page can do is say what will read it. Infrastructure
 * is left out on purpose: it would tell an attacker what to try and tells a
 * visitor nothing.
 */
const PIPELINE = [
  {
    library: "OpenCV",
    role: "Đọc ảnh, đo độ nét và độ sáng, tự bù sáng khi chỗ chụp thiếu đèn. Ảnh không đạt bị loại ngay tại đây.",
  },
  {
    library: "face_recognition · dlib",
    role: "Tìm khuôn mặt trong ảnh, đặt điểm mốc, rồi quy khuôn mặt thành một vector 128 chiều.",
  },
  {
    library: "So khớp",
    role: "So hai vector bằng khoảng cách Euclid. Càng gần 0 càng giống; quá ngưỡng thì hệ thống coi là người khác.",
  },
];

const WHAT_IT_DOES = [
  "Chấm công bằng ảnh chụp tại chỗ, không nhận ảnh có sẵn trong máy.",
  "Kiểm tra vị trí theo bán kính quanh địa điểm làm việc, tính lại ở máy chủ.",
  "Giờ làm việc theo từng địa điểm, có mức cho phép đến muộn.",
  "Người quản lý duyệt thành viên, duyệt chỉnh công và duyệt đổi ảnh khuôn mặt.",
];

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("MEMBER");
  const [teamCode, setTeamCode] = useState("");
  const [teamName, setTeamName] = useState<string | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
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

  /**
   * Confirm the code before the account exists.
   *
   * Typing a code wrong and finding out only after signing up leaves somebody
   * inside the app with no team and no idea why. Naming the unit back to them
   * takes one request and removes the whole class of confusion.
   */
  async function checkCode(value: string) {
    const code = value.trim();
    setTeamCode(code);
    setTeamName(null);
    setTeamError(null);
    if (code.length < 3) {
      return;
    }
    try {
      const team = await api.lookupTeam(code);
      setTeamName(`${team.name} · ${team.manager_name}`);
    } catch {
      setTeamError("Không tìm thấy đơn vị nào dùng mã này. Bạn hỏi lại người quản lý nhé.");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        writeTokens(await api.login(email, password));
        // Land on the first thing this account can actually do, rather than a
        // fixed page it may not be allowed to open.
        const access = await api.myScreens();
        router.replace(landingScreen(access.screens, access.role));
        return;
      }

      writeTokens(await api.register(email, password, role, teamCode.trim() || undefined));
      await api.updateMemberProfile({
        full_name: profile.full_name.trim(),
        phone: profile.phone.trim() || null,
        employee_code: profile.employee_code.trim() || null,
        position: profile.position.trim() || null,
        // The unit comes from the approved team code, never typed here.
        department: null,
      });
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

          {registering ? (
            <Field
              label="Mã đơn vị / nhóm"
              placeholder="Người quản lý cho bạn mã này"
              value={teamCode}
              onChange={(event) => void checkCode(event.target.value)}
              hint={
                teamName
                  ? `Bạn sẽ xin vào: ${teamName}`
                  : teamError ?? "Có thể để trống và nhập sau, nhưng phải có thì mới chấm công được."
              }
            />
          ) : null}

          {registering ? (
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
                    label="Chức danh"
                    maxLength={150}
                    placeholder="Chuyên viên / Giảng viên / Học viên"
                    value={profile.position}
                    onChange={(event) => setProfileField("position", event.target.value)}
                  />
                </div>
              </div>
            </>
          ) : null}

          {notice ? <Alert tone="warning">{notice}</Alert> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <Button type="submit" size="lg" loading={submitting} block>
            {registering ? "Tạo tài khoản" : "Đăng nhập"}
          </Button>
        </form>
      </Card>

      <section className="intro">
        <div className="intro__block">
          <h2 className="intro__title">Hệ thống này làm gì</h2>
          <ul className="intro__list">
            {WHAT_IT_DOES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div className="intro__block">
          <h2 className="intro__title">Khuôn mặt của bạn được đọc bằng gì</h2>
          <ol className="intro__steps">
            {PIPELINE.map((step, index) => (
              <li key={step.library}>
                <span className="intro__step">{index + 1}</span>
                <span>
                  <strong>{step.library}</strong>
                  <span className="intro__role">{step.role}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="intro__note">
            Ảnh khuôn mặt và ảnh chấm công nằm trong kho lưu trữ riêng, không có đường dẫn công khai.
            Mọi quyết định về vị trí và khuôn mặt do máy chủ tính, không tin dữ liệu thiết bị gửi lên.
          </p>
        </div>
      </section>
    </AppShell>
  );
}
