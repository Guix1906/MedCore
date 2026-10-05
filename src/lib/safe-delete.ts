import { supabase } from "@/integrations/supabase/client";

type RpcError = { message: string; code?: string } | null;
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: RpcError }>;

/** A função ainda não existe no banco (migração não aplicada). */
function isMissingFunction(error: NonNullable<RpcError>) {
  return error.code === "PGRST202" || /could not find the function/i.test(error.message);
}

/**
 * Exclui pela função do banco (que confere permissão e clínica). Só cai na exclusão direta
 * quando a função não existe; qualquer outra recusa (ex.: sem permissão) vira erro na tela.
 * A exclusão direta confere quantas linhas saíram: o RLS bloqueia sem devolver erro.
 */
export async function deleteViaRpc(
  fn: string,
  args: Record<string, unknown>,
  fallback: { table: string; id: string },
): Promise<void> {
  const { error } = await (supabase.rpc as unknown as Rpc)(fn, args);
  if (!error) return;
  if (!isMissingFunction(error)) throw new Error(error.message);

  const { data, error: directError } = await (
    supabase.from as unknown as (t: string) => any
  )(fallback.table)
    .delete()
    .eq("id", fallback.id)
    .select("id");
  if (directError) throw new Error(directError.message);
  if (!data || data.length === 0) {
    throw new Error("Registro não excluído: sem permissão ou já removido.");
  }
}
