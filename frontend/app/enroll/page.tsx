"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { BiometricConsent } from "../../components/BiometricConsent";
import { CameraCapture, type CapturePhase, type CapturedImage, type PhaseLabels } from "../../components/CameraCapture";
import { Alert, Badge, Button, Card, DataList, playChime } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { formatDateTime } from "../../lib/geo";
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
            Ảnh của bạn được chuyển thành đặc trưng số đã mã hoá, chỉ dùng để đối chiếu khi ghi nhận.
          </p>
        </div>
        <Badge tone={face?.enrolled ? "success" : "warning"}>
          {face?.enrolled ? "Đã đăng ký" : "Chưa đăng ký"}
        </Badge>
      </div>

      {face?.enrolled ? (
        <Card title="Hồ sơ hiện tại" subtitle="Bạn có thể đăng ký lại bất cứ lúc nào nếu diện mạo thay đổi.">
          <DataList
            rows={[
              { key: "Trạng thái", value: <Badge tone="success">Đang hoạt động</Badge> },
              { key: "Thời điểm đăng ký", value: face.enrolled_at ? formatDateTime(face.enrolled_at) : "—" },
            ]}
          />
        </Card>
      ) : null}

      <BiometricConsent />

      <Card
        title="Chụp ảnh khuôn mặt"
        subtitle="Chọn nơi đủ sáng, nhìn thẳng vào camera, không đeo kính râm hay khẩu trang."
      >
        <div className="stack">
          <CameraCapture
            captureLabel="Chụp ảnh"
            labels={ENROLL_LABELS}
            onCaptured={onCaptured}
            phase={phase}
            disabled={phase === "working"}
          />

          {quality ? (
            <div className="quality">
              <div className="quality__item">
                <p className="quality__value" style={{ color: quality.face_count === 1 ? "var(--color-success)" : "var(--color-danger)" }}>
                  {quality.face_count ?? "0"}
                </p>
                <p className="quality__label">Khuôn mặt</p>
              </div>
              <div className="quality__item">
                <p className="quality__value">
                  {quality.blur_score ? `${quality.blur_score.toFixed(0)}` : "—"}
                </p>
                <p className="quality__label">Độ rõ nét</p>
              </div>
              <div className="quality__item">
                <p className="quality__value">
                  {quality.brightness_score ? `${quality.brightness_score.toFixed(0)}` : "—"}
                </p>
                <p className="quality__label">Độ sáng</p>
              </div>
            </div>
          ) : null}

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
      <Card title="Để ảnh đạt chất lượng tốt nhất">
        <ul className="stack stack--tight" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", paddingLeft: "18px" }}>
          <li>Chỉ để <strong>một người</strong> trong khung hình.</li>
          <li>Chọn nơi có ánh sáng đều, tránh ngược sáng hoặc bóng đổ trên mặt.</li>
          <li>Bỏ kính râm, khẩu trang và mũ che khuất trán hoặc mắt.</li>
          <li>Giữ thiết bị cách mặt khoảng 40–60 cm, ngang tầm mắt.</li>
        </ul>
      </Card>
    </AppShell>
  );
}
