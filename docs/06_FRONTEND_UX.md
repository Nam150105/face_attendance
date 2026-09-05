# Frontend UX/UI Specification

## 1. Responsive requirement
Target:
- Mobile 360–430px
- Tablet 768–1024px
- Desktop 1280px+

Use responsive layouts rather than separate applications.

## 2. Public screens
- Landing/login/register.
- Email verification.
- Forgot/reset password.
- Privacy/biometric consent information.

## 3. Member screens
### Dashboard
- Current status: not checked-in / working / checked-out.
- Today's check-in and check-out.
- Required location.
- Camera/GPS readiness.

### Check-in screen
Show step state:
```text
Camera ready
GPS ready
Face detected
Verifying
Result
```
Warning state 100–200m:
```text
You are 143m away.
Check-in is allowed only with a reason.
[Reason textarea]
[Confirm check-in]
[Cancel]
```
Blocked state:
```text
You are 247m away.
Check-in is disabled.
```

### History
- Calendar/day list.
- Event detail.
- Image evidence.
- Location distance.
- Status/reason.

## 4. Manager screens
- Dashboard.
- Members.
- Member detail.
- Locations.
- Attendance calendar/table.
- Attendance event detail with image.
- Manual adjustment modal requiring reason.
- Audit logs.

## 5. Camera UX
- Large camera preview.
- Visual face guide.
- Explicit browser permission instructions.
- Do not upload every video frame. Capture still or short challenge frames according to the AI service design.
- Show clear retry states.

## 6. Accessibility
- Keyboard navigation desktop.
- Focus states.
- Adequate contrast.
- Labels for camera/GPS statuses.
- Screen-reader-friendly error messages where applicable.
