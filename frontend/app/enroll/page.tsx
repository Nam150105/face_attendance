"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { BiometricConsent } from "../../components/BiometricConsent";
import { CameraCapture, type CapturePhase, type CapturedImage, type PhaseLabels } from "../../components/CameraCapture";
import { Alert, Button, Card, Field, playChime } from "../../components/ui";
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
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  // Replacing a face that is already on file is a different act from
  // registering one, and the screen says so.
  const changing = Boolean(face?.enrolled);
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

  useEffect(() => {
    api
      .myFaceChangeStatus()
      .then((status) => setPending(status.pending !== null))
      .catch(() => setPending(false));
  }, [done]);

  async function submit() {
    if (!captured) {
      return;
    }
    setPhase("working");
    setMessage(null);
    try {
      const challenge = await api.startEnrollment();
      const result = await api.verifyEnrollment(challenge, captured.blob, reason.trim() || undefined);
      if (result.status === "PENDING_APPROVAL") {
        setPhase("done");
        setTone("success");
        setMessage(
          "Đã gửi ảnh mới cho người quản lý duyệt. Trong lúc chờ, bạn vẫn chấm công bằng ảnh cũ.",
        );
        setDone(true);
        return;
      }
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
            {changing
              ? "Ảnh mới cần người quản lý duyệt trước khi thay ảnh cũ."
              : "Chụp một ảnh để hệ thống nhận ra bạn khi chấm công."}
          </p>
        </div>
      </div>

      {face?.needs_reenrollment ? (
        <Alert tone="warning">
          Khuôn mặt bạn đăng ký trước đây dùng mô hình cũ nên hệ thống không so sánh được nữa. Bạn
          chụp lại một lần ở đây là xong, dữ liệu cũ sẽ được thay thế.
        </Alert>
      ) : null}

      {pending ? (
        <Alert tone="info">
          Ảnh mới của bạn đang chờ người quản lý duyệt. Trong lúc đó hệ thống vẫn dùng ảnh cũ.
        </Alert>
      ) : null}

      <Card title={changing ? "Chụp ảnh mới" : "Chụp ảnh khuôn mặt"}>
        <div className="stack">
          {changing ? (
            <Field
              label="Vì sao bạn cần đổi ảnh?"
              placeholder="Ví dụ: tôi vừa cắt tóc, ảnh cũ nhận không ra."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          ) : null}
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
              {changing
                ? captured
                  ? "Gửi cho người quản lý duyệt"
                  : "Chụp ảnh để gửi duyệt"
                : captured
                  ? "Hoàn tất đăng ký"
                  : "Chụp ảnh để tiếp tục"}
            </Button>
          )}
        </div>
      </Card>

      <p className="field__hint" style={{ textAlign: "center" }}>
        Một mình bạn trong khung hình · nơi sáng đều · bỏ khẩu trang, kính râm và mũ.
      </p>

      <BiometricConsent />
    </AppShell>
  );
}
