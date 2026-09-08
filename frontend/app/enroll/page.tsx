"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { BiometricConsent } from "../../components/BiometricConsent";
import { CameraCapture, type CapturePhase, type CapturedImage, type PhaseLabels } from "../../components/CameraCapture";
import { Alert, Button, Card, playChime } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { describeCode, describeError } from "../../lib/messages";
import type { CurrentUser, EnrollmentResult, FaceEnrollmentStatus } from "../../lib/types";

const ENROLL_LABELS: PhaseLabels = {
  framing: "Nhìn thẳng vào camera",
  holding: "Giữ yên thiết bị…",
  working: "Đang phân tích đặc trưng khuôn mặt…",
  done: "Đăng ký thành công",
  failed: "Chất lượng ảnh chưa đạt",
};

export default function EnrollPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [face, setFace] = useState<FaceEnrollmentStatus | null>(null);
  const [captured, setCaptured] = useState<CapturedImage | null>(null);
  const [phase, setPhase] = useState<CapturePhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"danger" | "warning" | "success">("danger");
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
      if (result.status !== "ENROLLED") {
        setPhase("failed");
        setTone("warning");
        setMessage(describeCode(result.code ?? "UNKNOWN_ERROR"));
        return;
      }
      setPhase("done");
      setTone("success");
      playChime("success");
      setMessage("Đã đăng ký khuôn mặt. Hệ thống sẽ dùng dữ liệu này để đối chiếu mỗi lần bạn check-in hoặc check-out.");
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
      <div className="page-header">
        <div>
          <h1 className="page-title">Đăng ký khuôn mặt</h1>
          <p className="page-lead">
            Chụp một ảnh để hệ thống nhận ra bạn mỗi lần chấm công. Chỉ mất khoảng một phút.
          </p>
        </div>
      </div>

      {face?.needs_reenrollment ? (
        <Alert tone="warning">
          Khuôn mặt bạn đăng ký trước đây dùng mô hình cũ nên hệ thống không so sánh được nữa. Bạn
          chụp lại một lần ở đây là xong, dữ liệu cũ sẽ được thay thế.
        </Alert>
      ) : null}

      {face?.enrolled && !face.needs_reenrollment ? (
        <Alert tone="success">
          Bạn đã đăng ký khuôn mặt. Chụp lại ở đây nếu diện mạo thay đổi — ảnh mới sẽ thay ảnh cũ.
        </Alert>
      ) : null}

      <Card title="Chụp ảnh khuôn mặt">
        <div className="stack">
          <CameraCapture
            captureLabel="Chụp ảnh"
            labels={ENROLL_LABELS}
            onCaptured={onCaptured}
            phase={phase}
            disabled={phase === "working"}
          />

          {message ? <Alert tone={tone}>{message}</Alert> : null}

          {done ? (
            <div className="row">
              <Button onClick={() => router.push("/attendance")} block>
                Check-in ngay
              </Button>
              <Button variant="secondary" onClick={() => router.push("/")}>
                Về trang chính
              </Button>
            </div>
          ) : (
            <Button
              size="lg"
              onClick={() => void submit()}
              loading={phase === "working"}
              disabled={!captured}
              block
            >
              {captured ? "Hoàn tất đăng ký" : "Chụp ảnh để tiếp tục"}
            </Button>
          )}
        </div>
      </Card>

      {/* Guidance Tips Card */}
      <Card title="Ba điều giúp chụp đạt ngay lần đầu">
        <ul className="stack stack--tight" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", paddingLeft: "18px" }}>
          <li>Chỉ để <strong>một mình bạn</strong> trong khung hình.</li>
          <li>Đứng nơi sáng đều, đừng để đèn hay cửa sổ ngay sau lưng.</li>
          <li>Bỏ khẩu trang, kính râm và mũ che trán.</li>
        </ul>
      </Card>

      <BiometricConsent />
    </AppShell>
  );
}
