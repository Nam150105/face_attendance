"use client";

import { useEffect, useState } from "react";

import { Alert, Badge, Card } from "./ui";
import { api } from "../lib/api";
import type { RecognitionEngine } from "../lib/types";

/**
 * What is actually judging the face, in plain terms. People are asked to hand
 * over their biometrics; the least the screen can do is name the libraries
 * doing the reading and the number they have to beat.
 */
export function RecognitionEnginePanel({ engine }: { engine?: RecognitionEngine }) {
  const [loaded, setLoaded] = useState<RecognitionEngine | null>(engine ?? null);

  useEffect(() => {
    if (engine) {
      setLoaded(engine);
      return;
    }
    let live = true;
    api
      .recognitionEngine()
      .then((result) => live && setLoaded(result))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [engine]);

  if (!loaded) {
    return null;
  }

  const steps = loaded.preprocessing ?? [];
  const versions = loaded.versions ?? {};

  return (
    <Card
      title="Công nghệ nhận diện"
      subtitle="Ảnh của bạn đi qua đúng các bước dưới đây, không có bước nào khác."
    >
      <div className="engine">
        <div className="engine__stage">
          <span className="engine__step">1</span>
          <div>
            <p className="engine__name">
              OpenCV <span className="engine__version">{versions.opencv ?? "—"}</span>
            </p>
            <p className="engine__role">
              Đọc ảnh, đo độ nét và độ sáng, tự bù sáng khi chỗ chụp thiếu đèn. Ảnh không đạt bị loại
              ngay ở đây, trước khi ai đó bị nhận nhầm.
            </p>
            {steps.length > 0 ? <p className="engine__chain">{steps.join("  →  ")}</p> : null}
          </div>
        </div>

        <div className="engine__stage">
          <span className="engine__step">2</span>
          <div>
            <p className="engine__name">
              face_recognition <span className="engine__version">{versions.face_recognition ?? "—"}</span>
              {versions.dlib ? <span className="engine__version">dlib {versions.dlib}</span> : null}
            </p>
            <p className="engine__role">
              Tìm khuôn mặt bằng {loaded.detector ?? "bộ phát hiện của dlib"}, đặt các điểm mốc trên
              mặt rồi quy khuôn mặt thành {loaded.dimension ?? 128} con số đặc trưng.
            </p>
            <p className="engine__chain">
              {loaded.encoder ?? "dlib ResNet"} · {loaded.dimension ?? 128} chiều
              {loaded.jitters ? ` · ${loaded.jitters} lượt lấy mẫu` : ""}
            </p>
          </div>
        </div>

        <div className="engine__stage">
          <span className="engine__step">3</span>
          <div>
            <p className="engine__name">So khớp</p>
            <p className="engine__role">
              Hai khuôn mặt được so bằng khoảng cách giữa hai bộ số. Càng gần 0 càng giống nhau; quá{" "}
              <strong>{loaded.tolerance ?? 0.6}</strong> thì hệ thống coi là người khác.
            </p>
          </div>
        </div>
      </div>

      {loaded.available ? (
        <Badge tone="success">Đang hoạt động</Badge>
      ) : (
        <Alert tone="warning">
          Bộ nhận diện chưa sẵn sàng nên tạm thời chưa chấm công bằng khuôn mặt được. Bạn báo người
          quản lý giúp nhé.
        </Alert>
      )}
    </Card>
  );
}
