/* ====================================================================
   Knicks 2026 — fan extras: page-load confetti + background-music toggle.
   Plain vanilla, no deps, runs immediately (script lives at end of body).
   ==================================================================== */
(function () {
  "use strict";

  /* ---------- confetti explosion on page load ---------- */
  (function confetti() {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const COLORS = ["#f58426", "#006bb6", "#ffffff", "#ffd54a", "#e06a0a", "#00477a"];
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:9999";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    let W, H, dpr;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.width = window.innerWidth * dpr;
      H = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
    }
    resize();

    const parts = [];
    function burst(cx, cy, count) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (4 + Math.random() * 9) * dpr;
        parts.push({
          x: cx, y: cy,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 6 * dpr,
          g: 0.22 * dpr,
          size: (5 + Math.random() * 7) * dpr,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          color: COLORS[(Math.random() * COLORS.length) | 0],
          life: 0,
          ttl: 90 + Math.random() * 60,
        });
      }
    }
    // A big central pop plus two flanking bursts → a full-width explosion.
    burst(W * 0.5, H * 0.34, 140);
    burst(W * 0.18, H * 0.30, 70);
    burst(W * 0.82, H * 0.30, 70);

    let frame = 0;
    function tick() {
      frame++;
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of parts) {
        if (p.life > p.ttl) continue;
        alive++;
        p.life++;
        p.vy += p.g;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        const fade = Math.max(0, 1 - p.life / p.ttl);
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.62);
        ctx.restore();
      }
      if (alive > 0 && frame < 420) requestAnimationFrame(tick);
      else canvas.remove();
    }
    requestAnimationFrame(tick);
  })();

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
