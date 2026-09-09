"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  LoadingRows,
  SelectField,
  TextAreaField,
} from "../../components/ui";
import { api } from "../../lib/api";
import { formatDateTime } from "../../lib/geo";
import { CORRECTION_STATUS, CORRECTION_TYPE, dayLabel } from "../../lib/member";
import { describeError } from "../../lib/messages";
import type { CorrectionType, CorrectionsResponse, CurrentUser } from "../../lib/types";

const TYPES: CorrectionType[] = ["MISSING_CHECK_IN", "MISSING_CHECK_OUT", "WRONG_TIME", "OTHER"];

function todayValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function CorrectionsContent() {
  const params = useSearchParams();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [data, setData] = useState<CorrectionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [workDate, setWorkDate] = useState(params.get("date") ?? todayValue());
  const [type, setType] = useState<CorrectionType>("MISSING_CHECK_OUT");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.myCorrections());
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    api.me().then(setUser).catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await api.submitCorrection({
        work_date: workDate,
        request_type: type,
        // datetime-local has no zone; the browser's own offset is the honest reading.
        requested_check_in: checkIn ? new Date(checkIn).toISOString() : null,
        requested_check_out: checkOut ? new Date(checkOut).toISOString() : null,
        reason: reason.trim(),
      });
      setNotice("Đã gửi yêu cầu. Người quản lý sẽ xem xét và bạn sẽ nhận được thông báo.");
      setReason("");
      setCheckIn("");
      setCheckOut("");
      await load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(id: string) {
    try {
      await api.cancelCorrection(id);
      await load();
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  const needsCheckIn = type === "MISSING_CHECK_IN" || type === "WRONG_TIME";
  const needsCheckOut = type === "MISSING_CHECK_OUT" || type === "WRONG_TIME";

  return (
    <AppShell email={user?.email} wide>

      <div className="page-header">
        <div>
          <h1 className="page-title">Yêu cầu chỉnh công</h1>
          <p className="page-lead">Báo quên check-in, quên check-out hoặc sai thời gian để người quản lý xem xét.</p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <details className="disclosure">
        <summary>Gửi yêu cầu mới</summary>
        <Card subtitle="Mỗi ngày chỉ có một yêu cầu đang chờ duyệt.">
        <form className="stack" onSubmit={submit}>
          <div className="filters-bar">
            <Field
              label="Ngày cần chỉnh"
              type="date"
              required
              max={todayValue()}
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
            />
            <SelectField label="Loại yêu cầu" value={type} onChange={(e) => setType(e.target.value as CorrectionType)}>
              {TYPES.map((item) => (
                <option key={item} value={item}>
                  {CORRECTION_TYPE[item]}
                </option>
              ))}
            </SelectField>
          </div>

          {needsCheckIn || needsCheckOut ? (
            <div className="filters-bar">
              {needsCheckIn ? (
                <Field
                  label="Giờ check-in đề nghị"
                  type="datetime-local"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                />
              ) : null}
              {needsCheckOut ? (
                <Field
                  label="Giờ check-out đề nghị"
                  type="datetime-local"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                />
              ) : null}
            </div>
          ) : null}

          <TextAreaField
            label="Lý do"
            required
            placeholder="Mô tả ngắn gọn vì sao cần chỉnh, ví dụ: máy hết pin nên không check-out được."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <Button type="submit" loading={submitting} disabled={reason.trim().length < 3} block>
            Gửi yêu cầu
          </Button>
        </form>
        </Card>
      </details>

      <Card title={data ? `Yêu cầu của bạn (${data.total})` : "Yêu cầu của bạn"}>
        {data === null && !error ? (
          <LoadingRows count={3} />
        ) : data && data.items.length === 0 ? (
          <Empty>Bạn chưa gửi yêu cầu chỉnh công nào.</Empty>
        ) : (
          <div className="stack stack--tight">
            {(data?.items ?? []).map((item) => {
              const meta = CORRECTION_STATUS[item.status];
              return (
                <div className="event" key={item.id}>
                  <div>
                    <p className="event__label">
                      {dayLabel(item.work_date)} · {CORRECTION_TYPE[item.request_type]}
                    </p>
                    <p className="event__meta">{item.reason}</p>
                    <p className="event__meta">Gửi lúc {formatDateTime(item.created_at)}</p>
                    {item.review_note ? (
                      <p className="event__meta">Phản hồi: {item.review_note}</p>
                    ) : null}
                  </div>
                  <div className="person__tags">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {item.status === "PENDING" ? (
                      <Button size="sm" variant="ghost" onClick={() => void cancel(item.id)}>
                        Thu hồi
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </AppShell>
  );
}

export default function CorrectionsPage() {
  // useSearchParams needs a Suspense boundary during static generation.
  return (
    <Suspense fallback={null}>
      <CorrectionsContent />
    </Suspense>
  );
}
