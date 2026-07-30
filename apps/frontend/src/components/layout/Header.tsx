import { ExternalLink, Moon, Sun } from "lucide-react";

import { Button, useTheme } from "@methanium/ui";
import { useStatus } from "../../use-status";
import { formatTime } from "../../utils";

export function Header() {
  const { resolvedPolarity, setTheme } = useTheme();
  const { snapshot, error } = useStatus();
  const isDark = resolvedPolarity === "dark";

  return (
    <header className="sticky top-0 z-40 h-12 border-b border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm">
      <div className="flex h-full items-center justify-between overflow-x-auto px-[10px]">
        <Button
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="mr-1 shrink-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          style={{ padding: "3px 13px" }}
          render={<a href="/" aria-label="Methanium home" />}
        >
          <img src="/methanium.svg" alt="Logo" className="w-[20.59px]!" />
        </Button>
        <nav
          className="mr-auto flex h-full shrink-0 items-center"
          aria-label="Primary"
        >
          <Button
            nativeButton={false}
            variant="ghost"
            size="sm"
            className="hidden md:flex h-9 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            render={<a target="_blank" href="mailto:contact@methanium.net" />}
          >
            Contact us
          </Button>
          <Button
            nativeButton={false}
            variant="ghost"
            size="sm"
            className="hidden md:flex h-9 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            render={<a target="_blank" href="mailto:security@methanium.net" />}
          >
            Report security issue
          </Button>
        </nav>
        <div className="flex h-full items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {snapshot?.generatedAt
              ? `Updated ${formatTime(snapshot.generatedAt)}`
              : (error?.message ?? "Waiting for data")}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setTheme(isDark ? "light" : "dark")}
          >
            {isDark ? (
              <Sun className="size-3.5" />
            ) : (
              <Moon className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
