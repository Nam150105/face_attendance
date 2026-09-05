"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Button } from "./ui";

export interface CapturedImage {
  blob: Blob;
  previewUrl: string;
}

export type VerifyPhase = "idle" | "verifying" | "pass" | "fail";

interface CameraCaptureProps {
  captureLabel: string;
  onCaptured: (image: CapturedImage | null) => void;
  phase?: VerifyPhase;
  statusText?: string | null;
  disabled?: boolean;
}

const CAPTURE_WIDTH = 960;
const JPEG_QUALITY = 0.92;
const COUNTDOWN_FROM = 3;

const PERMISSION_MESSAGES: Record<string, string> = {
  NotAllowedError: "Camera bị chặn. Bật quyền trong cài đặt trình duyệt rồi thử lại.",
  NotFoundError: "Thiết bị không có camera.",
  NotReadableError: "Camera đang bị ứng dụng khác chiếm.",
  OverconstrainedError: "Camera không đáp ứng cấu hình yêu cầu.",
};

export function CameraCapture({
  captureLabel,
  onCaptured,
  phase = "idle",
  statusText,
  disabled,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStreaming(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
      stopStream();
    };
  }, [stopStream]);

  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setError("Camera chỉ mở được trên HTTPS.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Trình duyệt không hỗ trợ camera.");
      return;
    }
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreaming(true);
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : "";
      setError(PERMISSION_MESSAGES[name] ?? "Không mở được camera.");
    } finally {
      setStarting(false);
    }
  }, []);

  const grabFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("Camera chưa sẵn sàng.");
      return;
    }
    const scale = CAPTURE_WIDTH / video.videoWidth;
    const canvas = document.createElement("canvas");
    canvas.width = CAPTURE_WIDTH;
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Không dựng được ảnh.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Không tạo được ảnh JPEG.");
          return;
        }
        const previewUrl = URL.createObjectURL(blob);
        setPreview(previewUrl);
        stopStream();
        onCaptured({ blob, previewUrl });
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  }, [onCaptured, stopStream]);

  const beginCountdown = useCallback(() => {
    setError(null);
    setCountdown(COUNTDOWN_FROM);
    timerRef.current = window.setInterval(() => {
      setCountdown((current) => {
        if (current === null) {
          return null;
        }
        if (current <= 1) {
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          grabFrame();
          return null;
        }
        return current - 1;
      });
    }, 1000);
  }, [grabFrame]);

  const retake = useCallback(() => {
    setPreview(null);
    onCaptured(null);
    void start();
  }, [onCaptured, start]);

  const guideClass = [
    "camera__guide",
    streaming && countdown === null ? "camera__guide--active" : "",
    phase === "verifying" ? "camera__guide--verifying" : "",
    phase === "pass" ? "camera__guide--pass" : "",
    phase === "fail" ? "camera__guide--fail" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const status =
    statusText ??
    (phase === "verifying"
      ? "Đang xác minh khuôn mặt"
      : phase === "pass"
        ? "Khớp"
        : phase === "fail"
          ? "Không khớp"
          : countdown !== null
            ? "Giữ yên"
            : streaming
              ? "Đưa mặt vào khung"
              : null);

  return (
    <div className="camera">
      <div className="camera__frame">
        {preview ? (
          <img className="camera__still" src={preview} alt="Ảnh vừa chụp" />
        ) : (
          <>
            <video
              ref={videoRef}
              className="camera__video camera__video--mirrored"
              playsInline
              muted
              autoPlay
              aria-label="Xem trước camera"
              style={{ display: streaming ? "block" : "none" }}
            />
            {!streaming ? <p className="camera__placeholder">Camera chưa bật</p> : null}
          </>
        )}

        <div className="camera__overlay" aria-hidden="true">
          {streaming || preview ? <span className={guideClass} /> : null}
          {phase === "verifying" ? <span className="camera__scan" /> : null}
          {countdown !== null ? <span className="camera__countdown">{countdown}</span> : null}
        </div>

        {status ? (
          <p className="camera__status" role="status">
            {phase === "verifying" ? <span className="spinner" aria-hidden="true" /> : null}
            {status}
          </p>
        ) : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="row">
        {preview ? (
          <Button variant="secondary" onClick={retake} disabled={disabled || phase === "verifying"} block>
            Chụp lại
          </Button>
        ) : streaming ? (
          <Button onClick={beginCountdown} disabled={disabled || countdown !== null} block>
            {countdown !== null ? `Chụp sau ${countdown}s` : captureLabel}
          </Button>
        ) : (
          <Button onClick={() => void start()} loading={starting} disabled={disabled} block>
            Bật camera
          </Button>
        )}
      </div>
    </div>
  );
}
