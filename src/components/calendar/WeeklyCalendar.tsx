"use client";
import React, { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { modalBackdrop, modalContent } from "@/lib/motion";

import type { DbRow } from "@/lib/types";
import CalendarGrid from "./CalendarGrid";
import { CalendarAppointment, ViewMode } from "./types";
import { weekDays, shiftDate, todayStr, fmtDayHeader, TYPE_META, STATUS_META } from "./utils";

/* ─── Quick-add modal ─── */
function QuickAddModal({
  date,
  time,
  onClose,
  onSave,
}: {
  date: string;
  time: string;
  onClose: () => void;
  onSave: (appt: Omit<CalendarAppointment, "id">) => Promise<void>;
}) {
  const [patientSearch, setPatientSearch] = useState("");
  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [suggestions, setSuggestions] = useState<{ id: string; name: string }[]>([]);
  const [allPatients, setAllPatients] = useState<{ id: string; name: string }[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [startTime, setStartTime] = useState(time);
  const [endTime, setEndTime] = useState(() => {
    const [h, m] = time.split(":").map(Number);
    const total = h * 60 + m + 30;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  });
  const [type, setType] = useState("consulta");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("patients")
      .select("id,name")
      .eq("active", true)
      .order("name")
      .limit(500)
      .then(({ data }) => setAllPatients((data ?? []) as { id: string; name: string }[]));
  }, []);

  useEffect(() => {
    if (patientSearch.length < 2) {
      setSuggestions([]);
      return;
    }
    setSuggestions(
      allPatients
        .filter((p) => p.name.toLowerCase().includes(patientSearch.toLowerCase()))
        .slice(0, 6),
    );
  }, [patientSearch, allPatients]);

  const selectPatient = (p: { id: string; name: string }) => {
    setPatientId(p.id);
    setPatientName(p.name);
    setPatientSearch(p.name);
    setShowSug(false);
  };

  const handleSave = async () => {
    if (!patientName.trim()) return;
    setSaving(true);
    await onSave({
      patient_id: patientId || "",
      patient_name: patientName,
      date,
      start_time: startTime,
      end_time: endTime,
      type,
      status: "agendado",
    });
    setSaving(false);
    onClose();
  };

  const inp: React.CSSProperties = {
    height: 34,
    border: "1px solid #E5E7EB",
    borderRadius: 6,
    padding: "0 10px",
    fontSize: 13,
    color: "#111827",
    background: "#fff",
    fontFamily: "inherit",
    width: "100%",
  };

  return (
    <motion.div
      variants={modalBackdrop}
      initial="hidden"
      animate="show"
      exit="exit"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        variants={modalContent}
        initial="hidden"
        animate="show"
        exit="exit"
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          width: 360,
          boxShadow: "0 20px 60px rgba(0,0,0,.2)",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 16 }}>
          Novo agendamento · {date.split("-").reverse().join("/")} {startTime}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Patient search with autocomplete */}
          <div style={{ position: "relative" }}>
            <input
              placeholder="Buscar paciente…"
              value={patientSearch}
              autoFocus
              onChange={(e) => {
                setPatientSearch(e.target.value);
                setPatientId("");
                setPatientName(e.target.value);
                setShowSug(true);
              }}
              onFocus={() => setShowSug(true)}
              onBlur={() => setTimeout(() => setShowSug(false), 150)}
              style={{ ...inp, borderColor: patientId ? "#10B981" : undefined }}
            />
            {showSug && suggestions.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  zIndex: 10,
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 6,
                  boxShadow: "0 4px 16px rgba(0,0,0,.12)",
                  marginTop: 2,
                  overflow: "hidden",
                }}
              >
                {suggestions.map((p) => (
                  <div
                    key={p.id}
                    onMouseDown={() => selectPatient(p)}
                    style={{
                      padding: "8px 12px",
                      fontSize: 13,
                      cursor: "pointer",
                      color: "#111827",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#F3F4F6")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                  >
                    {p.name}
                  </div>
                ))}
              </div>
            )}
            {!patientId && patientSearch.length >= 2 && suggestions.length === 0 && (
              <div style={{ fontSize: 11, color: "#EF4444", marginTop: 3 }}>
                Paciente não encontrado na base
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 3 }}>Início</div>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                style={inp}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 3 }}>Fim</div>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                style={inp}
              />
            </div>
          </div>

          <select value={type} onChange={(e) => setType(e.target.value)} style={inp}>
            {Object.entries(TYPE_META).map(([v, m]) => (
              <option key={v} value={v}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{
              height: 34,
              padding: "0 16px",
              border: "1px solid #E5E7EB",
              borderRadius: 6,
              background: "#fff",
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !patientName.trim()}
            style={{
              height: 34,
              padding: "0 16px",
              background: "#0066D0",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: saving || !patientName.trim() ? "default" : "pointer",
              opacity: saving || !patientName.trim() ? 0.6 : 1,
              fontFamily: "inherit",
            }}
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Appointment detail popover ─── */
function ApptDetail({
  appt,
  onClose,
  onDelete,
}: {
  appt: CalendarAppointment;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const meta = TYPE_META[appt.type] ?? { label: appt.type, color: "#374151", bg: "#F3F4F6" };
  const status = STATUS_META[appt.status] ?? { label: appt.status, dot: "#9CA3AF" };

  return (
    <motion.div
      variants={modalBackdrop}
      initial="hidden"
      animate="show"
      exit="exit"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        variants={modalContent}
        initial="hidden"
        animate="show"
        exit="exit"
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          width: 320,
          boxShadow: "0 20px 60px rgba(0,0,0,.2)",
          borderTop: `4px solid ${meta.color}`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
            {appt.patient_name}
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 18,
              cursor: "pointer",
              color: "#9CA3AF",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {[
          { label: "Data", val: appt.date.split("-").reverse().join("/") },
          { label: "Horário", val: `${appt.start_time} – ${appt.end_time}` },
          { label: "Tipo", val: meta.label },
          { label: "Status", val: status.label },
          appt.insurance ? { label: "Convênio", val: appt.insurance } : null,
          appt.notes ? { label: "Obs.", val: appt.notes } : null,
        ]
          .filter(Boolean)
          .map((row, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 0",
                borderBottom: "1px solid #F3F4F6",
                fontSize: 13,
              }}
            >
              <span style={{ color: "#6B7280" }}>{row!.label}</span>
              <span style={{ color: "#111827", fontWeight: 500 }}>{row!.val}</span>
            </div>
          ))}

        <button
          onClick={() => {
            onDelete(appt.id);
            onClose();
          }}
          style={{
            marginTop: 16,
            width: "100%",
            height: 34,
            background: "#FEF2F2",
            color: "#EF4444",
            border: "1px solid #FECACA",
            borderRadius: 6,
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 600,
          }}
        >
          Cancelar agendamento
        </button>
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════
   MAIN EXPORT
═══════════════════════════════════════════ */
export default function WeeklyCalendar() {
  const [view, setView] = useState<ViewMode>("week");
  const [refDate, setRefDate] = useState(todayStr());
  const [appts, setAppts] = useState<CalendarAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [quickAdd, setQuickAdd] = useState<{ date: string; time: string } | null>(null);
  const [detail, setDetail] = useState<CalendarAppointment | null>(null);

  /* ── Load ── */
  const days = view === "week" ? weekDays(refDate) : [refDate];

  const load = useCallback(async () => {
    setLoading(true);
    const start = days[0];
    const end = days[days.length - 1];
    const { data } = await supabase
      .from("appointments")
      .select(
        "id, patient_id, patients(name), date, start_time, end_time, type, status, insurance, notes",
      )
      .gte("date", start)
      .lte("date", end)
      .order("start_time");

    const mapped: CalendarAppointment[] = (data ?? []).map((r: DbRow) => ({
      id: r.id,
      patient_id: r.patient_id,
      patient_name: r.patients?.name ?? "Paciente",
      date: r.date,
      start_time: r.start_time?.slice(0, 5) ?? "00:00",
      end_time: r.end_time?.slice(0, 5) ?? "00:30",
      type: r.type,
      status: r.status,
      insurance: r.insurance ?? undefined,
      notes: r.notes ?? undefined,
    }));
    setAppts(mapped);
    setLoading(false);
  }, [days.join(",")]);

  useEffect(() => {
    load();
  }, [load]);

  /* ── Drag-drop / resize update ── */
  const handleUpdate = useCallback(
    async (updated: CalendarAppointment) => {
      // Optimistic update
      setAppts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setSaving(true);
      const { error } = await supabase
        .from("appointments")
        .update({
          date: updated.date,
          start_time: updated.start_time,
          end_time: updated.end_time,
        })
        .eq("id", updated.id);
      if (error) {
        console.error("Calendar update failed:", error);
        load(); // revert on error
      }
      setSaving(false);
    },
    [load],
  );

  /* ── Quick add ── */
  const handleQuickSave = useCallback(
    async (appt: Omit<CalendarAppointment, "id">) => {
      // Insert locally first (temp id)
      const tempId = `temp-${Date.now()}`;
      setAppts((prev) => [...prev, { ...appt, id: tempId }]);

      const { data, error } = await supabase
        .from("appointments")
        .insert({
          patient_id: appt.patient_id,
          doctor_id: (appt as DbRow).doctor_id,
          date: appt.date,
          start_time: appt.start_time,
          end_time: appt.end_time,
          type: appt.type,
          status: appt.status,
        } as DbRow)
        .select("id")
        .single();

      if (!error && data) {
        setAppts((prev) => prev.map((a) => (a.id === tempId ? { ...a, id: data.id } : a)));
      } else {
        setAppts((prev) => prev.filter((a) => a.id !== tempId));
        load();
      }
    },
    [load],
  );

  /* ── Delete ── */
  const handleDelete = useCallback(
    async (id: string) => {
      const snapshot = appts.find((a) => a.id === id);
      setAppts((prev) => prev.filter((a) => a.id !== id));
      const { error } = await supabase
        .from("appointments")
        .update({ status: "cancelado" })
        .eq("id", id);
      if (error) {
        // Revert optimistic removal on failure
        if (snapshot) setAppts((prev) => [...prev, snapshot]);
        toast.error("Erro ao cancelar agendamento. Tente novamente.");
      } else {
        toast.success("Agendamento cancelado");
      }
    },
    [appts],
  );

  /* ── Navigation ── */
  const goBack = useCallback(() => {
    setRefDate((d) => (view === "week" ? shiftDate(d, -7) : shiftDate(d, -1)));
  }, [view]);
  const goForward = useCallback(() => {
    setRefDate((d) => (view === "week" ? shiftDate(d, 7) : shiftDate(d, 1)));
  }, [view]);

  /* ── Keyboard shortcuts (T=hoje, D=dia, W=semana, ←/→ navegar) ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ignore when typing in inputs / modais abertos
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (quickAdd || detail) return;

      const k = e.key.toLowerCase();
      if (k === "t") {
        setRefDate(todayStr());
      } else if (k === "d") {
        setView("day");
      } else if (k === "w") {
        setView("week");
      } else if (e.key === "ArrowLeft") {
        goBack();
      } else if (e.key === "ArrowRight") {
        goForward();
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack, goForward, quickAdd, detail]);

  const headerLabel =
    view === "week"
      ? (() => {
          const start = days[0];
          const end = days[6];
          const s = new Date(start + "T12:00:00");
          const e = new Date(end + "T12:00:00");
          const sameMonth = s.getMonth() === e.getMonth();
          if (sameMonth) {
            const monthYear = e.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
            return `${s.getDate()} – ${e.getDate()} de ${monthYear}`;
          }
          return `${s.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${e.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;
        })()
      : new Date(refDate + "T12:00:00").toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          year: "numeric",
        });

  const [viewMenuOpen, setViewMenuOpen] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#fff",
        position: "relative",
      }}
    >
      {/* ── Toolbar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 20px",
          borderBottom: "1px solid #EEF0F3",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setRefDate(todayStr())}
          style={{
            background: "transparent",
            border: "none",
            padding: "4px",
            fontSize: 14,
            color: "#111827",
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 500,
          }}
        >
          Hoje
        </button>

        <button
          onClick={goBack}
          aria-label="Anterior"
          style={{
            background: "transparent",
            border: "none",
            padding: 4,
            fontSize: 18,
            color: "#6B7280",
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          ‹
        </button>

        <span style={{ fontSize: 14, fontWeight: 500, color: "#111827", minWidth: 160 }}>
          {headerLabel}
        </span>

        <button
          onClick={goForward}
          aria-label="Próximo"
          style={{
            background: "transparent",
            border: "none",
            padding: 4,
            fontSize: 18,
            color: "#6B7280",
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          ›
        </button>

        <div style={{ flex: 1 }} />

        {saving && (
          <span style={{ fontSize: 11, color: "#6C4CF7", fontWeight: 500 }}>Salvando…</span>
        )}
        {loading && <span style={{ fontSize: 11, color: "#9CA3AF" }}>Carregando…</span>}

        <button
          onClick={() =>
            toast.info("Anna — Assistente IA", {
              description: "Em breve: sugestões automáticas de horários e otimização da agenda.",
            })
          }
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            height: 40,
            padding: "0 18px",
            borderRadius: 12,
            border: "none",
            background: "linear-gradient(135deg, #7BD3FF 0%, #A88BFF 55%, #C89BFF 100%)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            boxShadow: "0 6px 18px rgba(140,120,255,.35)",
          }}
        >
          <span style={{ fontSize: 15 }}>✨</span>
          Pedir à Anna
        </button>

        <div style={{ position: "relative" }}>
          <button
            onClick={() => setViewMenuOpen((o) => !o)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              height: 40,
              padding: "0 14px",
              borderRadius: 12,
              border: "1px solid #E5E7EB",
              background: "#fff",
              fontSize: 14,
              color: "#111827",
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <span style={{ fontSize: 14 }}>🗓</span>
            {view === "week" ? "Semana" : "Dia"}
            <span style={{ fontSize: 10, color: "#9CA3AF", marginLeft: 2 }}>▾</span>
          </button>
          {viewMenuOpen && (
            <div
              style={{
                position: "absolute",
                top: 44,
                right: 0,
                zIndex: 20,
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 10,
                boxShadow: "0 10px 30px rgba(0,0,0,.08)",
                overflow: "hidden",
                minWidth: 140,
              }}
            >
              {(["week", "day"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setView(v);
                    setViewMenuOpen(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 14px",
                    fontSize: 13,
                    background: view === v ? "#F5F3FF" : "#fff",
                    color: view === v ? "#6C4CF7" : "#111827",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontWeight: view === v ? 600 : 400,
                  }}
                >
                  {v === "week" ? "Semana" : "Dia"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Grid ── */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <CalendarGrid
          appointments={appts}
          view={view}
          referenceDate={refDate}
          onUpdate={handleUpdate}
          onSlotClick={(date, time) => setQuickAdd({ date, time })}
          onAppointmentClick={(a) => setDetail(a)}
        />

        <button
          onClick={() => setQuickAdd({ date: refDate, time: "08:00" })}
          aria-label="Novo agendamento"
          style={{
            position: "absolute",
            right: 28,
            bottom: 96,
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "#6C4CF7",
            color: "#fff",
            border: "none",
            fontSize: 26,
            lineHeight: 1,
            cursor: "pointer",
            boxShadow: "0 10px 24px rgba(108,76,247,.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "inherit",
          }}
        >
          +
        </button>
        <button
          aria-label="Assistente IA"
          onClick={() =>
            toast.info("Assistente IA", {
              description: "Em breve: análise inteligente da agenda e sugestões personalizadas.",
            })
          }
          style={{
            position: "absolute",
            right: 28,
            bottom: 28,
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "radial-gradient(circle at 30% 30%, #FFD1F0 0%, #E9C7FF 55%, #C9B6FF 100%)",
            color: "#7A3AFF",
            border: "none",
            fontSize: 22,
            cursor: "pointer",
            boxShadow: "0 10px 24px rgba(200,155,255,.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "inherit",
          }}
        >
          ✨
        </button>
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>
        {quickAdd && (
          <QuickAddModal
            date={quickAdd.date}
            time={quickAdd.time}
            onClose={() => setQuickAdd(null)}
            onSave={handleQuickSave}
          />
        )}
        {detail && (
          <ApptDetail appt={detail} onClose={() => setDetail(null)} onDelete={handleDelete} />
        )}
      </AnimatePresence>
    </div>
  );
}
