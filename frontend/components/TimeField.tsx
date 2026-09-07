"use client";

import { useId } from "react";

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const MINUTES = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

interface TimeFieldProps {
  label: string;
  /** "HH:MM" or "HH:MM:SS"; empty string means not set. */
  value: string | null;
  onChange: (value: string | null) => void;
  hint?: string;
  presets?: string[];
  clearable?: boolean;
}

function split(value: string | null): { hour: string; minute: string } {
  if (!value) {
    return { hour: "", minute: "" };
  }
  const [hour = "", minute = ""] = value.split(":");
  return { hour: hour.padStart(2, "0"), minute: minute.padStart(2, "0") };
}

/** "07:03" -> "07:05" so a stored value always matches one of the options. */
function nearestOption(minute: string): string {
  if (MINUTES.includes(minute)) {
    return minute;
  }
  const value = Number(minute);
  if (Number.isNaN(value)) {
    return "00";
  }
  return MINUTES.reduce((best, option) =>
    Math.abs(Number(option) - value) < Math.abs(Number(best) - value) ? option : best,
  );
}

/**
 * Two plain selects instead of <input type="time">.
 *
 * The native control renders as "--:-- --", which reads as a broken field: there
 * is nothing to indicate it wants an hour and a minute, the AM/PM segment
 * appears or not depending on the browser locale, and on Android the picker is a
 * clock dial that takes four taps to set 08:00. Selects show real values, work
 * the same in every browser, and set a shift in two taps.
 */
export function TimeField({ label, value, onChange, hint, presets, clearable = true }: TimeFieldProps) {
  const id = useId();
  const { hour, minute } = split(value);

  function update(nextHour: string, nextMinute: string) {
    if (!nextHour && !nextMinute) {
      onChange(null);
      return;
    }
    onChange(`${nextHour || "08"}:${nextMinute || "00"}`);
  }

  return (
    <div className="field">
      <span className="field__label" id={`${id}-label`}>
        {label}
      </span>

      {presets && presets.length > 0 ? (
        <div className="timefield__presets">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`pill-chip ${value?.slice(0, 5) === preset ? "pill-chip--active" : ""}`}
              onClick={() => onChange(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      ) : null}

      <div className="timefield" role="group" aria-labelledby={`${id}-label`}>
        <select
          className="select timefield__part"
          aria-label={`${label} — giờ`}
          value={hour}
          onChange={(event) => update(event.target.value, minute || "00")}
        >
          <option value="">Giờ</option>
          {HOURS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <span className="timefield__colon" aria-hidden="true">
          :
        </span>

        <select
          className="select timefield__part"
          aria-label={`${label} — phút`}
          value={minute ? nearestOption(minute) : ""}
          onChange={(event) => update(hour || "08", event.target.value)}
        >
          <option value="">Phút</option>
          {MINUTES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        {clearable && value ? (
          <button type="button" className="timefield__clear" onClick={() => onChange(null)}>
            Xoá
          </button>
        ) : null}
      </div>

      {hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}
