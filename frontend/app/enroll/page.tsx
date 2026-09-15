"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { BiometricConsent } from "../../components/BiometricConsent";
import { CameraCapture, type CapturePhase, type CapturedImage, type PhaseLabels } from "../../components/CameraCapture";
import { RecognitionEnginePanel } from "../../components/RecognitionEnginePanel";
import { ResultCard } from "../../components/ResultCard";
import { Alert, Button, Card, Field, playChime } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { describeCode, describeError } from "../../lib/messages";
import type { CurrentUser, EnrollmentResult, FaceEnrollmentStatus } from "../../lib/types";

const ENROLL_LABELS: PhaseLabels = { working: "Đang phân tích khuôn mặt…" };

/** What the server measured on this exact photo, for the fold-away details. */
function readingRows(reading: EnrollmentResult) {
  return [
    ...(reading.face_count !== undefined ? [{ key: "Khuôn mặt tìm thấy", value: String(reading.face_count) }] : []),
    ...(reading.blur_score !== undefined ? [{ key: "Độ nét (Laplacian)", value: reading.blur_score.toFixed(0) }] : []),
    ...(reading.brightness_score !== undefined ? [{ key: "Độ sáng trung bình", value: reading.brightness_score.toFixed(0) }] : []),
    { key: "Bộ tìm mặt", value: reading.detector ?? "dlib HOG" },
    { key: "Bộ mã hoá", value: `${reading.encoder ?? "dlib ResNet"} · ${reading.dimension ?? 128} chiều` },
  ];
}

/** Why the server said no, as a headline the person can act on. */
function refusalTitle(code: string): string {
  if (code === "FACE_NOT_FOUND") return "Không thấy khuôn mặt trong ảnh";
  if (code === "MULTIPLE_FACES") return "Có nhiều hơn một người trong ảnh";
  if (code === "FACE_TOO_BLURRY" || code === "FACE_NOT_CLEAR" || code === "FACE_QUALITY_LOW") return "Ảnh chưa đủ nét";
  if (code === "LIGHTING_TOO_DARK") return "Ảnh quá tối";
  if (code === "LIGHTING_TOO_BRIGHT") return "Ảnh quá chói";
  return "Ảnh chưa dùng được";
}

export default function EnrollPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [face, setFace] = useState<FaceEnrollmentStatus | null>(null);
  const [captured, setCaptured] = useState<CapturedImage | null>(null);
  const [phase, setPhase] = useState<CapturePhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [failCode, setFailCode] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  // Replacing a face that is already on file is a different act from
  // registering one, and the screen says so.
  const [tone, setTone] = useState<"danger" | "warning" | "success">("danger");
  const [done, setDone] = useState(false);
  // Frozen once the photo is accepted: refreshing the status flipped the
  // screen to "Chụp ảnh mới" under a green "Đã đăng ký".
  const changing = Boolean(face?.enrolled) && !done;
  // What the two libraries actually measured on this photo. Shown afterwards
  // rather than as a wall of text beforehand: before the shutter, the only
  // thing that helps is where to stand.
  const [reading, setReading] = useState<EnrollmentResult | null>(null);

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
    setFailCode(null);
    setReading(null);
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
      setReading(result);
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
        setFailCode(result.code ?? "UNKNOWN_ERROR");
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

          {/* The verdict, only once there is one. */}
          {phase === "done" && reading ? (
            <ResultCard
              tone="success"
              title={reading.status === "PENDING_APPROVAL" ? "Đã gửi ảnh mới cho người quản lý" : "Đã đăng ký khuôn mặt"}
              body={
                reading.status === "PENDING_APPROVAL"
                  ? "Trong lúc chờ duyệt, bạn vẫn chấm công bằng ảnh cũ."
                  : "Từ giờ mỗi lần chấm công, hệ thống đối chiếu với ảnh này."
              }
              details={readingRows(reading)}
            >
              <div className="stack stack--tight">
                <Button onClick={() => router.push("/attendance")} block>
                  Chấm công ngay
                </Button>
                <Button variant="secondary" onClick={() => router.push("/")} block>
                  Về trang chính
                </Button>
              </div>
            </ResultCard>
          ) : phase === "failed" ? (
            <ResultCard
              tone={tone === "danger" ? "danger" : "warning"}
              title={failCode ? refusalTitle(failCode) : "Chưa đăng ký được"}
              body={message}
              details={reading ? readingRows(reading) : undefined}
            />
          ) : captured && phase === "idle" ? (
            <Button size="lg" onClick={() => void submit()} block>
              {changing ? "Dùng ảnh này, gửi duyệt" : "Dùng ảnh này"}
            </Button>
          ) : null}
        </div>
      </Card>

      {!captured ? (
        <p className="field__hint" style={{ textAlign: "center" }}>
          Bỏ khẩu trang, kính râm và mũ. Bốn mục dưới khung hình đạt hết thì nút chụp mở.
        </p>
      ) : null}

      <details className="disclosure">
        <summary>Ảnh của bạn được xử lý như thế nào?</summary>
        <RecognitionEnginePanel engine={face?.engine} />
      </details>

      <BiometricConsent />
    </AppShell>
  );
}
