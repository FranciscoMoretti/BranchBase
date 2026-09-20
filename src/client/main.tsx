import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { RecoveryBoundary } from "./components/recovery-boundary";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { queryClient } from "./query-client";

import "./styles.css";

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing root element");
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RecoveryBoundary
            description="Try again to restore the interface. Your apps continue running independently."
            title="This view couldn’t load"
          >
            <App />
            <Toaster closeButton expand position="bottom-right" />
          </RecoveryBoundary>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
);
