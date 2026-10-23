# 0002. Evolution API compartilhada com o WhatsApp da GreenCar

**Decisão (Gustavo, 23/10/2026):** usar a Evolution API que já roda no projeto GreenCar Site do Railway,
em vez de subir uma Evolution exclusiva do CRM.

**Risco:** a chave global dá controle sobre todas as instâncias daquele servidor, incluindo a da loja.

**Proteções no código:**

- Toda instância criada pelo CRM tem o prefixo `crm_` e fica registrada em `whatsapp_connections`.
- O cliente (`packages/core/src/whatsapp/evolution.ts`) recusa qualquer nome sem o prefixo, antes de chamar a Evolution.
- Não existe método para listar todas as instâncias; `fetchInstances` é sempre filtrado pelo nome e o resultado é conferido.
- Ações da tela só operam conexões da empresa logada, buscadas no banco do CRM.
- Webhook por conexão com segredo próprio (`?t=`) e conferência do nome da instância no evento.
- Teste automatizado: a Evolution falsa tem uma instância `GREENCAR`; os testes provam que nenhuma chamada a toca.

**Quando rever:** se o CRM for vendido para outras empresas, subir uma Evolution exclusiva (rede interna do Railway).
