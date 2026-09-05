"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { CameraCapture, type CapturedImage, type VerifyPhase } from "../../components/CameraCapture";
import { Alert, Badge, Button, Card, DataList } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { formatDateTime } from "../../lib/geo";
import { describeCode, describeError } from "../../lib/messages";
import type { CurrentUser, EnrollmentResult, FaceEnrollmentStatus } from "../../lib/types";

export default function EnrollPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [face, setFace] = useState<FaceEnrollmentStatus | null>(null);
  const [captured, setCaptured] = useState<CapturedImage | null>(null);
  const [phase, setPhase] = useState<VerifyPhase>("idle");
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
    setPhase("verifying");
    setMessage(null);
    try {
      const challenge = await api.startEnrollment();
      const result = await api.verifyEnrollment(challenge, captured.blob);
      setQuality(result);
      if (result.status !== "ENROLLED") {
        setPhase("fail");
        setTone("warning");
        setMessage(describeCode(result.code ?? "UNKNOWN_ERROR"));
        return;
      }
      setPhase("pass");
      setTone("success");
      setMessage("Đã lưu dữ liệu khuôn mặt.");
      setDone(true);
      setFace(await api.faceStatus());
    } catch (cause) {
      setPhase("fail");
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
            onCaptured={onCaptured}
            phase={phase}
            disabled={phase === "verifying"}
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
              loading={phase === "verifying"}
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
