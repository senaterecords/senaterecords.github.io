// The bar's freshness line ("Checked 12 min ago"), shared by every page: loaded once in the head, cached, and called
// right after each line so it is worked out before the first paint. Each <time data-updated data-status> carries when
// this page's records last changed (New York time) and where the hourly run writes the time of its last check. A check
// fetched in the last 10 minutes is remembered, so most pages show it at once; on a first visit the line waits a moment
// (.upd-wait) rather than showing one thing and then another; if the check can't be read it says "Updated ...".
window.otrFreshness = function () {
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var nyNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  var ago = function (ms) {
    var m = Math.max(0, Math.round(ms / 60000)), h = Math.round(m / 60), d = Math.round(h / 24);
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : h < 24 ? h + " hour" + (h === 1 ? "" : "s") + " ago" : d + " day" + (d === 1 ? "" : "s") + " ago";
  };
  var meridiem = function (h, m) { return (h % 12 || 12) + ":" + String(m).padStart(2, "0") + " " + (h < 12 ? "a.m." : "p.m."); };
  // "2026-10-16T01:35:57" (New York time) as "New records last arrived October 16, 2026 at 1:35 a.m."
  var arrived = function (iso) {
    var p = (iso || "").split(/[-T:]/).map(Number);
    return p.length < 5 || isNaN(p[3]) ? "" : "New records last arrived " + MONTHS[p[1] - 1] + " " + p[2] + ", " + p[0] + " at " + meridiem(p[3], p[4]);
  };
  var showUpdated = function (el) {
    el.textContent = "Updated " + ago(nyNow - new Date(el.dataset.updated));
    el.title = arrived(el.dataset.updated);
    el.classList.remove("upd-wait");
  };
  var showChecked = function (el, s) {
    var at = new Date(new Date(s.checkedAt).toLocaleString("en-US", { timeZone: "America/New_York" }));
    el.textContent = "Checked " + ago(Date.now() - Date.parse(s.checkedAt));
    el.title = "Checked the Senate's records at " + meridiem(at.getHours(), at.getMinutes()) + " · " + arrived(s.updatedAt || el.dataset.updated);
    el.classList.remove("upd-wait");
  };
  var cached = null;
  try { cached = JSON.parse(localStorage.getItem("otr:checked") || "null"); } catch (e) { /* storage blocked */ }
  var fresh = cached && cached.checkedAt && Date.now() - cached.fetched < 600000;
  var url = "";
  document.querySelectorAll("time[data-updated]").forEach(function (el) {
    if (el.dataset.shown) return;
    el.dataset.shown = "1";
    url = url || el.dataset.status || "";
    if (fresh) showChecked(el, cached);
    else if (!el.dataset.status) showUpdated(el);
    else el.classList.add("upd-wait");
  });
  if (fresh || !url) return;
  window.otrChecked = window.otrChecked || Promise.race([
    fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("status " + r.status); return r.json(); }),
    new Promise(function (_, fail) { setTimeout(function () { fail(new Error("slow")); }, 1500); }),
  ]).then(function (s) {
    if (!s || !s.checkedAt) throw new Error("no check");
    s.fetched = Date.now();
    try { localStorage.setItem("otr:checked", JSON.stringify(s)); } catch (e) { /* storage blocked */ }
    return s;
  });
  window.otrChecked.then(
    function (s) { document.querySelectorAll("time.upd-wait").forEach(function (el) { showChecked(el, s); }); },
    function () { document.querySelectorAll("time.upd-wait").forEach(showUpdated); }
  );
};
