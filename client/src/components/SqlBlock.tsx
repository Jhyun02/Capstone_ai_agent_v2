import { Check, Copy, CheckCircle2, XCircle, ShieldCheck, ShieldAlert } from "lucide-react";
import { useState } from "react";
import type { SqlValidation } from "@shared/routes";

interface SqlBlockProps {
  code: string;
  validation?: SqlValidation;
}

export function SqlBlock({ code, validation }: SqlBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-lg overflow-hidden border border-border bg-muted/30 my-4">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-border/50">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">생성된 SQL</span>
        <button
          onClick={handleCopy}
          className="p-1.5 rounded-md hover:bg-background/80 text-muted-foreground hover:text-foreground transition-all duration-200"
          title="SQL 복사"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div className="p-4 overflow-x-auto">
        <pre className="text-sm font-mono text-foreground/90">
          <code>{code}</code>
        </pre>
      </div>

      {validation && (
        <div className="px-4 py-3 border-t border-border/50 bg-muted/20">
          <div className="flex items-center gap-2 mb-2">
            {validation.overall ? (
              <ShieldCheck className="w-4 h-4 text-green-500" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-yellow-500" />
            )}
            <span className="text-xs font-medium text-muted-foreground">
              SQL 검증 {validation.overall ? "통과" : "경고"}
            </span>
          </div>
          <div className="space-y-1">
            {validation.items.map((item) => (
              <div key={item.key} className="flex items-center gap-2 text-xs">
                {item.passed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                )}
                <span className={item.passed ? "text-muted-foreground" : "text-red-400"}>
                  {item.label}: {item.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
