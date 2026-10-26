import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, MessageCircle, RefreshCw, TrainFront, X } from "lucide-react";
import { fetchConsistSnapshot } from "@/lib/transportvic-bot";
import { formatRelativeTime } from "@/lib/relative-time";

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function getStatusCopy(status: "active" | "idle" | "finished") {
  switch (status) {
    case "active":
      return "Currently running";
    case "idle":
      return "Waiting for next trip";
    default:
      return "Finished for now";
  }
}

export function ChatPanel({ isOpen, onClose }: ChatPanelProps) {
  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["/api/consist/430M"],
    queryFn: () => fetchConsistSnapshot("430M"),
    enabled: isOpen,
    refetchInterval: isOpen ? 60000 : false,
    retry: false,
  });

  // Overlay panel: Escape closes it, like the app's other dialogs.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const updatedLabel = data?.as_of
    ? formatRelativeTime(data.as_of)
    : null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm md:hidden"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            role="dialog"
            aria-modal="true"
            aria-label="430M Tracker Bot"
            className="fixed bottom-0 right-0 top-0 z-50 flex w-full flex-col border-l border-white/10 bg-card md:w-[430px]"
          >
            <div className="flex items-center justify-between border-b border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/20">
                  <MessageCircle className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-xl font-bold leading-none text-white">430M Tracker Bot</h2>
                  <p className="mt-1 text-xs font-medium text-blue-300">
                    Powered by TransportVic consist tracking
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="rounded-full bg-white/5 p-2 transition-colors hover:bg-white/10"
                  aria-label="Refresh tracker"
                >
                  <RefreshCw className={`h-4 w-4 text-white/70 ${isFetching ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full bg-white/5 p-2 transition-colors hover:bg-white/10"
                  aria-label="Close tracker"
                >
                  <X className="h-5 w-5 text-white/70" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {isLoading ? (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-white/70">
                  Loading live consist status...
                </div>
              ) : error instanceof Error ? (
                <div className="rounded-3xl border border-amber-400/20 bg-amber-500/10 p-5 text-sm text-amber-100">
                  <p className="font-semibold">Tracker unavailable</p>
                  <p className="mt-2 opacity-80">{error.message}</p>
                </div>
              ) : data ? (
                <div className="space-y-4">
                  <section className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300/80">
                          Live status
                        </p>
                        <h3 className="mt-2 flex items-center gap-2 text-xl font-semibold text-white">
                          <TrainFront className="h-5 w-5 text-blue-300" />
                          Consist {data.consist}
                        </h3>
                        <p className="mt-1 text-sm text-white/65">{getStatusCopy(data.status)}</p>
                      </div>
                      <a
                        href={`https://transportvic.me/metro/tracker/consist?consist=${encodeURIComponent(data.consist)}&date=`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                      >
                        Open source <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>

                    {updatedLabel && (
                      <p className="mt-4 text-xs text-white/45">Updated {updatedLabel}</p>
                    )}
                  </section>

                  <section className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
                    <p className="text-sm font-semibold text-white">Current trip</p>
                    {data.current_trip ? (
                      <div className="mt-3 space-y-3 text-sm text-white/75">
                        <div>
                          <p className="text-lg font-semibold text-white">
                            {data.current_trip.origin} to {data.current_trip.destination}
                          </p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/40">
                            Trip {data.current_trip.id}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-2xl border border-white/5 bg-black/20 p-3">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Departs</p>
                            <p className="mt-1 font-medium text-white">{data.current_trip.departs}</p>
                          </div>
                          <div className="rounded-2xl border border-white/5 bg-black/20 p-3">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Arrives</p>
                            <p className="mt-1 font-medium text-white">{data.current_trip.arrives}</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-white/60">No active trip at the moment.</p>
                    )}
                  </section>

                  <section className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
                    <p className="text-sm font-semibold text-white">Position estimate</p>
                    {data.position ? (
                      <div className="mt-3 space-y-3 text-sm text-white/75">
                        <div>
                          <p className="font-medium text-white">{data.position.current_stop}</p>
                          <p className="mt-1 text-white/60">
                            {data.position.vehicle_stop_status === "IN_TRANSIT_TO"
                              ? `Heading toward ${data.position.next_stop ?? "the next stop"}`
                              : "Stopped at station"}
                          </p>
                        </div>
                        {typeof data.position.progress_pct === "number" && (
                          <div>
                            <div className="mb-2 flex items-center justify-between text-xs text-white/45">
                              <span>Trip progress</span>
                              <span>{data.position.progress_pct}%</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-white/10">
                              <div
                                className="h-full rounded-full bg-blue-500 transition-all"
                                style={{ width: `${data.position.progress_pct}%` }}
                              />
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-2xl border border-white/5 bg-black/20 p-3">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Current stop</p>
                            <p className="mt-1 text-white">{data.position.current_stop_time}</p>
                          </div>
                          <div className="rounded-2xl border border-white/5 bg-black/20 p-3">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Next stop</p>
                            <p className="mt-1 text-white">
                              {data.position.next_stop_time ?? "Waiting"}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-white/60">No stop-level estimate available right now.</p>
                    )}
                  </section>

                  <section className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
                    <p className="text-sm font-semibold text-white">Next trip</p>
                    {data.next_trip ? (
                      <div className="mt-3 text-sm text-white/75">
                        <p className="font-medium text-white">
                          {data.next_trip.origin} to {data.next_trip.destination}
                        </p>
                        <p className="mt-1">Departs {data.next_trip.departs} and arrives {data.next_trip.arrives}</p>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-white/60">No next trip published right now.</p>
                    )}
                  </section>

                  <section className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
                    <p className="text-sm font-semibold text-white">Network alerts</p>
                    {data.network_alerts.length === 0 ? (
                      <p className="mt-3 text-sm text-white/60">No alerts parsed from the live board right now.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {data.network_alerts.map((alert, index) => (
                          <div
                            key={`${alert}-${index}`}
                            className="rounded-2xl border border-amber-400/15 bg-amber-500/10 px-3 py-3 text-sm text-amber-100"
                          >
                            {alert}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
