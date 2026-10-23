# Matriz de funcionalidades

Atualizada a cada entrega. Detalhe de implementação e validação de cada item no documento do plano.

| ID | Funcionalidade | Fase | Status | Evidência |
| --- | --- | --- | --- | --- |
| F01 | Login, sessão, recuperação de senha | 0 | Parcial | Login, sessão de 30 dias, troca de senha e bloqueio por tentativas: testes unitários, integração e E2E. Falta recuperação de senha por e-mail (depende do Resend). |
| F02 | Multiempresa, painel Master e troca de conta | 0 | Concluído | Integração + E2E (criar empresa, convite, troca de empresa, suspensão). |
| F03 | Papéis e permissões | 0 | Concluído (proposta) | Unitário por papel + E2E vendedor sem acesso à Equipe. Matriz aguardando ajuste. |
| F04 | Departamentos | 0 | Pendente | Tabela criada; telas entram junto com Conversas (Fase 1). |
| F05 | Conexão WhatsApp por QR | 1 | Concluído | Tela Conexões (criar, QR, reconectar, desconectar, desativar, excluir), limite por empresa no Master, webhook com segredo por conexão. Integração + E2E; validado em produção com leitura real do QR (23/10/2026) e webhooks chegando da Evolution. |
| F06 | Lista de conversas, nova conversa | 1 | Concluído | Lista em tempo real (SSE), filtros Abertas/Não lidas/Minhas/Fechadas/Todas, busca, nova conversa com checagem do número e regra do 9º dígito. Integração + E2E; validado em produção com WhatsApp real (23/10/2026). |
| F07 | Filtros avançados e condições | 1 | Pendente |  |
| F08 | Enviar e receber mídias | 1 | Concluído (parcial) | Texto, imagem, vídeo, áudio (como arquivo) e documento nos dois sentidos, status enviado/entregue/lido, "tentar de novo". Validado em produção. Pendente: gravar áudio no navegador. |
| F09 | Responder, editar, excluir mensagem | 1 | Pendente |  |
| F10 | Transcrição de áudio | 1 | Pendente |  |
| F11 | Posse da conversa | 1 | Concluído | Puxar para mim, atribuir (gestor/admin), responder conversa sem dono assume; vendedor/atendente veem as suas e as sem dono. Integração + E2E; validado em produção. |
| F12 | Painel do lead, fechar/reabrir | 1 | Parcial | Fechar/reabrir feito (cliente escrevendo reabre). Painel do lead entra com o CRM de negociações. |
| F13 | Sequências, respostas rápidas, ações rápidas (/), notas internas | 1 | Pendente |  |
| F14 | Inteligência de Conversas | 1 | Pendente |  |
| F15 | Contatos: CRUD, filtros, exportar | 1 | Concluído | Lista paginada com busca, novo, editar (telefone fixo), excluir com histórico, exportar e importar CSV (formato antigo e modelo) sem duplicar, com ou sem o 9. Integração + E2E; validado em produção com os 448 contatos (23/10/2026). |
| F16 | Funis e estágios | 1 | Em validação | Vários funis, funil padrão (recebe leads automáticos), etapas com cor, ordem e tipo (andamento, agendamento, ganho, perdido); não exclui etapa/funil com negociações. Integração + E2E. |
| F17 | Kanban, mover estágio, histórico | 1 | Em validação | Quadro por funil com contagem e soma por etapa, arrastar no computador, trocar etapa pelo painel no celular, tempo real, histórico (criação, etapa, responsável, valor, etiquetas, anotações). Integração + E2E. |
| F18 | Lista, paginação, exportar | 1 | Pendente |  |
| F19 | Ações em massa | 1 | Pendente |  |
| F20 | Nova negociação | 1 | Em validação | Por telefone (reaproveita o contato), título, valor, etapa, fonte e responsável; número sequencial por empresa. Lead automático no funil padrão para quem escreve pela primeira vez. Integração + E2E. |
| F21 | Detalhe: compras, atividades, produtos, score, campos | 1 | Parcial | Painel com contato, link para a conversa, etapa, responsável, valor, fonte, descrição, etiquetas, anotações e campos trazidos na importação. Compras, produtos, score e campos personalizados: pendentes. |
| F22 | Tarefas, modelos, Minhas tarefas | 1 | Pendente |  |
| F23 | Etiquetas, fontes, campos, produtos | 1 | Parcial | Etiquetas (cor, criar só admin/gestor) e fontes. Campos personalizados e produtos: pendentes. |
| F24 | Importação CSV | 1 | Em validação | Contatos e negociações: export do sistema antigo e modelo (apenas_contato, criar_negociacao, recorrente, etiquetas, data de criação); cria funis, etapas, fontes e etiquetas que faltarem; reimportar o export não duplica; colunas sem campo próprio ficam guardadas na negociação. Integração + E2E. |
| F25 | Rodízio de vendedores e aviso | 1 | Pendente |  |
| F26 | Agente: prompt, etapas, FAQ, modelos, gerador | 1 | Pendente |  |
| F27 | Agente: documentos (RAG) | 1 | Pendente |  |
| F28 | Agente: catálogo | 1 | Pendente |  |
| F29 | Agente: intervenção, exclusão, pausa | 1 | Pendente |  |
| F30 | Agente: notificações ao vendedor | 1 | Pendente |  |
| F31 | Agente: sentimento, nota, ICP, resumo | 1 | Pendente |  |
| F32 | Agente: simulador, logs, diagnóstico | 1 | Pendente |  |
| F33 | Agente: créditos e economia | 1 | Pendente |  |
| F34 | Follow-up, fila e anti-banimento | 1 | Pendente |  |
| F35 | Mensagens agendadas e lotes | 1 | Pendente |  |
| F36 | Agendamentos: calendário e lista | 1 | Pendente |  |
| F37 | Lembretes e retornos | 1 | Pendente |  |
| F38 | Dashboard Vendas, Análise de IA, Automações | 1 | Pendente |  |
| F39 | Dashboard SLA | 1 | Pendente |  |
| F40 | Personalizar dashboard | 1 | Pendente |  |
| F41 | Fluxos: gatilhos, editor, versões, simular, templates | 2 | Pendente |  |
| F42 | Conversão por palavra-chave | 2 | Pendente |  |
| F43 | Movimentação por inatividade | 2 | Pendente |  |
| F44 | Tarefas automáticas por estágio | 2 | Pendente |  |
| F45 | Meta CAPI | 2 | Pendente |  |
| F46 | Formulários Lead Ads | 2 | Pendente |  |
| F47 | Anúncios: sincronização e painéis | 2 | Pendente |  |
| F48 | Rastreamento: pixel, links, atribuição | 2 | Pendente |  |
| F49 | Google Agenda | 2 | Pendente |  |
| F50 | Relatórios por WhatsApp e PDF | 2 | Pendente |  |
| F51 | Notificações push e sons | 2 | Pendente |  |
| F52 | Instagram: Direct e comentários | 3 | Pendente |  |
| F53 | API Oficial do WhatsApp | 3 | Pendente |  |
| F54 | Disparos: campanhas, listas, histórico | 3 | Pendente |  |
| F55 | Ligações e voz (Twilio, ElevenLabs) | 3 | Pendente |  |
| F56 | E-mail marketing | 3 | Pendente |  |
| F57 | Google Ads: conversões offline | 3 | Pendente |  |
| F58 | Chat interno | 3 | Pendente |  |
| F59 | Catálogo de integrações por webhook | 4 | Pendente |  |
| F60 | Central de ajuda e tutoriais | 4 | Pendente |  |
| F61 | Migração de dados da referência | 4 | Pendente |  |

Itens extras da Fase 0 (infraestrutura): monorepo, CI (lint, tipos, testes, build, E2E), Dockerfile, health check, prévia visual de 4 telas (computador, celular, claro e escuro): concluídos.
