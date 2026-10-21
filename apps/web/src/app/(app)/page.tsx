import { can } from "@crm/core";
import { ROLE_LABELS } from "@crm/db";
import Link from "next/link";
import { Badge, GroupedList, PageHeader } from "@/components/ui";
import { requireOrg } from "@/lib/session";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ "sem-permissao"?: string }>;
}) {
  const ctx = await requireOrg();
  const sp = await searchParams;
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date()),
  );
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  return (
    <>
      <PageHeader
        title={`${greeting}, ${ctx.user.name.split(" ")[0]}`}
        subtitle={`${ctx.organization.name} · ${ctx.user.isMaster && !ctx.role ? "Master" : ROLE_LABELS[ctx.role ?? "seller"]}`}
      />
      {sp["sem-permissao"] && (
        <p className="mb-6 rounded-xl bg-warn-soft px-4 py-3 text-[14px] text-warn">
          Seu papel não tem acesso àquela área.
        </p>
      )}
      <GroupedList
        title="Disponível agora"
        footer="Os módulos de atendimento e vendas entram na Fase 1, conforme o plano aprovado."
      >
        {can(ctx.actor, "members.view") && (
          <Row href="/equipe" title="Equipe" text="Convide pessoas e defina o papel de cada uma." />
        )}
        <Row href="/conta" title="Conta" text="Troque sua senha." />
        {ctx.user.isMaster && <Row href="/master" title="Painel Master" text="Crie e administre empresas." />}
        <Row
          href="/previa"
          title="Prévia visual"
          text="As 4 telas propostas, para aprovar o visual."
          badge="Fase 0"
        />
      </GroupedList>
    </>
  );
}

function Row({ href, title, text, badge }: { href: string; title: string; text: string; badge?: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-fill/60">
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-medium">{title}</p>
        <p className="text-[14px] text-ink-2">{text}</p>
      </div>
      {badge && <Badge tone="accent">{badge}</Badge>}
      <span aria-hidden className="text-ink-3">
        ›
      </span>
    </Link>
  );
}
