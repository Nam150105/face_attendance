"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Button } from "./ui";

export interface CapturedImage {
  blob: Blob;
  previewUrl: string;
}

interface CameraCaptureProps {
  captureLabel: string;
  onCaptured: (image: CapturedImage | null) => void;
  disabled?: boolean;
}

const CAPTURE_WIDTH = 960;
const JPEG_QUALITY = 0.92;

export function CameraCapture({ captureLabel, onCaptured, disabled }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStreaming(false);
  }, []);

  useEffect(() => stopStream, [stopStream]);

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
      setError("Trình duyệt chỉ cho phép mở camera trên HTTPS. Hãy truy cập bằng địa chỉ https://.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Trình duyệt này không hỗ trợ truy cập camera.");
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
      const messages: Record<string, string> = {
        NotAllowedError: "Bạn đã từ chối quyền camera. Bật lại trong cài đặt trình duyệt rồi thử lại.",
        NotFoundError: "Không tìm thấy camera trên thiết bị này.",
        NotReadableError: "Camera đang được ứng dụng khác sử dụng.",
        OverconstrainedError: "Camera không đáp ứng được cấu hình yêu cầu.",
      };
      setError(messages[name] ?? "Không mở được camera.");
    } finally {
      setStarting(false);
    }
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("Camera chưa sẵn sàng. Đợi hình ảnh hiện lên rồi chụp lại.");
      return;
    }
    const scale = CAPTURE_WIDTH / video.videoWidth;
    const canvas = document.createElement("canvas");
    canvas.width = CAPTURE_WIDTH;
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Không dựng được ảnh từ camera.");
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

  const retake = useCallback(() => {
    setPreview(null);
    onCaptured(null);
    void start();
  }, [onCaptured, start]);

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
            {streaming ? <span className="camera__guide" aria-hidden="true" /> : null}
            {!streaming ? (
              <p className="camera__placeholder">
                Camera chưa bật. Nhấn <strong>Bật camera</strong> và cho phép quyền truy cập.
              </p>
            ) : null}
          </>
        )}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="row">
        {preview ? (
          <Button variant="secondary" onClick={retake} disabled={disabled}>
            Chụp lại
          </Button>
        ) : streaming ? (
          <Button onClick={capture} disabled={disabled} block>
            {captureLabel}
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
