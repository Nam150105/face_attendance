"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { Alert, Badge, Button, Card, DataList, Field, LoadingRows } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { formatDateTime } from "../../lib/geo";
import { describeError } from "../../lib/messages";
import type { CurrentUser, FaceEnrollmentStatus, MemberProfile } from "../../lib/types";

const EMPTY = { full_name: "", phone: "", employee_code: "", position: "", department: "" };

interface ManagerContact {
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  position: string | null;
  department: string | null;
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [face, setFace] = useState<FaceEnrollmentStatus | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [managers, setManagers] = useState<ManagerContact[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [joinRequests, setJoinRequests] = useState<
    { status: string; team_name: string | null; note: string | null; manager_name: string }[]
  >([]);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const load = useCallback(async () => {
    api
      .myManagers()
      .then(setManagers)
      .catch(() => setManagers([]));
    api
      .myJoinRequests()
      .then(setJoinRequests)
      .catch(() => setJoinRequests([]));
    try {
      const [me, myProfile, faceStatus] = await Promise.all([
        api.me(),
        api.memberProfile(),
        api.faceStatus(),
      ]);
      setUser(me);
      setProfile(myProfile);
      setFace(faceStatus);
      setForm({
        full_name: myProfile.full_name ?? "",
        phone: myProfile.phone ?? "",
        employee_code: myProfile.employee_code ?? "",
        position: myProfile.position ?? "",
        department: myProfile.department ?? "",
      });
    } catch (cause) {
      if (cause instanceof ApiError && cause.statusCode === 401) {
        router.replace("/login");
        return;
      }
      setError(describeError(cause));
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function joinTeam(event: React.FormEvent) {
    event.preventDefault();
    setJoinError(null);
    setJoining(true);
    try {
      const result = await api.joinTeam(joinCode.trim());
      setNotice(`Đã gửi yêu cầu vào ${result.team}. Chờ người quản lý duyệt là bạn chấm công được.`);
      setJoinCode("");
      setJoinRequests(await api.myJoinRequests());
    } catch (cause) {
      setJoinError(describeError(cause));
    } finally {
      setJoining(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    if (newPassword !== repeatPassword) {
      setPasswordError("Hai ô mật khẩu mới chưa giống nhau.");
      return;
    }
    setChanging(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      // Every session just ended, this one included, so send them to sign in
      // again rather than leaving a page whose next request will fail.
      router.replace("/login");
    } catch (cause) {
      setPasswordError(describeError(cause));
    } finally {
      setChanging(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.updateMemberProfile({
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        employee_code: form.employee_code.trim() || null,
        position: form.position.trim() || null,
        department: form.department.trim() || null,
      });
      setProfile(updated);
      setEditing(false);
      setNotice("Đã lưu thay đổi hồ sơ.");
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell email={user?.email} wide>

      <div className="page-header">
        <div>
          <h1 className="page-title">Hồ sơ cá nhân</h1>
          <p className="page-lead">Thông tin của bạn và trạng thái dữ liệu khuôn mặt.</p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card
        title="Thông tin cá nhân"
        action={
          !editing && profile ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Chỉnh sửa
            </Button>
          ) : null
        }
      >
        {profile === null && !error ? (
          <LoadingRows count={4} />
        ) : editing ? (
          <form className="stack" onSubmit={save}>
            <Field
              label="Họ và tên"
              required
              maxLength={200}
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
            <Field
              label="Số điện thoại"
              type="tel"
              inputMode="tel"
              maxLength={50}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <div className="row">
              <div style={{ flex: "1 1 160px" }}>
                <Field
                  label="Mã định danh"
                  maxLength={100}
                  value={form.employee_code}
                  onChange={(e) => setForm({ ...form, employee_code: e.target.value })}
                />
              </div>
              <div style={{ flex: "1 1 160px" }}>
                <Field
                  label="Chức danh"
                  maxLength={150}
                  value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                />
              </div>
            </div>
            <p className="field__hint">
              Đơn vị / nhóm do người quản lý quyết định khi duyệt bạn vào, nên không sửa ở đây.
            </p>
            <div className="row">
              <Button type="submit" loading={saving} block>
                Lưu thay đổi
              </Button>
              <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving} block>
                Huỷ
              </Button>
            </div>
          </form>
        ) : profile ? (
          <DataList
            rows={[
              { key: "Họ và tên", value: profile.full_name ?? "Chưa cập nhật" },
              { key: "Email", value: profile.email },
              { key: "Số điện thoại", value: profile.phone ?? "Chưa cập nhật" },
              { key: "Chức danh", value: profile.position ?? "Chưa cập nhật" },
              { key: "Đơn vị / Nhóm", value: profile.department ?? "Chưa thuộc nhóm nào" },
              { key: "Mã định danh", value: profile.employee_code ?? "Chưa cập nhật" },
              {
                key: "Trạng thái tài khoản",
                value: (
                  <Badge tone={profile.status === "ACTIVE" ? "success" : "warning"}>
                    {profile.status === "ACTIVE" ? "Đang hoạt động" : profile.status}
                  </Badge>
                ),
              },
            ]}
          />
        ) : null}
      </Card>

      {managers.length === 0 ? (
        <Card
          title="Bạn chưa thuộc nhóm nào"
          subtitle="Nhập mã đơn vị người quản lý đưa cho bạn. Được duyệt là chấm công được ngay."
        >
          <form className="stack" onSubmit={joinTeam}>
            {joinError ? <Alert tone="danger">{joinError}</Alert> : null}
            {joinRequests.map((request, index) => (
              <Alert key={index} tone={request.status === "PENDING" ? "info" : "warning"}>
                {request.status === "PENDING"
                  ? `Đang chờ ${request.manager_name} duyệt vào ${request.team_name ?? "nhóm"}.`
                  : `${request.manager_name} chưa duyệt bạn vào ${request.team_name ?? "nhóm"}${
                      request.note ? `: ${request.note}` : "."
                    }`}
              </Alert>
            ))}
            <Field
              label="Mã đơn vị / nhóm"
              placeholder="Ví dụ: K7M2PX"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value)}
            />
            <Button type="submit" loading={joining} disabled={joinCode.trim().length < 3} block>
              Gửi yêu cầu vào nhóm
            </Button>
          </form>
        </Card>
      ) : null}

      {managers.length > 0 ? (
        <Card
          title={managers.length > 1 ? "Những người quản lý bạn" : "Người quản lý của bạn"}
          subtitle="Có gì chưa đúng về giờ giấc hay chấm công, bạn liên hệ trực tiếp ở đây."
        >
          <div className="stack stack--tight">
            {managers.map((manager) => (
              <div className="contact" key={manager.user_id}>
                <div className="contact__body">
                  <p className="person__name">{manager.full_name ?? manager.email}</p>
                  <p className="event__meta">
                    {[manager.position, manager.department].filter(Boolean).join(" · ") || "Người quản lý"}
                  </p>
                </div>
                <div className="contact__links">
                  <a className="contact__link" href={`mailto:${manager.email}`}>
                    {manager.email}
                  </a>
                  {manager.phone ? (
                    <a className="contact__link" href={`tel:${manager.phone}`}>
                      {manager.phone}
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card
        title="Đổi mật khẩu"
        subtitle="Sau khi đổi, mọi thiết bị đang đăng nhập sẽ phải đăng nhập lại."
      >
        <form className="stack" onSubmit={changePassword}>
          {passwordError ? <Alert tone="danger">{passwordError}</Alert> : null}
          <Field
            label="Mật khẩu hiện tại"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <Field
            label="Mật khẩu mới"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            hint="Tối thiểu 8 ký tự, có cả chữ và số."
          />
          <Field
            label="Nhập lại mật khẩu mới"
            type="password"
            autoComplete="new-password"
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
          />
          <Button type="submit" loading={changing} block>
            Đổi mật khẩu
          </Button>
        </form>
      </Card>

      <Card
        title="Dữ liệu khuôn mặt"
        subtitle="Dùng để đối chiếu mỗi lần check-in và check-out."
        action={
          face ? (
            <Badge tone={face.enrolled ? "success" : "warning"}>
              {face.enrolled ? "Đã đăng ký" : "Chưa đăng ký"}
            </Badge>
          ) : null
        }
      >
        {face === null && !error ? (
          <LoadingRows count={2} />
        ) : (
          <div className="stack">
            <DataList
              rows={[
                {
                  key: "Trạng thái",
                  value: face?.enrolled ? "Đã có dữ liệu đối chiếu" : "Chưa có dữ liệu",
                },
                {
                  key: "Thời điểm đăng ký",
                  value: face?.enrolled_at ? formatDateTime(face.enrolled_at) : "—",
                },
              ]}
            />
            {!face?.enrolled ? (
              <Alert tone="warning">Bạn cần đăng ký khuôn mặt trước khi có thể check-in.</Alert>
            ) : null}
            <Button variant={face?.enrolled ? "secondary" : "primary"} onClick={() => router.push("/enroll")} block>
              {face?.enrolled ? "Đăng ký lại khuôn mặt" : "Đăng ký khuôn mặt"}
            </Button>
            {face?.enrolled ? (
              <p className="field__hint">
                Đăng ký lại sẽ thay thế dữ liệu cũ và được ghi vào nhật ký hoạt động.
              </p>
            ) : null}
          </div>
        )}
      </Card>
    </AppShell>
  );
}
