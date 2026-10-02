/**
 * Loading ECG global (overlay central). Funciona com vários carregamentos ao mesmo
 * tempo: cada show() precisa de um hide(); some só quando o último terminar.
 *
 *   MedLoading.show(); ... MedLoading.hide();
 *   await MedLoading.wrap(supabase.rpc(...));
 */
type Listener = () => void;

let count = 0;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());

export const MedLoading = {
  show() {
    count++;
    emit();
  },
  hide(force = false) {
    count = force ? 0 : Math.max(0, count - 1);
    emit();
  },
  wrap<T>(promise: PromiseLike<T> | T): Promise<T> {
    MedLoading.show();
    return Promise.resolve(promise).finally(() => MedLoading.hide());
  },
  isActive: () => count > 0,
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
