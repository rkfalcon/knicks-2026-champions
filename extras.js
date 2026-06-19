/* ====================================================================
   Knicks 2026 — fan extras: page-load confetti + background-music toggle.
   Plain vanilla, no deps, runs immediately (script lives at end of body).
   ==================================================================== */
(function () {
  "use strict";

  /* ---------- confetti explosion on page load ----------
     Pure CSS/DOM: each piece is animated by the compositor (GPU), so the burst
     never touches the main thread — no per-frame JS, no load-time hang. */
  function confetti() {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const COLORS = ["#f58426", "#006bb6", "#ffffff", "#ffd54a", "#e06a0a", "#00477a"];
    const wrap = document.createElement("div");
    wrap.className = "confetti-burst";
    wrap.setAttribute("aria-hidden", "true");

    const N = window.innerWidth < 560 ? 70 : 100;
    let html = "";
    for (let i = 0; i < N; i++) {
      const tx = (Math.random() * 2 - 1) * 60;        // vw spread, left/right
      const ty = Math.random() * 100 - 28;            // vh, mostly downward
      const r = Math.random() * 720 - 360;            // deg spin
      const size = 6 + Math.random() * 8;             // px
      const color = COLORS[(Math.random() * COLORS.length) | 0];
      const delay = Math.random() * 0.12;             // s
      const dur = 1.7 + Math.random() * 1.4;          // s
      html +=
        '<i style="--tx:' + tx.toFixed(1) + "vw;--ty:" + ty.toFixed(1) +
        "vh;--r:" + r.toFixed(0) + "deg;--w:" + size.toFixed(1) +
        "px;--c:" + color + ";--d:" + dur.toFixed(2) + "s;--delay:" +
        delay.toFixed(2) + 's;"></i>';
    }
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    // Clean up once the longest piece has finished (max delay + max dur + buffer).
    setTimeout(function () { wrap.remove(); }, 3600);
  }

  // Kick it off after the first paint so the page shows instantly; the animation
  // itself is GPU-composited and won't block anything.
  if (document.readyState === "complete") requestAnimationFrame(confetti);
  else window.addEventListener("load", function () { requestAnimationFrame(confetti); }, { once: true });

  /* ---------- background music toggle ---------- */
  (function music() {
    const audio = document.getElementById("bgm");
    const btn = document.getElementById("musicToggle");
    if (!audio || !btn) return;
    const KEY = "knicks_music_on";
    let on = false;

    function paint() {
      btn.textContent = on ? "🔊" : "🔇";
      btn.classList.toggle("is-on", on);
      btn.title = on ? "Mute music" : "Play music";
      btn.setAttribute("aria-pressed", String(on));
    }
    function save(v) { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch (e) {} }

    function play() {
      audio.volume = 0.55;
      const p = audio.play();
      if (p && p.then) {
        p.then(() => { on = true; paint(); save(true); })
         .catch(() => { on = false; paint(); }); // missing file or blocked → stay off
      } else {
        on = true; paint(); save(true);
      }
    }
    function pause() { audio.pause(); on = false; paint(); save(false); }

    btn.addEventListener("click", () => (on ? pause() : play()));
    paint();

    // If music was on last visit, resume it on the first interaction (browsers
    // block autoplay-with-sound until the user touches the page).
    let pref = false;
    try { pref = localStorage.getItem(KEY) === "1"; } catch (e) {}
    if (pref) {
      const resume = () => {
        play();
        document.removeEventListener("pointerdown", resume);
        document.removeEventListener("keydown", resume);
      };
      document.addEventListener("pointerdown", resume);
      document.addEventListener("keydown", resume);
    }
  })();
})();
