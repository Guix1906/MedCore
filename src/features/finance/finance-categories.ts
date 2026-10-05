import { supabase } from "@/integrations/supabase/client";

export interface FinanceCategory {
  id: string;
  name: string;
  type: "income" | "expense";
  color?: string | null;
  active?: boolean;
  created_at?: string;
}

export const DEFAULT_CLINIC_CATEGORIES: Array<{
  name: string;
  type: "income" | "expense";
  color: string;
}> = [
  // Despesas
  { name: "Aluguel e Condomínio", type: "expense", color: "#ef4444" },
  { name: "Energia, Água e Internet", type: "expense", color: "#f97316" },
  { name: "Folha de Pagamento e Encargos", type: "expense", color: "#dc2626" },
  { name: "Pró-Labore dos Sócios", type: "expense", color: "#b91c1c" },
  { name: "Impostos e Tributos", type: "expense", color: "#ea580c" },
  { name: "Contabilidade e Jurídico", type: "expense", color: "#d97706" },
  { name: "Materiais e Medicamentos", type: "expense", color: "#e11d48" },
  { name: "Manutenção e Equipamentos", type: "expense", color: "#be123c" },
  { name: "Marketing e Publicidade", type: "expense", color: "#9333ea" },
  { name: "Sistemas e Software", type: "expense", color: "#6366f1" },
  { name: "Limpeza e Copa", type: "expense", color: "#64748b" },
  { name: "Outras Despesas", type: "expense", color: "#71717a" },

  // Receitas
  { name: "Consultas Médicas", type: "income", color: "#10b981" },
  { name: "Procedimentos e Cirurgias", type: "income", color: "#059669" },
  { name: "Exames e Laudos", type: "income", color: "#14b8a6" },
  { name: "Telemedicina", type: "income", color: "#06b6d4" },
  { name: "Repasses de Convênios", type: "income", color: "#0284c7" },
  { name: "Retornos e Avaliações", type: "income", color: "#3b82f6" },
  { name: "Outras Receitas", type: "income", color: "#22c55e" },
];

export const CATEGORY_COLOR_PALETTE = [
  { name: "Verde Esmeralda", value: "#10b981" },
  { name: "Verde Escuro", value: "#059669" },
  { name: "Azul Claro", value: "#0284c7" },
  { name: "Azul Real", value: "#3b82f6" },
  { name: "Roxo", value: "#8b5cf6" },
  { name: "Vermelho", value: "#ef4444" },
  { name: "Laranja", value: "#f97316" },
  { name: "Âmbar", value: "#f59e0b" },
  { name: "Rosa / Carmim", value: "#e11d48" },
  { name: "Cinza Ardósia", value: "#64748b" },
];

// Versões anteriores mantinham uma cópia no navegador; o banco é a única fonte.
const LEGACY_STORAGE_KEY = "medcore_finance_categories";

function notifyCategoriesChanged() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Armazenamento indisponível: nada a limpar.
  }
  window.dispatchEvent(new CustomEvent("medcore_categories_updated"));
  window.dispatchEvent(new CustomEvent("medcore_events_updated"));
}

/**
 * Busca as categorias no banco. Banco vazio: devolve a lista padrão (ainda não salva) para
 * os seletores; "Restaurar padrão" grava essas categorias de verdade.
 */
export async function getFinanceCategories(): Promise<FinanceCategory[]> {
  const { data, error } = await (supabase as any)
    .from("finance_categories")
    .select("*")
    .order("type")
    .order("name");
  if (error) throw new Error(error.message || "Não foi possível carregar as categorias.");
  if (data && data.length > 0) return data as FinanceCategory[];

  return DEFAULT_CLINIC_CATEGORIES.map((c, i) => ({
    id: `default-${c.type}-${i}`,
    name: c.name,
    type: c.type,
    color: c.color,
    active: true,
  }));
}

/**
 * Adiciona ou edita uma categoria no Supabase e no cache local
 */
export async function saveFinanceCategory(params: {
  id?: string;
  name: string;
  type: "income" | "expense";
  color?: string | null;
}): Promise<FinanceCategory> {
  const trimmedName = params.name.trim();
  if (!trimmedName) throw new Error("O nome da categoria é obrigatório.");

  const categoryId = params.id || crypto.randomUUID();
  const item: FinanceCategory = {
    id: categoryId,
    name: trimmedName,
    type: params.type,
    color: params.color || (params.type === "expense" ? "#ef4444" : "#10b981"),
    active: true,
    created_at: new Date().toISOString(),
  };

  // 1. Salva no Supabase (o Supabase não lança exceção: o erro vem no retorno)
  const { error } = params.id
    ? await (supabase as any)
        .from("finance_categories")
        .update({
          name: item.name,
          type: item.type,
          color: item.color,
        })
        .eq("id", params.id)
    : await (supabase as any).from("finance_categories").insert({
        id: item.id,
        name: item.name,
        type: item.type,
        color: item.color,
      });
  if (error) throw new Error(error.message || "Não foi possível salvar a categoria.");

  notifyCategoriesChanged();
  return item;
}

/**
 * Exclui uma categoria do Supabase e do cache local
 */
export async function deleteFinanceCategory(id: string): Promise<void> {
  const { error } = await (supabase as any).from("finance_categories").delete().eq("id", id);
  if (error) throw new Error(error.message || "Não foi possível excluir a categoria.");
  notifyCategoriesChanged();
}

/**
 * Restaura todas as categorias padrão da clínica que ainda não existirem
 */
export async function seedClinicCategories(): Promise<number> {
  const existing = await getFinanceCategories();
  // Padrões ainda não salvos (id "default-…") não contam como existentes.
  const savedNames = new Set(
    existing.filter((c) => !c.id.startsWith("default-")).map((c) => c.name.toLowerCase().trim()),
  );
  const toAdd = DEFAULT_CLINIC_CATEGORIES.filter(
    (c) => !savedNames.has(c.name.toLowerCase().trim()),
  );

  if (toAdd.length === 0) return 0;

  let addedCount = 0;
  for (const cat of toAdd) {
    try {
      await saveFinanceCategory({
        name: cat.name,
        type: cat.type,
        color: cat.color,
      });
      addedCount++;
    } catch (err) {
      console.warn("Erro ao semear categoria:", cat.name, err);
    }
  }

  return addedCount;
}
