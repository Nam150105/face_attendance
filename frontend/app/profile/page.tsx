"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { Alert, Badge, Button, Card, Field, LoadingRows } from "../../components/ui";
import { api } from "../../lib/api";
import { formatDateTime } from "../../lib/geo";
import { describeError } from "../../lib/messages";
import type { CurrentUser, FaceEnrollmentStatus, MemberProfile } from "../../lib/types";

const EMPTY = { full_name: "", phone: "", employee_code: "", position: "" };

interface ManagerContact {
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  position: string | null;
  department: string | null;
}

/** Label above, value below: a two-column table wastes half the width on air. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="detail">
      <span className="detail__label">{label}</span>
      <span className="detail__value">{children}</span>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [face, setFace] = useState<FaceEnrollmentStatus | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [managers, setManagers] = useState<ManagerContact[]>([]);
  const [joinRequests, setJoinRequests] = useState<
    { status: string; team_name: string | null; note: string | null; manager_name: string }[]
  >([]);

  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    api.myManagers().then(setManagers).catch(() => setManagers([]));
    api.myJoinRequests().then(setJoinRequests).catch(() => setJoinRequests([]));
    api.myFacePhoto().then(setPhoto).catch(() => setPhoto(null));
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
      });
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.updateMemberProfile({
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        employee_code: form.employee_code.trim() || null,
        position: form.position.trim() || null,
        department: profile?.department ?? null,
      });
      setNotice("Đã lưu thông tin.");
      setEditing(false);
      await load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  async function joinTeam(event: React.FormEvent) {
    event.preventDefault();
    setJoining(true);
    try {
      const result = await api.joinTeam(joinCode.trim());
      setNotice(`Đã gửi yêu cầu vào ${result.team}. Chờ người quản lý duyệt.`);
      setJoinCode("");
      setJoinRequests(await api.myJoinRequests());
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setJoining(false);
    }
  }

  if (!profile) {
    return (
      <AppShell wide>
        {error ? <Alert tone="danger">{error}</Alert> : <LoadingRows count={4} />}
      </AppShell>
    );
  }

  return (
    <AppShell wide>
      <div className="page-header">
        <div>
          <h1 className="page-title">Hồ sơ</h1>
          <p className="page-lead">Thông tin của bạn và những gì liên quan tới tài khoản.</p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="profile-grid">
        <Card
          title="Thông tin cá nhân"
          action={
            !editing ? (
              <button
                type="button"
                className="icon-button"
                onClick={() => setEditing(true)}
                aria-label="Chỉnh sửa thông tin cá nhân"
                title="Chỉnh sửa"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            ) : null
          }
        >
          {editing ? (
            <form className="stack" onSubmit={save}>
              <Field
                label="Họ và tên"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
              <div className="field-pair">
                <Field
                  label="Số điện thoại"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
                <Field
                  label="Mã định danh"
                  value={form.employee_code}
                  onChange={(e) => setForm({ ...form, employee_code: e.target.value })}
                />
              </div>
              <Field
                label="Chức danh"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
              />
              <p className="field__hint">
                Đơn vị / nhóm do người quản lý quyết định khi duyệt bạn vào.
              </p>
              <div className="row">
                <Button type="submit" size="sm" loading={saving}>
                  Lưu
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
                  Huỷ
                </Button>
              </div>
            </form>
          ) : (
            <div className="profile-head">
              {photo ? (
                <img src={photo} alt="Ảnh khuôn mặt đã đăng ký" className="profile-head__photo" />
              ) : (
                <div className="profile-head__photo profile-head__photo--empty">Chưa có ảnh</div>
              )}
              <div className="detail-grid">
                <Detail label="Họ và tên">{profile.full_name ?? "Chưa cập nhật"}</Detail>
                <Detail label="Email">{profile.email}</Detail>
                <Detail label="Điện thoại">{profile.phone ?? "Chưa cập nhật"}</Detail>
                <Detail label="Chức danh">{profile.position ?? "Chưa cập nhật"}</Detail>
                <Detail label="Đơn vị / Nhóm">{profile.department ?? "Chưa thuộc nhóm nào"}</Detail>
                <Detail label="Mã định danh">{profile.employee_code ?? "Chưa cập nhật"}</Detail>
              </div>
            </div>
          )}
        </Card>

        <Card title="Khuôn mặt">
          <div className="detail-grid">
            <Detail label="Trạng thái">
              <Badge tone={face?.enrolled ? "success" : "warning"}>
                {face?.enrolled ? "Đã đăng ký" : "Chưa đăng ký"}
              </Badge>
            </Detail>
            <Detail label="Đăng ký lúc">
              {face?.enrolled_at ? formatDateTime(face.enrolled_at) : "—"}
            </Detail>
          </div>
          <Button
            size="sm"
            variant={face?.enrolled ? "secondary" : "primary"}
            onClick={() => router.push("/enroll")}
          >
            {face?.enrolled ? "Xin đổi ảnh khuôn mặt" : "Đăng ký khuôn mặt"}
          </Button>
        </Card>

        {managers.length > 0 ? (
          <Card title={managers.length > 1 ? "Người quản lý bạn" : "Người quản lý của bạn"}>
            <div className="stack stack--tight">
              {managers.map((manager) => (
                <div className="contact" key={manager.user_id}>
                  <div className="contact__body">
                    <p className="person__name">{manager.full_name ?? manager.email}</p>
                    <p className="event__meta">
                      {[manager.position, manager.department].filter(Boolean).join(" · ") ||
                        "Người quản lý"}
                    </p>
                  </div>
                  <div className="contact__links">
                    <a className="contact__link" href={`mailto:${manager.email}`}>
                      Gửi mail
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
        ) : (
          <Card title="Bạn chưa thuộc nhóm nào">
            <form className="stack" onSubmit={joinTeam}>
              {joinRequests.map((request, index) => (
                <Alert key={index} tone={request.status === "PENDING" ? "info" : "warning"}>
                  {request.status === "PENDING"
                    ? `Đang chờ ${request.manager_name} duyệt vào ${request.team_name ?? "nhóm"}.`
                    : `${request.manager_name} chưa duyệt${request.note ? `: ${request.note}` : "."}`}
                </Alert>
              ))}
              <Field
                label="Mã đơn vị / nhóm"
                placeholder="Người quản lý cho bạn mã này"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
              />
              <Button type="submit" size="sm" loading={joining} disabled={joinCode.trim().length < 3}>
                Gửi yêu cầu
              </Button>
            </form>
          </Card>
        )}

        <details className="disclosure">
          <summary>Bảo mật tài khoản</summary>
          <Card>
            <div className="detail-grid">
              <Detail label="Tài khoản">
                <Badge tone={user?.status === "ACTIVE" ? "success" : "warning"}>
                  {user?.status === "ACTIVE" ? "Đang hoạt động" : (user?.status ?? "—")}
                </Badge>
              </Detail>
            </div>
            <Button size="sm" variant="secondary" onClick={() => router.push("/profile/password")}>
              Đổi mật khẩu
            </Button>
          </Card>
        </details>
      </div>
    </AppShell>
  );
}
