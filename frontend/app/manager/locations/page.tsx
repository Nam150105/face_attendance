"use client";

import { useCallback, useEffect, useState } from "react";

import { Dialog } from "../../../components/Dialog";
import { LocationPicker } from "../../../components/LocationPicker";
import { ManagerShell } from "../../../components/ManagerShell";
import { Alert, Badge, Button, Card, Empty, Field, LoadingRows } from "../../../components/ui";
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

  const setAddressFromMap = useCallback((address: string) => {
    setForm((current) => (current.address ? current : { ...current, address }));
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (form.warning_radius_meters <= form.allow_radius_meters) {
      setFormError("Bán kính cảnh báo phải lớn hơn bán kính cho phép.");
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

  async function deactivate(location: ManagerLocation) {
    if (!window.confirm(`Tắt "${location.name}"?`)) {
      return;
    }
    try {
      await api.deleteLocation(location.id);
      await load();
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  return (
    <ManagerShell>
      <h1 className="page-title">Địa điểm</h1>
      <p className="page-lead">Ngưỡng geofence lưu theo từng địa điểm, máy chủ luôn kiểm tra lại khi chấm công.</p>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card title="Danh sách" action={<Button onClick={openCreate}>Tạo mới</Button>}>
        {locations === null ? (
          <LoadingRows count={3} />
        ) : locations.length === 0 ? (
          <Empty>Chưa có địa điểm.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>Toạ độ</th>
                  <th>Bán kính</th>
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
                    <td data-label="Toạ độ" className="numeric mono">
                      {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                    </td>
                    <td data-label="Bán kính" className="numeric">
                      {location.allow_radius_meters} / {location.warning_radius_meters} m
                    </td>
                    <td data-label="Trạng thái">
                      <Badge tone={location.is_active ? "success" : "neutral"}>
                        {location.is_active ? "Bật" : "Tắt"}
                      </Badge>
                    </td>
                    <td data-label="Thao tác">
                      <div className="row">
                        <Button variant="secondary" size="sm" onClick={() => openEdit(location)}>
                          Sửa
                        </Button>
                        {location.is_active ? (
                          <Button variant="ghost" size="sm" onClick={() => void deactivate(location)}>
                            Tắt
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating || editing ? (
        <Dialog title={editing ? editing.name : "Địa điểm mới"} onClose={closeDialog}>
          <form className="stack" onSubmit={save}>
            <Field
              label="Tên"
              required
              maxLength={200}
              placeholder="Văn phòng Hà Nội"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
            <Field
              label="Địa chỉ"
              maxLength={500}
              placeholder="Tuỳ chọn"
              value={form.address ?? ""}
              onChange={(event) =>
                setForm((current) => ({ ...current, address: event.target.value || null }))
              }
            />

            <hr className="divider" />

            <LocationPicker
              value={{ latitude: form.latitude, longitude: form.longitude }}
              onChange={setPoint}
              onAddressFound={setAddressFromMap}
            />

            <hr className="divider" />

            <div className="row">
              <div style={{ flex: "1 1 140px" }}>
                <Field
                  label="Cho phép (m)"
                  hint="Trong bán kính: chấm công bình thường"
                  type="number"
                  min={1}
                  required
                  value={form.allow_radius_meters}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, allow_radius_meters: Number(event.target.value) }))
                  }
                />
              </div>
              <div style={{ flex: "1 1 140px" }}>
                <Field
                  label="Cảnh báo (m)"
                  hint="Vượt qua: chặn"
                  type="number"
                  min={2}
                  required
                  value={form.warning_radius_meters}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, warning_radius_meters: Number(event.target.value) }))
                  }
                />
              </div>
            </div>

            {formError ? <Alert tone="danger">{formError}</Alert> : null}

            <div className="row">
              <Button type="submit" loading={saving}>
                Lưu
              </Button>
              <Button variant="secondary" type="button" onClick={closeDialog}>
                Huỷ
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </ManagerShell>
  );
}
