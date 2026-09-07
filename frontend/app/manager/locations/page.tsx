"use client";

import { useCallback, useEffect, useState } from "react";

import { Dialog } from "../../../components/Dialog";
import { LocationPicker } from "../../../components/LocationPicker";
import { ManagerShell } from "../../../components/ManagerShell";
import { TimeField } from "../../../components/TimeField";
import { Alert, Badge, Button, Card, Checkbox, Empty, Field, LoadingRows } from "../../../components/ui";
import { api } from "../../../lib/api";
import { describeError } from "../../../lib/messages";
import { shortTime } from "../../../lib/member";
import type { LocationInput, ManagerLocation } from "../../../lib/types";

const EMPTY_FORM: LocationInput = {
  name: "",
  address: null,
  latitude: 21.0285,
  longitude: 105.8048,
  allow_radius_meters: 100,
  warning_radius_meters: 200,
  is_active: true,
  expected_check_in: null,
  expected_check_out: null,
  grace_minutes: 10,
  enforce_hours: false,
};

export default function ManagerLocationsPage() {
  const [locations, setLocations] = useState<ManagerLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManagerLocation | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<LocationInput>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLocations(await api.managerLocations());
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditing(null);
    setCreating(true);
    setFormError(null);
  }

  function openEdit(location: ManagerLocation) {
    setForm({
      name: location.name,
      address: location.address,
      latitude: location.latitude,
      longitude: location.longitude,
      allow_radius_meters: location.allow_radius_meters,
      warning_radius_meters: location.warning_radius_meters,
      is_active: location.is_active,
      expected_check_in: location.expected_check_in,
      expected_check_out: location.expected_check_out,
      grace_minutes: location.grace_minutes,
      enforce_hours: location.enforce_hours,
    });
    setEditing(location);
    setCreating(false);
    setFormError(null);
  }

  const closeDialog = useCallback(() => {
    setEditing(null);
    setCreating(false);
  }, []);

  const setPoint = useCallback((point: { latitude: number; longitude: number }) => {
    setForm((current) => ({ ...current, ...point }));
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError("Vui lòng nhập tên địa điểm.");
      return;
    }
    if (form.warning_radius_meters <= form.allow_radius_meters) {
      setFormError("Khoảng cách chặn phải lớn hơn khoảng cách cho phép chấm công.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateLocation(editing.id, form);
      } else {
        await api.createLocation(form);
      }
      closeDialog();
      await load();
    } catch (cause) {
      setFormError(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  async function destroy(location: ManagerLocation) {
    if (!window.confirm(`Xoá vĩnh viễn địa điểm "${location.name}"? Thao tác này không hoàn tác được.`)) {
      return;
    }
    try {
      await api.destroyLocation(location.id);
      await load();
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  async function toggleDeactivate(location: ManagerLocation) {
    const actionName = location.is_active ? "tắt" : "bật lại";
    if (!window.confirm(`Bạn có chắc chắn muốn ${actionName} địa điểm "${location.name}"?`)) {
      return;
    }
    try {
      if (location.is_active) {
        await api.deleteLocation(location.id);
      } else {
        await api.updateLocation(location.id, {
          name: location.name,
          address: location.address,
          latitude: location.latitude,
          longitude: location.longitude,
          allow_radius_meters: location.allow_radius_meters,
          warning_radius_meters: location.warning_radius_meters,
          is_active: true,
          expected_check_in: location.expected_check_in,
          expected_check_out: location.expected_check_out,
          grace_minutes: location.grace_minutes,
          enforce_hours: location.enforce_hours,
        });
      }
      await load();
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  return (
    <ManagerShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Địa điểm</h1>
          <p className="page-lead">
            Đặt vị trí trên bản đồ, khu vực cho phép chấm công và giờ làm việc của từng nơi.
          </p>
        </div>
        <Button onClick={openCreate} icon={<span>+</span>}>
          Thêm địa điểm
        </Button>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card title="Danh sách địa điểm">
        {locations === null ? (
          <LoadingRows count={3} />
        ) : locations.length === 0 ? (
          <Empty>Chưa có nơi làm việc nào. Nhấn &quot;Thêm địa điểm&quot; để tạo nơi đầu tiên.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Địa điểm</th>
                  <th>Giờ làm việc</th>
                  <th>Khu vực cho phép</th>
                  <th>Trạng thái</th>
                  <th aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => (
                  <tr key={location.id}>
                    <td data-label="Địa điểm">
                      <p className="event__label">{location.name}</p>
                      <p className="event__meta">{location.address ?? "Chưa có địa chỉ"}</p>
                    </td>
                    <td data-label="Giờ làm việc">
                      {location.expected_check_in ? (
                        <>
                          <p className="event__label">
                            {shortTime(location.expected_check_in)} – {shortTime(location.expected_check_out)}
                          </p>
                          <p className="event__meta">
                            {location.enforce_hours
                              ? `Muộn quá ${location.grace_minutes} phút thì không vào được`
                              : `Muộn quá ${location.grace_minutes} phút vẫn vào được`}
                          </p>
                        </>
                      ) : (
                        <p className="event__meta">Chưa đặt giờ</p>
                      )}
                    </td>
                    <td data-label="Khu vực cho phép">
                      <p className="event__label">Trong {location.allow_radius_meters}m</p>
                      <p className="event__meta">
                        Xa hơn {location.warning_radius_meters}m thì không chấm công được
                      </p>
                    </td>
                    <td data-label="Trạng thái">
                      <Badge tone={location.is_active ? "success" : "neutral"}>
                        {location.is_active ? "Đang bật" : "Đã tắt"}
                      </Badge>
                    </td>
                    <td data-label="Thao tác">
                      <div className="row">
                        <Button size="sm" variant="secondary" onClick={() => openEdit(location)}>
                          Sửa
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void toggleDeactivate(location)}
                          style={{ color: location.is_active ? "var(--color-warning)" : "var(--color-success)" }}
                        >
                          {location.is_active ? "Tắt" : "Bật"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void destroy(location)}
                          style={{ color: "var(--color-danger)" }}
                        >
                          Xoá
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create / Edit Dialog */}
      {creating || editing ? (
        <Dialog
          title={editing ? `Sửa địa điểm: ${editing.name}` : "Thêm địa điểm"}
          onClose={closeDialog}
        >
          <form className="stack" onSubmit={save}>
            <Field
              label="Tên địa điểm"
              required
              placeholder="Ví dụ: Trụ sở chính, Cơ sở 2, Phòng 301…"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />

            <LocationPicker
              point={{ latitude: form.latitude, longitude: form.longitude }}
              onPointChange={setPoint}
              onFound={(label) => setForm((current) => ({ ...current, address: label }))}
              allowRadiusMeters={form.allow_radius_meters}
              warningRadiusMeters={form.warning_radius_meters}
            />

            <div className="field-pair">
              <Field
                label="Chấm công được trong (mét)"
                type="number"
                min={10}
                max={5000}
                required
                value={form.allow_radius_meters}
                onChange={(e) => setForm({ ...form, allow_radius_meters: parseInt(e.target.value, 10) || 10 })}
              />
              <Field
                label="Xa hơn mức này thì chặn (mét)"
                type="number"
                min={form.allow_radius_meters + 1}
                max={10000}
                required
                value={form.warning_radius_meters}
                onChange={(e) => setForm({ ...form, warning_radius_meters: parseInt(e.target.value, 10) || 20 })}
              />
            </div>
            <p className="field__hint">
              Đứng trong vòng tròn xanh thì chấm công bình thường. Ở giữa hai vòng thì vẫn chấm công được
              nhưng phải cho biết lý do. Ra ngoài vòng cam thì không chấm công được.
            </p>

            <div className="field-pair">
              <TimeField
                label="Giờ vào"
                value={form.expected_check_in}
                presets={["07:00", "08:00", "08:30", "09:00"]}
                onChange={(value) => setForm({ ...form, expected_check_in: value })}
              />
              <TimeField
                label="Giờ ra"
                value={form.expected_check_out}
                presets={["16:00", "17:00", "17:30", "18:00"]}
                onChange={(value) => setForm({ ...form, expected_check_out: value })}
              />
            </div>
            <p className="field__hint">
              Để trống nếu nơi này không có giờ cố định.
            </p>
            <Field
              label="Số phút đến muộn được chấp nhận"
              type="number"
              min={0}
              max={240}
              value={form.grace_minutes ?? 10}
              onChange={(e) => setForm({ ...form, grace_minutes: parseInt(e.target.value, 10) || 0 })}
              hint="Ví dụ 10 phút: giờ vào 08:00, ai tới lúc 08:07 vẫn chấm công được và màn hình nhắc họ muộn 7 phút."
            />

            <Checkbox
              label="Muộn quá số phút trên thì không cho chấm công"
              checked={form.enforce_hours}
              onChange={(checked) => setForm({ ...form, enforce_hours: checked })}
            />
            <p className="field__hint">
              {form.enforce_hours
                ? "Muộn quá mức trên sẽ bị từ chối, nhưng lần thử đó vẫn hiện trong danh sách bản ghi để bạn nắm được."
                : "Muộn bao nhiêu cũng vẫn chấm công được. Hệ thống chỉ ghi lại muộn bao nhiêu và ra sớm bao nhiêu."}
            </p>

            <Checkbox
              label="Bật địa điểm này ngay sau khi lưu"
              checked={form.is_active}
              onChange={(checked) => setForm({ ...form, is_active: checked })}
            />

            {formError ? <Alert tone="danger">{formError}</Alert> : null}

            <div className="row" style={{ marginTop: "8px" }}>
              <Button type="submit" loading={saving} block>
                {editing ? "Lưu thay đổi" : "Tạo địa điểm"}
              </Button>
              <Button variant="secondary" onClick={closeDialog} disabled={saving} block>
                Huỷ
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </ManagerShell>
  );
}
