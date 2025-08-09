import React, { useEffect, useMemo, useState } from "react";

/**
 * F1 Season Tracker — Multi-Season + Analytics (localStorage)
 * - Seasons: create/rename/delete/switch
 * - Teams/Drivers/Events/Results per season
 * - Analytics: averages, podiums, DNFs, team totals, cumulative trends (inline SVG)
 */

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const toISODate = (d) => new Date(d).toISOString().slice(0, 10);

const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

const computePointsFor = (position, type) =>
  type === "Sprint"
    ? position >= 1 && position <= SPRINT_POINTS.length ? SPRINT_POINTS[position - 1] : 0
    : position >= 1 && position <= RACE_POINTS.length ? RACE_POINTS[position - 1] : 0;

const classNames = (...xs) => xs.filter(Boolean).join(" ");

// ---------- storage helpers ----------
function useStoredState(key, initial) {
  const [state, setState] = useState(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : initial; }
    catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(state)); } catch {} }, [key, state]);
  return [state, setState];
}
function useSeasonedState(seasonId, baseKey, initial) {
  const key = `${baseKey}_${seasonId || "no-season"}`;
  const [state, setState] = useState(initial);
  useEffect(() => {
    try { const raw = localStorage.getItem(key); setState(raw ? JSON.parse(raw) : initial); }
    catch { setState(initial); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(state)); } catch {} }, [key, state]);
  return [state, setState];
}

// ---------- scoring helpers for Analytics ----------
function sortEventsByRound(events) {
  return [...events].sort((a,b) => (a.round ?? 0) - (b.round ?? 0));
}
function groupResultsByEvent(results) {
  const m = new Map();
  for (const r of results) {
    if (!m.has(r.eventId)) m.set(r.eventId, []);
    m.get(r.eventId).push(r);
  }
  return m;
}
function scoreEventEntries(event, entries) {
  return entries
    .slice()
    .sort((a,b)=>a.position-b.position)
    .map(r => {
      const base = r.status === 'FIN' ? computePointsFor(r.position, event.type) : 0;
      const fl = (event.type === 'GP' && r.fastestLap && r.position <= 10) ? 1 : 0;
      return { driverId: r.driverId, pts: base + fl, pos: r.position, status: r.status, fastestLapApplied: !!fl };
    });
}

// ---------- App ----------
export default function App() {
  // seasons meta
  const [meta, setMeta] = useStoredState("f1_seasons_meta", { seasons: [], activeId: "" });

  // migrate legacy single-season keys on first run
  useEffect(() => {
    if (meta.seasons && meta.seasons.length) return;
    const legacyKeys = ["f1_teams","f1_drivers","f1_events","f1_results"];
    const legacy = legacyKeys.map(k => { try { return JSON.parse(localStorage.getItem(k)||"null"); } catch { return null; }});
    const id = uid();
    setMeta({ seasons: [{ id, name: "Season 1" }], activeId: id });
    ["teams","drivers","events","results"].forEach((name,i)=>{
      const data = legacy[i]; if (data) localStorage.setItem(`f1_${name}_${id}`, JSON.stringify(data));
    });
    legacyKeys.forEach(k => localStorage.removeItem(k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!meta.seasons?.length) {
      const id = uid();
      setMeta({ seasons: [{ id, name: "Season 1" }], activeId: id });
    }
  }, [meta.seasons?.length]);

  const activeSeason = meta.seasons.find(s => s.id === meta.activeId) || meta.seasons[0];

  // season-scoped data
  const [teams, setTeams] = useSeasonedState(activeSeason?.id, "f1_teams", []);
  const [drivers, setDrivers] = useSeasonedState(activeSeason?.id, "f1_drivers", []);
  const [events, setEvents] = useSeasonedState(activeSeason?.id, "f1_events", []);
  const [results, setResults] = useSeasonedState(activeSeason?.id, "f1_results", []);
  const [tab, setTab] = useStoredState("f1_tab", "Standings");

  const teamById = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t])), [teams]);
  const driverById = useMemo(() => Object.fromEntries(drivers.map(d => [d.id, d])), [drivers]);

  const standings = useMemo(
    () => buildStandings({ drivers, teams, events, results, driverById }),
    [drivers, teams, events, results, driverById]
  );

  // CRUD
  const addTeam = (team) => setTeams(prev => [...prev, { id: uid(), color: "", ...team }]);
  const updateTeam = (id, patch) => setTeams(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  const deleteTeam = (id) => { setTeams(prev => prev.filter(t => t.id !== id)); setDrivers(prev => prev.map(d => d.teamId === id ? { ...d, teamId: "" } : d)); };

  const addDriver = (driver) => setDrivers(prev => [...prev, { id: uid(), country: "", teamId: "", ...driver }]);
  const updateDriver = (id, patch) => setDrivers(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
  const deleteDriver = (id) => setDrivers(prev => prev.filter(d => d.id !== id));

  const addEvent = (evt) => setEvents(prev => {
    const round = evt.round ?? (prev.length + 1);
    return [...prev, { id: uid(), date: toISODate(new Date()), type: "GP", ...evt, round }].sort((a,b)=>a.round-b.round);
  });
  const updateEvent = (id, patch) => setEvents(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  const deleteEvent = (id) => { setEvents(prev => prev.filter(e => e.id !== id)); setResults(prev => prev.filter(r => r.eventId !== id)); };

  const bulkReplaceEventResults = (eventId, entries) =>
    setResults(prev => normalizeResults([...prev.filter(r => r.eventId !== eventId), ...entries]));

  const clearSeason = () => {
    if (!confirm(`Erase ALL data for "${activeSeason?.name}"?`)) return;
    setTeams([]); setDrivers([]); setEvents([]); setResults([]); setTab("Standings");
  };

  // seasons actions
  const createSeason = () => {
    const base = `Season ${meta.seasons.length + 1}`;
    const name = prompt("New season name:", base) || base;
    const id = uid();
    setMeta({ seasons: [...meta.seasons, { id, name }], activeId: id });
  };
  const renameSeason = () => {
    if (!activeSeason) return;
    const name = prompt("Rename season:", activeSeason.name);
    if (!name) return;
    setMeta({ ...meta, seasons: meta.seasons.map(s => s.id === activeSeason.id ? { ...s, name } : s) });
  };
  const deleteSeason = () => {
    if (!activeSeason) return;
    if (!confirm(`Delete "${activeSeason.name}" and all its data?`)) return;
    ["teams","drivers","events","results"].forEach(kind => localStorage.removeItem(`f1_${kind}_${activeSeason.id}`));
    const seasons = meta.seasons.filter(s => s.id !== activeSeason.id);
    setMeta({ seasons, activeId: seasons[0]?.id || "" });
  };
  const switchSeason = (id) => setMeta({ ...meta, activeId: id });

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="app-header">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-2 h-6 rounded bg-black" />
          <h1 className="text-xl font-bold tracking-tight">F1 Season Tracker</h1>

          <div className="ml-4 flex items-center gap-2">
            <select className="border rounded-xl px-3 py-1.5" value={activeSeason?.id || ""} onChange={(e)=>switchSeason(e.target.value)}>
              {meta.seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="btn" onClick={createSeason}>+ New</button>
            <button className="btn" onClick={renameSeason}>Rename</button>
            <button className="btn btn-danger" onClick={deleteSeason}>Delete</button>
          </div>

          <div className="ml-auto flex gap-2">
            <button onClick={() => exportJSON(activeSeason, { teams, drivers, events, results })} className="btn">Export</button>
            <label className="btn cursor-pointer">
              Import
              <input type="file" accept="application/json" className="hidden"
                     onChange={e => e.target.files?.[0] &&
                       importJSON(e.target.files[0], activeSeason, { setTeams, setDrivers, setEvents, setResults, setTab })}/>
            </label>
            <button onClick={clearSeason} className="btn btn-danger">Reset Season</button>
          </div>
        </div>

        <nav className="max-w-7xl mx-auto px-4 pb-2 flex gap-1 flex-wrap">
          {['Standings','Events','Enter Results','Drivers','Teams','Analytics','Data'].map(t => (
            <button key={t} onClick={()=>setTab(t)}
              className={classNames("px-3 py-1.5 rounded-xl text-sm",
                tab===t ? "bg-black text-white" : "hover:bg-neutral-100 border border-neutral-200")}>
              {t}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {tab === 'Teams' && <TeamsPanel teams={teams} addTeam={addTeam} updateTeam={updateTeam} deleteTeam={deleteTeam} />}
        {tab === 'Drivers' && <DriversPanel drivers={drivers} teams={teams} addDriver={addDriver} updateDriver={updateDriver} deleteDriver={deleteDriver} />}
        {tab === 'Events' && <EventsPanel events={events} updateEvent={updateEvent} deleteEvent={deleteEvent} addEvent={addEvent} />}
        {tab === 'Enter Results' && <EnterResultsPanel events={events} drivers={drivers} results={results} bulkReplace={bulkReplaceEventResults} />}
        {tab === 'Standings' && <StandingsPanel standings={standings} teamById={teamById} />}
        {tab === 'Analytics' && <AnalyticsPanel drivers={drivers} teams={teams} events={events} results={results} />}
        {tab === 'Data' && <DataPeek teams={teams} drivers={drivers} events={events} results={results} />}

        <footer className="mt-16 text-sm text-neutral-500">
          <p>Season: <span className="font-medium">{activeSeason?.name || "—"}</span></p>
          <p>Points rules: GP [25,18,15,12,10,8,6,4,2,1], Sprint [8..1]. Fastest Lap +1 (GP, top-10 only).</p>
        </footer>
      </main>
    </div>
  );
}

// ---------- Panels ----------
function TeamsPanel({ teams, addTeam, updateTeam, deleteTeam }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#111827");
  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Teams</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border rounded-2xl p-4 bg-white">
          <h3 className="font-medium mb-3">Add Team</h3>
          <div className="flex flex-col gap-3">
            <input className="px-3 py-2" placeholder="Team name" value={name} onChange={e=>setName(e.target.value)} />
            <div className="flex items-center gap-3">
              <input type="color" value={color} onChange={e=>setColor(e.target.value)} />
              <span className="text-sm text-neutral-600">Team color</span>
            </div>
            <button onClick={()=>{ if(!name.trim()) return; addTeam({ name: name.trim(), color }); setName(""); }} className="btn btn-primary">Add Team</button>
          </div>
        </div>

        <div className="border rounded-2xl p-4 bg-white">
          <h3 className="font-medium mb-3">Current Teams</h3>
          <ul className="space-y-2">
            {teams.map(t => (
              <li key={t.id} className="flex items-center gap-3 p-2 rounded-xl border">
                <span className="w-3 h-3 rounded" style={{background:t.color}} />
                <input className="flex-1 bg-transparent" value={t.name} onChange={e=>updateTeam(t.id,{name:e.target.value})} />
                <input type="color" value={t.color||"#111827"} onChange={e=>updateTeam(t.id,{color:e.target.value})} />
                <button onClick={()=>deleteTeam(t.id)} className="btn btn-danger">Delete</button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function DriversPanel({ drivers, teams, addDriver, updateDriver, deleteDriver }) {
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id || "");
  useEffect(()=>{ if (!teams.find(t=>t.id===teamId) && teams[0]) setTeamId(teams[0].id); }, [teams]);

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Drivers</h2>
      <div className="grid md:grid-cols-2 gap-4">
        {/* Add Driver */}
        <div className="border rounded-2xl p-4 bg-white">
          <h3 className="font-medium mb-3">Add Driver</h3>
          <div className="flex flex-col gap-3">
            <input className="px-3 py-2" placeholder="Driver name" value={name} onChange={e=>setName(e.target.value)} />
            <input className="px-3 py-2" placeholder="Country (optional)" value={country} onChange={e=>setCountry(e.target.value)} />
            <select className="px-3 py-2" value={teamId} onChange={e=>setTeamId(e.target.value)}>
              <option value="">— No Team —</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={()=>{ if(!name.trim()) return; addDriver({ name: name.trim(), country: country.trim(), teamId }); setName(""); setCountry(""); }} className="btn btn-primary self-start">Add Driver</button>
          </div>
        </div>

        {/* Current Drivers */}
        <div className="border rounded-2xl p-4 bg-white">
          <h3 className="font-medium mb-3">Current Drivers</h3>
          <table className="table-auto w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th>Driver</th>
                <th>Country</th>
                <th>Team</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => (
                <tr key={d.id}>
                  <td className="min-w-[10rem]"><input className="w-full px-2 py-1" value={d.name} onChange={e=>updateDriver(d.id,{name:e.target.value})} /></td>
                  <td className="min-w-[8rem]"><input className="w-full px-2 py-1" value={d.country||""} onChange={e=>updateDriver(d.id,{country:e.target.value})} /></td>
                  <td className="min-w-[10rem]">
                    <select className="w-full px-2 py-1" value={d.teamId||""} onChange={e=>updateDriver(d.id,{teamId:e.target.value})}>
                      <option value="">— No Team —</option>
                      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                  <td className="text-right w-[5rem]"><button onClick={()=>deleteDriver(d.id)} className="btn btn-danger">Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </section>
  );
}

function EventsPanel({ events, addEvent, updateEvent, deleteEvent }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("GP");
  const [date, setDate] = useState(toISODate(new Date()));

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Events (Grand Prix & Sprints)</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border rounded-2xl p-4 bg-white">
          <h3 className="font-medium mb-3">Add Event</h3>
          <div className="flex flex-col gap-3">
            <input className="px-3 py-2" placeholder="Event name (e.g., Australian GP)" value={name} onChange={e=>setName(e.target.value)} />
            <div className="flex gap-2">
              <select className="px-3 py-2" value={type} onChange={e=>setType(e.target.value)}>
                <option>GP</option>
                <option>Sprint</option>
              </select>
              <input type="date" className="px-3 py-2" value={date} onChange={e=>setDate(e.target.value)} />
            </div>
            <button onClick={()=>{ if(!name.trim()) return; addEvent({ name: name.trim(), type, date }); setName(""); }} className="btn btn-primary self-start">Add Event</button>
          </div>
        </div>

        <div className="border rounded-2xl p-4 bg-white">
          <h3 className="font-medium mb-3">Season Events</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-2">Round</th>
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Name</th>
                  <th className="py-2 pr-2">Type</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2 pr-2"><input type="number" className="w-20" value={e.round} onChange={ev=>updateEvent(e.id,{round:Number(ev.target.value)})} /></td>
                    <td className="py-2 pr-2"><input type="date" value={toISODate(e.date)} onChange={ev=>updateEvent(e.id,{date:ev.target.value})} /></td>
                    <td className="py-2 pr-2"><input className="w-full" value={e.name} onChange={ev=>updateEvent(e.id,{name:ev.target.value})} /></td>
                    <td className="py-2 pr-2">
                      <select value={e.type} onChange={ev=>updateEvent(e.id,{type:ev.target.value})}>
                        <option>GP</option>
                        <option>Sprint</option>
                      </select>
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={()=>deleteEvent(e.id)} className="btn btn-danger">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function EnterResultsPanel({ events, drivers, results, bulkReplace }) {
  const [eventId, setEventId] = useState(events[0]?.id || "");
  const [fastestLapDriverId, setFastestLapDriverId] = useState("");

  useEffect(()=>{ if (!events.find(e=>e.id===eventId) && events[0]) setEventId(events[0].id); }, [events]);

  const currentEvent = events.find(e=>e.id===eventId);
  const existing = useMemo(()=>results.filter(r=>r.eventId===eventId).sort((a,b)=>a.position-b.position), [results, eventId]);

  const [grid, setGrid] = useState(() => {
    if (existing.length) return existing.map(r=>({ driverId: r.driverId, position: r.position, status: r.status||"FIN", fastestLap: !!r.fastestLap }));
    return Array.from({length: Math.max(20, drivers.length)}, (_,i)=>({ driverId: "", position: i+1, status: "FIN", fastestLap: false }));
  });

  useEffect(()=>{
    const ex = results.filter(r=>r.eventId===eventId).sort((a,b)=>a.position-b.position);
    if (ex.length) setGrid(ex.map(r=>({ driverId: r.driverId, position: r.position, status: r.status||"FIN", fastestLap: !!r.fastestLap })));
    else setGrid(Array.from({length: Math.max(20, drivers.length)}, (_,i)=>({ driverId: "", position: i+1, status: "FIN", fastestLap: false })));
    setFastestLapDriverId("");
  }, [eventId, results, drivers.length]);

  if (!events.length) return <p className="text-neutral-600">Add events first.</p>;
  if (!drivers.length) return <p className="text-neutral-600">Add drivers first.</p>;

  const saveAll = () => {
    if (!currentEvent) return;
    const filled = grid.filter(g=>g.driverId);
    const seen = new Set();
    for (const g of filled) { if (seen.has(g.driverId)) { alert("Duplicate driver in grid: fix before saving."); return; } seen.add(g.driverId); }
    const entries = filled.map(g => ({ eventId: currentEvent.id, driverId: g.driverId, position: g.position, status: g.status, fastestLap: g.fastestLap || false }));
    if (currentEvent.type === 'GP' && fastestLapDriverId) {
      const idx = entries.findIndex(e=>e.driverId===fastestLapDriverId);
      if (idx >= 0) entries[idx].fastestLap = true;
    }
    bulkReplace(currentEvent.id, entries);
    alert("Results saved!");
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Enter Results</h2>
      <div className="flex flex-wrap items-center gap-3">
        <select className="border rounded-xl px-3 py-2" value={eventId} onChange={e=>setEventId(e.target.value)}>
          {events.map(e => <option key={e.id} value={e.id}>{`R${e.round ?? '?'} — ${e.name} (${e.type})`}</option>)}
        </select>
        {currentEvent?.type === 'GP' && (
          <div className="flex items-center gap-2">
            <label className="text-sm">Fastest Lap:</label>
            <select className="border rounded-xl px-3 py-2" value={fastestLapDriverId} onChange={e=>setFastestLapDriverId(e.target.value)}>
              <option value="">— None —</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}
        <button className="ml-auto btn btn-primary" onClick={saveAll}>Save Results</button>
      </div>

      <div className="overflow-x-auto border rounded-2xl bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pl-3">Pos</th>
              <th className="py-2">Driver</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {grid.map((row, idx) => (
              <tr key={idx} className="border-b last:border-0">
                <td className="py-2 pl-3 w-16">{row.position}</td>
                <td className="py-2">
                  <select className="border rounded-lg px-2 py-1 w-full" value={row.driverId} onChange={e=>setGrid(g=>g.map((r,i)=>i===idx?{...r, driverId:e.target.value}:r))}>
                    <option value="">— Empty —</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </td>
                <td className="py-2">
                  <select className="border rounded-lg px-2 py-1" value={row.status} onChange={e=>setGrid(g=>g.map((r,i)=>i===idx?{...r, status:e.target.value}:r))}>
                    <option value="FIN">Finished</option>
                    <option value="DNF">DNF</option>
                    <option value="DNS">DNS</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <button className="btn" onClick={()=>setGrid(Array.from({length: Math.max(20, drivers.length)}, (_,i)=>({ driverId: "", position: i+1, status: "FIN", fastestLap: false })))}>Clear Grid</button>
        <button className="btn" onClick={()=>setGrid(g=>g.map((r,i)=>({ ...r, position: i+1 })))}>Normalize Positions</button>
      </div>
    </section>
  );
}

function StandingsPanel({ standings, teamById }) {
  return (
    <section className="space-y-8">
      <div className="grid md:grid-cols-2 gap-6">
        <div className="border rounded-2xl overflow-hidden bg-white">
          <div className="p-4 border-b flex items-center gap-2">
            <div className="w-2 h-5 rounded bg-black"/>
            <h3 className="font-semibold">Drivers' Championship</h3>
            <span className="ml-auto text-xs text-neutral-500">sorted by points, wins, podiums, best finish</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pl-3">#</th>
                  <th className="py-2">Driver</th>
                  <th className="py-2">Team</th>
                  <th className="py-2 text-right pr-3">Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.drivers.map((row, i) => (
                  <tr key={row.driver.id} className="border-b last:border-0">
                    <td className="py-2 pl-3">{i+1}</td>
                    <td className="py-2">{row.driver.name}</td>
                    <td className="py-2">{teamById[row.driver.teamId]?.name || '—'}</td>
                    <td className="py-2 pr-3 text-right font-semibold">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border rounded-2xl overflow-hidden bg-white">
          <div className="p-4 border-b flex items-center gap-2">
            <div className="w-2 h-5 rounded bg-black"/>
            <h3 className="font-semibold">Constructors' Championship</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pl-3">#</th>
                  <th className="py-2">Team</th>
                  <th className="py-2 text-right pr-3">Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.teams.map((row, i) => (
                  <tr key={row.team.id} className="border-b last:border-0">
                    <td className="py-2 pl-3">{i+1}</td>
                    <td className="py-2 flex items-center gap-2">
                      <span className="w-3 h-3 rounded" style={{background: row.team.color || '#111827'}}/>
                      {row.team.name}
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="border rounded-2xl p-4 bg-white">
        <h4 className="font-semibold mb-2">Leaders</h4>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div className="p-3 rounded-xl border">
            <div className="text-neutral-500">Drivers</div>
            <div className="text-lg font-semibold">{standings.drivers[0]?.driver.name || '—'}</div>
            <div className="text-neutral-600">{standings.drivers[0] ? `${standings.drivers[0].points} pts` : ''}</div>
          </div>
          <div className="p-3 rounded-xl border">
            <div className="text-neutral-500">Constructors</div>
            <div className="text-lg font-semibold">{standings.teams[0]?.team.name || '—'}</div>
            <div className="text-neutral-600">{standings.teams[0] ? `${standings.teams[0].points} pts` : ''}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AnalyticsPanel({ drivers, teams, events, results }) {
  const eventsSorted = useMemo(() => sortEventsByRound(events), [events]);
  const resultsByEvent = useMemo(() => groupResultsByEvent(results), [results]);

  const { driverStats, driverCumSeries, rounds } = useMemo(() => {
    const rounds = eventsSorted.map(e => e.round ?? 0);
    const driverStats = new Map();
    const driverCumSeries = new Map();

    for (const d of drivers) {
      driverStats.set(d.id, { name: d.name, teamId: d.teamId || "", points: 0, finishes: [], dnfs: 0, podiums: 0 });
      driverCumSeries.set(d.id, []);
    }

    let cumByDriver = Object.fromEntries(drivers.map(d => [d.id, 0]));

    eventsSorted.forEach((e, idx) => {
      const entries = scoreEventEntries(e, resultsByEvent.get(e.id) || []);
      for (const row of entries) {
        const ds = driverStats.get(row.driverId);
        if (!ds) continue;
        ds.points += row.pts;
        if (row.status === 'DNF') ds.dnfs += 1;
        ds.finishes.push(row.pos);
        if (row.pos <= 3) ds.podiums += 1;
        cumByDriver[row.driverId] += row.pts;
        driverCumSeries.get(row.driverId)[idx] = cumByDriver[row.driverId];
      }
      for (const d of drivers) {
        const arr = driverCumSeries.get(d.id);
        if (arr[idx] == null) arr[idx] = cumByDriver[d.id] || 0;
      }
    });

    for (const [id, ds] of driverStats.entries()) {
      const fins = ds.finishes.length ? ds.finishes : [];
      const avg = fins.length ? (fins.reduce((a,b)=>a+b,0) / fins.length) : 0;
      ds.avgFinish = fins.length ? Number(avg.toFixed(2)) : null;
    }
    return { driverStats, driverCumSeries, rounds };
  }, [drivers, eventsSorted, resultsByEvent]);

  const driverRows = useMemo(() => {
    return drivers.map(d => {
      const s = driverStats.get(d.id);
      return {
        id: d.id,
        name: d.name,
        team: teams.find(t=>t.id===d.teamId)?.name || '—',
        points: s?.points || 0,
        avgFinish: s?.avgFinish ?? '—',
        podiums: s?.podiums || 0,
        dnfs: s?.dnfs || 0,
      };
    }).sort((a,b)=> b.points - a.points || a.name.localeCompare(b.name));
  }, [drivers, teams, driverStats]);

  const teamTotals = useMemo(() => {
    const totals = new Map();
    for (const d of driverRows) {
      const teamId = drivers.find(x => x.id === d.id)?.teamId;
      if (!teamId) continue;
      totals.set(teamId, (totals.get(teamId) || 0) + (d.points || 0));
    }
    return teams.map(t => ({ id: t.id, name: t.name, points: totals.get(t.id) || 0 }))
                .sort((a,b)=> b.points - a.points || a.name.localeCompare(b.name));
  }, [teams, driverRows, drivers]);

  const topDrivers = driverRows.slice(0,5);

  return (
    <section className="space-y-8">
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-4">
          <h3 className="font-semibold mb-2">Top Drivers (Avg Finish)</h3>
          <div className="text-sm text-neutral-600 mb-3">Lower is better</div>
          <SimpleBarChart
            labels={topDrivers.map(x=>x.name)}
            values={topDrivers.map(x=> (typeof x.avgFinish === 'number' ? x.avgFinish : 0))}
            valueFormatter={(v)=> (v? v.toFixed(2):'—')}
            maxBars={5}
          />
        </div>

        <div className="card p-4">
          <h3 className="font-semibold mb-2">Team Points (Total)</h3>
          <SimpleBarChart
            labels={teamTotals.map(x=>x.name)}
            values={teamTotals.map(x=>x.points)}
            valueFormatter={(v)=>`${v}`}
          />
        </div>

        <div className="card p-4">
          <h3 className="font-semibold mb-2">Cumulative Points — Top 5 Drivers</h3>
          <SimpleLineChart
            xLabels={rounds.map(r => `R${r}`)}
            series={topDrivers.map(d => ({
              label: d.name,
              data: (/** @type {number[]} */(driverCumSeries.get(d.id))) || []
            }))}
          />
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-semibold mb-3">Driver Analytics</h3>
        <div className="overflow-x-auto">
          <table className="table w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Driver</th>
                <th className="py-2">Team</th>
                <th className="py-2">Points</th>
                <th className="py-2">Avg Finish</th>
                <th className="py-2">Podiums</th>
                <th className="py-2">DNFs</th>
              </tr>
            </thead>
            <tbody>
              {driverRows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2">{r.name}</td>
                  <td className="py-2">{r.team}</td>
                  <td className="py-2">{r.points}</td>
                  <td className="py-2">{typeof r.avgFinish === 'number' ? r.avgFinish.toFixed(2) : '—'}</td>
                  <td className="py-2">{r.podiums}</td>
                  <td className="py-2">{r.dnfs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-semibold mb-3">Team Analytics</h3>
        <div className="overflow-x-auto">
          <table className="table w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Team</th>
                <th className="py-2">Points</th>
              </tr>
            </thead>
            <tbody>
              {teamTotals.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="py-2">{t.name}</td>
                  <td className="py-2">{t.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function DataPeek({ teams, drivers, events, results }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Raw Data</h2>
      <pre className="text-xs border rounded-2xl p-4 bg-white overflow-auto">{JSON.stringify({teams,drivers,events,results}, null, 2)}</pre>
    </section>
  );
}

// ---------- charts ----------
function SimpleBarChart({ labels, values, valueFormatter = v=>String(v), maxBars }) {
  const max = Math.max(1, ...values);
  const bars = labels.map((label, i) => ({ label, value: values[i] || 0 }));
  const slice = maxBars ? bars.slice(0, maxBars) : bars;
  const W = 520, H = 220, P = 28;
  const cw = (W - P*2) / slice.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[220px]">
      <line x1={P} y1={H-P} x2={W-P} y2={H-P} stroke="#e5e7eb" />
      {slice.map((b, i) => {
        const h = max ? Math.round((b.value / max) * (H - P*2)) : 0;
        const x = P + i*cw + 6;
        const y = H - P - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={Math.max(6, cw-12)} height={h} rx="6" fill="black" opacity="0.85" />
            <text x={x + (cw-12)/2} y={y-6} textAnchor="middle" fontSize="11" fill="#374151">{valueFormatter(b.value)}</text>
            <text x={x + (cw-12)/2} y={H-P+14} textAnchor="middle" fontSize="11" fill="#6b7280">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
function SimpleLineChart({ xLabels, series }) {
  const n = xLabels.length;
  const W = 520, H = 220, P = 28;
  const xs = (i) => P + (i*(W-2*P))/Math.max(1,(n-1));
  const max = Math.max(1, ...series.flatMap(s => s.data));
  const colorFor = (idx) => (["#111111","#ef4444","#3b82f6","#10b981","#f59e0b"][idx % 5]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[220px]">
      <line x1={P} y1={H-P} x2={W-P} y2={H-P} stroke="#e5e7eb" />
      {xLabels.map((lab,i)=>(
        <text key={i} x={xs(i)} y={H-P+14} textAnchor="middle" fontSize="11" fill="#6b7280">{lab}</text>
      ))}
      {series.map((s, si) => {
        const pts = s.data.map((y,i)=>{
          const vy = max ? (H-P) - (y/max)*(H-2*P) : (H-P);
          return `${xs(i)},${vy}`;
        }).join(' ');
        return (
          <g key={si}>
            <polyline fill="none" stroke={colorFor(si)} strokeWidth="2" points={pts}/>
            {s.data.map((y,i)=>{
              const vy = max ? (H-P) - (y/max)*(H-2*P) : (H-P);
              return <circle key={i} cx={xs(i)} cy={vy} r="2.5" fill={colorFor(si)} />;
            })}
            <text x={W-P} y={12 + si*14} textAnchor="end" fontSize="11" fill={colorFor(si)}>{s.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------- standings + io ----------
function buildStandings({ drivers, teams, events, results, driverById }) {
  const driverStats = new Map();
  const teamPoints = new Map();
  for (const d of drivers) driverStats.set(d.id, { points: 0, wins: 0, podiums: 0, bestFinish: 99, finishes: [] });
  for (const t of teams) teamPoints.set(t.id, 0);

  const resultsByEvent = results.reduce((acc, r) => { (acc[r.eventId] ||= []).push(r); return acc; }, {});
  for (const e of events) {
    const entries = (resultsByEvent[e.id] || []).slice().sort((a,b)=>a.position-b.position);
    for (const r of entries) {
      if (!driverStats.has(r.driverId)) continue;
      const d = driverStats.get(r.driverId);
      const basePts = r.status === 'FIN' ? computePointsFor(r.position, e.type) : 0;
      const flBonus = (e.type === 'GP' && r.fastestLap && r.position <= 10) ? 1 : 0;
      const pts = basePts + flBonus;
      d.points += pts;
      if (r.position === 1) d.wins += 1;
      if (r.position <= 3) d.podiums += 1;
      d.bestFinish = Math.min(d.bestFinish, r.position);
      d.finishes.push(r.position);
      const drv = driverById[r.driverId];
      if (drv?.teamId) teamPoints.set(drv.teamId, (teamPoints.get(drv.teamId) || 0) + pts);
    }
  }
  const driverRows = drivers.map(d => ({ driver: d, ...driverStats.get(d.id) }))
    .sort((a,b) => (b.points - a.points) || (b.wins - a.wins) || (b.podiums - a.podiums) || (a.bestFinish - b.bestFinish) || a.driver.name.localeCompare(b.driver.name));
  const teamRows = teams.map(t => ({ team: t, points: teamPoints.get(t.id) || 0 }))
    .sort((a,b)=> b.points - a.points || a.team.name.localeCompare(b.team.name));
  return { drivers: driverRows, teams: teamRows };
}
function normalizeResults(list) {
  return list.map(r => ({
    ...r,
    position: Math.max(1, Number(r.position) || 1),
    status: r.status === 'DNF' ? 'DNF' : (r.status === 'DNS' ? 'DNS' : 'FIN'),
    fastestLap: !!r.fastestLap,
  })).sort((a,b)=> a.eventId.localeCompare(b.eventId) || a.position - b.position);
}
function exportJSON(season, data) {
  const name = season?.name?.replace(/[^\w\- ]/g, "_") || "Season";
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}_f1_season.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
async function importJSON(file, season, setters) {
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if (!data) throw new Error("Invalid JSON");
    setters.setTeams(Array.isArray(data.teams) ? data.teams : []);
    setters.setDrivers(Array.isArray(data.drivers) ? data.drivers : []);
    setters.setEvents(Array.isArray(data.events) ? data.events : []);
    setters.setResults(Array.isArray(data.results) ? data.results : []);
    setters.setTab("Standings");
    alert(`Imported into "${season?.name || "Season"}"`);
  } catch (e) {
    alert("Import failed: " + e.message);
  }
}
