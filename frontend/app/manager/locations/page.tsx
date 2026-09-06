"use client";

import { useCallback, useEffect, useState } from "react";

import { Dialog } from "../../../components/Dialog";
import { LocationPicker } from "../../../components/LocationPicker";
import { ManagerShell } from "../../../components/ManagerShell";
import { Alert, Badge, Button, Card, Checkbox, Empty, Field, LoadingRows } from "../../../components/ui";
import { api } from "../../../lib/api";
import { describeError } from "../../../lib/messages";
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

  const setAddress = useCallback((address: string) => {
    setForm((current) => ({ ...current, address: address || null }));
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError("Vui lòng nhập tên địa điểm.");
      return;
    }
    if (form.warning_radius_meters <= form.allow_radius_meters) {
      setFormError("Phạm vi cảnh báo phải lớn hơn phạm vi cho phép.");
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
            Thiết lập toạ độ và phạm vi cho phép ghi nhận tại từng địa điểm.
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
          <Empty>Chưa có địa điểm nào. Nhấn &quot;Thêm địa điểm&quot; để bắt đầu.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tên địa điểm</th>
                  <th>Toạ độ</th>
                  <th>Phạm vi (chuẩn / cảnh báo)</th>
                  <th>Trạng thái</th>
                  <th aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => (
                  <tr key={location.id}>
                    <td data-label="Tên">
                      <p className="event__label">{location.name}</p>
                      {location.address ? <p className="event__meta">{location.address}</p> : null}
                    </td>
                    <td data-label="Toạ độ" className="numeric mono" style={{ fontSize: "13px" }}>
                      {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                    </td>
                    <td data-label="Phạm vi" className="numeric">
                      <span style={{ color: "var(--color-success)", fontWeight: 600 }}>{location.allow_radius_meters}m</span>
                      {" / "}
                      <span style={{ color: "var(--color-warning)" }}>{location.warning_radius_meters}m</span>
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
              address={form.address ?? ""}
              onPointChange={setPoint}
              onAddressChange={setAddress}
              allowRadiusMeters={form.allow_radius_meters}
              warningRadiusMeters={form.warning_radius_meters}
            />

            <div className="field-pair">
              <Field
                label="Phạm vi chuẩn (mét)"
                type="number"
                min={10}
                max={5000}
                required
                value={form.allow_radius_meters}
                onChange={(e) => setForm({ ...form, allow_radius_meters: parseInt(e.target.value, 10) || 10 })}
              />
              <Field
                label="Phạm vi cảnh báo (mét)"
                type="number"
                min={form.allow_radius_meters + 1}
                max={10000}
                required
                value={form.warning_radius_meters}
                onChange={(e) => setForm({ ...form, warning_radius_meters: parseInt(e.target.value, 10) || 20 })}
              />
            </div>
            <p className="field__hint">
              Trong phạm vi chuẩn thì lượt ghi nhận hợp lệ. Ngoài phạm vi chuẩn nhưng trong mức cảnh báo thì
              người dùng phải nhập lý do.
            </p>

            <div className="field-pair">
              <Field
                label="Giờ vào dự kiến"
                type="time"
                value={form.expected_check_in ?? ""}
                onChange={(e) => setForm({ ...form, expected_check_in: e.target.value || null })}
              />
              <Field
                label="Giờ ra dự kiến"
                type="time"
                value={form.expected_check_out ?? ""}
                onChange={(e) => setForm({ ...form, expected_check_out: e.target.value || null })}
              />
            </div>
            <Field
              label="Cho phép muộn (phút)"
              type="number"
              min={0}
              max={240}
              value={form.grace_minutes ?? 10}
              onChange={(e) => setForm({ ...form, grace_minutes: parseInt(e.target.value, 10) || 0 })}
              hint="Dùng để đánh giá sớm hay muộn khi thành viên chưa có ca riêng."
            />

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
