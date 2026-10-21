// Dados FICTÍCIOS só para a prévia visual da Fase 0. Nada aqui vai para o banco.

export const STAGES = [
  { id: "novo", name: "Novo lead", color: "#0071e3" },
  { id: "atendimento", name: "Em atendimento", color: "#5856d6" },
  { id: "qualificado", name: "Qualificado", color: "#af52de" },
  { id: "visita", name: "Visita agendada", color: "#ff9500" },
  { id: "proposta", name: "Proposta", color: "#30b0c7" },
  { id: "ganho", name: "Venda ganha", color: "#34c759" },
] as const;

export type Deal = {
  id: string;
  name: string;
  interest: string;
  value: number;
  owner: string;
  stage: (typeof STAGES)[number]["id"];
  days: number;
  channel: "whatsapp" | "instagram";
  hot?: boolean;
  ai?: boolean;
};

export const DEALS: Deal[] = [
  {
    id: "1",
    name: "Mariana Costa",
    interest: "SUV compacto até 90 mil",
    value: 88900,
    owner: "Ana Prado",
    stage: "novo",
    days: 0,
    channel: "whatsapp",
    ai: true,
  },
  {
    id: "2",
    name: "Rafael Nunes",
    interest: "Picape diesel",
    value: 189000,
    owner: "Bruno Lemos",
    stage: "novo",
    days: 1,
    channel: "instagram",
  },
  {
    id: "3",
    name: "Juliana Reis",
    interest: "Hatch automático",
    value: 64900,
    owner: "Ana Prado",
    stage: "atendimento",
    days: 2,
    channel: "whatsapp",
    ai: true,
  },
  {
    id: "4",
    name: "Pedro Almeida",
    interest: "Sedan com troca",
    value: 97500,
    owner: "Carlos Dias",
    stage: "atendimento",
    days: 4,
    channel: "whatsapp",
    hot: true,
  },
  {
    id: "5",
    name: "Camila Torres",
    interest: "Primeiro carro",
    value: 42900,
    owner: "Bruno Lemos",
    stage: "qualificado",
    days: 3,
    channel: "whatsapp",
  },
  {
    id: "6",
    name: "Lucas Martins",
    interest: "SUV 7 lugares",
    value: 154000,
    owner: "Carlos Dias",
    stage: "visita",
    days: 1,
    channel: "whatsapp",
    hot: true,
  },
  {
    id: "7",
    name: "Fernanda Lima",
    interest: "Hatch com financiamento",
    value: 58900,
    owner: "Ana Prado",
    stage: "proposta",
    days: 6,
    channel: "instagram",
  },
  {
    id: "8",
    name: "Thiago Souza",
    interest: "Picape cabine dupla",
    value: 212000,
    owner: "Bruno Lemos",
    stage: "ganho",
    days: 9,
    channel: "whatsapp",
  },
];

export type Msg = { from: "lead" | "me" | "ai" | "event"; text: string; time: string };

export const THREAD: Msg[] = [
  { from: "event", text: "Lead veio do anúncio · SUV compacto 2021", time: "09:12" },
  { from: "lead", text: "Oi! Esse SUV ainda está disponível?", time: "09:12" },
  {
    from: "ai",
    text: "Bom dia, Mariana! Está sim. Você pensa em pagar à vista ou financiado?",
    time: "09:13",
  },
  { from: "lead", text: "Financiado, e tenho um carro para dar na troca.", time: "09:15" },
  { from: "ai", text: "Perfeito. Qual o modelo e o ano do seu carro?", time: "09:15" },
  { from: "event", text: "Distribuído para Ana Prado (rodízio)", time: "09:16" },
  { from: "me", text: "Oi Mariana, aqui é a Ana. Posso te mandar uma simulação ainda hoje?", time: "09:31" },
  { from: "lead", text: "Pode sim, obrigada!", time: "09:33" },
];

export const CONVERSATIONS = [
  {
    id: "1",
    name: "Mariana Costa",
    last: "Pode sim, obrigada!",
    time: "09:33",
    unread: 0,
    channel: "whatsapp",
    stage: "Novo lead",
  },
  {
    id: "4",
    name: "Pedro Almeida",
    last: "Consigo ver o carro amanhã?",
    time: "09:20",
    unread: 2,
    channel: "whatsapp",
    stage: "Em atendimento",
  },
  {
    id: "2",
    name: "Rafael Nunes",
    last: "Qual o km dela?",
    time: "08:57",
    unread: 1,
    channel: "instagram",
    stage: "Novo lead",
  },
  {
    id: "6",
    name: "Lucas Martins",
    last: "Fechado, sábado às 10h.",
    time: "Ontem",
    unread: 0,
    channel: "whatsapp",
    stage: "Visita agendada",
  },
  {
    id: "7",
    name: "Fernanda Lima",
    last: "Vou ver com meu marido",
    time: "Ontem",
    unread: 0,
    channel: "instagram",
    stage: "Proposta",
  },
  {
    id: "5",
    name: "Camila Torres",
    last: "Áudio · 0:24",
    time: "seg.",
    unread: 0,
    channel: "whatsapp",
    stage: "Qualificado",
  },
];

export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
