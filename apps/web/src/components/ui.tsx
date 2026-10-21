import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "plain" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-press active:scale-[0.98]",
  secondary: "bg-fill text-ink hover:bg-fill-strong active:scale-[0.98]",
  plain: "text-accent hover:bg-accent-soft",
  danger: "bg-danger-soft text-danger hover:brightness-95",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "h-8 px-3 text-[13px]",
    md: "h-10 px-4 text-[15px]",
    lg: "h-12 px-5 text-[17px] w-full",
  };
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: o controle vem como children
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}

const inputBase =
  "w-full h-11 rounded-xl bg-fill px-3.5 text-[15px] text-ink placeholder:text-ink-3 outline-none ring-0 transition focus:bg-surface focus:shadow-[0_0_0_4px_var(--accent-soft)] focus:outline-none";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputBase, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputBase, "appearance-none pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-[var(--radius-card)] bg-surface", className)}>{children}</div>;
}

/** Lista agrupada no estilo Ajustes do iOS. */
export function GroupedList({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      {title && (
        <h2 className="mb-2 px-4 text-[13px] font-medium uppercase tracking-wide text-ink-3">{title}</h2>
      )}
      <div className="divide-y divide-separator overflow-hidden rounded-[var(--radius-card)] bg-surface">
        {children}
      </div>
      {footer && <p className="mt-2 px-4 text-[13px] text-ink-3">{footer}</p>}
    </section>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "ok" | "warn" | "danger";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-fill text-ink-2",
    accent: "bg-accent-soft text-accent",
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
  };
  return (
    <span
      className={cx("inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-medium", tones[tone])}
    >
      {children}
    </span>
  );
}

const avatarHues = ["#0071e3", "#34aadc", "#5856d6", "#af52de", "#ff2d55", "#ff9500", "#30b0c7", "#248a3d"];
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const parts = name.trim().split(/\s+/);
  const ini =
    ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
  const hue = avatarHues[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % avatarHues.length];
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: hue }}
    >
      {ini}
    </span>
  );
}

export function Notice({
  tone = "danger",
  children,
}: {
  tone?: "danger" | "ok" | "accent";
  children: ReactNode;
}) {
  const tones = {
    danger: "bg-danger-soft text-danger",
    ok: "bg-ok-soft text-ok",
    accent: "bg-accent-soft text-accent",
  };
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={cx("rounded-xl px-3.5 py-2.5 text-[14px]", tones[tone])}
    >
      {children}
    </p>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="large-title">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
