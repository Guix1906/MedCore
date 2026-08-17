import type { Activity } from "@/components/agenda/agenda-types";

/**
 * Calcula o Domingo de Páscoa para determinado ano usando o algoritmo Meeus/Jones/Butcher.
 */
export function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Retorna o N-ésimo domingo de determinado mês (0-indexed, ex: 4 para Maio, 7 para Agosto).
 */
function getNthSundayOfMonth(year: number, month: number, nth: number): Date {
  const firstDay = new Date(year, month, 1);
  const dayOfWeek = firstDay.getDay(); // 0 = Domingo
  const firstSundayDay = dayOfWeek === 0 ? 1 : 1 + (7 - dayOfWeek);
  const targetDay = firstSundayDay + (nth - 1) * 7;
  return new Date(year, month, targetDay);
}

export type HolidayItem = {
  date: Date;
  title: string;
  type: "nacional" | "facultativo";
};

/**
 * Retorna todos os Feriados Nacionais e Datas Comemorativas do Brasil para um determinado ano.
 */
export function getBrazilianHolidays(year: number): HolidayItem[] {
  const easter = getEasterSunday(year);

  // Feriados Móveis baseados na Páscoa
  const carnavalSegunda = addDays(easter, -48);
  const carnavalTerca = addDays(easter, -47);
  const quartaCinzas = addDays(easter, -46);
  const sextaFeiraSanta = addDays(easter, -2);
  const corpusChristi = addDays(easter, 60);

  // Datas comemorativas móveis
  const diaDasMaes = getNthSundayOfMonth(year, 4, 2); // 2º domingo de Maio
  const diaDosPais = getNthSundayOfMonth(year, 7, 2); // 2º domingo de Agosto

  const holidays: HolidayItem[] = [
    { date: new Date(year, 0, 1), title: "Confraternização Universal", type: "nacional" },
    { date: carnavalSegunda, title: "Carnaval (Segunda-feira)", type: "facultativo" },
    { date: carnavalTerca, title: "Carnaval (Terça-feira)", type: "facultativo" },
    { date: quartaCinzas, title: "Quarta-feira de Cinzas (até 14h)", type: "facultativo" },
    { date: sextaFeiraSanta, title: "Sexta-feira Santa / Paixão de Cristo", type: "nacional" },
    { date: easter, title: "Páscoa", type: "facultativo" },
    { date: new Date(year, 3, 21), title: "Tiradentes", type: "nacional" },
    { date: new Date(year, 4, 1), title: "Dia do Trabalhador", type: "nacional" },
    { date: diaDasMaes, title: "Dia das Mães", type: "facultativo" },
    { date: new Date(year, 5, 12), title: "Dia dos Namorados", type: "facultativo" },
    { date: corpusChristi, title: "Corpus Christi", type: "facultativo" },
    { date: diaDosPais, title: "Dia dos Pais", type: "facultativo" },
    { date: new Date(year, 8, 7), title: "Independência do Brasil", type: "nacional" },
    { date: new Date(year, 9, 12), title: "Nossa Senhora Aparecida / Dia das Crianças", type: "nacional" },
    { date: new Date(year, 10, 2), title: "Finados", type: "nacional" },
    { date: new Date(year, 10, 15), title: "Proclamação da República", type: "nacional" },
    { date: new Date(year, 10, 20), title: "Dia da Consciência Negra", type: "nacional" },
    { date: new Date(year, 11, 24), title: "Véspera de Natal (Facultativo após 14h)", type: "facultativo" },
    { date: new Date(year, 11, 25), title: "Natal", type: "nacional" },
    { date: new Date(year, 11, 31), title: "Véspera de Ano Novo / Réveillon", type: "facultativo" },
  ];

  return holidays.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Converte feriados dos anos especificados em instâncias de Activity para exibição na Agenda.
 */
export function getHolidayActivitiesForYears(years: number[]): Activity[] {
  const out: Activity[] = [];

  for (const yr of years) {
    const list = getBrazilianHolidays(yr);
    for (const h of list) {
      const d = h.date;
      const yrStr = d.getFullYear();
      const mStr = String(d.getMonth() + 1).padStart(2, "0");
      const dStr = String(d.getDate()).padStart(2, "0");
      const dateKey = `${yrStr}-${mStr}-${dStr}`;

      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);

      out.push({
        id: `feriado:${dateKey}:${h.title}`,
        source: "event",
        kind: "feriado",
        title: `🇧🇷 Feriado: ${h.title}`,
        description: `Feriado ${h.type === "nacional" ? "Nacional" : "Datas Comemorativas / Facultativos"} do Brasil`,
        start,
        end,
        allDay: true,
        assignedTo: null,
        caseId: null,
        caseTitle: null,
        location: "Brasil",
        priority: null,
        status: h.type,
        raw: h,
      });
    }
  }

  return out;
}
