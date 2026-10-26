# CRM Novo

CRM com WhatsApp, Agente de IA e automações, multiempresa, com visual inspirado nos apps da Apple.
Construído a partir do mapeamento do sistema de referência (20/10/2026). Plano e matriz completos: `docs/`.

## Estrutura

```
apps/web         Next.js 15 (telas, API, server actions)
packages/db      Esquema Drizzle + migrações (PostgreSQL)
packages/core    Regras de negócio: autenticação, empresas, convites, permissões
docs/            Matriz de funcionalidades, permissões, decisões
```

O serviço `worker` (filas, follow-ups, IA, WhatsApp) entra na Fase 1.

## Rodar localmente

Requisitos: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
cp .env.example apps/web/.env.local   # ajuste DATABASE_URL
DATABASE_URL=postgres://... pnpm db:migrate
DATABASE_URL=postgres://... MASTER_EMAIL=voce@email.com MASTER_PASSWORD='SenhaForte1' pnpm --filter @crm/core create-master
pnpm --filter @crm/web dev            # http://localhost:3000
```

## Testes

```bash
TEST_DATABASE_URL=postgres://.../crm_test pnpm test     # unitários e integração (banco real)
pnpm --filter @crm/web build && (cd apps/web && npx next start -p 3100 &)
cd apps/web && npx playwright test                       # ponta a ponta, computador e celular
```

## Implantação (Railway)

- Serviço `web` construído pelo `Dockerfile` (ver `railway.json`). Na inicialização aplica as migrações e sobe o servidor.
- Serviço `Postgres` do Railway; `DATABASE_URL` como referência.
- Variáveis: `DATABASE_URL`, `APP_URL`, `APP_NAME`, `SETUP_TOKEN` (só para o primeiro acesso), `RESEND_API_KEY` e `EMAIL_FROM` (opcional).
- Primeiro acesso: abra `APP_URL/setup?token=<SETUP_TOKEN>` e crie a conta Master. Depois apague a variável `SETUP_TOKEN`.
- Health check: `/api/health`.

## WhatsApp (Evolution API)

Variáveis no serviço web: `EVOLUTION_API_URL` e `EVOLUTION_API_KEY`. O CRM só opera instâncias com prefixo `crm_`
(ver docs/decisoes/0002-evolution-compartilhada.md).

Testes E2E usam uma Evolution falsa:

```bash
pnpm --filter @crm/core fake-evolution        # Evolution falsa em :3199 (chave: chave-teste) e IA falsa em :3198
cd apps/web && APP_URL=http://localhost:3100 EVOLUTION_API_URL=http://127.0.0.1:3199 EVOLUTION_API_KEY=chave-teste \
  ANTHROPIC_API_KEY=teste ANTHROPIC_BASE_URL=http://127.0.0.1:3198 npx next start -p 3100
npx playwright test
```

## Conversas

- Eventos da Evolution são gravados em `webhook_events` e processados na hora; se falharem, um reprocessador
  (em `apps/web/src/instrumentation.ts`) tenta de novo a cada 30 s, até 5 vezes.
- Tempo real: `pg_notify('crm_events')` + `/api/eventos` (Server-Sent Events).
- Mídias ficam em `message_media` (limite 16 MB por arquivo).
- Grupos e listas de transmissão são guardados como evento, mas não viram conversa.

## CRM

- Funil padrão "Funil de Vendas" e fontes são criados na primeira vez que a empresa abre o CRM.
- Quem escreve pela primeira vez no WhatsApp vira negociação na primeira etapa do funil padrão
  (não recria se a pessoa já teve negociação ganha ou perdida).
- Importar negociações (CRM → Importar) aceita o export do sistema antigo e o modelo; reimportar o export não duplica.

## Agente de IA

- Tela "Agente de IA" (admin/gestor): instruções, modelo, espera, histórico, simulador e importação do agente antigo.
- Respostas agendadas em `ai_jobs` (agrupa mensagens em sequência) e enviadas por um timer de 3 s (`instrumentation.ts`).
- Ferramentas da IA: transferir_para_humano, encerrar_atendimento e mover_etapa; buscar_catalogo e enviar_fotos quando há itens ativos no Catálogo; ver_horarios e marcar_visita quando a Agenda libera a IA.
- A IA pausa quando um atendente responde (pelo CRM ou pelo celular) e quando os créditos do mês acabam.
- 1 crédito = 1.000 tokens; limite por empresa no painel Master.

## Catálogo, agenda e rodízio

- Catálogo (`/catalogo`): itens com fotos no banco (`product_photos`), importação do `.json` do agente antigo ou CSV `titulo;descricao;valor`.
- Agenda (`/agenda`): expediente, duração e capacidade em `schedule_settings`; visitas em `appointments`. Horário fixo de Brasília (-03:00).
- Rodízio (`/equipe`) e telefone de aviso (`/conta`). Avisos vão para `notification_outbox` e saem por um timer de 5 s pela conexão de WhatsApp aberta da empresa. O link do aviso usa `APP_URL`.

## Follow-up e lembretes

- Follow-up (tela do Agente, `followup_settings`): timer de 60 s; só age quando a última mensagem foi da IA. Contador em `conversations.followup_count`, zerado quando o cliente escreve.
- Lembretes de visita (Agenda → Horários e IA): timer de 60 s; horas já tratadas ficam em `appointments.reminders_sent`.

## Painel (Início)

- `getDashboard` (packages/core/src/services/dashboard.ts): consultas SQL diretas, sem cache. Leads = negociações criadas no período; vendas = negociações ganhas com `closed_at` no período.
- Gestor (`reports.view`) vê a empresa ou uma pessoa; vendedor vê só os próprios números.

## Produtividade e áudio

- Respostas rápidas (`/respostas`), notas internas (`messages.internal`), tarefas (`/tarefas`, aviso por timer de 20 s).
- Anti-bloqueio: `reserveAutomatedSend` reserva a vez no número (`whatsapp_connections.next_automated_at`) e conta `messages.automation` do dia.
- Transcrição de áudio (opcional): `TRANSCRIBE_API_KEY`; para Groq, `TRANSCRIBE_BASE_URL=https://api.groq.com/openai/v1` e `TRANSCRIBE_MODEL=whisper-large-v3-turbo`. Sem essas variáveis usa OpenAI (`whisper-1`).
