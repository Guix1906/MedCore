import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { permissionsByModule, togglePermission, type PermissionKey } from "./permissions";

type Props = {
  /** Permissões marcadas (efetivas desejadas). */
  value: readonly string[];
  onChange?: (next: PermissionKey[]) => void;
  /** Permissões do perfil: destaca ajustes individuais em relação a ele. */
  baseline?: readonly string[] | null;
  readOnly?: boolean;
  /** Quem edita só concede o que possui. */
  canGrant?: (key: PermissionKey) => boolean;
  idPrefix: string;
};

export function PermissionMatrix({
  value,
  onChange,
  baseline,
  readOnly,
  canGrant,
  idPrefix,
}: Props) {
  const selected = new Set(value);
  const base = baseline ? new Set(baseline) : null;
  const editable = !readOnly && !!onChange;

  const setModule = (keys: PermissionKey[], enabled: boolean) => {
    if (!onChange) return;
    let next: PermissionKey[] = [...(value as PermissionKey[])];
    for (const key of keys) {
      if (enabled && canGrant && !canGrant(key)) continue;
      next = togglePermission(next, key, enabled);
    }
    onChange(next);
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {permissionsByModule().map((module) => {
        const keys = module.items.map((item) => item.key as PermissionKey);
        const count = keys.filter((key) => selected.has(key)).length;
        const moduleState = count === 0 ? false : count === keys.length ? true : "indeterminate";
        const grantable = keys.filter((key) => !canGrant || canGrant(key));
        const moduleId = `${idPrefix}-module-${module.id}`;
        return (
          <fieldset key={module.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <legend className="sr-only">{module.label}</legend>
            <div className="mb-2 flex items-center gap-2 border-b border-slate-100 pb-2">
              <Checkbox
                id={moduleId}
                checked={moduleState}
                disabled={!editable || (moduleState !== true && grantable.length === 0)}
                onCheckedChange={(checked) => setModule(keys, checked === true)}
                aria-label={`Todas as permissões de ${module.label}`}
              />
              <label htmlFor={moduleId} className="text-sm font-semibold text-slate-800">
                {module.label}
              </label>
              <span className="ml-auto text-[11px] text-slate-500">
                {count}/{keys.length}
              </span>
            </div>
            <ul className="space-y-1">
              {module.items.map((item) => {
                const key = item.key as PermissionKey;
                const id = `${idPrefix}-${key.replace(".", "-")}`;
                const checked = selected.has(key);
                const added = !!base && checked && !base.has(key);
                const removed = !!base && !checked && base.has(key);
                const blocked = !checked && !!canGrant && !canGrant(key);
                return (
                  <li
                    key={key}
                    className={cn(
                      "flex items-start gap-3 rounded-lg px-2 py-1.5",
                      added && "bg-emerald-50/70",
                      removed && "bg-rose-50/70",
                    )}
                  >
                    <Checkbox
                      id={id}
                      className="mt-0.5"
                      checked={checked}
                      disabled={!editable || blocked}
                      onCheckedChange={(next) =>
                        onChange?.(togglePermission(value, key, next === true))
                      }
                      aria-describedby={`${id}-desc`}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <label htmlFor={id} className="text-[13px] font-medium text-slate-800">
                          {item.label}
                        </label>
                        {added && (
                          <span className="rounded bg-emerald-100 px-1.5 text-[10.5px] font-semibold text-emerald-800">
                            + ajuste individual
                          </span>
                        )}
                        {removed && (
                          <span className="rounded bg-rose-100 px-1.5 text-[10.5px] font-semibold text-rose-800">
                            − removida do perfil
                          </span>
                        )}
                        {item.enforcement === "interface" && (
                          <span
                            className="rounded bg-slate-100 px-1.5 text-[10.5px] font-medium text-slate-600"
                            title="Controla menus e telas. Os dados continuam protegidos pelas permissões de cada módulo no banco."
                          >
                            navegação
                          </span>
                        )}
                      </div>
                      <p id={`${id}-desc`} className="text-[12px] leading-snug text-slate-500">
                        {item.description}
                        {blocked ? " Você não possui esta permissão para concedê-la." : ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
