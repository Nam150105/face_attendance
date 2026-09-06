"use client";

import { useState } from "react";

const STEPS: Record<"camera" | "location", { title: string; steps: string[] }> = {
  camera: {
    title: "Cách bật lại quyền camera",
    steps: [
      "Chrome / Edge trên máy tính: nhấn biểu tượng ổ khoá bên trái thanh địa chỉ → bật Camera → tải lại trang.",
      "Chrome trên Android: nhấn ổ khoá → Quyền → Camera → Cho phép.",
      "Safari trên iPhone: Cài đặt → Safari → Camera → Cho phép, rồi mở lại trang.",
      "Nếu đang dùng chế độ ẩn danh hoặc trình duyệt trong ứng dụng khác (Facebook, Zalo), hãy mở bằng trình duyệt thường.",
    ],
  },
  location: {
    title: "Cách bật lại quyền vị trí",
    steps: [
      "Chrome / Edge trên máy tính: nhấn biểu tượng ổ khoá bên trái thanh địa chỉ → bật Vị trí → tải lại trang.",
      "Chrome trên Android: nhấn ổ khoá → Quyền → Vị trí → Cho phép. Kiểm tra thêm Cài đặt → Vị trí của máy đã bật.",
      "Safari trên iPhone: Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị → Safari → Khi dùng ứng dụng.",
      "Ở trong nhà hoặc gần toà nhà cao tầng, tín hiệu định vị kém; hãy ra nơi thoáng rồi thử lại.",
    ],
  },
};

export function PermissionHelp({ kind }: { kind: "camera" | "location" }) {
  const [open, setOpen] = useState(false);
  const help = STEPS[kind];

  return (
    <div className="perm-help">
      <button
        type="button"
        className="perm-help__toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {open ? "Ẩn hướng dẫn" : help.title}
      </button>
      {open ? (
        <ol className="perm-help__list">
          {help.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
