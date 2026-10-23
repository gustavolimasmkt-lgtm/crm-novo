# Permissões (proposta, aguardando ajuste do Gustavo)

O sistema de referência não permitiu observar outros perfis; esta matriz é proposta.
Implementação: `packages/core/src/auth/permissions.ts`.

| Permissão | Administrador | Gestor | Vendedor | Atendente |
| --- | --- | --- | --- | --- |
| Gerenciar empresa, conexões, departamentos | sim | não | não | não |
| Gerenciar equipe (papéis, desativar) | sim | não | não | não |
| Ver equipe e convidar vendedor/atendente | sim | sim | não | não |
| Configurações (funis, follow-ups, fluxos) | sim | sim | não | não |
| Relatórios | sim | sim | não | não |
| Ver todas as negociações e conversas | sim | sim | só as suas e sem dono | só as suas e sem dono |
| Redistribuir negociações | sim | sim | não | não |
| Ver valores das negociações | sim | sim | sim | não |
| Excluir negociação | sim | sim | não | não |
| Configurar funis, etapas, etiquetas e fontes | sim | sim | não | não |
| Puxar conversa para si | sim | sim | sim | sim |
| Ver, criar e editar contatos | sim | sim | sim | sim |
| Excluir, importar e exportar contatos | sim | sim | não | não |

**Master** (conta da plataforma): cria, suspende e entra em qualquer empresa; define limites (conexões WhatsApp, créditos de IA).

Regras já implementadas: a empresa nunca fica sem administrador ativo; ninguém remove o próprio acesso de administrador;
convite novo para o mesmo e-mail cancela o anterior; convite vale 7 dias; 5 senhas erradas em 15 minutos bloqueiam o login por e-mail.
