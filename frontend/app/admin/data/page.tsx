"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "../../../components/AdminShell";
import { Dialog } from "../../../components/Dialog";
import { Alert, Button, Card, Empty, Field, LoadingRows, SelectField } from "../../../components/ui";
import { api } from "../../../lib/api";
import { describeError } from "../../../lib/messages";

const PAGE_SIZE = 25;

interface Column {
  name: string;
  type: string;
  nullable: boolean;
  has_default: boolean;
  readonly: boolean;
}

interface Rows {
  table: string;
  label: string;
  columns: Column[];
  total: number;
  items: Record<string, unknown>[];
}

function show(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Cut the text itself rather than hiding the overflow. A UUID clipped by CSS
 * still occupies its full width in the layout, which pushed the edit buttons
 * off the right edge of the screen. The whole value stays in the cell's title.
 */
function brief(value: unknown): string {
  const text = show(value);
  return text.length > 24 ? `${text.slice(0, 23)}…` : text;
}

export default function AdminDataPage() {
  const [tables, setTables] = useState<{ name: string; label: string; rows: number }[] | null>(null);
  const [table, setTable] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Rows | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .adminTables()
      .then((result) => {
        setTables(result.tables);
        setTable((current) => current || result.tables[0]?.name || "");
      })
      .catch((cause) => setError(describeError(cause)));
  }, []);

  const load = useCallback(async () => {
    if (!table) {
      return;
    }
    setRows(null);
    try {
      setRows(await api.adminRows(table, { search: search || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE }));
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [table, search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(row: Record<string, unknown>) {
    setEditing(row);
    setCreating(false);
    setDialogError(null);
    setDraft(
      Object.fromEntries(
        (rows?.columns ?? []).filter((column) => !column.readonly).map((column) => [column.name, show(row[column.name])]),
      ),
    );
  }

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setDialogError(null);
    setDraft({});
  }

  /** Only fields the person actually touched are sent, so blank optional
   *  columns keep their database default instead of being forced to null. */
  function changed(row: Record<string, unknown> | null): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(draft)) {
      if (row === null) {
        if (value !== "") {
          values[name] = value;
        }
      } else if (value !== show(row[name])) {
        values[name] = value;
      }
    }
    return values;
  }

  async function save() {
    const values = changed(editing);
    if (Object.keys(values).length === 0) {
      setDialogError("Bạn chưa sửa gì cả.");
      return;
    }
    setBusy(true);
    setDialogError(null);
    try {
      if (creating) {
        await api.adminInsertRow(table, values);
        setNotice("Đã thêm một dòng mới.");
      } else {
        await api.adminUpdateRow(table, String(editing?.id), values);
        setNotice("Đã lưu thay đổi.");
      }
      setEditing(null);
      setCreating(false);
      await load();
    } catch (cause) {
      setDialogError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Record<string, unknown>) {
    if (!window.confirm(`Xoá vĩnh viễn dòng này khỏi bảng ${table}? Không hoàn tác được.`)) {
      return;
    }
    setBusy(true);
    try {
      await api.adminDeleteRow(table, String(row.id));
      setNotice("Đã xoá một dòng.");
      await load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  const lastPage = rows ? Math.max(0, Math.ceil(rows.total / PAGE_SIZE) - 1) : 0;
  const editable = (rows?.columns ?? []).filter((column) => !column.readonly);

  return (
    <AdminShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dữ liệu hệ thống</h1>
          <p className="page-lead">Xem và sửa trực tiếp từng dòng trong các bảng nghiệp vụ.</p>
        </div>
        <Button onClick={openCreate} disabled={!rows}>
          Thêm dòng
        </Button>
      </div>

      <Alert tone="warning">
        Đây là dữ liệu thật, sửa là có hiệu lực ngay và không có bước hoàn tác. Mọi thao tác đều được
        ghi vào nhật ký kèm tên bạn.
      </Alert>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card className="filter-card">
        <div className="filters-bar filters-bar--compact">
          <SelectField
            label="Bảng"
            value={table}
            onChange={(event) => {
              setTable(event.target.value);
              setPage(0);
              setSearch("");
            }}
          >
            {(tables ?? []).map((item) => (
              <option key={item.name} value={item.name}>
                {item.label} ({item.rows})
              </option>
            ))}
          </SelectField>
          <Field
            label="Tìm trong bảng"
            placeholder="Nhập rồi nhấn Enter"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </div>
      </Card>

      <Card title={rows ? `${rows.label} · ${rows.total} dòng` : "Đang tải"}>
        {rows === null ? (
          <LoadingRows count={6} />
        ) : rows.items.length === 0 ? (
          <Empty>Bảng này chưa có dòng nào khớp.</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table--dense">
                <thead>
                  <tr>
                    {rows.columns.map((column) => (
                      <th key={column.name}>{column.name}</th>
                    ))}
                    <th aria-label="Thao tác" className="cell-actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.items.map((row, index) => (
                    <tr key={String(row.id ?? index)}>
                      {rows.columns.map((column) => (
                        <td key={column.name} data-label={column.name} title={show(row[column.name])}>
                          {brief(row[column.name]) || "—"}
                        </td>
                      ))}
                      <td data-label="Thao tác" className="cell-actions">
                        <div className="row">
                          <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>
                            Sửa
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void remove(row)}
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

            <div className="pagination">
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                ← Trước
              </Button>
              <span className="mono">
                Trang {page + 1} / {lastPage + 1}
              </span>
              <Button variant="secondary" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
                Sau →
              </Button>
            </div>
          </>
        )}
      </Card>

      {editing || creating ? (
        <Dialog
          title={creating ? `Thêm dòng vào ${rows?.label}` : `Sửa dòng trong ${rows?.label}`}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        >
          <div className="stack">
            {dialogError ? <Alert tone="danger">{dialogError}</Alert> : null}
            {editing ? <p className="event__meta mono">id: {String(editing.id)}</p> : null}

            {editable.map((column) => (
              <Field
                key={column.name}
                label={column.name}
                hint={`${column.type}${column.nullable ? " · có thể để trống" : " · bắt buộc"}`}
                value={draft[column.name] ?? ""}
                onChange={(event) => setDraft({ ...draft, [column.name]: event.target.value })}
              />
            ))}

            <Button onClick={() => void save()} loading={busy} block>
              {creating ? "Thêm dòng" : "Lưu thay đổi"}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </AdminShell>
  );
}
