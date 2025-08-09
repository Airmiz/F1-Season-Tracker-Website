import React, { useEffect, useMemo, useState } from "react";

/**
 * F1 Season Tracker — single-file React app
 * Works great in a Vite + React project. Uses localStorage for persistence.
 * Features
 * - Add/edit Teams, Drivers (linked to a team), and Events (Grand Prix or Sprint)
 * - Enter race/sprint results with positions + optional Fastest Lap
 * - Auto-calculated Driver & Constructor standings (with tiebreakers)
 * - Import/Export JSON
 * - Clean, responsive UI with Tailwind classes (optional)
 *
 * How to use with Vite (PowerShell):
 *   npm create vite@latest f1-tracker -- --template react
 *   cd f1-tracker && npm install
 *   (optional Tailwind)
 *   npm install -D tailwindcss postcss autoprefixer && npx tailwindcss init -p
 *   Replace src/App.jsx with this file's contents (export default function App()).
 *   npm run dev
 */

// ---------- Types ----------
/** Team: { id, name, color }
 *  Driver: { id, name, country, teamId }
 *  Event: { id, name, round, date (ISO), type: 'GP'|'Sprint' }
 *  ResultEntry: { eventId, driverId, position (1..), status: 'FIN'|'DNF'|'DNS', fastestLap?: boolean }
 */

// ---------- Utilities ----------
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const toISODate = (d) => new Date(d).toISOString().slice(0, 10);

const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

function computePointsFor(position, type) {
  if (type === "Sprint") return position >= 1 && position <= SPRINT_POINTS.length ? SPRINT_POINTS[position - 1] : 0;
  return position >= 1 && position <= RACE_POINTS.length ? RACE_POINTS[position - 1] : 0;
}

function classNames(...xs) { return xs.filter(Boolean).join(" "); }

// ---------- Storage Hook ----------
function useStoredState(key, initial) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);
  return [state, setState];
}

// ---------- Main App ----------
export default function App() {
  const [teams, setTeams] = useStoredState("f1_teams", []);
  const [drivers, setDrivers] = useStoredState("f1_drivers", []);
  const [events, setEvents] = useStoredState("f1_events", []);
  const [results, setResults] = useStoredState("f1_results", []);
  const [tab, setTab] = useStoredState("f1_tab", "Standings");

  // Derived maps
  const teamById = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t])), [teams]);
  const driverById = useMemo(() => Object.fromEntries(drivers.map(d => [d.id, d])), [drivers]);
  const eventsById = useMemo(() => Object.fromEntries(events.map(e => [e.id, e])), [events]);

  // Standings
  const standings = useMemo(() => buildStandings({ drivers, teams, events, results, driverById }), [drivers, teams, events, results]);

  // CRUD helpers
  const addTeam = (team) => setTeams(prev => [...prev, { id: uid(), color: "", ...team }]);
  const updateTeam = (id, patch) => setTeams(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  const deleteTeam = (id) => {
    setTeams(prev => prev.filter(t => t.id !== id));
    // detach drivers from deleted team
    setDrivers(prev => prev.map(d => d.teamId === id ? { ...d, teamId: "" } : d));
  };

  const addDriver = (driver) => setDrivers(prev => [...prev, { id: uid(), country: "", teamId: "", ...driver }]);
  const updateDriver = (id, patch) => setDrivers(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
  const deleteDriver = (id) => setDrivers(prev => prev.filter(d => d.id !== id));

  const addEvent = (evt) => setEvents(prev => {
    const round = evt.round ?? (prev.length + 1);
    return [...prev, { id: uid(), date: toISODate(new Date()), type: "GP", ...evt, round }].sort((a,b)=>a.round-b.round);
  });
  const updateEvent = (id, patch) => setEvents(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  const deleteEvent = (id) => {
    setEvents(prev => prev.filter(e => e.id !== id));
    setResults(prev => prev.filter(r => r.eventId !== id));
  };

  // results management
  const saveResultEntry = (entry) => {
    setResults(prev => {
      const idx = prev.findIndex(r => r.eventId === entry.eventId && r.driverId === entry.driverId);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...entry };
        return normalizeResults(copy);
      }
      return normalizeResults([...prev, entry]);
    });
  };
  const bulkReplaceEventResults = (eventId, entries) => {
    setResults(prev => normalizeResults([...prev.filter(r => r.eventId !== eventId), ...entries]));
  };

  const clearAll = () => {
    if (!confirm("This will erase ALL data (teams, drivers, events, results). Continue?")) return;
    setTeams([]); setDrivers([]); setEvents([]); setResults([]); setTab("Standings");
  };

  const exportJSON = () => {
    const blob = new Blob([
      JSON.stringify({ teams, drivers, events, results }, null, 2)
    ], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `f1_season_${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const importJSON = async (file) => {
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      if (!data) throw new Error("Invalid file");
      setTeams(data.teams ?? []);
      setDrivers(data.drivers ?? []);
      setEvents(data.events ?? []);
      setResults(normalizeResults(data.results ?? []));
      setTab("Standings");
    } catch (e) {
      alert("Import failed: " + e.message);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-2 h-6 rounded bg-black" />
          <h1 className="text-xl font-bold tracking-tight">F1 Season Tracker</h1>
          <div className="ml-auto flex gap-2">
            <button onClick={exportJSON} className="px-3 py-1.5 rounded-xl border border-neutral-200 hover:bg-neutral-100">Export</button>
            <label className="px-3 py-1.5 rounded-xl border border-neutral-200 hover:bg-neutral-100 cursor-pointer">
              Import
              <input type="file" accept="application/json" className="hidden" onChange={e => e.target.files?.[0] && importJSON(e.target.files[0])} />
            </label>
            <button onClick={clearAll} className="px-3 py-1.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50">Reset</button>
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-4 pb-2 flex gap-1 flex-wrap">
          {['Standings','Events','Enter Results','Drivers','Teams','Data'].map(t => (
            <button key={t} onClick={()=>setTab(t)} className={classNames("px-3 py-1.5 rounded-xl text-sm", tab===t?"bg-black text-white":"hover:bg-neutral-100 border border-neutral-200")}>{t}</button>
          ))}
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === 'Teams' && (
          <TeamsPanel teams={teams} addTeam={addTeam} updateTeam={updateTeam} deleteTeam={deleteTeam} />
        )}
        {tab === 'Drivers' && (
          <DriversPanel drivers={drivers} teams={teams} addDriver={addDriver} updateDriver={updateDriver} deleteDriver={deleteDriver} />
        )}
        {tab === 'Events' && (
          <EventsPanel events={events} updateEvent={updateEvent} deleteEvent={deleteEvent} addEvent={addEvent} />
        )}
        {tab === 'Enter Results' && (
          <EnterResultsPanel events={events} drivers={drivers} results={results} onSave={saveResultEntry} bulkReplace={bulkReplaceEventResults} />
        )}
        {tab === 'Standings' && (
          <StandingsPanel standings={standings} teamById={teamById} />
        )}
        {tab === 'Data' && (
          <DataPeek teams={teams} drivers={drivers} events={events} results={results} />
        )}

        <footer className="mt-16 text-sm text-neutral-500">
          <p>Points rules: GP [25,18,15,12,10,8,6,4,2,1] (top-10), Sprint [8..1] (top-8). Optional Fastest Lap +1 (GP only, top-10 only).</p>
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
            <input className="border rounded-xl px-3 py-2" placeholder="Team name" value={name} onChange={e=>setName(e.target.value)} />
            <div className="flex items-center gap-3">
              <input type="color" value={color} onChange={e=>setColor(e.target.value)} />
              <span className="text-sm text-neutral-600">Team color</span>
            </div>
            <button onClick={()=>{ if(!name.trim()) return; addTeam({ name: name.trim(), color }); setName(""); }} className="self-start px-3 py-2 rounded-xl bg-black text-white">Add Team</button>
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
                <button onClick={()=>deleteTeam(t.id)} className="text-red-600 hover:underline text-sm">Delete</button>
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

  useEffect(() => { 
    if (!teams.find(t => t.id === teamId) && teams[0]) setTeamId(teams[0].id); 
  }, [teams]);

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Drivers</h2>
      <div className="grid md:grid-cols-2 gap-4">
        
        {/* Add Driver */}
        <div className="border rounded-2xl p-4 bg-white">
          <h3 className="font-medium mb-3">Add Driver</h3>
          <div className="flex flex-col gap-3">
            <input className="px-3 py-2" placeholder="Driver name" value={name} onChange={e => setName(e.target.value)} />
            <input className="px-3 py-2" placeholder="Country (optional)" value={country} onChange={e => setCountry(e.target.value)} />
            <select className="px-3 py-2" value={teamId} onChange={e => setTeamId(e.target.value)}>
              <option value="">— No Team —</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button 
              onClick={() => { 
                if (!name.trim()) return; 
                addDriver({ name: name.trim(), country: country.trim(), teamId }); 
                setName(""); 
                setCountry(""); 
              }} 
              className="btn btn-primary self-start"
            >
              Add Driver
            </button>
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
                  <td className="min-w-[10rem]">
                    <input 
                      className="w-full px-2 py-1" 
                      value={d.name} 
                      onChange={e => updateDriver(d.id, { name: e.target.value })} 
                    />
                  </td>
                  <td className="min-w-[8rem]">
                    <input 
                      className="w-full px-2 py-1" 
                      value={d.country || ""} 
                      onChange={e => updateDriver(d.id, { country: e.target.value })} 
                    />
                  </td>
                  <td className="min-w-[10rem]">
                    <select 
                      className="w-full px-2 py-1" 
                      value={d.teamId || ""} 
                      onChange={e => updateDriver(d.id, { teamId: e.target.value })}
                    >
                      <option value="">— No Team —</option>
                      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                  <td className="text-right w-[5rem]">
                    <button onClick={() => deleteDriver(d.id)} className="btn btn-danger">Delete</button>
                  </td>
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
            <input className="border rounded-xl px-3 py-2" placeholder="Event name (e.g., Australian GP)" value={name} onChange={e=>setName(e.target.value)} />
            <div className="flex gap-2">
              <select className="border rounded-xl px-3 py-2" value={type} onChange={e=>setType(e.target.value)}>
                <option>GP</option>
                <option>Sprint</option>
              </select>
              <input type="date" className="border rounded-xl px-3 py-2" value={date} onChange={e=>setDate(e.target.value)} />
            </div>
            <button onClick={()=>{ if(!name.trim()) return; addEvent({ name: name.trim(), type, date }); setName(""); }} className="self-start px-3 py-2 rounded-xl bg-black text-white">Add Event</button>
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
                  <th className="py-2"/>
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
                      <button onClick={()=>deleteEvent(e.id)} className="text-red-600 hover:underline">Delete</button>
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

function EnterResultsPanel({ events, drivers, results, onSave, bulkReplace }) {
  const [eventId, setEventId] = useState(events[0]?.id || "");
  const [fastestLapDriverId, setFastestLapDriverId] = useState("");

  useEffect(()=>{
    if (!events.find(e=>e.id===eventId) && events[0]) setEventId(events[0].id);
  }, [events]);

  const currentEvent = events.find(e=>e.id===eventId);
  const existing = useMemo(()=>results.filter(r=>r.eventId===eventId).sort((a,b)=>a.position-b.position), [results, eventId]);

  const [grid, setGrid] = useState(() => {
    if (existing.length) return existing.map(r=>({ driverId: r.driverId, position: r.position, status: r.status||"FIN" }));
    return Array.from({length: Math.max(20, drivers.length)}, (_,i)=>({ driverId: "", position: i+1, status: "FIN" }));
  });

  useEffect(()=>{
    // when event changes, reset grid to existing or blank
    const ex = results.filter(r=>r.eventId===eventId).sort((a,b)=>a.position-b.position);
    if (ex.length) setGrid(ex.map(r=>({ driverId: r.driverId, position: r.position, status: r.status||"FIN" })));
    else setGrid(Array.from({length: Math.max(20, drivers.length)}, (_,i)=>({ driverId: "", position: i+1, status: "FIN" })));
    setFastestLapDriverId("");
  }, [eventId, results, drivers.length]);

  if (!events.length) return <p className="text-neutral-600">Add events first.</p>;
  if (!drivers.length) return <p className="text-neutral-600">Add drivers first.</p>;

  const saveAll = () => {
    if (!currentEvent) return;
    const filled = grid.filter(g=>g.driverId);
    const seen = new Set();
    for (const g of filled) {
      if (seen.has(g.driverId)) { alert("Duplicate driver in grid: fix before saving."); return; }
      seen.add(g.driverId);
    }
    const entries = filled.map(g => ({
      eventId: currentEvent.id,
      driverId: g.driverId,
      position: g.position,
      status: g.status,
      fastestLap: false,
    }));
    if (currentEvent.type === 'GP' && fastestLapDriverId) {
      // Only award FL if driver is in top 10 — enforced in scoring phase
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
        <button className="ml-auto px-3 py-2 rounded-xl bg-black text-white" onClick={saveAll}>Save Results</button>
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
        <button className="px-3 py-2 rounded-xl border" onClick={()=>setGrid(Array.from({length: Math.max(20, drivers.length)}, (_,i)=>({ driverId: "", position: i+1, status: "FIN" })))}>Clear Grid</button>
        <button className="px-3 py-2 rounded-xl border" onClick={()=>setGrid(g=>g.map((r,i)=>({ ...r, position: i+1 })))}>Normalize Positions</button>
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

function DataPeek({ teams, drivers, events, results }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Raw Data</h2>
      <pre className="text-xs border rounded-2xl p-4 bg-white overflow-auto">{JSON.stringify({teams,drivers,events,results}, null, 2)}</pre>
    </section>
  );
}

// ---------- Standings Logic ----------
function buildStandings({ drivers, teams, events, results, driverById }) {
  const driverStats = new Map(); // driverId -> { points, wins, podiums, bestFinish }
  const teamPoints = new Map(); // teamId -> points

  for (const d of drivers) {
    driverStats.set(d.id, { points: 0, wins: 0, podiums: 0, bestFinish: 99, finishes: [] });
  }
  for (const t of teams) teamPoints.set(t.id, 0);

  // Group results by event
  const resultsByEvent = results.reduce((acc, r) => {
    (acc[r.eventId] ||= []).push(r);
    return acc;
  }, {});

  for (const e of events) {
    const entries = (resultsByEvent[e.id] || []).slice().sort((a,b)=>a.position-b.position);
    for (const r of entries) {
      if (!driverStats.has(r.driverId)) continue; // driver removed
      const d = driverStats.get(r.driverId);
      const basePts = r.status === 'FIN' ? computePointsFor(r.position, e.type) : 0;
      const flBonus = (e.type === 'GP' && r.fastestLap && r.position <= 10) ? 1 : 0;
      const pts = basePts + flBonus;
      d.points += pts;
      if (r.position === 1) d.wins += 1;
      if (r.position >= 1 && r.position <= 3) d.podiums += 1;
      d.bestFinish = Math.min(d.bestFinish, r.position);
      d.finishes.push(r.position);

      // Constructors
      const drv = driverById[r.driverId];
      if (drv?.teamId) teamPoints.set(drv.teamId, (teamPoints.get(drv.teamId) || 0) + pts);
    }
  }

  const driverRows = drivers.map(d => ({
    driver: d,
    ...driverStats.get(d.id),
  })).sort(driverCompare);

  const teamRows = teams.map(t => ({ team: t, points: teamPoints.get(t.id) || 0 }))
    .sort((a,b)=> b.points - a.points || a.team.name.localeCompare(b.team.name));

  return { drivers: driverRows, teams: teamRows };
}

function driverCompare(a, b) {
  // Sort by points desc, wins desc, podiums desc, bestFinish asc, name asc
  return (
    (b.points - a.points) ||
    (b.wins - a.wins) ||
    (b.podiums - a.podiums) ||
    (a.bestFinish - b.bestFinish) ||
    a.driver.name.localeCompare(b.driver.name)
  );
}

// Normalize: positions as numbers, statuses constrained, drop empties/NaN positions
function normalizeResults(list) {
  return list
    .map(r => ({
      ...r,
      position: Math.max(1, Number(r.position) || 1),
      status: r.status === 'DNF' ? 'DNF' : (r.status === 'DNS' ? 'DNS' : 'FIN'),
      fastestLap: !!r.fastestLap,
    }))
    .sort((a,b)=> a.eventId.localeCompare(b.eventId) || a.position - b.position);
}
