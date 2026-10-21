"use client";

import { Building2, ChevronsUpDown, Crown, Home, LogOut, Settings2, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { logoutAction, switchOrgAction } from "@/app/actions/auth";
import { Avatar, cx } from "./ui";

type Org = { id: string; name: string };
type NavItem = { href: string; label: string; icon: ReactNode };

export function Shell({
  children,
  user,
  org,
  orgs,
  canSeeTeam,
}: {
  children: ReactNode;
  user: { name: string; email: string; isMaster: boolean };
  org: Org;
  orgs: Org[];
  canSeeTeam: boolean;
}) {
  const pathname = usePathname();
  const nav: NavItem[] = [
    { href: "/", label: "Início", icon: <Home size={20} /> },
    ...(canSeeTeam ? [{ href: "/equipe", label: "Equipe", icon: <Users size={20} /> }] : []),
    { href: "/conta", label: "Conta", icon: <Settings2 size={20} /> },
    ...(user.isMaster ? [{ href: "/master", label: "Master", icon: <Crown size={20} /> }] : []),
  ];
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="min-h-dvh md:flex">
      {/* Barra lateral (computador) */}
      <aside className="material sticky top-0 hidden h-dvh w-[260px] shrink-0 flex-col border-r border-separator px-3 py-4 md:flex">
        <OrgSwitcher org={org} orgs={orgs} />
        <nav className="mt-4 space-y-0.5" aria-label="Principal">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                "flex h-9 items-center gap-3 rounded-lg px-3 text-[15px] transition-colors",
                isActive(n.href) ? "bg-accent text-white" : "text-ink hover:bg-fill",
              )}
            >
              {n.icon}
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-3 rounded-xl px-2 py-2">
          <Avatar name={user.name} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium">{user.name}</p>
            <p className="truncate text-[12px] text-ink-3">{user.email}</p>
          </div>
          <form action={logoutAction}>
            <button className="rounded-lg p-2 text-ink-2 hover:bg-fill" aria-label="Sair" title="Sair">
              <LogOut size={18} />
            </button>
          </form>
        </div>
      </aside>

      {/* Cabeçalho (celular) */}
      <header className="material sticky top-0 z-20 flex h-12 items-center justify-between border-b border-separator px-4 md:hidden">
        <OrgSwitcher org={org} orgs={orgs} compact />
        <form action={logoutAction}>
          <button className="rounded-lg p-2 text-ink-2" aria-label="Sair">
            <LogOut size={18} />
          </button>
        </form>
      </header>

      <main className="min-w-0 flex-1 px-4 pb-28 pt-6 md:px-10 md:pb-12 md:pt-10">
        <div className="mx-auto max-w-[1100px]">{children}</div>
      </main>

      {/* Barra de abas (celular) */}
      <nav
        aria-label="Principal"
        className="material fixed inset-x-0 bottom-0 z-20 flex border-t border-separator pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cx(
              "flex h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
              isActive(n.href) ? "text-accent" : "text-ink-3",
            )}
          >
            {n.icon}
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function OrgSwitcher({ org, orgs, compact }: { org: Org; orgs: Org[]; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx(
          "flex items-center gap-2.5 rounded-xl text-left hover:bg-fill",
          compact ? "h-9 px-2" : "h-12 w-full px-2",
        )}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent text-white">
          <Building2 size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{org.name}</span>
        </span>
        {orgs.length > 1 && <ChevronsUpDown size={16} className="text-ink-3" />}
      </button>
      {open && orgs.length > 1 && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-xl bg-surface p-1 shadow-float">
          <p className="px-3 pb-1 pt-2 text-[12px] font-medium uppercase tracking-wide text-ink-3">
            Trocar de empresa
          </p>
          {orgs.map((o) => (
            <form key={o.id} action={switchOrgAction}>
              <input type="hidden" name="organizationId" value={o.id} />
              <button
                className={cx(
                  "flex h-9 w-full items-center rounded-lg px-3 text-left text-[15px] hover:bg-fill",
                  o.id === org.id && "font-semibold text-accent",
                )}
              >
                {o.name}
              </button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
