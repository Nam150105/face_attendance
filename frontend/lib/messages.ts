import { ApiError } from "./api";

const CODE_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  "Invalid or expired credentials": "Email hoặc mật khẩu không đúng.",
  "Email is already registered": "Email này đã được đăng ký.",
  "User is not active": "Tài khoản chưa được kích hoạt.",
  "Insufficient permissions": "Tài khoản không có quyền thực hiện thao tác này.",

  IMAGE_INVALID: "Ảnh không hợp lệ hoặc không đọc được. Chụp lại bằng camera.",
  IMAGE_TOO_SMALL: "Ảnh có độ phân giải quá thấp. Chụp lại gần hơn.",
  FACE_NOT_FOUND: "Không tìm thấy khuôn mặt trong ảnh. Đưa mặt vào giữa khung và thử lại.",
  MULTIPLE_FACES: "Ảnh có nhiều hơn một khuôn mặt. Chỉ chụp một mình bạn.",
  FACE_QUALITY_LOW: "Chất lượng ảnh chưa đạt: ảnh bị mờ hoặc thiếu/thừa sáng.",
  FACE_MODEL_NOT_CONFIGURED: "Dịch vụ nhận diện chưa được cấu hình model. Liên hệ quản trị viên.",
  FACE_REFERENCE_NOT_FOUND: "Chưa có dữ liệu khuôn mặt tham chiếu. Hãy đăng ký khuôn mặt trước.",
  FACE_NOT_ENROLLED: "Bạn chưa đăng ký khuôn mặt. Hãy hoàn tất đăng ký trước khi chấm công.",
  FACE_NOT_MATCHED: "Khuôn mặt không khớp với dữ liệu đã đăng ký.",
  "Face AI service unavailable": "Dịch vụ nhận diện khuôn mặt đang không phản hồi.",
  "Invalid or expired enrollment challenge": "Phiên đăng ký khuôn mặt đã hết hạn. Hãy bắt đầu lại.",
  "Face AI returned an invalid embedding": "Dịch vụ nhận diện trả về dữ liệu không hợp lệ.",

  GPS_ACCURACY_LOW: "Độ chính xác GPS quá thấp. Ra ngoài trời hoặc bật Wi-Fi rồi thử lại.",
  OUTSIDE_ALLOWED_ZONE: "Bạn đang ở ngoài phạm vi cho phép của địa điểm này.",
  WARNING_REASON_REQUIRED: "Bạn ở ngoài bán kính cho phép. Vui lòng nhập lý do giải trình.",
  "Location is not assigned to this member": "Địa điểm này chưa được gán cho bạn.",
  "Checkout location is inactive": "Địa điểm check-in ban đầu đã bị vô hiệu hoá.",

  CHECK_IN_ALREADY_EXISTS: "Bạn đang trong ca làm việc. Hãy check-out trước.",
  CHECK_OUT_WITHOUT_CHECK_IN: "Bạn chưa check-in nên không thể check-out.",

  "Image exceeds 10 MB limit": "Ảnh vượt quá giới hạn 10 MB.",
  "Database unavailable": "Không kết nối được cơ sở dữ liệu.",
  "Member not found": "Không tìm thấy hồ sơ thành viên.",
  "Only members can enroll a face": "Chỉ tài khoản MEMBER mới đăng ký được khuôn mặt.",
};

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return CODE_MESSAGES[error.code] ?? `Lỗi ${error.statusCode}: ${error.code}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Đã xảy ra lỗi không xác định.";
}

export function describeCode(code: string): string {
  return CODE_MESSAGES[code] ?? code;
}

export const GEOFENCE_MESSAGES: Record<string, string> = {
  ALLOW: "Bạn đang trong bán kính cho phép.",
  WARNING_REASON_REQUIRED: "Ngoài bán kính cho phép nhưng vẫn trong vùng cảnh báo — cần nhập lý do.",
  BLOCK: "Ngoài vùng cảnh báo — không thể chấm công tại đây.",
  GPS_ACCURACY_LOW: "Độ chính xác GPS quá thấp để xác định vị trí.",
};
