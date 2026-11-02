"use client";

import {
  BarChart3,
  Bot,
  Building2,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronsUpDown,
  Crown,
  Home,
  KanbanSquare,
  ListTodo,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  Package,
  Plug,
  Settings2,
  Smartphone,
  UserRound,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { logoutAction, switchOrgAction } from "@/app/actions/auth";
import { Avatar, cx } from "./ui";

type Org = { id: string; name: string };
type NavItem = { href: string; label: string; icon: ReactNode; primary?: boolean; group?: GroupId };
type GroupId = "dia" | "vendas" | "automacao" | "marketing" | "config";
const GROUPS: { id: GroupId; label: string }[] = [
  { id: "dia", label: "Dia a dia" },
  { id: "vendas", label: "Vendas" },
  { id: "automacao", label: "Automação" },
  { id: "marketing", label: "Anúncios" },
  { id: "config", label: "Configurações" },
];
const OPEN_KEY = "crm.menu.abertos";

export function Shell({
  children,
  user,
  org,
  orgs,
  canSeeTeam,
  canManageConnections,
  canConfigure,
}: {
  children: ReactNode;
  user: { name: string; email: string; isMaster: boolean };
  org: Org;
  orgs: Org[];
  canSeeTeam: boolean;
  canManageConnections: boolean;
  canConfigure: boolean;
}) {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const nav: NavItem[] = [
    { href: "/", label: "Início", icon: <Home size={20} />, primary: true },
    { href: "/conversas", label: "Conversas", icon: <MessageCircle size={20} />, primary: true },
    { href: "/crm", label: "CRM", icon: <KanbanSquare size={20} />, primary: true },
    { href: "/contatos", label: "Contatos", icon: <UserRound size={20} />, primary: true },
    { href: "/tarefas", label: "Tarefas", icon: <ListTodo size={20} />, group: "dia" },
    { href: "/agendadas", label: "Agendadas", icon: <CalendarClock size={20} />, group: "dia" },
    { href: "/agenda", label: "Agenda", icon: <CalendarDays size={20} />, group: "dia" },
    { href: "/catalogo", label: "Catálogo", icon: <Package size={20} />, group: "vendas" },
    { href: "/respostas", label: "Respostas rápidas", icon: <Zap size={20} />, group: "vendas" },
    ...(canConfigure
      ? ([
          { href: "/agente", label: "Agente de IA", icon: <Bot size={20} />, group: "automacao" },
          { href: "/fluxos", label: "Fluxos", icon: <Workflow size={20} />, group: "automacao" },
          { href: "/campanhas", label: "Campanhas", icon: <Megaphone size={20} />, group: "automacao" },
          { href: "/anuncios", label: "Anúncios", icon: <BarChart3 size={20} />, group: "marketing" },
          { href: "/meta", label: "Integração Meta", icon: <Plug size={20} />, group: "marketing" },
        ] satisfies NavItem[])
      : []),
    ...(canSeeTeam
      ? [{ href: "/equipe", label: "Equipe", icon: <Users size={20} />, group: "config" as const }]
      : []),
    ...(canManageConnections
      ? [{ href: "/conexoes", label: "Conexões", icon: <Smartphone size={20} />, group: "config" as const }]
      : []),
    { href: "/conta", label: "Conta", icon: <Settings2 size={20} />, group: "config" },
    ...(user.isMaster
      ? [{ href: "/master", label: "Master", icon: <Crown size={20} />, group: "config" as const }]
      : []),
  ];
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  const activeGroup = nav.find((n) => n.group && isActive(n.href))?.group;
  // Categorias abertas: lembradas neste navegador; a da tela atual sempre abre.
  const [open, setOpen] = useState<GroupId[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as GroupId[];
      setOpen(Array.isArray(saved) ? saved : []);
    } catch {}
  }, []);
  useEffect(() => {
    if (activeGroup) setOpen((o) => (o.includes(activeGroup) ? o : [...o, activeGroup]));
  }, [activeGroup]);
  const toggleGroup = (g: GroupId) =>
    setOpen((o) => {
      const next = o.includes(g) ? o.filter((x) => x !== g) : [...o, g];
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  const groups = GROUPS.map((g) => ({ ...g, items: nav.filter((n) => n.group === g.id) })).filter(
    (g) => g.items.length,
  );
  const link = (n: NavItem) => (
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
  );

  return (
    <div className="min-h-dvh md:flex">
      {/* Barra lateral (computador) */}
      <aside className="material sticky top-0 hidden h-dvh w-[260px] shrink-0 flex-col border-r border-separator px-3 py-4 md:flex">
        <OrgSwitcher org={org} orgs={orgs} />
        <nav className="mt-4 min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label="Principal">
          {nav.filter((n) => n.primary).map(link)}
          {groups.map((g) => {
            const isOpen = open.includes(g.id);
            return (
              <div key={g.id} className="pt-2">
                <button
                  type="button"
                  onClick={() => toggleGroup(g.id)}
                  aria-expanded={isOpen}
                  className={cx(
                    "flex h-8 w-full items-center gap-2 rounded-lg px-3 text-[12px] font-semibold uppercase tracking-wide hover:bg-fill",
                    g.id === activeGroup ? "text-accent" : "text-ink-3",
                  )}
                >
                  <span className="flex-1 text-left">{g.label}</span>
                  <ChevronDown size={14} className={cx("transition-transform", !isOpen && "-rotate-90")} />
                </button>
                {isOpen && <div className="space-y-0.5">{g.items.map(link)}</div>}
              </div>
            );
          })}
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

      <main className="min-w-0 flex-1 px-4 pb-28 pt-[max(1.5rem,env(safe-area-inset-top))] md:px-10 md:pb-12 md:pt-10">
        <div className="mx-auto max-w-[1100px]">{children}</div>
      </main>

      {/* Barra de abas (celular): 4 principais + Mais */}
      <nav
        aria-label="Principal"
        className="material fixed inset-x-0 bottom-0 z-20 flex border-t border-separator pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {nav
          .filter((n) => n.primary)
          .map((n) => (
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
        <button
          type="button"
          onClick={() => setMore(true)}
          className={cx(
            "flex h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
            nav.some((n) => !n.primary && isActive(n.href)) ? "text-accent" : "text-ink-3",
          )}
        >
          <Menu size={20} />
          Mais
        </button>
      </nav>
      {more && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Mais"
        >
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Fechar"
            onClick={() => setMore(false)}
          />
          <div className="relative max-h-[80dvh] w-full overflow-y-auto rounded-t-[22px] bg-surface p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {groups.map((g) => (
              <div key={g.id} className="mb-1">
                <p className="px-3 pt-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
                  {g.label}
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {g.items.map((n) => (
                    <Link
                      key={n.href}
                      href={n.href}
                      onClick={() => setMore(false)}
                      className={cx(
                        "flex h-12 items-center gap-2.5 rounded-xl px-3 text-[15px]",
                        isActive(n.href) ? "bg-accent-soft text-accent" : "bg-fill/60 text-ink",
                      )}
                    >
                      {n.icon}
                      <span className="min-w-0 leading-tight">{n.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
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
