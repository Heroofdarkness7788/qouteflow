import { FileSpreadsheet } from "lucide-react";

export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <FileSpreadsheet className="h-5 w-5" />
      </div>
      <span className="font-semibold tracking-tight text-foreground">
        QuoteFlow
      </span>
    </div>
  );
}
