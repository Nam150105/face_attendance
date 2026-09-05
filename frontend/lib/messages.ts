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
  "Registered member email not found": "Email này chưa có tài khoản trên hệ thống. Người đó cần tự đăng ký trước, sau đó bạn mới thêm được.",
  "Member is already managed": "Thành viên này đã có trong danh sách của bạn.",
  "Member is outside manager scope": "Thành viên không thuộc phạm vi quản lý của bạn.",
  "Location is outside manager scope or inactive": "Địa điểm không thuộc quyền quản lý hoặc đã tắt.",
  "Assignment not found in manager scope": "Không tìm thấy phân công này.",
  "Attendance event is outside manager scope": "Bản ghi không thuộc phạm vi quản lý của bạn.",
  "Attendance event has no evidence image": "Bản ghi không có ảnh bằng chứng.",
  "Location is inactive": "Địa điểm đã bị tắt.",
  "Invalid membership status": "Trạng thái không hợp lệ.",
  ADJUST_REASON_REQUIRED: "Cần nhập lý do điều chỉnh.",
  NOTHING_TO_ADJUST: "Chưa thay đổi gì so với hiện tại.",
  INVALID_ATTENDANCE_STATUS: "Trạng thái chấm công không hợp lệ.",
  PLACE_QUERY_REQUIRED: "Nhập địa chỉ, link bản đồ hoặc toạ độ.",
  PLACE_NOT_FOUND: "Không tìm thấy địa điểm nào khớp. Thử tên cụ thể hơn hoặc dán link Google Maps.",
  PLACE_LINK_HAS_NO_COORDINATES: "Link này không chứa toạ độ. Mở Google Maps, giữ vào điểm cần chọn rồi copy link chia sẻ.",
  PLACE_LINK_UNREACHABLE: "Không mở được link. Kiểm tra lại đường dẫn.",
  PLACE_COORDINATES_INVALID: "Toạ độ nằm ngoài phạm vi hợp lệ.",
  GEOCODER_UNAVAILABLE: "Dịch vụ tra cứu bản đồ đang không phản hồi. Thử dán toạ độ trực tiếp.",
  "Only members can enroll a face": "Chỉ tài khoản MEMBER mới đăng ký được khuôn mặt.",
};

const STATUS_FALLBACK: Record<number, string> = {
  400: "Yêu cầu không hợp lệ.",
  401: "Phiên đăng nhập đã hết hạn. Đăng nhập lại.",
  403: "Bạn không có quyền thực hiện thao tác này.",
  404: "Không tìm thấy dữ liệu.",
  409: "Dữ liệu đã tồn tại hoặc đang xung đột.",
  413: "Tệp quá lớn.",
  422: "Dữ liệu nhập chưa hợp lệ.",
  429: "Thao tác quá nhanh. Thử lại sau.",
  500: "Máy chủ gặp lỗi. Thử lại sau.",
  502: "Dịch vụ phụ trợ không phản hồi.",
  503: "Dịch vụ tạm thời không khả dụng.",
};

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return CODE_MESSAGES[error.code] ?? STATUS_FALLBACK[error.statusCode] ?? "Thao tác không thành công.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Đã xảy ra lỗi không xác định.";
}

const FAILURE_LABELS: Record<string, string> = {
  OUTSIDE_ALLOWED_ZONE: "Ngoài vùng cho phép",
  GPS_ACCURACY_LOW: "GPS không đủ chính xác",
  FACE_NOT_MATCHED: "Khuôn mặt không khớp",
  FACE_NOT_FOUND: "Không thấy khuôn mặt",
  MULTIPLE_FACES: "Nhiều khuôn mặt",
  FACE_QUALITY_LOW: "Ảnh chất lượng thấp",
  IMAGE_INVALID: "Ảnh không hợp lệ",
  IMAGE_TOO_SMALL: "Ảnh quá nhỏ",
};

export function describeFailure(code: string | null): string | null {
  if (!code) {
    return null;
  }
  return FAILURE_LABELS[code] ?? code;
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
