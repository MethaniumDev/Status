import "./styles.css";

import { BUILT_IN_THEMES, ThemeProvider } from "@methanium/ui";
import { Provider as MTPProvider } from "@methanium/status-mtp";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { routeTree } from "./routeTree.gen";
import { mtpOptions } from "./mtp-options.ts";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider
      defaultTheme="dark"
      themes={BUILT_IN_THEMES}
      defaultParentThemeId="methanium"
    >
      <MTPProvider options={mtpOptions} authenticate={false}>
        <RouterProvider router={router} />
      </MTPProvider>
    </ThemeProvider>
  </StrictMode>,
);
