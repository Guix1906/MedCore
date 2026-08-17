import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/utils/cn";

type Props = {
  value: string; // "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"
  onChange: (v: string) => void;
  mode?: "datetime" | "date";
  disabled?: boolean;
  className?: string;
  placeholder?: string;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function DateTimePicker({
  value,
  onChange,
  mode = "datetime",
  disabled,
  className,
  placeholder = "Selecionar",
}: Props) {
  const date = value ? new Date(value.length === 10 ? `${value}T00:00` : value) : undefined;
  const time = value && value.length > 10 ? value.slice(11, 16) : "";

  const setDate = (d?: Date) => {
    if (!d) return onChange("");
    const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (mode === "date") return onChange(datePart);
    onChange(`${datePart}T${time || "09:00"}`);
  };

  const setTime = (t: string) => {
    const datePart = value?.slice(0, 10) || format(new Date(), "yyyy-MM-dd");
    onChange(`${datePart}T${t || "09:00"}`);
  };

  return (
    <div className={cn("grid w-full min-w-0 grid-cols-[minmax(0,1fr)_104px] gap-3", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "min-h-10 min-w-0 w-full justify-start text-left font-normal",
              !date && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate leading-5">
              {date ? format(date, "PPP", { locale: ptBR }) : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
          <Calendar mode="single" selected={date} onSelect={setDate} initialFocus locale={ptBR} />
        </PopoverContent>
      </Popover>
      {mode === "datetime" && (
        <Input
          type="time"
          className="h-10 w-full min-w-0 shrink-0 text-center"
          disabled={disabled}
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      )}
    </div>
  );
}
