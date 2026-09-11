"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Dialog } from "../../../components/Dialog";
import { GeoMap, type MapCircle, type MapMarker } from "../../../components/GeoMap";
import { LocationPicker } from "../../../components/LocationPicker";
import { usePermissions } from "../../../lib/permissions";
import { ManagerShell } from "../../../components/ManagerShell";
import { TimeField } from "../../../components/TimeField";
import { Alert, Badge, Button, Card, Checkbox, Empty, Field, LoadingRows } from "../../../components/ui";
import { api } from "../../../lib/api";
import { readPosition } from "../../../lib/geo";
import { describeError } from "../../../lib/messages";
import { shortTime } from "../../../lib/member";
import type { LocationInput, ManagedMember, ManagerLocation } from "../../../lib/types";

const EMPTY_FORM: LocationInput = {
  name: "",
  address: null,
  latitude: 21.0285,
  longitude: 105.8048,
  allow_radius_meters: 20,
  warning_radius_meters: 50,
  is_active: true,
  expected_check_in: "08:00",
  expected_check_out: "17:00",
  grace_minutes: 10,
  enforce_hours: false,
  shift_kind: "DAY",
};

export default function ManagerLocationsPage() {
  const may = usePermissions("locations");
  const mayManageMembers = usePermissions("members");
  const [assigning, setAssigning] = useState<ManagerLocation | null>(null);
  const [roster, setRoster] = useState<ManagedMember[] | null>(null);
  const [assignedTo, setAssignedTo] = useState<Set<string>>(new Set());
  const [draftAssigned, setDraftAssigned] = useState<Set<string>>(new Set());
  const [memberSearch, setMemberSearch] = useState("");
  const [assignBusy, setAssignBusy] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [locations, setLocations] = useState<ManagerLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManagerLocation | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<LocationInput>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The pin the manager tapped: a card under the map says what it is and
  // offers the same actions as the row, so the map is a way in, not a picture.
  const [picked, setPicked] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);
  const [pinNotice, setPinNotice] = useState<string | null>(null);
  // Radii are typed as text so a field can be emptied while typing; the
  // number is read back on save. Snapping "" to 10 the instant the field was
  // cleared made "150" come out as "1050".
  const [radiusText, setRadiusText] = useState({ allow: "", warning: "" });

  const pickedLocation = (locations ?? []).find((row) => row.id === picked) ?? null;

  /** From the list to the map: pick the pin and bring the map on screen. */
  function pickOnMap(id: string) {
    setPicked(id);
    document.querySelector(".site-map")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const siteMarkers = useMemo<MapMarker[]>(
    () =>
      (locations ?? []).map((row) => ({
        id: row.id,
        point: { latitude: row.latitude, longitude: row.longitude },
        kind: row.is_active ? "site" : "site-off",
        label: row.name,
        active: row.id === picked,
      })),
    [locations, picked],
  );
  const siteCircles = useMemo<MapCircle[]>(
    () =>
      (locations ?? [])
        .filter((row) => row.is_active)
        .map((row) => ({
          center: { latitude: row.latitude, longitude: row.longitude },
          radiusMeters: row.allow_radius_meters,
          color: row.id === picked ? "#0c5cab" : "#0e7a55",
        })),
    [locations, picked],
  );
  const focus = useMemo(
    () => (pickedLocation ? { latitude: pickedLocation.latitude, longitude: pickedLocation.longitude } : null),
    [pickedLocation],
  );

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
    setRadiusText({ allow: String(EMPTY_FORM.allow_radius_meters), warning: String(EMPTY_FORM.warning_radius_meters) });
    setEditing(null);
    setCreating(true);
    setFormError(null);
    setPinNotice(null);
    // A manager usually creates a place while standing in it: the pin starts
    // at the phone's position, and the form says so. Refused or slow GPS
    // leaves the pin on the city centre with a hint to search or drag.
    setPinning(true);
    readPosition()
      .then((position) => {
        setForm((current) =>
          current.latitude === EMPTY_FORM.latitude && current.longitude === EMPTY_FORM.longitude
            ? { ...current, latitude: position.latitude, longitude: position.longitude }
            : current,
        );
        setPinNotice(`Đã ghim tại vị trí hiện tại của bạn (±${position.accuracyMeters.toFixed(0)} m). Kéo ghim nếu cần chỉnh.`);
      })
      .catch(() => setPinNotice("Không lấy được vị trí hiện tại. Tìm địa chỉ, dán liên kết Google Maps hoặc kéo ghim trên bản đồ."))
      .finally(() => setPinning(false));
  }

  function openEdit(location: ManagerLocation) {
    setPinNotice(null);
    setRadiusText({ allow: String(location.allow_radius_meters), warning: String(location.warning_radius_meters) });
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
      shift_kind: location.shift_kind,
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
    if (!radiusText.allow.trim() || !radiusText.warning.trim() || form.allow_radius_meters < 1) {
      setFormError("Nhập hai khoảng cách bằng mét.");
      return;
    }
    if (form.warning_radius_meters <= form.allow_radius_meters) {
      setFormError("Khoảng cách chặn phải lớn hơn khoảng cách cho phép chấm công.");
      return;
    }
    if (!form.expected_check_in || !form.expected_check_out) {
      setFormError("Địa điểm phải có giờ vào và giờ ra.");
      return;
    }
    if (form.expected_check_in >= form.expected_check_out) {
      setFormError("Giờ ra phải sau giờ vào. Ca đêm sẽ được hỗ trợ sau.");
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
      setPicked((current) => (current === location.id ? null : current));
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
          shift_kind: location.shift_kind,
        });
      }
      await load();
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  /**
   * Assigning from the place, not from the person.
   *
   * A manager setting up a site thinks "these six people work here", and doing
   * that person-by-person means opening six dialogs. This opens one.
   */
  async function openAssign(location: ManagerLocation) {
    setAssigning(location);
    setAssignError(null);
    setRoster(null);
    setMemberSearch("");
    setAssignedTo(new Set());
    setDraftAssigned(new Set());
    try {
      const members = await api.managerMembers();
      setRoster(members);
      const pairs = await Promise.all(
        members.map(async (member) => {
          const places = await api.assignedLocations(member.user_id);
          return places.some((place) => place.id === location.id) ? member.user_id : null;
        }),
      );
      const already = new Set(pairs.filter((id): id is string => id !== null));
      setAssignedTo(already);
      setDraftAssigned(new Set(already));
    } catch (cause) {
      setAssignError(describeError(cause));
    }
  }

  /**
   * Tick freely, save once.
   *
   * Firing a request on every tick meant twenty people was twenty round trips,
   * with no way to change your mind halfway. Only the difference is sent now.
   */
  function toggleAssignment(member: ManagedMember, next: boolean) {
    setDraftAssigned((current) => {
      const updated = new Set(current);
      if (next) {
        updated.add(member.user_id);
      } else {
        updated.delete(member.user_id);
      }
      return updated;
    });
  }

  async function saveAssignments() {
    if (!assigning) {
      return;
    }
    const added = [...draftAssigned].filter((id) => !assignedTo.has(id));
    const removed = [...assignedTo].filter((id) => !draftAssigned.has(id));
    if (added.length === 0 && removed.length === 0) {
      setAssigning(null);
      return;
    }
    setAssignBusy("saving");
    setAssignError(null);
    try {
      for (const memberId of added) {
        await api.assignLocation(memberId, assigning.id, false);
      }
      for (const memberId of removed) {
        await api.unassignLocation(memberId, assigning.id);
      }
      setAssignedTo(new Set(draftAssigned));
      setAssigning(null);
    } catch (cause) {
      setAssignError(describeError(cause));
    } finally {
      setAssignBusy(null);
    }
  }

  const visibleRoster = (roster ?? []).filter((member) => {
    const needle = memberSearch.trim().toLowerCase();
    return (
      !needle ||
      (member.full_name ?? "").toLowerCase().includes(needle) ||
      member.email.toLowerCase().includes(needle)
    );
  });
  const allVisiblePicked =
    visibleRoster.length > 0 && visibleRoster.every((member) => draftAssigned.has(member.user_id));

  /** Select-all applies to what the search is showing, never to hidden rows. */
  function toggleVisible() {
    setDraftAssigned((current) => {
      const updated = new Set(current);
      for (const member of visibleRoster) {
        if (allVisiblePicked) {
          updated.delete(member.user_id);
        } else {
          updated.add(member.user_id);
        }
      }
      return updated;
    });
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
        {may.create ? (
          <Button onClick={openCreate} icon={<span>+</span>}>
            Thêm địa điểm
          </Button>
        ) : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {locations && locations.length > 0 ? (
        <Card title="Bản đồ địa điểm" subtitle="Mỗi ghim là một nơi chấm công. Bấm ghim, hoặc bấm một dòng trong danh sách, để sửa, gán người, bật tắt hay xoá.">
          <div className="site-map">
            <GeoMap
              circles={siteCircles}
              markers={siteMarkers}
              height={380}
              fit={!picked}
              focus={focus}
              onMarkerClick={(id) => setPicked((current) => (current === id ? null : id))}
            />
            {pickedLocation ? (
              <div className="site-callout" role="region" aria-label={`Địa điểm ${pickedLocation.name}`}>
                <div className="site-callout__head">
                  <div className="site-callout__text">
                    <p className="site-callout__name">{pickedLocation.name}</p>
                    <p className="event__meta">{pickedLocation.address ?? "Chưa có địa chỉ"}</p>
                    <p className="event__meta">
                      Ca ngày {shortTime(pickedLocation.expected_check_in)} – {shortTime(pickedLocation.expected_check_out)} · chấm được
                      trong {pickedLocation.allow_radius_meters} m
                    </p>
                  </div>
                  <Badge tone={pickedLocation.is_active ? "success" : "neutral"}>
                    {pickedLocation.is_active ? "Đang bật" : "Đã tắt"}
                  </Badge>
                </div>
                <div className="row">
                  {may.edit ? (
                    <Button size="sm" onClick={() => openEdit(pickedLocation)}>
                      Sửa
                    </Button>
                  ) : null}
                  {mayManageMembers.edit ? (
                    <Button size="sm" variant="secondary" onClick={() => void openAssign(pickedLocation)}>
                      Gán người
                    </Button>
                  ) : null}
                  {may.edit ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void toggleDeactivate(pickedLocation)}
                      style={{ color: pickedLocation.is_active ? "var(--color-warning-strong)" : "var(--color-success)" }}
                    >
                      {pickedLocation.is_active ? "Tắt" : "Bật"}
                    </Button>
                  ) : null}
                  {may.delete ? (
                    <Button size="sm" variant="ghost" onClick={() => void destroy(pickedLocation)} style={{ color: "var(--color-danger)" }}>
                      Xoá
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
                    Đóng
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

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
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => (
                  <tr
                    key={location.id}
                    className={`is-clickable${location.id === picked ? " is-picked" : ""}`}
                    tabIndex={0}
                    onClick={() => pickOnMap(location.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        pickOnMap(location.id);
                      }
                    }}
                  >
                    <td data-label="Địa điểm">
                      <p className="event__label">{location.name}</p>
                      <p className="event__meta">{location.address ?? "Chưa có địa chỉ"}</p>
                    </td>
                    <td data-label="Giờ làm việc">
                      <p className="event__label">
                        Ca ngày · {shortTime(location.expected_check_in)} – {shortTime(location.expected_check_out)}
                      </p>
                      <p className="event__meta">
                        {location.enforce_hours
                          ? `Muộn quá ${location.grace_minutes} phút thì không vào được`
                          : `Muộn quá ${location.grace_minutes} phút vẫn vào được`}
                      </p>
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

            {pinning ? <Alert tone="info">Đang lấy vị trí hiện tại để ghim…</Alert> : null}
            {!pinning && pinNotice ? <Alert tone="info">{pinNotice}</Alert> : null}
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
                inputMode="numeric"
                min={1}
                max={5000}
                required
                value={radiusText.allow}
                onChange={(e) => {
                  const text = e.target.value;
                  setRadiusText((current) => ({ ...current, allow: text }));
                  const value = parseInt(text, 10);
                  if (!Number.isNaN(value)) setForm({ ...form, allow_radius_meters: value });
                }}
              />
              <Field
                label="Xa hơn mức này thì chặn (mét)"
                type="number"
                inputMode="numeric"
                min={form.allow_radius_meters + 1}
                max={10000}
                required
                value={radiusText.warning}
                onChange={(e) => {
                  const text = e.target.value;
                  setRadiusText((current) => ({ ...current, warning: text }));
                  const value = parseInt(text, 10);
                  if (!Number.isNaN(value)) setForm({ ...form, warning_radius_meters: value });
                }}
              />
            </div>
            <p className="field__hint">
              Đứng trong vòng tròn xanh thì chấm công bình thường. Ở giữa hai vòng thì vẫn chấm công được
              nhưng phải cho biết lý do. Ra ngoài vòng cam thì không chấm công được.
            </p>

            <div className="field">
              <span className="field__label">Ca làm việc</span>
              <div className="segmented" role="radiogroup" aria-label="Ca làm việc">
                <button
                  type="button"
                  role="radio"
                  aria-checked={form.shift_kind === "DAY"}
                  className={form.shift_kind === "DAY" ? "is-active" : undefined}
                  onClick={() => setForm({ ...form, shift_kind: "DAY" })}
                >
                  Ca ngày
                </button>
                <button type="button" role="radio" aria-checked={false} disabled title="Sắp có">
                  Ca đêm · sắp có
                </button>
              </div>
            </div>
            <div className="field-pair">
              <TimeField
                label="Giờ vào (bắt buộc)"
                value={form.expected_check_in}
                presets={["07:00", "08:00", "08:30", "09:00"]}
                clearable={false}
                onChange={(value) => setForm({ ...form, expected_check_in: value ?? "" })}
              />
              <TimeField
                label="Giờ ra (bắt buộc)"
                value={form.expected_check_out}
                presets={["16:00", "17:00", "17:30", "18:00"]}
                clearable={false}
                onChange={(value) => setForm({ ...form, expected_check_out: value ?? "" })}
              />
            </div>
            <p className="field__hint">
              Ca ngày bắt đầu và kết thúc trong cùng một ngày. Phiên chấm công tự khép lúc 00:00: chưa chấm
              ra thì ngày đó chỉ có lượt vào, hôm sau chấm vào bình thường.
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
      {assigning ? (
        <Dialog title={`Ai chấm công tại ${assigning.name}?`} onClose={() => setAssigning(null)}>
          <div className="stack">
            {assignError ? <Alert tone="danger">{assignError}</Alert> : null}
            {roster === null ? (
              <LoadingRows count={4} />
            ) : roster.length === 0 ? (
              <Empty>Bạn chưa quản lý thành viên nào.</Empty>
            ) : (
              <>
                <div className="picker-bar">
                  <input
                    className="input"
                    placeholder="Tìm nhanh trong danh sách"
                    value={memberSearch}
                    onChange={(event) => setMemberSearch(event.target.value)}
                  />
                  <button type="button" className="picker-bar__all" onClick={toggleVisible}>
                    {allVisiblePicked ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                  </button>
                </div>

                <div className="pick-list">
                  {visibleRoster.map((member) => (
                    <label className="pick" key={member.user_id}>
                      <input
                        type="checkbox"
                        checked={draftAssigned.has(member.user_id)}
                        onChange={(event) => toggleAssignment(member, event.target.checked)}
                      />
                      <span className="pick__body">
                        <span className="person__name">{member.full_name ?? member.email}</span>
                        <span className="event__meta">{member.email}</span>
                      </span>
                    </label>
                  ))}
                </div>

                <Button onClick={() => void saveAssignments()} loading={assignBusy === "saving"} block>
                  Lưu · {draftAssigned.size} người chấm công tại đây
                </Button>
              </>
            )}
          </div>
        </Dialog>
      ) : null}
    </ManagerShell>
  );
}
