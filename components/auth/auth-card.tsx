import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Card wrapper used by every auth page. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <>
      <Card className="gap-5 py-5 sm:py-6">
        <CardHeader className="px-4 sm:px-6">
          {/* The card title is the page's only heading on auth screens. */}
          <CardTitle className="text-lg font-semibold tracking-tight">
            <h1>{title}</h1>
          </CardTitle>
          {description && <CardDescription className="text-sm">{description}</CardDescription>}
        </CardHeader>
        <CardContent className="px-4 sm:px-6">{children}</CardContent>
      </Card>
      {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
    </>
  );
}
