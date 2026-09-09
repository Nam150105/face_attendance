import { ApiError } from "./api";

const CODE_MESSAGES: Record<string, string> = {
  // Mạng: statusCode 0, request chưa từng tới được máy chủ.
  NETWORK_OFFLINE: "Thiết bị đang mất kết nối mạng. Hãy bật Wi-Fi hoặc dữ liệu di động rồi thử lại.",
  NETWORK_TIMEOUT: "Máy chủ phản hồi quá lâu. Kiểm tra kết nối mạng rồi thử lại.",
  NETWORK_ERROR: "Không kết nối được tới máy chủ. Vui lòng kiểm tra mạng rồi thử lại.",

  NOT_AUTHENTICATED: "Bạn cần đăng nhập để tiếp tục.",
  SESSION_REVOKED: "Phiên đăng nhập đã kết thúc vì tài khoản được đăng nhập trên thiết bị khác.",
  RATE_LIMIT_EXCEEDED: "Bạn đã thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.",
  UNSUPPORTED_IMAGE_TYPE: "Tệp gửi lên không phải ảnh JPEG hoặc PNG hợp lệ. Vui lòng chụp lại.",
  IDEMPOTENCY_KEY_CONFLICT: "Yêu cầu bị trùng mã xử lý. Vui lòng thử lại.",
  PLACE_LINK_HOST_NOT_ALLOWED: "Chỉ chấp nhận liên kết từ Google Maps hoặc Apple Maps.",

  // Member portal
  DATE_RANGE_INVALID: "Khoảng thời gian không hợp lệ: ngày bắt đầu sau ngày kết thúc.",
  DATE_RANGE_TOO_WIDE: "Khoảng thời gian quá dài. Vui lòng chọn tối đa một năm.",
  CORRECTION_REASON_REQUIRED: "Vui lòng nhập lý do cho yêu cầu chỉnh công.",
  CORRECTION_DATE_IN_FUTURE: "Không thể yêu cầu chỉnh công cho ngày trong tương lai.",
  CORRECTION_ALREADY_PENDING: "Ngày này đã có một yêu cầu đang chờ duyệt.",
  CORRECTION_NOT_FOUND_OR_REVIEWED: "Yêu cầu không còn tồn tại hoặc đã được xử lý.",
  CORRECTION_ALREADY_REVIEWED: "Yêu cầu này đã được xử lý trước đó.",
  CORRECTION_OUTSIDE_MANAGER_SCOPE: "Yêu cầu không thuộc phạm vi bạn quản lý.",
  INVALID_CORRECTION_TYPE: "Loại yêu cầu chỉnh công không hợp lệ.",
  INVALID_CORRECTION_DECISION: "Quyết định duyệt không hợp lệ.",
  NOTIFICATION_NOT_FOUND: "Không tìm thấy thông báo này.",
  CHECK_IN_TOO_LATE: "Đã quá giờ vào cho phép của nơi làm việc này nên bạn chưa chấm công vào được. Bạn báo người quản lý để được hỗ trợ nhé.",
  EMPLOYEE_CODE_TAKEN: "Mã định danh này đã được dùng cho thành viên khác. Vui lòng chọn mã khác.",
  LOCATION_HAS_ATTENDANCE: "Địa điểm đã có bản ghi chấm công nên không xoá được. Hãy tắt địa điểm thay vì xoá.",
  // Backend trả "Invalid email or password" khi sai thông tin đăng nhập, còn
  // "Invalid or expired credentials" là mặc định của unauthorized() khi token hết hạn.
  "Invalid email or password": "Email hoặc mật khẩu chưa chính xác. Vui lòng kiểm tra lại.",
  "Invalid or expired credentials": "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.",
  "Email is already registered": "Email này đã được đăng ký trên hệ thống.",
  "User is not active": "Tài khoản đang tạm khoá. Vui lòng liên hệ người quản lý để kích hoạt lại.",
  "Insufficient permissions": "Bạn không có quyền thực hiện thao tác này.",
  "Password must contain at least 8 characters, letters, and numbers":
    "Mật khẩu cần tối thiểu 8 ký tự, gồm cả chữ và số.",
  "Invalid or expired password reset token": "Liên kết đặt lại mật khẩu đã hết hạn. Vui lòng yêu cầu lại.",

  // Camera & Face AI
  IMAGE_INVALID: "Ảnh chưa đọc được. Bạn chụp lại giúp nhé.",
  IMAGE_TOO_SMALL: "Khuôn mặt trong ảnh hơi nhỏ. Bạn đưa điện thoại lại gần hơn rồi chụp lại nhé.",
  FACE_NOT_FOUND: "Chưa thấy khuôn mặt trong khung hình. Bạn đưa mặt vào giữa vòng tròn và nhìn thẳng vào camera nhé.",
  MULTIPLE_FACES: "Có nhiều người trong khung hình. Bạn nhờ mọi người tránh ra để chỉ còn một mình nhé.",
  FACE_QUALITY_LOW: "Ảnh bị mờ hoặc nơi bạn đứng hơi tối. Bạn ra chỗ sáng hơn, lau ống kính và giữ yên máy khoảng 2 giây rồi chụp lại nhé.",
  FACE_TOO_BLURRY: "Ảnh bị nhoè. Bạn giữ yên máy khoảng 2 giây, lau ống kính rồi chụp lại nhé.",
  LIGHTING_TOO_DARK: "Chỗ bạn đứng hơi tối nên máy chưa nhìn rõ mặt. Bạn ra gần cửa sổ hoặc chỗ có đèn rồi chụp lại nhé.",
  LIGHTING_TOO_BRIGHT: "Ánh sáng chiếu thẳng vào mặt làm ảnh bị chói. Bạn quay lưng lại nguồn sáng rồi chụp lại nhé.",
  FACE_NOT_CLEAR: "Máy mới nhìn được một phần khuôn mặt. Bạn bỏ khẩu trang, kính râm hoặc tóc che mặt, nhìn thẳng vào camera rồi chụp lại nhé.",
  FACE_ENCODING_FAILED: "Máy chưa đọc được khuôn mặt trong ảnh này. Bạn chụp lại gần hơn một chút nhé.",
  FACE_ENGINE_MISMATCH: "Khuôn mặt bạn đăng ký từ trước dùng mô hình cũ nên không so sánh được nữa. Bạn vào mục Hồ sơ đăng ký lại khuôn mặt, chỉ mất chưa tới một phút.",
  FACE_MODEL_NOT_CONFIGURED: "Hệ thống nhận diện đang tạm nghỉ. Bạn báo người quản lý giúp nhé.",
  FACE_REFERENCE_NOT_FOUND: "Chưa có ảnh khuôn mặt của bạn để đối chiếu. Bạn vào mục Hồ sơ để đăng ký trước nhé.",
  CURRENT_PASSWORD_WRONG: "Mật khẩu hiện tại chưa đúng. Bạn nhập lại giúp nhé.",
  NEW_PASSWORD_SAME_AS_OLD: "Mật khẩu mới trùng mật khẩu cũ. Bạn chọn mật khẩu khác nhé.",
  SYSTEM_ERROR: "Hệ thống gặp trục trặc nên chưa làm được việc này. Bạn thử lại sau ít phút nhé.",
  FACE_NOT_ENROLLED: "Bạn chưa đăng ký khuôn mặt. Vào mục Hồ sơ để đăng ký, chỉ mất chưa tới một phút.",
  FACE_NOT_MATCHED: "Chưa nhận ra bạn. Bạn bỏ khẩu trang, kính râm hoặc mũ che mặt, đứng ở nơi đủ sáng rồi chụp lại nhé.",
  "Face AI service unavailable": "Hệ thống nhận diện đang bận. Bạn đợi vài giây rồi thử lại nhé.",
  "Invalid or expired enrollment challenge": "Phiên đăng ký đã hết hạn do chờ quá lâu. Vui lòng chụp lại.",
  "Face AI returned an invalid embedding": "Không phân tích được đặc trưng khuôn mặt. Vui lòng chụp lại ở nơi đủ sáng.",
  "Only members can enroll a face": "Chỉ tài khoản thành viên mới đăng ký được khuôn mặt.",

  // GPS & Geofence
  GPS_ACCURACY_LOW: "Chưa xác định được chính xác bạn đang ở đâu. Bạn bật Wi-Fi hoặc ra chỗ thoáng, tránh trong nhà kín, rồi thử lại nhé.",
  OUTSIDE_ALLOWED_ZONE: "Bạn đang ở quá xa nơi làm việc nên chưa chấm công được. Bạn tới gần hơn rồi thử lại nhé.",
  WARNING_REASON_REQUIRED: "Bạn đang đứng hơi xa nơi làm việc. Cho biết lý do để người quản lý nắm được nhé.",
  "Location is not assigned to this member": "Bạn chưa được phép chấm công ở địa điểm này.",
  "Checkout location is inactive": "Địa điểm bạn đã check-in hiện đã ngừng hoạt động.",
  "Invalid latitude or longitude": "Toạ độ gửi lên không hợp lệ.",
  "GPS accuracy must be non-negative": "Giá trị độ chính xác định vị không hợp lệ.",

  // Vòng đời phiên ghi nhận
  CHECK_IN_ALREADY_EXISTS: "Bạn đã check-in và đang trong phiên. Hãy check-out khi kết thúc.",
  CHECK_OUT_WITHOUT_CHECK_IN: "Bạn chưa check-in nên chưa thể check-out.",

  // Hệ thống & quản trị
  "Image exceeds 10 MB limit": "Dung lượng ảnh vượt quá 10 MB. Vui lòng thử lại.",
  "Database unavailable": "Không kết nối được cơ sở dữ liệu. Vui lòng thử lại sau.",
  "Member not found": "Không tìm thấy thành viên này trên hệ thống.",
  "Registered member email not found": "Email này chưa có tài khoản thành viên. Người dùng cần tự đăng ký trước.",
  "Member is already managed": "Thành viên này đã có trong danh sách bạn quản lý.",
  "Member is outside manager scope": "Thành viên không thuộc phạm vi quản lý của bạn.",
  "Location is outside manager scope or inactive": "Địa điểm không thuộc quyền quản lý hoặc đang tắt.",
  "Location is outside manager scope": "Địa điểm không thuộc quyền quản lý của bạn.",
  "warning_radius_meters must be greater than allow_radius_meters":
    "Phạm vi cảnh báo phải lớn hơn phạm vi chuẩn.",
  "Assignment not found in manager scope": "Không tìm thấy phân công địa điểm này.",
  "Attendance event is outside manager scope": "Bản ghi này không thuộc phạm vi bạn quản lý.",
  "Attendance event has no evidence image": "Bản ghi này không có ảnh xác thực đính kèm.",
  "Location is inactive": "Địa điểm này đã ngừng hoạt động.",
  "Invalid membership status": "Trạng thái thành viên không hợp lệ.",
  NO_EMAIL_PROVIDED: "Vui lòng nhập ít nhất một địa chỉ email.",
  TOO_MANY_EMAILS: "Hệ thống hỗ trợ tối đa 200 email cho mỗi lần thêm.",
  ADJUST_REASON_REQUIRED: "Vui lòng nhập lý do điều chỉnh bản ghi.",
  NOTHING_TO_ADJUST: "Trạng thái mới không khác trạng thái hiện tại.",
  INVALID_ATTENDANCE_STATUS: "Trạng thái bản ghi không hợp lệ.",
  PLACE_QUERY_REQUIRED: "Vui lòng nhập địa chỉ, toạ độ hoặc dán liên kết Google Maps.",
  PLACE_NOT_FOUND: "Không tìm thấy địa điểm phù hợp. Hãy nhập tên đường hoặc toà nhà chi tiết hơn, hoặc dán liên kết Google Maps.",
  PLACE_LINK_HAS_NO_COORDINATES: "Liên kết chia sẻ không chứa toạ độ hợp lệ. Vui lòng kiểm tra lại trên Google Maps.",
  PLACE_LINK_UNREACHABLE: "Không truy cập được liên kết bản đồ. Vui lòng kiểm tra kết nối mạng.",
  PLACE_COORDINATES_INVALID: "Toạ độ không hợp lệ.",
  GEOCODER_UNAVAILABLE: "Dịch vụ tìm kiếm bản đồ đang bận. Bạn có thể kéo ghim trực tiếp trên bản đồ.",
};

const STATUS_FALLBACK: Record<number, string> = {
  400: "Thông tin gửi lên chưa hợp lệ. Vui lòng kiểm tra lại.",
  401: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  403: "Bạn không có quyền thực hiện thao tác này.",
  404: "Không tìm thấy dữ liệu yêu cầu.",
  409: "Dữ liệu đã tồn tại hoặc đang xung đột.",
  413: "Tệp gửi lên vượt quá dung lượng cho phép.",
  422: "Dữ liệu nhập vào chưa đúng định dạng.",
  429: "Thao tác quá nhanh. Vui lòng đợi một chút rồi thử lại.",
  500: "Máy chủ đang gặp sự cố. Vui lòng thử lại sau.",
  502: "Dịch vụ xử lý nền không phản hồi. Vui lòng thử lại sau.",
  503: "Hệ thống đang bảo trì. Vui lòng quay lại sau ít phút.",
};

/**
 * What to put on screen when something fails.
 *
 * Never the raw text from the server: an exception class, a constraint name or
 * an English sentence tells the person nothing they can act on. Either we have
 * a sentence written for them, or they get a short code to quote to whoever
 * runs the system.
 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const known = CODE_MESSAGES[error.code];
    if (known) {
      return known;
    }
    if (error.errorCode) {
      return `Hệ thống gặp trục trặc nên chưa làm được việc này. Bạn báo giúp người quản trị mã lỗi ${error.errorCode}.`;
    }
    return STATUS_FALLBACK[error.statusCode] ?? "Thao tác chưa thành công. Bạn thử lại giúp nhé.";
  }
  // Errors this app raised itself already carry a sentence written for the
  // person reading it — throwing that away was how "you denied location access"
  // turned into "check your connection".
  if (error instanceof Error && (error as { userFacing?: boolean }).userFacing) {
    return error.message;
  }
  return "Thao tác chưa thành công. Bạn kiểm tra kết nối mạng rồi thử lại nhé.";
}

/** Lỗi mạng thì thao tác cũ vẫn còn nguyên giá trị, chỉ cần gửi lại. */
export function isRetryableTransport(code: string): boolean {
  return code === "NETWORK_OFFLINE" || code === "NETWORK_TIMEOUT" || code === "NETWORK_ERROR";
}

const FAILURE_LABELS: Record<string, string> = {
  CHECK_IN_TOO_LATE: "Quá giờ vào cho phép",
  OUTSIDE_ALLOWED_ZONE: "Ngoài phạm vi cho phép",
  GPS_ACCURACY_LOW: "Tín hiệu định vị yếu",
  FACE_NOT_MATCHED: "Khuôn mặt chưa khớp",
  FACE_NOT_FOUND: "Không thấy khuôn mặt",
  MULTIPLE_FACES: "Nhiều người trong ảnh",
  FACE_QUALITY_LOW: "Ảnh mờ hoặc thiếu sáng",
  FACE_TOO_BLURRY: "Ảnh bị nhoè",
  LIGHTING_TOO_DARK: "Chỗ chụp quá tối",
  LIGHTING_TOO_BRIGHT: "Ảnh bị chói sáng",
  FACE_NOT_CLEAR: "Khuôn mặt bị che",
  FACE_ENCODING_FAILED: "Không đọc được khuôn mặt",
  FACE_ENGINE_MISMATCH: "Cần đăng ký lại khuôn mặt",
  IMAGE_INVALID: "Ảnh không hợp lệ",
  IMAGE_TOO_SMALL: "Độ phân giải thấp",
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
  ALLOW: "Vị trí hợp lệ — bạn đang ở trong phạm vi của địa điểm.",
  WARNING_REASON_REQUIRED: "Vị trí nằm trong vùng cảnh báo (ngoài phạm vi chuẩn) — cần nhập lý do.",
  BLOCK: "Vị trí quá xa địa điểm đã đăng ký — không thể ghi nhận tại đây.",
  GPS_ACCURACY_LOW: "Độ chính xác định vị chưa đạt yêu cầu.",
};

export const BULK_STATUS_LABELS: Record<string, { label: string; tone: "success" | "info" | "warning" | "danger" }> = {
  ADDED: { label: "Đã thêm", tone: "success" },
  REACTIVATED: { label: "Đã kích hoạt lại", tone: "success" },
  ALREADY_MANAGED: { label: "Đã có trong danh sách", tone: "info" },
  NOT_REGISTERED: { label: "Chưa có tài khoản", tone: "warning" },
  INVALID_EMAIL: { label: "Email sai định dạng", tone: "danger" },
};
