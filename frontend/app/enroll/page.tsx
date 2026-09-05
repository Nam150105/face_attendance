"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { CameraCapture, type CapturePhase, type CapturedImage, type PhaseLabels } from "../../components/CameraCapture";
import { Alert, Badge, Button, Card, DataList } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { formatDateTime } from "../../lib/geo";
import { describeCode, describeError } from "../../lib/messages";
import type { CurrentUser, EnrollmentResult, FaceEnrollmentStatus } from "../../lib/types";

const ENROLL_LABELS: PhaseLabels = {
  framing: "Đưa mặt vào khung",
  holding: "Giữ yên",
  working: "Đang phân tích ảnh",
  done: "Đã lưu dữ liệu khuôn mặt",
  failed: "Ảnh chưa đạt yêu cầu",
};

export default function EnrollPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [face, setFace] = useState<FaceEnrollmentStatus | null>(null);
  const [captured, setCaptured] = useState<CapturedImage | null>(null);
  const [phase, setPhase] = useState<CapturePhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"danger" | "warning" | "success">("danger");
  const [quality, setQuality] = useState<EnrollmentResult | null>(null);
  const [done, setDone] = useState(false);

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
      setMessage(describeError(cause));
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCaptured = useCallback((image: CapturedImage | null) => {
    setCaptured(image);
    setPhase("idle");
    setMessage(null);
    setQuality(null);
  }, []);

  async function submit() {
    if (!captured) {
      return;
    }
    setPhase("working");
    setMessage(null);
    try {
      const challenge = await api.startEnrollment();
      const result = await api.verifyEnrollment(challenge, captured.blob);
      setQuality(result);
      if (result.status !== "ENROLLED") {
        setPhase("failed");
        setTone("warning");
        setMessage(describeCode(result.code ?? "UNKNOWN_ERROR"));
        return;
      }
      setPhase("done");
      setTone("success");
      setMessage("Đã ghi nhận khuôn mặt. Từ giờ hệ thống dùng dữ liệu này để đối chiếu khi bạn chấm công.");
      setDone(true);
      setFace(await api.faceStatus());
    } catch (cause) {
      setPhase("failed");
      setTone("danger");
      setMessage(describeError(cause));
    }
  }

  return (
    <AppShell email={user?.email}>
      <h1 className="page-title">Đăng ký khuôn mặt</h1>
      <p className="page-lead">Ảnh chỉ dùng để sinh vector đặc trưng. Ảnh gốc không được lưu.</p>

      {face?.enrolled ? (
        <Card title="Dữ liệu hiện tại" action={<Badge tone="success">Đã có</Badge>}>
          <DataList
            rows={[
              { key: "Model", value: <span className="mono">{face.model_version ?? "—"}</span> },
              { key: "Đăng ký", value: face.enrolled_at ? formatDateTime(face.enrolled_at) : "—" },
            ]}
          />
          <p className="field__hint" style={{ marginTop: "var(--space-2)" }}>
            Đăng ký lại sẽ thu hồi dữ liệu cũ.
          </p>
        </Card>
      ) : null}

      <Card title="Chụp ảnh" subtitle="Một người trong khung, đủ sáng, không khẩu trang hay kính râm.">
        <div className="stack">
          <CameraCapture
            captureLabel="Chụp"
            labels={ENROLL_LABELS}
            onCaptured={onCaptured}
            phase={phase}
            disabled={phase === "working"}
          />

          {quality ? (
            <div className="quality">
              <div className="quality__item">
                <p className="quality__value">{quality.face_count ?? "—"}</p>
                <p className="quality__label">Khuôn mặt</p>
              </div>
              <div className="quality__item">
                <p className="quality__value">{quality.blur_score?.toFixed(0) ?? "—"}</p>
                <p className="quality__label">Độ nét</p>
              </div>
              <div className="quality__item">
                <p className="quality__value">{quality.brightness_score?.toFixed(0) ?? "—"}</p>
                <p className="quality__label">Độ sáng</p>
              </div>
            </div>
          ) : null}

          {message ? <Alert tone={tone}>{message}</Alert> : null}

          {done ? (
            <div className="row">
              <Button onClick={() => router.push("/attendance")} block>
                Chấm công
              </Button>
              <Button variant="secondary" onClick={() => router.push("/")}>
                Trang chính
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => void submit()}
              loading={phase === "working"}
              disabled={!captured}
              block
            >
              Gửi đăng ký
            </Button>
          )}
        </div>
      </Card>
    </AppShell>
  );
}
