"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { CameraCapture, type CapturedImage } from "../../components/CameraCapture";
import { Alert, Badge, Button, Card, DataList } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { formatDateTime } from "../../lib/geo";
import { describeCode, describeError } from "../../lib/messages";
import type { CurrentUser, FaceEnrollmentStatus } from "../../lib/types";

export default function EnrollPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [face, setFace] = useState<FaceEnrollmentStatus | null>(null);
  const [captured, setCaptured] = useState<CapturedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [me, status] = await Promise.all([api.me(), api.faceStatus()]);
      setUser(me);
      setFace(status);
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

  async function submit() {
    if (!captured) {
      return;
    }
    setSubmitting(true);
    setError(null);
    setRejection(null);
    try {
      const challenge = await api.startEnrollment();
      const result = await api.verifyEnrollment(challenge, captured.blob);
      if (result.status !== "ENROLLED") {
        setRejection(describeCode(result.code ?? "UNKNOWN_ERROR"));
        return;
      }
      setSuccess(true);
      setFace(await api.faceStatus());
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell email={user?.email}>
      <h1 className="page-title">Đăng ký khuôn mặt</h1>
      <p className="page-lead">
        Ảnh chỉ được dùng để tạo vector đặc trưng phục vụ xác thực chấm công. Ảnh gốc không được lưu ở bước này.
      </p>

      {face?.enrolled ? (
        <Card title="Dữ liệu hiện có" action={<Badge tone="success">Đã đăng ký</Badge>}>
          <DataList
            rows={[
              { key: "Model", value: face.model_name ?? "—" },
              { key: "Phiên bản", value: face.model_version ?? "—" },
              { key: "Đăng ký lúc", value: face.enrolled_at ? formatDateTime(face.enrolled_at) : "—" },
            ]}
          />
          <p className="field__hint" style={{ marginTop: "var(--space-2)" }}>
            Đăng ký lại sẽ thu hồi dữ liệu khuôn mặt cũ và thay bằng ảnh mới.
          </p>
        </Card>
      ) : null}

      <Card title="Chụp ảnh khuôn mặt" subtitle="Giữ khuôn mặt trong vòng tròn, đủ sáng, không đeo khẩu trang hoặc kính râm.">
        <div className="stack">
          <CameraCapture captureLabel="Chụp ảnh" onCaptured={setCaptured} disabled={submitting} />

          <ul className="field__hint" style={{ margin: 0, paddingLeft: "var(--space-2)" }}>
            <li>Chỉ một người trong khung hình.</li>
            <li>Ảnh rõ nét, không rung — ảnh mờ sẽ bị từ chối.</li>
            <li>Tránh ngược sáng hoặc phòng quá tối.</li>
          </ul>

          {rejection ? <Alert tone="warning">{rejection}</Alert> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {success ? <Alert tone="success">Đăng ký khuôn mặt thành công. Bạn đã có thể chấm công.</Alert> : null}

          {success ? (
            <div className="row">
              <Button onClick={() => router.push("/attendance")} block>
                Đi tới chấm công
              </Button>
              <Button variant="secondary" onClick={() => router.push("/")}>
                Về bảng điều khiển
              </Button>
            </div>
          ) : (
            <Button onClick={() => void submit()} loading={submitting} disabled={!captured} block>
              Gửi ảnh đăng ký
            </Button>
          )}
        </div>
      </Card>
    </AppShell>
  );
}
