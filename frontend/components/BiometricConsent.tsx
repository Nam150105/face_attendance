"use client";

import { useState } from "react";

/**
 * 07_SECURITY_PRIVACY.md §2 requires this notice before enrollment: what is
 * collected, why, where it lives, for how long, who can read it, and how to get
 * it removed. Shown expanded by default so it is read, not skipped.
 */
export function BiometricConsent() {
  const [open, setOpen] = useState(true);

  return (
    <section className="consent">
      <button
        type="button"
        className="consent__head"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="consent__title">Thông tin về dữ liệu sinh trắc học</span>
        <span className="consent__chevron" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <dl className="consent__list">
          <dt>Thu thập gì</dt>
          <dd>
            Một ảnh khuôn mặt và một chuỗi đặc trưng số (embedding) được trích xuất từ ảnh đó. Hệ thống
            không lưu video và không quay liên tục.
          </dd>

          <dt>Dùng để làm gì</dt>
          <dd>
            Chỉ để đối chiếu đúng người khi bạn check-in hoặc check-out. Không dùng cho mục đích nào khác
            và không chia sẻ cho bên thứ ba.
          </dd>

          <dt>Lưu ở đâu</dt>
          <dd>
            Ảnh nằm trong kho lưu trữ riêng tư, không công khai. Đặc trưng khuôn mặt nằm trong cơ sở dữ
            liệu của tổ chức. Cả hai chỉ truyền qua kết nối đã mã hoá.
          </dd>

          <dt>Ai xem được</dt>
          <dd>
            Chỉ bạn và người quản lý trực tiếp đang quản lý bạn. Quản lý của tổ chức khác không truy cập
            được. Mọi lần đăng ký lại khuôn mặt đều được ghi vào nhật ký hoạt động.
          </dd>

          <dt>Lưu trong bao lâu</dt>
          <dd>
            Đặc trưng khuôn mặt được giữ cho tới khi bạn đăng ký lại hoặc rời khỏi tổ chức. Ảnh của mỗi
            lượt ghi nhận được giữ theo chính sách lưu trữ của tổ chức bạn.
          </dd>

          <dt>Muốn xoá hoặc sửa</dt>
          <dd>
            Bạn có thể chụp lại để thay dữ liệu cũ bất cứ lúc nào. Để xoá hẳn, hãy liên hệ người quản lý
            hoặc bộ phận phụ trách dữ liệu của tổ chức.
          </dd>
        </dl>
      ) : null}
    </section>
  );
}
