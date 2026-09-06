"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { MemberNav } from "../../components/MemberNav";
import { Alert, Badge, Button, Card, DataList, Field, LoadingRows } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { formatDateTime } from "../../lib/geo";
import { describeError } from "../../lib/messages";
import type { CurrentUser, FaceEnrollmentStatus, MemberProfile } from "../../lib/types";

const EMPTY = { full_name: "", phone: "", employee_code: "", position: "", department: "" };

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

  const load = useCallback(async () => {
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
      <MemberNav />

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
                  label="Đơn vị / Nhóm"
                  maxLength={150}
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                />
              </div>
            </div>
            <Field
              label="Chức danh"
              maxLength={150}
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
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
              { key: "Đơn vị / Nhóm", value: profile.department ?? "Chưa cập nhật" },
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
                { key: "Mô hình nhận diện", value: face?.model_name ?? "—" },
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
