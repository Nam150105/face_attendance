import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
  loading?: boolean;
}

export function Button({ variant = "primary", block, loading, children, disabled, ...rest }: ButtonProps) {
  const classes = ["button"];
  if (variant !== "primary") {
    classes.push(`button--${variant}`);
  }
  if (block) {
    classes.push("button--block");
  }
  return (
    <button className={classes.join(" ")} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
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
}

export function Field({ label, hint, id, ...rest }: FieldProps) {
  const inputId = id ?? `field-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <input className="input" id={inputId} aria-describedby={hintId} {...rest} />
      {hint ? (
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
  const inputId = id ?? `textarea-${label.replace(/\s+/g, "-").toLowerCase()}`;
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

export function SelectField({
  label,
  hint,
  id,
  children,
  ...rest
}: {
  label: string;
  hint?: string;
  id?: string;
  children: ReactNode;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const inputId = id ?? `select-${label.replace(/\s+/g, "-").toLowerCase()}`;
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

type Tone = "info" | "success" | "warning" | "danger";

export function Alert({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <span>{children}</span>
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: Tone | "neutral"; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function DataList({ rows }: { rows: Array<{ key: string; value: ReactNode }> }) {
  return (
    <dl className="datalist">
      {rows.map((row) => (
        <div className="datalist__row" key={row.key}>
          <dt className="datalist__key">{row.key}</dt>
          <dd className="datalist__value">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function LoadingRows({ count = 3 }: { count?: number }) {
  return (
    <div className="stack stack--tight" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Đang tải dữ liệu</span>
      {Array.from({ length: count }, (_, index) => (
        <span className="skeleton" key={index} style={{ width: `${100 - index * 15}%` }} />
      ))}
    </div>
  );
}
