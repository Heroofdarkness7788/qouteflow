import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "QuoteFlow — AI Order to Excel Quotation" },
      {
        name: "description",
        content:
          "Paste customer order emails and instantly generate Excel quotations matched against your price list.",
      },
      { property: "og:title", content: "QuoteFlow — AI Order to Excel Quotation" },
      {
        property: "og:description",
        content:
          "Paste an order email, get a ready-to-send Excel quotation in seconds.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "QuoteFlow — AI Order to Excel Quotation" },
      { name: "description", content: "Automates the process of converting customer orders received via email into draft quotations." },
      { property: "og:description", content: "Automates the process of converting customer orders received via email into draft quotations." },
      { name: "twitter:description", content: "Automates the process of converting customer orders received via email into draft quotations." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/18a39c38-359f-4734-a637-e97a051b8afa/id-preview-5dea97fe--029be1c1-662e-4e5a-8aa4-5f1de7c820a2.lovable.app-1776676989421.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/18a39c38-359f-4734-a637-e97a051b8afa/id-preview-5dea97fe--029be1c1-662e-4e5a-8aa4-5f1de7c820a2.lovable.app-1776676989421.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
