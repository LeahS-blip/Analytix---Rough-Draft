/** Shown instantly while a dashboard page loads on the server (first visit, switching sites). */
export default function Loading() {
  return (
    <div className="app" aria-busy="true" aria-label="Loading your dashboard">
      <aside className="side">
        <div className="side-brand">
          <span className="sk" style={{ width: 120, height: 22 }} />
        </div>
        <div style={{ padding: "0 14px" }}>
          <span className="sk" style={{ width: "100%", height: 52 }} />
        </div>
        <div className="nav">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="sk" style={{ width: "70%", height: 16, margin: "10px 12px" }} />
          ))}
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <span className="sk" style={{ width: 180, height: 26 }} />
        </div>
        <div className="content">
          <div className="kpis">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="kpi"><span className="sk" style={{ width: "60%", height: 14 }} /><span className="sk" style={{ width: "50%", height: 30 }} /><span className="sk" style={{ width: "100%", height: 34 }} /></div>
            ))}
          </div>
          <div className="card"><span className="sk" style={{ width: "100%", height: 300 }} /></div>
        </div>
      </div>
    </div>
  );
}
