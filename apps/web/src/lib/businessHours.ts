/* ─────────────────────────────────────────────────────────
   Horário de funcionamento das filiais

   Estrutura persistida em DealershipBranch.businessHours (Json):
     { "0": { closed, open, close }, ... "6": {...} }
   Chave = dia da semana (0 = domingo … 6 = sábado).
   Horários no formato "HH:MM" (24h).
───────────────────────────────────────────────────────── */

export interface DayHours {
  closed: boolean;
  open: string;   // "09:00"
  close: string;  // "18:00"
}

export type BusinessHours = Record<string, DayHours>;

export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const WEEKDAYS_LONG = [
  'Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado',
];

/** Padrão sugerido ao cadastrar: seg–sex 09–18, sáb 09–13, dom fechado */
export function defaultBusinessHours(): BusinessHours {
  const bh: BusinessHours = {};
  for (let d = 0; d < 7; d++) {
    if (d === 0)      bh[d] = { closed: true,  open: '09:00', close: '18:00' };
    else if (d === 6) bh[d] = { closed: false, open: '09:00', close: '13:00' };
    else              bh[d] = { closed: false, open: '09:00', close: '18:00' };
  }
  return bh;
}

/** true se o objeto tem ao menos um dia configurado */
export function hasBusinessHours(bh: unknown): bh is BusinessHours {
  return !!bh && typeof bh === 'object' && Object.keys(bh as object).length > 0;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export type OpenState = 'open' | 'closed' | 'unknown';

export interface OpenStatus {
  state: OpenState;
  /** Rótulo curto para o card, ex: "Fecha às 18h", "Abre seg 09h" */
  label: string;
}

/**
 * Calcula se a filial está aberta agora e o próximo evento relevante.
 * Retorna state 'unknown' quando não há horários cadastrados.
 */
export function getOpenStatus(bh: unknown, now: Date = new Date()): OpenStatus {
  if (!hasBusinessHours(bh)) return { state: 'unknown', label: '' };

  const today = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const fmt = (hhmm: string) => {
    const [h, m] = hhmm.split(':');
    return m && m !== '00' ? `${h}h${m}` : `${h}h`;
  };

  const todayHours = bh[today];
  if (todayHours && !todayHours.closed) {
    const o = toMinutes(todayHours.open);
    const c = toMinutes(todayHours.close);
    if (nowMin >= o && nowMin < c) {
      return { state: 'open', label: `Fecha às ${fmt(todayHours.close)}` };
    }
    if (nowMin < o) {
      return { state: 'closed', label: `Abre às ${fmt(todayHours.open)}` };
    }
  }

  // Procura o próximo dia aberto (até 7 dias à frente)
  for (let i = 1; i <= 7; i++) {
    const d = (today + i) % 7;
    const dh = bh[d];
    if (dh && !dh.closed) {
      const when = i === 1 ? 'amanhã' : WEEKDAYS_SHORT[d].toLowerCase();
      return { state: 'closed', label: `Abre ${when} ${fmt(dh.open)}` };
    }
  }

  return { state: 'closed', label: 'Fechado' };
}

/** Lista a semana inteira para exibição no detalhe (com flag do dia atual) */
export function getOpenHoursList(
  bh: unknown,
  now: Date = new Date(),
): { label: string; hours: string; closed: boolean; today: boolean }[] | null {
  if (!hasBusinessHours(bh)) return null;
  const today = now.getDay();
  return WEEKDAYS_LONG.map((label, d) => {
    const day = bh[d];
    return {
      label,
      hours: day && !day.closed ? `${day.open} – ${day.close}` : 'Fechado',
      closed: !day || day.closed,
      today: d === today,
    };
  });
}
