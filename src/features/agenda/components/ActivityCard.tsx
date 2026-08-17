import { memo, useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { KIND_COLOR, type Activity } from "@/components/agenda/agenda-types";
import { cn } from "@/utils/cn";
import { KindIcon } from "./KindIcon";
import {
  HoverCard,
  HoverCardContent,
  HoverCardPortal,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { CheckCircle2, ClipboardList, DollarSign, MessageSquare, User, MessageCircle, Clock, CircleDollarSign, MapPin } from "lucide-react";
import { useActiveCompany } from "@/hooks/use-active-company";
import { useCompanyMembers } from "@/hooks/use-company-members";

function formatLongDate(d: Date) {
  const s = d.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return s.replace(/\.$/g, "").replace(".,", ",");
}

function stripMeta(desc: string | null | undefined) {
  if (!desc) return "";
  return desc.replace(/<!--AGENDAMENTO_META:.*?-->/s, "").trim();
}

function parseMeta(desc: string | null | undefined): {
  color?: string;
  status?: string;
  downPayment?: number;
  remainingValue?: number;
  procedurePrice?: number;
} | null {
  if (!desc) return null;
  const m = desc.match(/<!--AGENDAMENTO_META:(.*?)-->/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function initialsOf(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function hexToHsl(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h: number, s: number, l: number) {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = light - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function softenColor(hex: string) {
  const hsl = hexToHsl(hex);
  return hslToHex(hsl.h, Math.min(hsl.s, 55), Math.max(hsl.l, 88));
}

function softenColorHover(hex: string) {
  const hsl = hexToHsl(hex);
  return hslToHex(hsl.h, Math.min(hsl.s, 65), Math.max(hsl.l, 82));
}

function formatHeaderSubtitle(start: Date, end: Date | null) {
  const weekday = start.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  const capWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const day = start.getDate();
  const month = start.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  const year = start.getFullYear();

  const startLabel = start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const endLabel = end
    ? end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;

  const timePart = endLabel ? `${startLabel} - ${endLabel}` : startLabel;

  return `${capWeekday}, ${day} de ${month} de ${year}  •  ${timePart}`;
}

function getWhatsAppUrl(phone: string | null | undefined, patientName: string) {
  const msg = encodeURIComponent(`Olá ${patientName}, referente ao seu agendamento.`);
  if (!phone) {
    return `https://wa.me/?text=${msg}`;
  }
  const cleanDigits = phone.replace(/\D/g, "");
  if (!cleanDigits) {
    return `https://wa.me/?text=${msg}`;
  }
  const fullPhone = cleanDigits.length <= 11 ? `55${cleanDigits}` : cleanDigits;
  return `https://wa.me/${fullPhone}?text=${msg}`;
}

function ActivityHoverContent({
  a,
  onView,
  onEdit,
}: {
  a: Activity;
  onView: () => void;
  onEdit?: () => void;
}) {
  const { companyId } = useActiveCompany();
  const { byId } = useCompanyMembers(companyId);
  const ownerName = a.assignedTo ? (byId.get(a.assignedTo) ?? null) : null;

  const openDetails = (event: MouseEvent<HTMLButtonElement> | ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onView();
  };

  const openEdit = (event: MouseEvent<HTMLButtonElement> | ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (onEdit) {
      onEdit();
    } else {
      onView();
    }
  };

  const patientName = a.title || a.caseTitle || "Guilherme";
  const patientInitials = initialsOf(patientName);
  const profName = ownerName || "Amanda Thais";
  const statusText = a.status || "Agendado";
  const financialStatus = a.location || "Sem previsão de recebimento";

  const meta = parseMeta(a.description);
  const rawPhone = (meta as any)?.patientPhone || (meta as any)?.phone || a.description?.match(/(\(?\d{2}\)?\s?\d{4,5}-?\d{4})/)?.[1];
  const waUrl = getWhatsAppUrl(rawPhone, patientName);

  return (
    <div className="w-[330px] p-5 bg-white rounded-2xl shadow-[0_20px_50px_rgba(24,20,50,0.18)] border border-slate-100/90 font-sans space-y-4 text-slate-800 text-[13.5px]">
      {/* Header: Badge Roxo Claro + Nome "Agendamento" + Data/Hora */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 h-6 w-6 rounded-lg bg-[#ECE6FE] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-bold text-[#1E2538] leading-tight">Agendamento</div>
          <div className="mt-0.5 text-[12.5px] font-medium text-[#5A6478]">
            {formatHeaderSubtitle(a.start, a.end)}
          </div>
        </div>
      </div>

      {/* Profissional / Médico */}
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-[#E2E8F0] overflow-hidden shrink-0 grid place-items-center text-[12px] font-bold text-slate-700">
          {initialsOf(profName)}
        </div>
        <span className="font-medium text-[#1E2538] text-[12.5px] truncate">{profName}</span>
      </div>

      {/* Paciente com Ícone do WhatsApp vinculado */}
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-[#ECE6FE] text-[#7C3AED] font-extrabold text-[12px] shrink-0 grid place-items-center">
          {patientInitials}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-[#1E2538] text-[12.5px] truncate">{patientName}</span>
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={`Abrir conversa no WhatsApp com ${patientName}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-center p-0.5 text-[#8C96A6] hover:text-[#25D366] transition-all hover:scale-110 active:scale-95 cursor-pointer shrink-0"
          >
            <MessageCircle className="h-4.5 w-4.5" />
          </a>
        </div>
      </div>

      {/* Status do Agendamento */}
      <div className="flex items-center gap-3">
        <div className="relative flex items-center justify-center shrink-0 w-8">
          <Clock className="h-5 w-5 text-slate-500" />
          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#8B5CF6] ring-2 ring-white" />
        </div>
        <span className="font-bold text-[#1E2538] text-[13.5px] capitalize">{statusText}</span>
      </div>

      {/* Localização / Sala de Atendimento */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center shrink-0 w-8">
          <MapPin className="h-5 w-5 text-[#8C96A6]" />
        </div>
        <span className="font-bold text-[#1E2538] text-[13.5px] truncate">{financialStatus}</span>
      </div>

      {/* Botões de Ação */}
      <div className="pt-2 flex items-center gap-3">
        <button
          type="button"
          onPointerDown={openEdit}
          onClick={openEdit}
          className="flex-1 h-10 rounded-xl text-[13.5px] font-bold bg-[#F4F5F8] text-[#5A6478] hover:bg-[#EBECEF] transition-all cursor-pointer shadow-none flex items-center justify-center"
        >
          Editar
        </button>
        <button
          type="button"
          onPointerDown={openDetails}
          onClick={openDetails}
          className="flex-1 h-10 rounded-xl text-[13.5px] font-bold bg-[#8B5CF6] text-white hover:bg-[#7C3AED] transition-all cursor-pointer shadow-none flex items-center justify-center"
        >
          Ver detalhes
        </button>
      </div>
    </div>
  );
}

export function ActivityCard({
  a,
  style,
  onClick,
  onEdit,
  onDragStart,
  onDragEnd,
  siblings,
  onResize,
  colWidth,
}: {
  a: Activity;
  style: React.CSSProperties;
  onClick: () => void;
  onEdit?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  siblings?: Activity[];
  onResize?: (a: Activity, newStart: Date, newEnd: Date) => void;
  colWidth?: number;
}) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [isEdgeArea, setIsEdgeArea] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const justResizedRef = useRef(false);

  // Estado para feedback em tempo real ao esticar (redimensionar)
  const [resizeState, setResizeState] = useState<{
    edge: "top" | "bottom";
    deltaMinutes: number;
  } | null>(null);

  // Estado para feedback em tempo real ao arrastar o card em todas as direções (cima, baixo, esquerda, direita)
  const [moveState, setMoveState] = useState<{
    deltaMinutes: number;
    deltaDays: number;
    colWidth: number;
  } | null>(null);

  const handleMoveStart = (e: ReactPointerEvent) => {
    if (e.button !== 0) return; // Garante que o arrasto só inicia se for o clique principal do mouse

    const rect = e.currentTarget.getBoundingClientRect();
    const topDist = e.clientY - rect.top;
    const bottomDist = rect.bottom - e.clientY;
    const edgeThreshold = Math.min(16, Math.max(10, rect.height / 3));
    if (topDist <= edgeThreshold || bottomDist <= edgeThreshold) return;

    const targetElement = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const effectiveColWidth = colWidth || (targetElement.parentElement?.clientWidth || 120);

    const initialStart = a.start instanceof Date ? a.start : new Date(a.start);
    const startMs = !isNaN(initialStart.getTime()) ? initialStart.getTime() : Date.now();
    const initialEnd = a.end
      ? (a.end instanceof Date ? a.end : new Date(a.end))
      : new Date(startMs + 45 * 60 * 1000);
    const durationMs = initialEnd.getTime() - startMs;

    let isDragging = false;
    let currentDeltaMinutes = 0;
    let currentDeltaDays = 0;

    const onPointerMove = (moveEvent: PointerEvent) => {
      // Se o botão do mouse não estiver mais pressionado, cancela o movimento imediatamente
      if (moveEvent.buttons !== 1) {
        if (isDragging) {
          onPointerUp(moveEvent);
        }
        return;
      }

      const deltaY = moveEvent.clientY - startY;
      const deltaX = moveEvent.clientX - startX;

      // Exige clique pressionado + movimento de mais de 6px para iniciar o arrasto
      if (!isDragging && (Math.abs(deltaY) > 6 || Math.abs(deltaX) > 6)) {
        isDragging = true;
        cancelHoverTimer();
        setHoverOpen(false);
        try {
          targetElement.setPointerCapture(pointerId);
        } catch {
          /* noop */
        }
      }

      if (isDragging) {
        // Pula de quadrado em quadrado: 18px = 15min vertical (cima/baixo) e colWidth = 1 dia horizontal (esquerda/direita)
        const slotJumpsY = Math.round(deltaY / 18);
        const slotJumpsX = Math.round(deltaX / effectiveColWidth);
        const newDeltaMinutes = slotJumpsY * 15;
        const newDeltaDays = slotJumpsX;

        if (newDeltaMinutes !== currentDeltaMinutes || newDeltaDays !== currentDeltaDays) {
          currentDeltaMinutes = newDeltaMinutes;
          currentDeltaDays = newDeltaDays;
          setMoveState({
            deltaMinutes: newDeltaMinutes,
            deltaDays: newDeltaDays,
            colWidth: effectiveColWidth,
          });
        }
      }
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      try {
        targetElement.releasePointerCapture(upEvent.pointerId);
      } catch {
        /* noop */
      }
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);

      if (isDragging) {
        justResizedRef.current = true;
        setTimeout(() => {
          justResizedRef.current = false;
        }, 400);
        setMoveState(null);

        if ((currentDeltaMinutes !== 0 || currentDeltaDays !== 0) && onResize) {
          const shiftMs = currentDeltaDays * 24 * 60 * 60 * 1000 + currentDeltaMinutes * 60 * 1000;
          const newStart = new Date(startMs + shiftMs);
          const newEnd = new Date(startMs + durationMs + shiftMs);
          onResize(a, newStart, newEnd);
        }
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleResizeStart = (e: ReactPointerEvent, edge: "top" | "bottom") => {
    e.stopPropagation();
    e.preventDefault();
    cancelHoverTimer();
    setHoverOpen(false);
    setIsEdgeArea(true);

    const targetElement = e.currentTarget as HTMLElement;
    try {
      targetElement.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }

    const startY = e.clientY;
    const initialStart = a.start instanceof Date ? a.start : new Date(a.start);
    const startMs = !isNaN(initialStart.getTime()) ? initialStart.getTime() : Date.now();
    const initialEnd = a.end
      ? (a.end instanceof Date ? a.end : new Date(a.end))
      : new Date(startMs + 45 * 60 * 1000);
    const initialStartMs = initialStart.getTime();
    const initialEndMs = initialEnd.getTime();

    // Encontra os vizinhos mais próximos (acima e abaixo) de forma 100% segura
    const otherSiblings = Array.isArray(siblings) ? siblings.filter((s) => s && s.id !== a.id) : [];
    let closestAboveEndMs: number | null = null;
    let closestBelowStartMs: number | null = null;

    for (const sib of otherSiblings) {
      const sibStart = sib.start instanceof Date ? sib.start : new Date(sib.start);
      const sibStartMs = sibStart.getTime();
      const sibEnd = sib.end ? (sib.end instanceof Date ? sib.end : new Date(sib.end)) : new Date(sibStartMs + 45 * 60 * 1000);
      const sibEndMs = sibEnd.getTime();

      if (sibEndMs <= initialStartMs) {
        if (closestAboveEndMs === null || sibEndMs > closestAboveEndMs) {
          closestAboveEndMs = sibEndMs;
        }
      }
      if (sibStartMs >= initialEndMs) {
        if (closestBelowStartMs === null || sibStartMs < closestBelowStartMs) {
          closestBelowStartMs = sibStartMs;
        }
      }
    }

    let currentDeltaMinutes = 0;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startY;
      // 1.2px = 1 min -> passos de 15 min (18px por retângulo da grade). Atualização síncrona sem delay!
      const rawDeltaMinutes = Math.round((deltaY / 1.2) / 15) * 15;

      if (edge === "top") {
        let maxDelta = Math.floor((initialEndMs - initialStartMs - 15 * 60 * 1000) / (60 * 1000));
        let targetDelta = Math.min(rawDeltaMinutes, maxDelta);
        const targetStartMs = initialStartMs + targetDelta * 60 * 1000;

        // Auto-ajuste / Snap magnético com o card superior
        if (closestAboveEndMs !== null) {
          const diffMin = (targetStartMs - closestAboveEndMs) / (60 * 1000);
          if (Math.abs(diffMin) <= 15 || targetStartMs < closestAboveEndMs) {
            targetDelta = Math.round((closestAboveEndMs - initialStartMs) / (60 * 1000));
          }
        }

        if (targetDelta !== currentDeltaMinutes) {
          currentDeltaMinutes = targetDelta;
          setResizeState({ edge, deltaMinutes: targetDelta });
        }
      } else {
        let minDelta = -Math.floor((initialEndMs - initialStartMs - 15 * 60 * 1000) / (60 * 1000));
        let targetDelta = Math.max(rawDeltaMinutes, minDelta);
        const targetEndMs = initialEndMs + targetDelta * 60 * 1000;

        // Auto-ajuste / Snap magnético com o card inferior
        if (closestBelowStartMs !== null) {
          const diffMin = (closestBelowStartMs - targetEndMs) / (60 * 1000);
          if (Math.abs(diffMin) <= 15 || targetEndMs > closestBelowStartMs) {
            targetDelta = Math.round((closestBelowStartMs - initialEndMs) / (60 * 1000));
          }
        }

        if (targetDelta !== currentDeltaMinutes) {
          currentDeltaMinutes = targetDelta;
          setResizeState({ edge, deltaMinutes: targetDelta });
        }
      }
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      try {
        targetElement.releasePointerCapture(upEvent.pointerId);
      } catch {
        /* noop */
      }
      targetElement.removeEventListener("pointermove", onPointerMove);
      targetElement.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      justResizedRef.current = true;
      setTimeout(() => {
        justResizedRef.current = false;
      }, 400);
      setResizeState(null);
      setIsEdgeArea(false);

      if (currentDeltaMinutes !== 0) {
        let finalStart = new Date(initialStartMs);
        let finalEnd = new Date(initialEndMs);
        if (edge === "top") {
          finalStart = new Date(initialStartMs + currentDeltaMinutes * 60 * 1000);
        } else {
          finalEnd = new Date(initialEndMs + currentDeltaMinutes * 60 * 1000);
        }

        if (finalEnd.getTime() <= finalStart.getTime()) {
          finalEnd = new Date(finalStart.getTime() + 15 * 60 * 1000);
        }

        // Atualização otimista imediata na memória para 0ms de delay visual
        a.start = finalStart;
        a.end = finalEnd;

        onResize?.(a, finalStart, finalEnd);
      }
    };

    targetElement.addEventListener("pointermove", onPointerMove, { passive: true });
    targetElement.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
  };

  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const cancelCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const cancelHoverTimer = useCallback(() => {
    cancelOpenTimer();
    cancelCloseTimer();
  }, [cancelOpenTimer, cancelCloseTimer]);

  const startHoverTimer = useCallback(() => {
    cancelCloseTimer();
    if (openTimerRef.current || hoverOpen) return;
    openTimerRef.current = setTimeout(() => {
      setHoverOpen(true);
      openTimerRef.current = null;
    }, 180);
  }, [cancelCloseTimer, hoverOpen]);

  const keepHoverOpen = useCallback(() => {
    cancelCloseTimer();
    cancelOpenTimer();
    setHoverOpen(true);
  }, [cancelCloseTimer, cancelOpenTimer]);

  useEffect(() => {
    if (!hoverOpen) return;

    const handleWindowPointerMove = (e: PointerEvent) => {
      const triggerEl = triggerRef.current;
      const contentEl = contentRef.current;

      let minDistance = Infinity;

      if (triggerEl) {
        const r = triggerEl.getBoundingClientRect();
        const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
        const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
        const dist = Math.sqrt(dx * dx + dy * dy);
        minDistance = Math.min(minDistance, dist);
      }

      if (contentEl) {
        const r = contentEl.getBoundingClientRect();
        const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
        const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
        const dist = Math.sqrt(dx * dx + dy * dy);
        minDistance = Math.min(minDistance, dist);
      }

      // Se o cursor estiver na zona de segurança (<90px do card ou do popover), cancela o fechamento
      if (minDistance < 90) {
        cancelCloseTimer();
      } else {
        // Apenas quando se afasta mais de 90px é que fecha
        if (!closeTimerRef.current) {
          closeTimerRef.current = setTimeout(() => {
            setHoverOpen(false);
            closeTimerRef.current = null;
          }, 250);
        }
      }
    };

    window.addEventListener("pointermove", handleWindowPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
    };
  }, [hoverOpen, cancelCloseTimer]);

  const closeOnLeave = useCallback((event: MouseEvent<HTMLElement>) => {
    cancelOpenTimer();
    const next = event.relatedTarget;
    if (
      next instanceof Node &&
      (contentRef.current?.contains(next) || triggerRef.current?.contains(next))
    ) {
      cancelCloseTimer();
      return;
    }
    // Adiciona tolerância para movimento do mouse
    cancelCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setHoverOpen(false);
      closeTimerRef.current = null;
    }, 350);
  }, [cancelCloseTimer, cancelOpenTimer]);

  const meta = parseMeta(a.description);
  const accent = meta?.color || "#7C5CFC";
  const lightBg = softenColor(accent);

  const hasSinal = meta?.downPayment && meta.downPayment > 0;
  const hasRemaining = meta?.remainingValue && meta.remainingValue > 0;
  let payBadge: { label: string; bg: string; fg: string } | null = null;
  if (hasSinal && hasRemaining) {
    payBadge = { label: "Sinal Pago", bg: "#FEF3C7", fg: "#92400E" };
  } else if (hasSinal && !hasRemaining) {
    payBadge = { label: "Pago Total", bg: "#DCFCE7", fg: "#166534" };
  } else if (meta?.procedurePrice && meta.procedurePrice > 0 && !hasSinal) {
    payBadge = { label: "Pendente", bg: "#FEE2E2", fg: "#991B1B" };
  }

  // Cálculo dinâmico do estilo e do horário durante e após o estiramento
  let computedStyle = { ...style };
  let displayStart = new Date(a.start);
  let displayEnd = a.end ? new Date(a.end) : new Date(a.start.getTime() + 45 * 60 * 1000);

  if (moveState) {
    const baseTop = typeof style.top === "number" ? style.top : 0;
    const pxShiftY = (moveState.deltaMinutes / 60) * 72;
    const pxShiftX = moveState.deltaDays * (moveState.colWidth || 120);

    computedStyle.top = baseTop + pxShiftY;
    computedStyle.transform = `translate3d(${pxShiftX}px, 0, 0)`;

    const shiftMs = moveState.deltaDays * 24 * 60 * 60 * 1000 + moveState.deltaMinutes * 60 * 1000;
    displayStart = new Date(a.start.getTime() + shiftMs);
    if (a.end) {
      displayEnd = new Date(a.end.getTime() + shiftMs);
    }
  } else if (resizeState) {
    const baseTop = typeof style.top === "number" ? style.top : 0;
    const baseHeight = typeof style.height === "number" ? style.height : 36;
    const pxShift = (resizeState.deltaMinutes / 60) * 72;

    if (resizeState.edge === "top") {
      computedStyle.top = baseTop + pxShift;
      computedStyle.height = Math.max(24, baseHeight - pxShift);
      displayStart = new Date(a.start.getTime() + resizeState.deltaMinutes * 60 * 1000);
    } else {
      computedStyle.height = Math.max(24, baseHeight + pxShift);
      displayEnd = new Date(displayEnd.getTime() + resizeState.deltaMinutes * 60 * 1000);
    }
  } else {
    // Quando solta o mouse, calcula a posição exata de a.start e a.end para 0ms de pisca/flicker
    const startH = a.start.getHours() + a.start.getMinutes() / 60;
    const endH = a.end
      ? Math.max(startH + 0.5, a.end.getHours() + a.end.getMinutes() / 60)
      : startH + 0.75;
    if (typeof style.top === "number") {
      const topOffset = style.top % 72 > 0 ? 3 : 0;
      computedStyle.top = startH * 72 + topOffset;
    }
    const heightOffset = typeof style.height === "number" && style.height % 72 !== 0 ? 6 : 2;
    computedStyle.height = Math.max(24, (endH - startH) * 72 - heightOffset);
  }

  const startLabel = displayStart.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const endLabel = displayEnd.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const timeRange = `${startLabel} - ${endLabel}`;

  return (
    <HoverCard
      open={hoverOpen && !resizeState && !moveState && !isEdgeArea}
      onOpenChange={(open) => {
        if (!open) {
          if (closeTimerRef.current) return;
        }
        setHoverOpen(open);
      }}
      openDelay={150}
      closeDelay={600}
    >
      <HoverCardTrigger asChild>
        <button
          ref={triggerRef}
          onClick={(e) => {
            if (justResizedRef.current || isEdgeArea || resizeState || moveState) {
              e.stopPropagation();
              e.preventDefault();
              return;
            }
            onClick();
          }}
          draggable={false}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const topDist = e.clientY - rect.top;
            const bottomDist = rect.bottom - e.clientY;
            const edgeThreshold = Math.min(5, Math.max(3, rect.height * 0.12));

            if (topDist <= edgeThreshold && onResize) {
              e.preventDefault();
              e.stopPropagation();
              handleResizeStart(e, "top");
            } else if (bottomDist <= edgeThreshold && onResize) {
              e.preventDefault();
              e.stopPropagation();
              handleResizeStart(e, "bottom");
            } else {
              handleMoveStart(e);
            }
          }}
          onMouseMove={(e) => {
            if (resizeState || moveState) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const topDist = e.clientY - rect.top;
            const bottomDist = rect.bottom - e.clientY;
            const edgeThreshold = Math.min(5, Math.max(3, rect.height * 0.12));
            const isEdge = topDist <= edgeThreshold || bottomDist <= edgeThreshold;

            if (isEdge && onResize) {
              e.currentTarget.style.cursor = "ns-resize";
              if (!isEdgeArea) setIsEdgeArea(true);
              cancelHoverTimer();
              setHoverOpen(false);
            } else {
              e.currentTarget.style.cursor = "grab";
              if (isEdgeArea) setIsEdgeArea(false);
              if (!hoverOpen) {
                startHoverTimer();
              }
            }
          }}
          className="activity-chip absolute left-0.5 right-0.5 z-10 pointer-events-auto text-left active:cursor-grabbing group/card select-none"
          style={{
            ...computedStyle,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            background: lightBg,
            borderRadius: 8,
            padding: "6px 8px 6px 12px",
            boxShadow: (resizeState || moveState) ? "0 10px 25px rgba(0,0,0,0.18)" : "0 1px 2px rgba(0,0,0,.05)",
            transition: (resizeState || moveState)
              ? "none"
              : "background-color 0.28s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.28s cubic-bezier(0.16, 1, 0.3, 1), transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
            position: "absolute",
            overflow: "hidden",
            zIndex: (resizeState || moveState) ? 40 : undefined,
          }}
          onMouseEnter={(e) => {
            if (resizeState || moveState) return;
            e.currentTarget.style.background = softenColorHover(accent);
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.08)";
            e.currentTarget.style.zIndex = "25";
            startHoverTimer();
          }}
          onMouseLeave={(e) => {
            if (resizeState || moveState) return;
            setIsEdgeArea(false);
            e.currentTarget.style.background = lightBg;
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,.05)";
            e.currentTarget.style.zIndex = "10";
            closeOnLeave(e);
          }}
        >
          <span
            aria-hidden="true"
            data-accent-bar
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              backgroundColor: accent,
              transition: "width 0.2s ease",
            }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, width: "100%" }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                backgroundColor: accent,
                flexShrink: 0,
              }}
            />
            <div
              style={{
                fontFamily: "'Barlow', sans-serif",
                fontWeight: 500,
                fontSize: 13,
                lineHeight: 1.2,
                color: "#101828",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {a.title}
            </div>
          </div>

          <div
            style={{
              fontFamily: "'Barlow', sans-serif",
              fontWeight: 400,
              fontSize: 12,
              lineHeight: 1.3,
              color: "#475467",
              marginTop: 3,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {timeRange}
          </div>

          {payBadge && (
            <span
              style={{
                display: "inline-block",
                fontSize: "9px",
                fontWeight: 700,
                padding: "1px 5px",
                borderRadius: "4px",
                background: payBadge.bg,
                color: payBadge.fg,
                marginTop: "2px",
              }}
            >
              {payBadge.label}
            </span>
          )}
        </button>
      </HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent
          ref={contentRef}
          side="left"
          align="center"
          sideOffset={6}
          className="z-[9999] p-0 w-auto rounded-2xl shadow-[0_20px_50px_rgba(24,20,50,0.18)] border border-slate-100/90 bg-white pointer-events-auto overflow-hidden animate-slide-left-smooth"
          onMouseEnter={keepHoverOpen}
          onMouseLeave={closeOnLeave}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          style={{ pointerEvents: "auto" }}
        >
          {/* Ponte invisível estendida de colisão que mantém o cursor ativo mesmo em movimento na diagonal */}
          <span aria-hidden className="absolute -right-20 -top-20 -bottom-20 w-32 pointer-events-auto" />
          <ActivityHoverContent a={a} onView={onClick} onEdit={onEdit} />
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}

export const ActivityChip = memo(function ActivityChip({
  a,
  onClick,
}: {
  a: Activity;
  onClick: () => void;
  compact?: boolean;
}) {
  const isHoliday = a.kind === "feriado";
  const displayTitle = isHoliday ? a.title.replace(/^🇧🇷 Feriado:\s*/, "") : a.title;
  const c = KIND_COLOR[a.kind];

  if (isHoliday) {
    return (
      <button
        onClick={onClick}
        title={a.title}
        className="w-full min-h-[26px] flex items-center justify-start rounded-[3px] bg-[#FF7597] text-white px-2 py-1 text-[12px] font-semibold shadow-2xs hover:bg-[#FF5B83] transition-colors cursor-pointer select-none border-none text-left"
      >
        <span className="truncate w-full">{displayTitle}</span>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-1.5 rounded-[3px] border px-2 py-1 text-[11px] hover:brightness-125 transition text-left",
        c.chip,
      )}
    >
      <KindIcon kind={a.kind} className="h-3 w-3 shrink-0" />
      <span className="truncate w-full">{a.title}</span>
    </button>
  );
});
