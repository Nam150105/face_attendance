"use client";

import { useCallback, useEffect, useState } from "react";

import { Dialog } from "../../../components/Dialog";
import { ManagerShell } from "../../../components/ManagerShell";
import { Alert, Badge, Button, Card, Empty, Field, LoadingRows } from "../../../components/ui";
import { api } from "../../../lib/api";
import { readPosition } from "../../../lib/geo";
import { describeError } from "../../../lib/messages";
import type { LocationInput, ManagerLocation } from "../../../lib/types";

const EMPTY_FORM: LocationInput = {
  name: "",
  address: null,
  latitude: 0,
  longitude: 0,
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
  const [locating, setLocating] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
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
    setAccuracy(null);
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
    setAccuracy(null);
  }

  function closeDialog() {
    setEditing(null);
    setCreating(false);
  }

  async function useCurrentPosition() {
    setLocating(true);
    setFormError(null);
    try {
      const fix = await readPosition();
      setForm((current) => ({
        ...current,
        latitude: Number(fix.latitude.toFixed(7)),
        longitude: Number(fix.longitude.toFixed(7)),
      }));
      setAccuracy(fix.accuracyMeters);
    } catch (cause) {
      setFormError(describeError(cause));
    } finally {
      setLocating(false);
    }
  }

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
    if (!window.confirm(`Vô hiệu hoá địa điểm "${location.name}"? Thành viên sẽ không chấm công tại đây được nữa.`)) {
      return;
    }
    try {
      await api.deleteLocation(location.id);
      await load();
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  const dialogOpen = creating || editing !== null;

  return (
    <ManagerShell>
      <h1 className="page-title">Địa điểm</h1>
      <p className="page-lead">
        Ngưỡng geofence được lưu theo từng địa điểm và luôn được máy chủ kiểm tra lại khi chấm công.
      </p>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card
        title="Danh sách địa điểm"
        subtitle="Bấm sửa để đổi toạ độ hoặc bán kính."
        action={<Button onClick={openCreate}>Tạo địa điểm</Button>}
      >
        {locations === null ? (
          <LoadingRows count={3} />
        ) : locations.length === 0 ? (
          <Empty>Chưa có địa điểm nào. Tạo một địa điểm để thành viên bắt đầu chấm công.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>Toạ độ</th>
                  <th>Cho phép</th>
                  <th>Cảnh báo</th>
                  <th>Trạng thái</th>
                  <th aria-label="Hành động" />
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => (
                  <tr key={location.id}>
                    <td data-label="Tên">
                      <span className="event__label">{location.name}</span>
                      {location.address ? <p className="event__meta">{location.address}</p> : null}
                    </td>
                    <td data-label="Toạ độ" className="numeric">
                      {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                    </td>
                    <td data-label="Cho phép" className="numeric">
                      {location.allow_radius_meters} m
                    </td>
                    <td data-label="Cảnh báo" className="numeric">
                      {location.warning_radius_meters} m
                    </td>
                    <td data-label="Trạng thái">
                      <Badge tone={location.is_active ? "success" : "neutral"}>
                        {location.is_active ? "Hoạt động" : "Đã tắt"}
                      </Badge>
                    </td>
                    <td data-label="Hành động">
                      <div className="row">
                        <Button variant="secondary" onClick={() => openEdit(location)}>
                          Sửa
                        </Button>
                        {location.is_active ? (
                          <Button variant="ghost" onClick={() => void deactivate(location)}>
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

      {dialogOpen ? (
        <Dialog title={editing ? `Sửa ${editing.name}` : "Tạo địa điểm"} onClose={closeDialog}>
          <form className="stack" onSubmit={save}>
            <Field
              label="Tên địa điểm"
              required
              maxLength={200}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <Field
              label="Địa chỉ"
              maxLength={500}
              value={form.address ?? ""}
              onChange={(event) => setForm({ ...form, address: event.target.value || null })}
            />

            <Button variant="secondary" type="button" onClick={() => void useCurrentPosition()} loading={locating}>
              Dùng vị trí hiện tại của tôi
            </Button>
            {accuracy !== null ? (
              <Alert tone={accuracy <= 50 ? "success" : "warning"}>
                Đã lấy toạ độ với sai số {accuracy.toFixed(0)} m.
                {accuracy > 50 ? " Sai số cao — nên lấy lại ở nơi thoáng trước khi lưu." : ""}
              </Alert>
            ) : null}

            <Field
              label="Vĩ độ (latitude)"
              type="number"
              step="0.0000001"
              min={-90}
              max={90}
              required
              value={form.latitude}
              onChange={(event) => setForm({ ...form, latitude: Number(event.target.value) })}
            />
            <Field
              label="Kinh độ (longitude)"
              type="number"
              step="0.0000001"
              min={-180}
              max={180}
              required
              value={form.longitude}
              onChange={(event) => setForm({ ...form, longitude: Number(event.target.value) })}
            />
            <Field
              label="Bán kính cho phép (m)"
              hint="Trong bán kính này: chấm công bình thường."
              type="number"
              min={1}
              required
              value={form.allow_radius_meters}
              onChange={(event) => setForm({ ...form, allow_radius_meters: Number(event.target.value) })}
            />
            <Field
              label="Bán kính cảnh báo (m)"
              hint="Giữa hai bán kính: bắt buộc nhập lý do. Vượt qua: chặn."
              type="number"
              min={2}
              required
              value={form.warning_radius_meters}
              onChange={(event) => setForm({ ...form, warning_radius_meters: Number(event.target.value) })}
            />

            {formError ? <Alert tone="danger">{formError}</Alert> : null}

            <div className="row">
              <Button type="submit" loading={saving}>
                {editing ? "Lưu thay đổi" : "Tạo địa điểm"}
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
