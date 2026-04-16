import { type LucideIcon, Sparkles } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ComingSoon({
  title,
  subtitle,
  description,
  icon: Icon,
  bullets,
}: {
  title: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  bullets: string[];
}) {
  return (
    <>
      <Topbar title={title} subtitle={subtitle}>
        <Badge
          variant="outline"
          className="hidden sm:inline-flex border-dashed bg-transparent text-[10px] text-muted-foreground/80"
        >
          Coming soon
        </Badge>
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader kicker="Roadmap" title={title} description={description} />

        <Card className="relative overflow-hidden border-border bg-card/60 card-lift">
          <div aria-hidden className="absolute inset-0 bg-grid opacity-60" />
          <div
            aria-hidden
            className="absolute inset-x-0 -top-24 h-64 bg-gradient-to-b from-primary/10 to-transparent blur-3xl"
          />
          <CardContent className="relative p-8 sm:p-12">
            <div className="flex flex-col items-start gap-6 sm:flex-row">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </div>

              <div className="flex-1 space-y-5">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles
                      className="h-3.5 w-3.5 text-primary"
                      strokeWidth={2}
                    />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                      In development
                    </span>
                  </div>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                    Scoped for the next release
                  </h3>
                </div>

                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {bullets.map((b) => (
                    <li
                      key={b}
                      className="flex items-start gap-2 text-[13px] text-muted-foreground"
                    >
                      <span
                        aria-hidden
                        className="mt-[8px] inline-block h-1 w-1 shrink-0 rounded-full bg-primary"
                      />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
