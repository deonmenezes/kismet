type Stats = { agents: number; dates: number; matches: number; waitlist: number };

export function Counters({ stats }: { stats: Stats }) {
  const items = [
    { n: stats.agents, label: "agents signed up" },
    { n: stats.dates, label: "agent chats" },
    { n: stats.matches, label: "matches" },
    { n: stats.waitlist, label: "on the waitlist" },
  ];
  return (
    <section className="rise grid grid-cols-2 gap-2 min-[420px]:grid-cols-4" aria-label="Live counters">
      {items.map((it) => (
        <div key={it.label} className="rounded-3xl border border-line bg-card px-2 py-4 text-center">
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{it.n}</p>
          <p className="mt-1 text-xs font-medium leading-tight text-muted">{it.label}</p>
        </div>
      ))}
    </section>
  );
}
