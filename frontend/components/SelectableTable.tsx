"use client";

import { type ReactNode, useMemo } from "react";

/**
 * A table you can work on, not just read.
 *
 * Doing the same thing to twenty people one row at a time is the slowest part
 * of running this system. Tick the ones you mean, act once. The header box
 * covers what is currently on screen — never rows behind a filter you cannot
 * see, because acting on invisible rows is how accidents happen.
 */

export interface Column<T> {
  key: string;
  label: string;
  /** Right-aligned, never wrapped: counts and times read better that way. */
  numeric?: boolean;
  render: (row: T) => ReactNode;
}

export function SelectableTable<T>({
  rows,
  columns,
  idOf,
  selected,
  onSelectedChange,
  actions,
  empty,
  dense,
}: {
  rows: T[];
  columns: Column<T>[];
  idOf: (row: T) => string;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  /** Rendered above the table once something is ticked. */
  actions?: (ids: string[]) => ReactNode;
  empty: ReactNode;
  dense?: boolean;
}) {
  const ids = useMemo(() => rows.map(idOf), [rows, idOf]);
  const allTicked = ids.length > 0 && ids.every((id) => selected.has(id));
  const someTicked = ids.some((id) => selected.has(id));

  function toggleAll(next: boolean) {
    const updated = new Set(selected);
    for (const id of ids) {
      if (next) {
        updated.add(id);
      } else {
        updated.delete(id);
      }
    }
    onSelectedChange(updated);
  }

  function toggleOne(id: string, next: boolean) {
    const updated = new Set(selected);
    if (next) {
      updated.add(id);
    } else {
      updated.delete(id);
    }
    onSelectedChange(updated);
  }

  if (rows.length === 0) {
    return <>{empty}</>;
  }

  const chosen = ids.filter((id) => selected.has(id));

  return (
    <>
      {actions ? (
        <div className={`bulkbar${chosen.length > 0 ? " is-active" : ""}`}>
          <span className="bulkbar__count">
            {chosen.length > 0 ? `Đã chọn ${chosen.length}` : "Chưa chọn ai"}
          </span>
          {chosen.length > 0 ? (
            <>
              <div className="bulkbar__actions">{actions(chosen)}</div>
              <button type="button" className="bulkbar__clear" onClick={() => onSelectedChange(new Set())}>
                Bỏ chọn
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="table-wrap">
        <table className={`table table--grid${dense ? " table--dense" : ""}`}>
          <thead>
            <tr>
              <th className="cell-tick">
                {/* The label is the target: clicking it toggles the box, and it
                    is big enough to hit without being visually heavy. */}
                <label className="tick">
                  <input
                    type="checkbox"
                    checked={allTicked}
                    ref={(node) => {
                      if (node) {
                        node.indeterminate = someTicked && !allTicked;
                      }
                    }}
                    onChange={(event) => toggleAll(event.target.checked)}
                    aria-label="Chọn tất cả dòng đang hiện"
                  />
                </label>
              </th>
              {columns.map((column) => (
                <th key={column.key} className={column.numeric ? "numeric" : undefined}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const id = idOf(row);
              const ticked = selected.has(id);
              return (
                <tr key={id} className={ticked ? "is-selected" : undefined}>
                  <td className="cell-tick" data-label="Chọn">
                    <label className="tick">
                      <input
                        type="checkbox"
                        checked={ticked}
                        onChange={(event) => toggleOne(id, event.target.checked)}
                        aria-label="Chọn dòng này"
                      />
                    </label>
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      data-label={column.label}
                      className={column.numeric ? "numeric" : undefined}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
