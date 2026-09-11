export const ADMIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Admin console</title>
  <style>
    :root { color-scheme: light; --bg: #f4f1ea; --card: #fff; --ink: #1c1917; --muted: #57534e; --line: #e7e5e4; --accent: #1d4ed8; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 15px/1.45 system-ui, sans-serif; color: var(--ink); background: var(--bg); }
    header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; padding: 16px 24px; background: var(--card); border-bottom: 1px solid var(--line); }
    h1 { font-size: 1.15rem; margin: 0; }
    nav { display: flex; gap: 8px; }
    nav button, .export { border: 1px solid var(--line); background: var(--card); padding: 6px 10px; border-radius: 6px; cursor: pointer; }
    nav button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    label { color: var(--muted); font-size: 0.9rem; }
    main { padding: 20px 24px 48px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
    .card b { display: block; font-size: 1.35rem; }
    .card span { color: var(--muted); font-size: 0.8rem; }
    table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); font-size: 0.92rem; }
    th { color: var(--muted); font-weight: 600; }
    tr:last-child td { border-bottom: 0; }
    tbody tr[data-user] { cursor: pointer; }
    tbody tr[data-user]:hover { background: #fafaf9; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
    input, select { font: inherit; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; }
    .detail { margin-top: 20px; }
    .hidden { display: none; }
    .mono { font-family: ui-monospace, monospace; font-size: 0.85rem; }
    h2 { font-size: 1rem; margin: 18px 0 8px; }
    .err { color: #b91c1c; }
  </style>
</head>
<body>
  <header>
    <h1>Admin console</h1>
    <div class="toolbar">
      <label>Range
        <select id="range">
          <option value="24h">24 hours</option>
          <option value="7d" selected>7 days</option>
          <option value="30d">30 days</option>
          <option value="all">All</option>
        </select>
      </label>
      <nav>
        <button type="button" data-tab="overview" class="active">Overview</button>
        <button type="button" data-tab="users">Users</button>
        <button type="button" data-tab="logins">Logins</button>
        <button type="button" data-tab="activity">Activity</button>
      </nav>
    </div>
  </header>
  <main>
    <p id="status" class="err"></p>
    <section id="overview"></section>
    <section id="users" class="hidden"></section>
    <section id="logins" class="hidden"></section>
    <section id="activity" class="hidden"></section>
  </main>
  <script>
    const HOUR_MS = 3600000;
    let tab = "overview";
    const $ = (id) => document.getElementById(id);
    function range() { return $("range").value; }
    function fmtTime(ms) {
      if (ms == null) return "—";
      return new Date(ms).toLocaleString();
    }
    function fmtHour(hour) {
      if (hour == null) return "—";
      return new Date(hour * HOUR_MS).toLocaleString();
    }
    function n(v) { return Number(v || 0).toLocaleString(); }
    async function post(path, body) {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      if (res.status === 404) {
        document.body.innerHTML = "<p style=\\"padding:24px\\">Not found.</p>";
        return null;
      }
      if (!res.ok) throw new Error(path + " failed (" + res.status + ")");
      const type = res.headers.get("content-type") || "";
      if (type.includes("text/csv")) return res;
      return res.json();
    }
    function table(headers, rows, rowAttrs) {
      const head = "<tr>" + headers.map((h) => "<th>" + h + "</th>").join("") + "</tr>";
      const body = rows.map((cells, i) => {
        const attr = rowAttrs ? rowAttrs(i) : "";
        return "<tr " + attr + ">" + cells.map((c) => "<td>" + c + "</td>").join("") + "</tr>";
      }).join("");
      return "<table><thead>" + head + "</thead><tbody>" + body + "</tbody></table>";
    }
    async function loadOverview() {
      const data = await post("/admin/api/summary", { range: range() });
      if (!data) return;
      $("overview").innerHTML =
        "<div class=\\"cards\\">" +
        card("Users", data.usersTotal) +
        card("New users", data.usersNew) +
        card("Logins", data.logins) +
        card("Register / return", data.loginsRegister + " / " + data.loginsSignIn) +
        card("Live signed-in", data.liveSessions) +
        card("Opens", data.opens) +
        card("Refreshes", data.refreshes) +
        card("Actions", data.actions) +
        card("Signed-in calls", data.signedInCalls) +
        card("Anonymous calls", data.anonymousCalls) +
        card("Unique sessions", data.uniqueSessions) +
        card("Unique users", data.uniqueUsers) +
        "</div><h2>By app</h2>" +
        table(["App", "Opens", "Refreshes", "Actions", "Sessions", "Users"],
          data.byApp.map((r) => [esc(r.appId), n(r.opens), n(r.refreshes), n(r.actions), n(r.sessions), n(r.users)]));
    }
    function card(label, value) {
      return "<div class=\\"card\\"><b>" + esc(String(value)) + "</b><span>" + esc(label) + "</span></div>";
    }
    function esc(s) {
      return String(s).replace(/[&<>\\"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;" }[ch]));
    }
    async function loadUsers() {
      const q = ($("userSearch") && $("userSearch").value) || "";
      const data = await post("/admin/api/users", { range: range(), q });
      if (!data) return;
      $("users").innerHTML =
        "<div class=\\"toolbar\\"><input id=\\"userSearch\\" placeholder=\\"Search email\\" value=\\"" + esc(q) + "\\">" +
        "<button type=\\"button\\" class=\\"export\\" id=\\"exportUsers\\">Export CSV</button></div>" +
        table(["Email", "Signed up", "Last login", "Last activity", "Opens", "Refreshes", "Actions"],
          data.map((r) => [esc(r.email), fmtTime(r.createdAt), fmtTime(r.lastLoginAt), fmtHour(r.lastHour), n(r.opens), n(r.refreshes), n(r.actions)]),
          (i) => "data-user=\\"" + esc(data[i].userId) + "\\"") +
        "<div id=\\"userDetail\\" class=\\"detail\\"></div>";
      $("userSearch").addEventListener("change", loadUsers);
      $("exportUsers").addEventListener("click", () => downloadCsv("/admin/export/users", { range: range(), q }));
      $("users").querySelectorAll("tr[data-user]").forEach((tr) => {
        tr.addEventListener("click", () => showUser(tr.getAttribute("data-user")));
      });
    }
    async function showUser(userId) {
      const data = await post("/admin/api/user", { range: range(), userId });
      if (!data) return;
      $("userDetail").innerHTML =
        "<h2>" + esc(data.email) + "</h2><p>Signed up " + fmtTime(data.createdAt) + "</p>" +
        "<h2>Logins</h2>" + table(["When", "Kind", "IP", "Session"],
          data.logins.map((r) => [fmtTime(r.at), esc(r.kind), esc(r.ip), "<span class=mono>" + esc(r.sessionId) + "</span>"])) +
        "<h2>By app</h2>" + table(["App", "Opens", "Refreshes", "Actions"],
          data.byApp.map((r) => [esc(r.appId), n(r.opens), n(r.refreshes), n(r.actions)])) +
        "<h2>Sessions</h2>" + table(["Session", "IP", "Last hour", "Opens", "Refreshes", "Actions"],
          data.sessions.map((r) => ["<span class=mono>" + esc(r.sessionId) + "</span>", esc(r.ip), fmtHour(r.lastHour), n(r.opens), n(r.refreshes), n(r.actions)]));
    }
    async function loadLogins() {
      const data = await post("/admin/api/logins", { range: range() });
      if (!data) return;
      $("logins").innerHTML =
        "<div class=\\"toolbar\\"><button type=\\"button\\" class=\\"export\\" id=\\"exportLogins\\">Export CSV</button></div>" +
        table(["When", "Email", "Kind", "IP", "Session"],
          data.map((r) => [fmtTime(r.at), esc(r.email), esc(r.kind), esc(r.ip), "<span class=mono>" + esc(r.sessionId) + "</span>"]));
      $("exportLogins").addEventListener("click", () => downloadCsv("/admin/export/logins", { range: range() }));
    }
    async function loadActivity() {
      const appId = ($("actApp") && $("actApp").value) || "";
      const data = await post("/admin/api/activity", { range: range(), appId });
      if (!data) return;
      $("activity").innerHTML =
        "<div class=\\"toolbar\\"><input id=\\"actApp\\" placeholder=\\"Filter app id\\" value=\\"" + esc(appId) + "\\">" +
        "<button type=\\"button\\" class=\\"export\\" id=\\"exportActivity\\">Export CSV</button></div>" +
        "<div class=\\"cards\\">" + card("Opens", data.totals.opens) + card("Refreshes", data.totals.refreshes) + card("Actions", data.totals.actions) + "</div>" +
        "<h2>By app</h2>" + table(["App", "Opens", "Refreshes", "Actions", "Sessions", "Users"],
          data.byApp.map((r) => [esc(r.appId), n(r.opens), n(r.refreshes), n(r.actions), n(r.sessions), n(r.users)])) +
        "<h2>Hourly sessions</h2>" + table(["Hour", "App", "Email", "IP", "Session", "Opens", "Refreshes", "Actions"],
          data.sessions.map((r) => [fmtHour(r.hour), esc(r.appId), esc(r.email || "anonymous"), esc(r.ip), "<span class=mono>" + esc(r.sessionId) + "</span>", n(r.opens), n(r.refreshes), n(r.actions)]));
      $("actApp").addEventListener("change", loadActivity);
      $("exportActivity").addEventListener("click", () => downloadCsv("/admin/export/activity", { range: range(), appId: $("actApp").value }));
    }
    async function downloadCsv(path, body) {
      const res = await post(path, body);
      if (!res) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (res.headers.get("content-disposition") || "").match(/filename="([^"]+)"/)?.[1] || "export.csv";
      a.click();
      URL.revokeObjectURL(url);
    }
    async function refresh() {
      $("status").textContent = "";
      try {
        if (tab === "overview") await loadOverview();
        if (tab === "users") await loadUsers();
        if (tab === "logins") await loadLogins();
        if (tab === "activity") await loadActivity();
      } catch (err) {
        $("status").textContent = String(err.message || err);
      }
    }
    document.querySelectorAll("nav button").forEach((btn) => {
      btn.addEventListener("click", () => {
        tab = btn.getAttribute("data-tab");
        document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b === btn));
        ["overview", "users", "logins", "activity"].forEach((id) => $(id).classList.toggle("hidden", id !== tab));
        refresh();
      });
    });
    $("range").addEventListener("change", refresh);
    refresh();
  </script>
</body>
</html>
`;
