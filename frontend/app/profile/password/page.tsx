"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppShell } from "../../../components/AppShell";
import { Alert, Button, Card, Field } from "../../../components/ui";
import { api } from "../../../lib/api";
import { describeError } from "../../../lib/messages";

/** Its own screen: a password form has nothing to do with a phone number, and
 *  putting them together made the profile a wall to scroll past. */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (next !== repeat) {
      setError("Hai ô mật khẩu mới chưa giống nhau.");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      router.replace("/login");
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Đổi mật khẩu</h1>
          <p className="page-lead">Đổi xong, mọi thiết bị đang đăng nhập sẽ phải đăng nhập lại.</p>
        </div>
      </div>

      <Card>
        <form className="stack" onSubmit={submit}>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field
            label="Mật khẩu hiện tại"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
          <Field
            label="Mật khẩu mới"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            hint="Tối thiểu 8 ký tự, có cả chữ và số."
          />
          <Field
            label="Nhập lại mật khẩu mới"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
          />
          <div className="row">
            <Button type="submit" loading={busy} disabled={!current || next.length < 8}>
              Đổi mật khẩu
            </Button>
            <Button variant="secondary" onClick={() => router.push("/profile")}>
              Quay lại
            </Button>
          </div>
        </form>
      </Card>
    </AppShell>
  );
}
