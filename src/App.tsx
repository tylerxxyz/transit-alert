import React from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import About from "@/pages/About";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import ResetPassword from "@/pages/ResetPassword";
import Settings from "@/pages/Settings";
import TodaysAlerts from "@/pages/TodaysAlerts";
import NotFound from "@/pages/not-found";

const CRASH_REPORT_STORAGE_KEY = "transitalert-last-crash-report";
const AustralianNetworks = React.lazy(() => import("@/pages/AustralianNetworks"));

function buildCrashReport(error: unknown, source = "runtime") {
  const resolvedError = error instanceof Error ? error : new Error(String(error || "Unknown error"));
  return [
    `TransitAlert crash report`,
    `Source: ${source}`,
    `Time: ${new Date().toISOString()}`,
    `URL: ${typeof window !== "undefined" ? window.location.href : "unknown"}`,
    `User agent: ${typeof navigator !== "undefined" ? navigator.userAgent : "unknown"}`,
    `Message: ${resolvedError.message || "Unknown runtime error"}`,
    `Stack: ${resolvedError.stack || "No stack available"}`,
  ].join("\n");
}

function saveCrashReport(report: string) {
  try {
    window.localStorage.setItem(CRASH_REPORT_STORAGE_KEY, report);
  } catch {
    // Storage can fail in private browsing or locked-down mobile WebViews.
  }
}

// Initialize QueryClient
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/app" component={Home} />
      <Route path="/settings" component={Settings} />
      <Route path="/login" component={Login} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/alerts/today" component={TodaysAlerts} />
      <Route path="/networks"><React.Suspense fallback={<p className="p-6 text-white">Loading Australian networks…</p>}><AustralianNetworks /></React.Suspense></Route>
      <Route path="/about" component={About} />
      <Route component={NotFound} />
    </Switch>
  );
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; report: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null, report: "" };
  }

  static getDerivedStateFromError(error: Error) {
    return { error, report: buildCrashReport(error, "react-render") };
  }

  override componentDidCatch(error: Error) {
    const report = buildCrashReport(error, "react-render");
    saveCrashReport(report);
    console.error("Transit Alert crashed during render", error);
    this.setState({ report });
  }

  override render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-foreground">
        <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-card/90 p-6 shadow-2xl backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">
            Oops, TransitAlert hit an error
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-white">
            Something crashed before the app could finish loading.
          </h1>
          <p className="mt-3 text-sm text-white/65">
            This can happen on low-memory mobile sessions or when a live layer fails during render.
            You can reload, or copy the debug report so testers can see the exact error instead of a blank screen.
          </p>
          <pre className="mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-amber-100">
            {this.state.error.message || "Unknown runtime error"}
          </pre>
          <details className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-white/70">
            <summary className="cursor-pointer font-semibold text-white">Debug report for testers</summary>
            <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-white/70">
              {this.state.report || buildCrashReport(this.state.error, "react-render")}
            </pre>
          </details>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-500"
            >
              Reload app
            </button>
            <button
              type="button"
              onClick={() => {
                const report = this.state.report || buildCrashReport(this.state.error, "react-render");
                void navigator.clipboard?.writeText(report);
              }}
              className="rounded-2xl border border-white/10 bg-white/10 px-5 py-3 font-semibold text-white transition hover:bg-white/15"
            >
              Copy debug report
            </button>
          </div>
        </div>
      </main>
    );
  }
}

function App() {
  React.useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      saveCrashReport(buildCrashReport(event.error ?? event.message, "window-error"));
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      saveCrashReport(buildCrashReport(event.reason, "unhandled-promise"));
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppErrorBoundary>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AppErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
