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
| F09 | Responder, editar, excluir mensagem | 1 | Em validação | Responder citando (mensagem do cliente ou nossa; respostas do cliente também aparecem citadas), editar texto até 15 min e apagar para todos até 48 h (quem enviou ou gestor), pela Evolution (updateMessage, deleteMessageForEveryone). Edição e apagado feitos pelo cliente aparecem no CRM ("editada", "O cliente apagou", texto riscado para a equipe). Integração + E2E. |
| F10 | Transcrição de áudio | 1 | Concluído | Áudio do cliente transcrito (API compatível com a OpenAI: OpenAI whisper-1 ou Groq whisper-large-v3-turbo, variáveis TRANSCRIBE_*). A IA transcreve sozinha antes de responder; na conversa, botão Transcrever e o texto abaixo do áudio. Sem chave, a IA segue dizendo que não ouve. Integração + E2E. Validado em produção (26/10/2026). |
| F11 | Posse da conversa | 1 | Concluído | Puxar para mim, atribuir (gestor/admin), responder conversa sem dono assume; vendedor/atendente veem as suas e as sem dono. Integração + E2E; validado em produção. |
| F12 | Painel do lead, fechar/reabrir | 1 | Parcial | Fechar/reabrir feito (cliente escrevendo reabre). Painel do lead entra com o CRM de negociações. |
| F13 | Sequências, respostas rápidas, ações rápidas (/), notas internas | 1 | Parcial | Respostas rápidas (tela própria; admin/gestor edita; "/" no campo de mensagem lista e insere, {nome} vira o primeiro nome) e notas internas na conversa (só a equipe vê; não mudam a prévia, não vão para a IA, não pausam a IA, não contam no tempo de resposta). Sequências e ações rápidas: pendentes. Integração + E2E. Validado em produção (26/10/2026). |
| F14 | Inteligência de Conversas | 1 | Pendente |  |
| F15 | Contatos: CRUD, filtros, exportar | 1 | Concluído | Lista paginada com busca, novo, editar (telefone fixo), excluir com histórico, exportar e importar CSV (formato antigo e modelo) sem duplicar, com ou sem o 9. Integração + E2E; validado em produção com os 448 contatos (23/10/2026). |
| F16 | Funis e estágios | 1 | Concluído | Vários funis, funil padrão (recebe leads automáticos), etapas com cor, ordem e tipo (andamento, agendamento, ganho, perdido); não exclui etapa/funil com negociações. Integração + E2E. Validado em produção (23/10/2026). |
| F17 | Kanban, mover estágio, histórico | 1 | Concluído | Quadro por funil com contagem e soma por etapa, arrastar no computador, trocar etapa pelo painel no celular, tempo real, histórico (criação, etapa, responsável, valor, etiquetas, anotações). Integração + E2E. Validado em produção (23/10/2026). |
| F18 | Lista, paginação, exportar | 1 | Pendente |  |
| F19 | Ações em massa | 1 | Pendente |  |
| F20 | Nova negociação | 1 | Concluído | Por telefone (reaproveita o contato), título, valor, etapa, fonte e responsável; número sequencial por empresa. Lead automático no funil padrão para quem escreve pela primeira vez. Integração + E2E. Validado em produção (23/10/2026). |
| F21 | Detalhe: compras, atividades, produtos, score, campos | 1 | Parcial | Painel com contato, link para a conversa, etapa, responsável, valor, fonte, descrição, etiquetas, anotações e campos trazidos na importação. Compras, produtos, score e campos personalizados: pendentes. |
| F22 | Tarefas, modelos, Minhas tarefas | 1 | Parcial | Tarefas com dia e hora, responsável (gestor escolhe; vendedor cria para si), observação, ligação com a negociação (atalho no painel da negociação); tela Tarefas com Atrasadas, Hoje, Amanhã, Próximas e Concluídas, Minhas/Todas; aviso no WhatsApp do responsável na hora; tarefas atrasadas no painel. Modelos de tarefa: pendentes. Integração + E2E. Validado em produção (26/10/2026). |
| F23 | Etiquetas, fontes, campos, produtos | 1 | Parcial | Etiquetas (cor, criar só admin/gestor) e fontes. Campos personalizados e produtos: pendentes. |
| F24 | Importação CSV | 1 | Concluído | Contatos e negociações: export do sistema antigo e modelo (apenas_contato, criar_negociacao, recorrente, etiquetas, data de criação); cria funis, etapas, fontes e etiquetas que faltarem; reimportar o export não duplica; colunas sem campo próprio ficam guardadas na negociação. Integração + E2E. Validado em produção (23/10/2026). |
| F25 | Rodízio de vendedores e aviso | 1 | Concluído | Rodízio por empresa (Equipe): lead novo do WhatsApp vai para a próxima pessoa da lista (quem sai da equipe sai do rodízio; conversa que já tem dono não gira). Aviso "NOVO LEAD" no WhatsApp da pessoa (cadastrado em Conta), enviado pela conexão da empresa com fila e até 5 tentativas. Integração + E2E. Validado em produção (24/10/2026). |
| F26 | Agente: prompt, etapas, FAQ, modelos, gerador | 1 | Em validação | Agente por empresa: instruções, modelo (Haiku, Sonnet ou Opus 5.5), conexão, espera para agrupar mensagens, histórico, mensagem de transferência; importação do agente do sistema antigo. Ferramentas: transferir para humano, encerrar, mover etapa, catálogo (F28) e agenda (F36). Gerador e modelos prontos: pendentes. Integração + E2E. |
| F27 | Agente: documentos (RAG) | 1 | Pendente |  |
| F28 | Agente: catálogo | 1 | Concluído | Tela Catálogo (todos veem, admin/gestor edita): título, preço ou texto, descrição, ativo, até 8 fotos (reduzidas no navegador). Importa o catálogo do agente antigo (.json) ou CSV titulo;descricao;valor sem duplicar. IA ganha buscar_catalogo (tolerante a hífen/acento) e enviar_fotos (até 4 por item, até 3 itens por resposta) só quando há itens ativos. Fotos do sistema antigo não vêm no export. Integração + E2E. Validado em produção (24/10/2026). |
| F29 | Agente: intervenção, exclusão, pausa | 1 | Em validação | IA pausa quando atendente responde (CRM ou celular, janela de 30 min), ao transferir ou encerrar; botão Pausar/Religar na conversa; mensagens da IA marcadas. Integração + E2E. |
| F30 | Agente: notificações ao vendedor | 1 | Concluído | Quando a IA transfere, o responsável recebe "ATENDIMENTO HUMANO NECESSÁRIO" com motivo e link; sem responsável, puxa o próximo do rodízio e atribui. Visita marcada pela IA avisa o responsável. Integração. Validado em produção (24/10/2026). |
| F31 | Agente: sentimento, nota, ICP, resumo | 1 | Parcial | Resumo do atendimento pela IA (Haiku): resumo, interesse, temperatura quente/morno/frio, nota 0 a 10, objeções e próximo passo; botão na conversa, aparece no painel da negociação e vai junto no aviso de transferência para o vendedor. Sentimento por mensagem e ICP: pendentes. Integração + E2E. |
| F32 | Agente: simulador, logs, diagnóstico | 1 | Parcial | Simulador com as instruções do formulário (mostra transferência, encerramento e mudança de etapa). Logs e diagnóstico: pendentes. |
| F33 | Agente: créditos e economia | 1 | Em validação | Consumo por empresa (1 crédito = 1.000 tokens), limite mensal do Master, IA para ao esgotar; uso do mês na tela do agente. |
| F34 | Follow-up, fila e anti-banimento | 1 | Parcial | Follow-up automático (tela do Agente): até 5 passos, IA ou texto fixo ({nome}), janela de envio, só quando a IA falou por último, sem visita futura nem negociação encerrada; recomeça quando o cliente responde. Anti-bloqueio para envios automáticos (follow-up e lembretes): um por vez por número, intervalo aleatório configurável e limite por dia; "digitando..." antes das mensagens da IA. Disparo em massa: pendente. Integração + E2E. |
| F35 | Mensagens agendadas e lotes | 1 | Em validação | Mensagens agendadas na conversa (saem em nome de quem agendou, cancelar antes). Campanhas (admin/gestor): público por etapa, etiqueta e dias sem conversa, com contagem ao vivo; {nome}; rodapé "responda SAIR"; envio pela fila anti-bloqueio (um por vez por número, intervalo, limite por dia, janela); checa se o número tem WhatsApp; pausar, retomar, cancelar; progresso e quantos responderam. SAIR tira o contato de todas as campanhas e deixa nota na conversa. Quem responde ao disparo é atendido pela IA. Integração + E2E. |
| F36 | Agendamentos: calendário e lista | 1 | Concluído | Tela Agenda: lista por dia (próximas 60 dias / últimos 30), filtro Minhas, marcar visita por telefone, compareceu / não veio / cancelar / reabrir (anota na negociação). Configuração: expediente por dia, duração, visitas por horário, IA pode marcar. IA ganha ver_horarios e marcar_visita (confere expediente e lotação, devolve horários livres) e a negociação vai para a etapa de agendamento. Visão de calendário em grade: pendente. Integração + E2E. Validado em produção (24/10/2026). |
| F37 | Lembretes e retornos | 1 | Parcial | Lembrete de visita ao cliente pelo WhatsApp (até 3, ex.: 24 h e 2 h antes), mensagem editável ({nome}, {quando}, {empresa}); pula lembrete que perdeu o sentido (visita marcada depois); no último, aviso ao responsável; cria a conversa se o contato não tiver. Lembretes de retorno para o vendedor: pendentes. Integração + E2E. |
| F38 | Dashboard Vendas, Análise de IA, Automações | 1 | Parcial | Início virou painel: períodos (hoje, 7 e 30 dias, este mês, mês passado) e filtro por pessoa (gestor); leads novos, visitas e comparecimento, vendas e valor, conversão; funil atual por etapa; origem dos leads com vendas; tabela da equipe; agente de IA (mensagens, conversas, transferências, visitas, créditos). Vendedor vê só os próprios números. Aviso de visitas passadas sem resultado. Gráficos por período e automações: pendentes. Integração + E2E. |
| F39 | Dashboard SLA | 1 | Parcial | Primeira resposta (mediana geral e só de pessoas, % em até 5 min, sem resposta) para quem escreveu pela primeira vez no período; lista de clientes esperando resposta há mais de 10 min (sem resposta da IA a caminho), com tempo e link para a conversa; contagem por pessoa. Metas de SLA e alertas: pendentes. Integração + E2E. |
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
