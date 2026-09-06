"use client";

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
  loading?: boolean;
  size?: "md" | "sm" | "lg";
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  block,
  loading,
  size = "md",
  icon,
  children,
  disabled,
  // HTML defaults a <button> inside a form to type="submit", which made every
  // secondary action in a form submit it — "Tim" on the location picker saved a
  // half-filled location, "Huy" saved instead of closing. Submitting is now
  // opt-in via type="submit".
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = ["button"];
  if (variant !== "primary") {
    classes.push(`button--${variant}`);
  }
  if (size === "sm") {
    classes.push("button--sm");
  } else if (size === "lg") {
    classes.push("button--lg");
  }
  if (block) {
    classes.push("button--block");
  }
  return (
    <button type={type} className={classes.join(" ")} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
}

export function Card({
  title,
  subtitle,
  action,
  glow,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  glow?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${glow ? "card--glow" : ""} ${className ?? ""}`}>
      {title ? (
        <header className="card__header">
          <div>
            <h2 className="card__title">{title}</h2>
            {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Field({ label, hint, error, id, ...rest }: FieldProps) {
  const inputId = id ?? `f-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <input className="input" id={inputId} aria-describedby={hintId} {...rest} />
      {error ? (
        <span className="field__hint" style={{ color: "var(--color-danger)" }}>
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
}

export function TextAreaField({ label, hint, id, ...rest }: TextAreaFieldProps) {
  const inputId = id ?? `t-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <textarea className="textarea" id={inputId} aria-describedby={hintId} {...rest} />
      {hint ? (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  children: ReactNode;
}

export function SelectField({ label, hint, id, children, ...rest }: SelectFieldProps) {
  const inputId = id ?? `s-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <select className="select" id={inputId} {...rest}>
        {children}
      </select>
      {hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

type Tone = "info" | "success" | "warning" | "danger";

export function Alert({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <span>{children}</span>
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone | "neutral";
  children: ReactNode;
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function DataList({
  rows,
}: {
  rows: Array<{ key: string; value: ReactNode }>;
}) {
  return (
    <div className="datalist">
      {rows.map((row, index) => (
        <div className="datalist__row" key={index}>
          <span className="datalist__key">{row.key}</span>
          <span className="datalist__value">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <svg
        style={{ margin: "0 auto 12px", display: "block", color: "var(--text-muted)", opacity: 0.6 }}
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
      {children}
    </div>
  );
}

export function LoadingRows({ count = 3 }: { count?: number }) {
  return (
    <div className="stack" aria-label="Đang tải dữ liệu...">
      {Array.from({ length: count }).map((_, index) => (
        <div className="skeleton skeleton-row" key={index} />
      ))}
    </div>
  );
}

/** Synthesize a pleasant feedback chime with Web Audio API */
export function playChime(type: "success" | "shutter" | "click" = "success") {
  if (typeof window === "undefined") return;
  try {
    const AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    if (type === "success") {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = "sine";
      osc2.type = "triangle";
      osc1.frequency.setValueAtTime(523.25, now); // C5
      osc1.frequency.exponentialRampToValueAtTime(659.25, now + 0.1); // E5
      osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.2); // G5
      osc2.frequency.setValueAtTime(1046.5, now + 0.1); // C6

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now + 0.1);
      osc1.stop(now + 0.45);
      osc2.stop(now + 0.45);
    } else if (type === "shutter") {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.08);

      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  } catch {
    // Audio feedback is purely non-critical enhancement.
  }
}
