import { useGetReportStats } from "@/lib/api-client-react/src/generated/api";
import { Flame, AlertTriangle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function RiskyRoutes() {
  const { data: stats, isLoading, isError } = useGetReportStats({
    query: { queryKey: ["/api/reports/stats"], refetchInterval: 60000 }
  });

  if (isError) return (
    <div role="status" className="absolute left-4 top-32 z-30 hidden max-w-64 rounded-2xl border border-white/10 bg-card/90 p-4 text-sm text-white/70 md:block">
      Community report activity is unavailable. Please try again later.
    </div>
  );

  if (isLoading || !stats?.riskyRoutes?.length) return null;

  return (
    <div className="absolute left-4 sm:left-6 top-32 bottom-32 w-64 pointer-events-none z-30 hidden md:flex flex-col">
      <div className="bg-card/60 backdrop-blur-2xl border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col pointer-events-auto h-full max-h-[500px]">
        <div className="p-4 border-b border-white/5 bg-gradient-to-b from-white/5 to-transparent">
          <h2 className="font-display font-bold text-lg text-white flex items-center gap-2">
            <Flame className="w-5 h-5 text-warning" />
            Risky Routes
          </h2>
          <p className="text-xs text-muted-foreground mt-1">High inspector activity</p>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin scrollbar-thumb-white/10">
          {stats.riskyRoutes.map((route, i: number) => (
            <div 
              key={i}
              className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center font-display font-bold text-lg",
                  route.riskLevel === 'high' ? 'bg-destructive/20 text-destructive border border-destructive/20' :
                  route.riskLevel === 'medium' ? 'bg-warning/20 text-warning border border-warning/20' :
                  'bg-green-500/20 text-green-400 border border-green-500/20'
                )}>
                  {route.lineNumber}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold capitalize text-white/90">{route.transportType}</span>
                  <span className="text-xs text-muted-foreground">{route.reportCount} reports</span>
                </div>
              </div>
              
              {route.riskLevel === 'high' && <AlertTriangle className="w-4 h-4 text-destructive opacity-70" />}
              {route.riskLevel === 'low' && <ShieldCheck className="w-4 h-4 text-green-400 opacity-70" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
