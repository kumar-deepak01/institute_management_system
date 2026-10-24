import { useCallback, useEffect, useRef, useState } from "react";
import "./LampLogin.css";

/**
 * My Classroom - lamp login (presentation only).
 *
 * This component contains NO auth logic. Wire the project's EXISTING login logic into `onSubmit`:
 *   onSubmit({ email, password, remember }) => Promise<{ ok: boolean, message?: string }>
 *   - resolve { ok: true }  -> success (the caller does the existing redirect)
 *   - resolve { ok: false } -> wrong ID/password: error text + shake + Login button escapes
 *   - throw / reject        -> network/server problem: error text only, no escape animation
 */

// TODO: replace with the real URLs (do not invent them).
export const ADMISSION_FORM_URL = "/admissions";
export const BOOK_DEMO_URL = "#";

// Login button "escape" tuning
const THREAD_MAX = 85; // px, max distance from its slot
const REST_MIN = 50; // px, where it settles after popping out
const REST_MAX = 80;
const DODGE_RADIUS = 130; // px, pointer distance that makes it dodge
const JUMP_RADIUS = 24; // px, pointer this close -> it jumps away
const SMALL_SCALE = 0.55; // button size while out of its slot

const ERROR_TEXT = "Invalid ID or password. Please check your details and try again.";
const SERVER_ERROR_TEXT = "Something went wrong. Please try again in a moment.";
const OK_TEXT = "Login successful. Redirecting to My Classroom...";

export default function LampLogin({
  onSubmit,
  onForgotPassword,
  forgotPasswordHref = "/forgot-password",
  admissionUrl = ADMISSION_FORM_URL,
  bookDemoUrl = BOOK_DEMO_URL,
}) {
  const [on, setOn] = useState(false);
  const [out, setOut] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" });
  const [shaking, setShaking] = useState(false);
  const [flicking, setFlicking] = useState(false);

  const formRef = useRef(null);
  const slotRef = useRef(null);
  const btnRef = useRef(null);
  const pathRef = useRef(null);
  const dotRef = useRef(null);
  const busyRef = useRef(false);
  const phys = useRef({
    mis: false,
    p: { x: 0, y: 0 },
    v: { x: 0, y: 0 },
    rest: { x: 0, y: 0 },
    popUntil: 0,
    mx: -999,
    my: -999,
    sc: 1,
  });

  // page title + fonts (no extra library needed)
  useEffect(() => {
    document.title = "My Classroom Login | My JEE Mentor";
    if (!document.getElementById("ll-fonts")) {
      const l = document.createElement("link");
      l.id = "ll-fonts";
      l.rel = "stylesheet";
      l.href =
        "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@700&display=swap";
      document.head.appendChild(l);
    }
  }, []);

  // hide the card from keyboard/screen readers while the light is off
  useEffect(() => {
    if (formRef.current) formRef.current.inert = !on;
  }, [on]);

  const comeHome = useCallback(() => {
    if (phys.current.mis) {
      phys.current.mis = false;
      setOut(false);
    }
  }, []);

  const pulse = (setter) => {
    setter(false);
    requestAnimationFrame(() => setter(true));
    setTimeout(() => setter(false), 600);
  };

  const popOut = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ph = phys.current;
    const a = Math.random() * Math.PI * 2;
    const r = REST_MIN + Math.random() * (REST_MAX - REST_MIN);
    ph.mis = true;
    ph.rest = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    ph.v.x = (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 5);
    ph.v.y = -(9 + Math.random() * 4);
    ph.popUntil = performance.now() + 1300;
    setOut(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    let result = null;
    let failed = false;
    try {
      result = await onSubmit({ email: email.trim(), password, remember });
    } catch (err) {
      failed = true;
    }
    busyRef.current = false;

    if (failed) {
      setMsg({ type: "error", text: SERVER_ERROR_TEXT });
      return;
    }
    if (result && result.ok) {
      comeHome();
      setMsg({ type: "ok", text: result.message || OK_TEXT });
    } else {
      setMsg({ type: "error", text: (result && result.message) || ERROR_TEXT });
      pulse(setShaking);
      pulse(setFlicking);
      popOut();
    }
  };

  // pointer tracking + physics loop
  useEffect(() => {
    const ph = phys.current;
    const onMove = (e) => {
      ph.mx = e.clientX;
      ph.my = e.clientY;
    };
    const onUp = (e) => {
      if (e.pointerType === "touch") {
        ph.mx = -999;
        ph.my = -999;
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onMove);
    window.addEventListener("pointerup", onUp);

    let raf;
    const tick = (t) => {
      const slot = slotRef.current;
      const btn = btnRef.current;
      const form = formRef.current;
      const path = pathRef.current;
      const dot = dotRef.current;
      if (slot && btn && form && path && dot) {
        const h = slot.getBoundingClientRect();
        const hx = h.left + h.width / 2;
        const hy = h.top + h.height / 2;
        const { p, v } = ph;

        if (ph.mis) {
          if (t < ph.popUntil) {
            v.x += (ph.rest.x - p.x) * 0.012;
            v.y += (ph.rest.y - p.y) * 0.012;
          }
          const hw = (h.width * ph.sc) / 2;
          const hh = (h.height * ph.sc) / 2;
          const cx = hx + p.x;
          const cy = hy + p.y;
          const nx = Math.max(cx - hw, Math.min(ph.mx, cx + hw));
          const ny = Math.max(cy - hh, Math.min(ph.my, cy + hh));
          const dx = cx - ph.mx;
          const dy = cy - ph.my;
          const d = Math.hypot(ph.mx - nx, ph.my - ny);
          const dc = Math.hypot(dx, dy) || 1;

          if (d < DODGE_RADIUS) {
            const f = (DODGE_RADIUS - d) / DODGE_RADIUS;
            v.x += (dx / dc) * f * 3.4;
            v.y += (dy / dc) * f * 3.4;
            const s = p.x * dy - p.y * dx >= 0 ? 1 : -1;
            v.x += (-dy / dc) * f * 1.8 * s;
            v.y += (dx / dc) * f * 1.8 * s;
          }
          if (d < JUMP_RADIUS) {
            const ang = Math.atan2(-dy, -dx) + (Math.random() - 0.5);
            p.x = Math.cos(ang) * THREAD_MAX * 0.85;
            p.y = Math.sin(ang) * THREAD_MAX * 0.85;
            v.x = 0;
            v.y = 0;
          }
          v.x *= 0.9;
          v.y *= 0.9;
          p.x += v.x;
          p.y += v.y;

          const len = Math.hypot(p.x, p.y);
          if (len > THREAD_MAX) {
            p.x *= THREAD_MAX / len;
            p.y *= THREAD_MAX / len;
            v.x *= 0.4;
            v.y *= 0.4;
          }
          p.x = Math.max(-hx + hw + 8, Math.min(window.innerWidth - hx - hw - 8, p.x));
          p.y = Math.max(-hy + hh + 8, Math.min(window.innerHeight - hy - hh - 8, p.y));
          ph.sc += (SMALL_SCALE - ph.sc) * 0.12;
        } else {
          p.x *= 0.88;
          p.y *= 0.88;
          v.x = 0;
          v.y = 0;
          if (Math.abs(p.x) + Math.abs(p.y) < 0.1) {
            p.x = 0;
            p.y = 0;
          }
          ph.sc += (1 - ph.sc) * 0.15;
          if (Math.abs(1 - ph.sc) < 0.003) ph.sc = 1;
        }

        btn.style.transform = `translate(${p.x}px,${p.y}px) scale(${ph.sc}) rotate(${p.x * 0.05}deg)`;

        if (p.x || p.y || ph.mis) {
          const fr = form.getBoundingClientRect();
          const sx = hx - fr.left;
          const sy = hy - fr.top;
          const ex = sx + p.x;
          const ey = sy + p.y;
          const sag = Math.max(0, THREAD_MAX - Math.hypot(p.x, p.y)) * 0.4;
          path.setAttribute("d", `M${sx} ${sy} Q${(sx + ex) / 2} ${(sy + ey) / 2 + sag} ${ex} ${ey}`);
          dot.setAttribute("cx", sx);
          dot.setAttribute("cy", sy);
          dot.setAttribute("r", "3.5");
        } else {
          path.setAttribute("d", "");
          dot.setAttribute("cx", -10);
          dot.setAttribute("r", "0");
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const toggleLight = () => setOn((v) => !v);

  const rootClass = ["ll-root", on ? "ll-on" : "", out ? "ll-out" : "", flicking ? "ll-flick" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={rootClass}>

      <header className="ll-head">
        <p className="ll-eyebrow">MY JEE MENTOR</p>
        <h1 className="ll-serif ll-title">My Classroom Login</h1>
      </header>

      <section className="ll-section">
        {/* ---------- lamp column ---------- */}
        <div className="ll-lampcol">
          <div className="ll-floorglow" />
          <div className="ll-cone" />
          <div className="ll-cone ll-cone2" />
          <div className="ll-pole" />
          <div className="ll-base" />
          <div className="ll-shade" />

          {/* helper: hanging sign + 3D smiley + dashed trail (only active while light is OFF) */}
          <div className="ll-emo" aria-hidden="true">
            <div className="ll-sign">
              <div className="ll-sign-in">
                <svg width="108" height="40" style={{ position: "absolute", left: 0, top: 0 }}>
                  <path d="M54 2 L14 38 M54 2 L94 38" stroke="#b9a88a" strokeWidth="1.3" fill="none" />
                  <circle cx="54" cy="2" r="3" fill="#d7c4a0" />
                </svg>
                <div className="ll-board">
                  <small>PLEASE</small>
                  <b>TURN ON</b>
                </div>
              </div>
            </div>

            <svg className="ll-face" viewBox="0 0 64 64">
              <defs>
                <radialGradient id="ll-eb" cx="36%" cy="28%" r="80%">
                  <stop offset="0" stopColor="#ffe6a8" />
                  <stop offset=".35" stopColor="#ffb43c" />
                  <stop offset=".72" stopColor="#ff8a14" />
                  <stop offset="1" stopColor="#cf4f08" />
                </radialGradient>
                <radialGradient id="ll-ebs" cx="50%" cy="112%" r="70%">
                  <stop offset="0" stopColor="#ffcf6a" stopOpacity=".75" />
                  <stop offset="1" stopColor="#ffcf6a" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="ll-ee" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#7a3009" />
                  <stop offset="1" stopColor="#2a0e02" />
                </linearGradient>
                <radialGradient id="ll-ec" cx="50%" cy="50%" r="50%">
                  <stop offset="0" stopColor="#ff5a2a" stopOpacity=".6" />
                  <stop offset="1" stopColor="#ff5a2a" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle cx="32" cy="32" r="30" fill="url(#ll-eb)" />
              <circle cx="32" cy="32" r="30" fill="url(#ll-ebs)" />
              <ellipse cx="23" cy="13" rx="13" ry="6" fill="#fff" opacity=".42" transform="rotate(-24 23 13)" />
              <ellipse cx="44" cy="9.5" rx="2.6" ry="1.4" fill="#fff" opacity=".5" transform="rotate(30 44 9.5)" />
              <ellipse cx="13.5" cy="38" rx="6" ry="4.6" fill="url(#ll-ec)" />
              <ellipse cx="50.5" cy="38" rx="6" ry="4.6" fill="url(#ll-ec)" />
              <path
                d="M16.5 20.5q4.5-4.2 9-1.2M38.5 19.3q4.5-3 9 1.2"
                stroke="#6b2a08"
                strokeWidth="2.4"
                fill="none"
                strokeLinecap="round"
              />
              <ellipse cx="22" cy="28" rx="4.2" ry="5.8" fill="url(#ll-ee)" />
              <ellipse cx="42" cy="28" rx="4.2" ry="5.8" fill="url(#ll-ee)" />
              <ellipse cx="23.4" cy="25.4" rx="1.7" ry="2.1" fill="#fff" />
              <ellipse cx="43.4" cy="25.4" rx="1.7" ry="2.1" fill="#fff" />
              <circle cx="20.8" cy="30.8" r=".9" fill="#fff" opacity=".7" />
              <circle cx="40.8" cy="30.8" r=".9" fill="#fff" opacity=".7" />
              <path d="M16 39Q32 62 48 39Q32 45 16 39Z" fill="#3d1203" />
              <path d="M19.5 40.2Q32 45.4 44.5 40.2Q32 47.2 19.5 40.2Z" fill="#fff6e8" />
              <path d="M25 51.4Q32 46.6 39 51.4Q32 57 25 51.4Z" fill="#ff7a6a" />
            </svg>

            <svg className="ll-trail" width="14" height="42" viewBox="0 0 14 42">
              <line x1="7" y1="0" x2="7" y2="34" stroke="#ffb43c" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="5 6" />
              <path d="M2 31l5 7 5-7" stroke="#ffb43c" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* light switch */}
          <div className="ll-switchwrap">
            <div
              role="switch"
              aria-checked={on}
              aria-label="Turn the lamp on or off"
              tabIndex={0}
              className="ll-switch"
              onClick={toggleLight}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleLight();
                }
              }}
            >
              <div className="ll-knob" />
            </div>
          </div>
        </div>

        {/* ---------- login card ---------- */}
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          noValidate
          className={`ll-card ${shaking ? "ll-shake" : ""}`}
        >
          {/* thread (inside the card's stacking context: above card bg, below the button) */}
          <svg
            className="ll-thread"
            aria-hidden="true"
          >
            <path ref={pathRef} fill="none" stroke="rgba(167,150,255,.85)" strokeWidth="1.6" />
            <circle ref={dotRef} r="0" fill="#a796ff" cx="-10" cy="-10" />
          </svg>

          <h2 className="ll-serif ll-welcome">Welcome Back</h2>
          <p className="ll-sub">Please login to continue</p>

          <label className="ll-field ll-field-gap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9a9aa3" strokeWidth="1.8" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
            <input
              name="email"
              type="text"
              autoComplete="username"
              placeholder="Student ID or Email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                comeHome();
              }}
              onFocus={comeHome}
              className="ll-input"
            />
          </label>

          <label className="ll-field">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9a9aa3" strokeWidth="1.8" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            <input
              name="password"
              type={showPass ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                comeHome();
              }}
              onFocus={comeHome}
              className="ll-input"
            />
            <button
              type="button"
              aria-label={showPass ? "Hide password" : "Show password"}
              aria-pressed={showPass}
              onClick={() => setShowPass((s) => !s)}
              className="ll-eye"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </label>

          <div className="ll-row">
            <label className="ll-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="ll-check"
              />
              Remember me
            </label>
            <a
              href={forgotPasswordHref}
              onClick={(e) => {
                if (onForgotPassword) {
                  e.preventDefault();
                  onForgotPassword();
                }
              }}
              className="ll-link"
            >
              Forgot password?
            </a>
          </div>

          <p
            role="alert"
            aria-live="polite"
            className={`ll-msg ${msg.type === "ok" ? "ll-msg-ok" : "ll-msg-err"}`}
          >
            {msg.text}
          </p>

          {/* slot = the box; the button inside it pops out on wrong login */}
          <div ref={slotRef} className="ll-slot">
            <button
              ref={btnRef}
              type="submit"
              className="ll-btn"
              style={{ zIndex: 2 }}
            >
              Login
            </button>
          </div>

          <p className="ll-foot">
            New to My JEE Mentor?
            <br />
            <a href={admissionUrl} className="ll-link">
              Apply for Admission
            </a>
            <span className="ll-sep">|</span>
            <a href={bookDemoUrl} className="ll-link">
              Book a Demo
            </a>
          </p>
        </form>
      </section>
    </main>
  );
}