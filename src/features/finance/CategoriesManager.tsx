import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Tags,
  Plus,
  Search,
  Pencil,
  Trash2,
  ArrowUpRight,
  ArrowDownLeft,
  Sparkles,
  Check,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { confirmDialog } from "@/components/app/confirm-dialog";
import {
  type FinanceCategory,
  CATEGORY_COLOR_PALETTE,
  getFinanceCategories,
  saveFinanceCategory,
  deleteFinanceCategory,
  seedClinicCategories,
} from "./finance-categories";
import { cn } from "@/lib/utils";

/**
 * Modal para criação ou edição de Categoria Financeira
 */
export interface CategoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: FinanceCategory | null;
  defaultType?: "income" | "expense";
  onSuccess?: (category: FinanceCategory) => void;
}

export function CategoryModal({
  open,
  onOpenChange,
  initialData,
  defaultType = "expense",
  onSuccess,
}: CategoryModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState<"income" | "expense">("expense");
  const [color, setColor] = useState("#ef4444");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialData) {
        setName(initialData.name);
        setType(initialData.type);
        setColor(initialData.color || (initialData.type === "expense" ? "#ef4444" : "#10b981"));
      } else {
        setName("");
        setType(defaultType);
        setColor(defaultType === "expense" ? "#ef4444" : "#10b981");
      }
    }
  }, [open, initialData, defaultType]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Por favor, digite o nome da categoria.");
      return;
    }

    setSaving(true);
    try {
      const saved = await saveFinanceCategory({
        id: initialData?.id,
        name: trimmed,
        type,
        color,
      });

      // Invalida consultas do React Query
      void queryClient.invalidateQueries({ queryKey: ["finance-categories-list"] });
      void queryClient.invalidateQueries({ queryKey: ["financial-title-categories"] });
      void queryClient.invalidateQueries({ queryKey: ["financial-snapshot"] });

      toast.success(
        initialData ? "Categoria atualizada com sucesso!" : "Categoria cadastrada com sucesso!",
      );
      onSuccess?.(saved);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar categoria.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Tags className="h-5 w-5 text-primary" />
            {initialData ? "Editar Categoria" : "Nova Categoria"}
          </DialogTitle>
          <DialogDescription>
            {initialData
              ? "Modifique os dados da categoria selecionada."
              : "Cadastre uma nova categoria para classificar receitas ou despesas da clínica."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 py-2">
          {/* Tipo: Despesa ou Receita */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Tipo de Categoria *
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setType("expense");
                  if (!initialData) setColor("#ef4444");
                }}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border p-3 font-medium text-sm transition-all cursor-pointer",
                  type === "expense"
                    ? "border-destructive bg-destructive/10 text-destructive shadow-xs font-semibold"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/50",
                )}
              >
                <ArrowUpRight className="h-4 w-4 text-destructive" />
                Despesa (Saída)
              </button>
              <button
                type="button"
                onClick={() => {
                  setType("income");
                  if (!initialData) setColor("#10b981");
                }}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border p-3 font-medium text-sm transition-all cursor-pointer",
                  type === "income"
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-xs font-semibold"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/50",
                )}
              >
                <ArrowDownLeft className="h-4 w-4 text-emerald-500" />
                Receita (Entrada)
              </button>
            </div>
          </div>

          {/* Nome da Categoria */}
          <div className="space-y-1.5">
            <Label htmlFor="cat-name" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Nome da Categoria *
            </Label>
            <Input
              id="cat-name"
              placeholder={type === "expense" ? "ex: Materiais Cirúrgicos, Aluguel, Farmácia" : "ex: Consultas, Procedimentos, Exames"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="h-10 text-sm"
            />
          </div>

          {/* Paleta de Cores */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Cor de Identificação
            </Label>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {CATEGORY_COLOR_PALETTE.map((pal) => (
                <button
                  key={pal.value}
                  type="button"
                  title={pal.name}
                  onClick={() => setColor(pal.value)}
                  className={cn(
                    "relative h-7 w-7 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 cursor-pointer",
                    color === pal.value && "scale-110 ring-2 ring-primary ring-offset-2",
                  )}
                  style={{ backgroundColor: pal.value }}
                >
                  {color === pal.value && (
                    <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow-sm" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <DialogFooter className="pt-3 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Salvando..." : initialData ? "Atualizar Categoria" : "Salvar Categoria"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Tela principal de Gerenciamento e Cadastro de Categorias
 */
export default function CategoriesManager() {
  const queryClient = useQueryClient();
  const [filterType, setFilterType] = useState<"all" | "expense" | "income">("all");
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<FinanceCategory | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);

  // Busca lista unificada de categorias
  const {
    data: categories = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["finance-categories-list"],
    queryFn: getFinanceCategories,
    staleTime: 30000,
  });

  // Escuta atualizações locais para refletir na tela imediatamente
  useEffect(() => {
    const handleUpdate = () => {
      void refetch();
    };
    window.addEventListener("medcore_categories_updated", handleUpdate);
    window.addEventListener("medcore_events_updated", handleUpdate);
    return () => {
      window.removeEventListener("medcore_categories_updated", handleUpdate);
      window.removeEventListener("medcore_events_updated", handleUpdate);
    };
  }, [refetch]);

  // Contadores
  const expenseCount = useMemo(
    () => categories.filter((c) => c.type === "expense").length,
    [categories],
  );
  const incomeCount = useMemo(
    () => categories.filter((c) => c.type === "income").length,
    [categories],
  );

  // Itens filtrados por busca e tipo
  const filteredCategories = useMemo(() => {
    return categories.filter((cat) => {
      if (filterType !== "all" && cat.type !== filterType) return false;
      if (search.trim()) {
        const term = search.toLowerCase().trim();
        return cat.name.toLowerCase().includes(term);
      }
      return true;
    });
  }, [categories, filterType, search]);

  const handleOpenNew = (type?: "income" | "expense") => {
    setEditingCategory(null);
    if (type) setFilterType(type);
    setIsModalOpen(true);
  };

  const handleEdit = (cat: FinanceCategory) => {
    setEditingCategory(cat);
    setIsModalOpen(true);
  };

  const handleDelete = async (cat: FinanceCategory) => {
    const confirmed = await confirmDialog({
      title: "Excluir Categoria",
      description: `Tem certeza que deseja excluir a categoria "${cat.name}"? Lançamentos existentes que utilizavam essa categoria manterão o histórico.`,
      confirmText: "Excluir Categoria",
      destructive: true,
    });

    if (!confirmed) return;

    try {
      await deleteFinanceCategory(cat.id);
      void queryClient.invalidateQueries({ queryKey: ["finance-categories-list"] });
      void queryClient.invalidateQueries({ queryKey: ["financial-title-categories"] });
      void queryClient.invalidateQueries({ queryKey: ["financial-snapshot"] });
      toast.success(`Categoria "${cat.name}" excluída.`);
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir categoria.");
    }
  };

  const handleSeedDefaults = async () => {
    const confirmed = await confirmDialog({
      title: "Restaurar Categorias Clínicas Padrão",
      description:
        "Deseja carregar a lista de categorias padrão recomendadas para clínicas médicas (Consultas, Procedimentos, Aluguel, Folha, Impostos, Insumos)? Suas categorias existentes não serão apagadas.",
      confirmText: "Restaurar Padrões",
    });

    if (!confirmed) return;

    setIsSeeding(true);
    try {
      const added = await seedClinicCategories();
      void queryClient.invalidateQueries({ queryKey: ["finance-categories-list"] });
      void queryClient.invalidateQueries({ queryKey: ["financial-title-categories"] });
      void queryClient.invalidateQueries({ queryKey: ["financial-snapshot"] });
      if (added > 0) {
        toast.success(`${added} categorias padrão adicionadas com sucesso!`);
      } else {
        toast.info("Todas as categorias padrão já estão cadastradas.");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao restaurar categorias padrão.");
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total de Categorias
            </p>
            <p className="text-2xl font-bold text-foreground mt-1">{categories.length}</p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Tags className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Categorias de Despesas
            </p>
            <p className="text-2xl font-bold text-destructive mt-1">{expenseCount}</p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <ArrowUpRight className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Categorias de Receitas
            </p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{incomeCount}</p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <ArrowDownLeft className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Barra de Filtros, Busca e Ações */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-card border border-border p-3 rounded-2xl shadow-xs">
        {/* Filtro de Abas Rápidas */}
        <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-xl">
          <button
            type="button"
            onClick={() => setFilterType("all")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer",
              filterType === "all"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Todas ({categories.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType("expense")}
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer",
              filterType === "expense"
                ? "bg-destructive/15 text-destructive shadow-xs font-semibold"
                : "text-muted-foreground hover:text-destructive",
            )}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            Despesas ({expenseCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterType("income")}
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer",
              filterType === "income"
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shadow-xs font-semibold"
                : "text-muted-foreground hover:text-emerald-600",
            )}
          >
            <ArrowDownLeft className="h-3.5 w-3.5" />
            Receitas ({incomeCount})
          </button>
        </div>

        {/* Campo de Busca */}
        <div className="relative flex-1 md:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar categoria..."
            className="pl-9 h-9 text-xs rounded-xl"
          />
        </div>

        {/* Botões de Ação */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSeedDefaults}
            disabled={isSeeding}
            className="h-9 text-xs gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground"
            title="Adiciona as categorias recomendadas para clínicas se ainda não existirem"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            Padrões Clínicos
          </Button>

          <Button
            size="sm"
            onClick={() => handleOpenNew()}
            className="h-9 text-xs gap-1.5 cursor-pointer font-medium"
          >
            <Plus className="h-4 w-4" />
            Nova Categoria
          </Button>
        </div>
      </div>

      {/* Lista de Categorias em Cards Elegantes */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center p-12 text-muted-foreground space-y-3">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm">Carregando categorias...</p>
        </div>
      ) : filteredCategories.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <FolderPlus className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Nenhuma categoria encontrada</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              {search
                ? `Nenhuma categoria corresponde à busca "${search}".`
                : "Você ainda não possui categorias cadastradas para este filtro."}
            </p>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button size="sm" onClick={() => handleOpenNew()} className="gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Criar Primeira Categoria
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSeedDefaults}
              className="gap-1.5 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              Carregar Padrões
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredCategories.map((cat) => {
            const isExpense = cat.type === "expense";
            const colorBadge = cat.color || (isExpense ? "#ef4444" : "#10b981");

            return (
              <div
                key={cat.id}
                className="group relative flex flex-col justify-between rounded-xl border border-border bg-card p-3.5 shadow-xs transition-all hover:shadow-md hover:border-border/80"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="shrink-0 h-3 w-3 rounded-full ring-2 ring-background"
                      style={{ backgroundColor: colorBadge }}
                    />
                    <span
                      className="text-sm font-medium text-foreground truncate"
                      title={cat.name}
                    >
                      {cat.name}
                    </span>
                  </div>

                  {/* Ações: Editar e Excluir */}
                  <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handleEdit(cat)}
                      title="Editar categoria"
                      aria-label={`Editar ${cat.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(cat)}
                      title="Excluir categoria"
                      aria-label={`Excluir ${cat.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Badge do Tipo (Despesa / Receita) */}
                <div className="mt-3 flex items-center justify-between pt-2 border-t border-border/50 text-[11px]">
                  <Badge
                    variant={isExpense ? "destructive" : "success"}
                    className={cn(
                      "px-2 py-0.5 text-[11px] font-normal gap-1",
                      isExpense
                        ? "bg-destructive/10 text-destructive border-destructive/20"
                        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
                    )}
                  >
                    {isExpense ? (
                      <>
                        <ArrowUpRight className="h-3 w-3" />
                        Despesa
                      </>
                    ) : (
                      <>
                        <ArrowDownLeft className="h-3 w-3" />
                        Receita
                      </>
                    )}
                  </Badge>

                  <span className="text-[10px] text-muted-foreground capitalize">
                    {isExpense ? "Saída de caixa" : "Entrada de caixa"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Criação / Edição */}
      <CategoryModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        initialData={editingCategory}
        defaultType={filterType === "income" ? "income" : "expense"}
      />
    </div>
  );
}
