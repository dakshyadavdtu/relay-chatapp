import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { Router } from "wouter";
import { store } from "./state/store";
import App from "./App";
import "./styles/globals.css";
import { pingHealth } from "./lib/api";
import { bootstrap } from "@/features/ui_prefs";
import { primeAudio } from "@/utils/soundEffects";

/** Production: require backend URLs; no localhost fallback (Vercel -> Render). */
if (typeof import.meta !== "undefined" && import.meta.env.PROD) {
  const httpUrl = import.meta.env.VITE_BACKEND_HTTP_URL;
  const wsUrl = import.meta.env.VITE_BACKEND_WS_URL;
  if (!httpUrl || typeof httpUrl !== "string" || !httpUrl.trim()) {
    throw new Error(
      "VITE_BACKEND_HTTP_URL is required in production. Set it in your build (e.g. Vercel env) to your backend URL (e.g. https://relay-chatapp.onrender.com)."
    );
  }
  if (!wsUrl || typeof wsUrl !== "string" || !wsUrl.trim()) {
    throw new Error(
      "VITE_BACKEND_WS_URL is required in production. Set it to your backend WebSocket URL (e.g. wss://relay-chatapp.onrender.com/ws)."
    );
  }
  if (/localhost|127\.0\.0\.1/i.test(httpUrl.trim())) {
    throw new Error("VITE_BACKEND_HTTP_URL must not point to localhost in production.");
  }
  if (/localhost|127\.0\.0\.1/i.test(wsUrl.trim())) {
    throw new Error("VITE_BACKEND_WS_URL must not point to localhost in production.");
  }
}

/** DEV only: enforce single host so host-only cookies are not split (localhost vs 127.0.0.1). */
const ALLOWED_DEV_HOST = "localhost";
const isDevWrongHost =
  typeof import.meta !== "undefined" &&
  import.meta.env?.DEV === true &&
  typeof window !== "undefined" &&
  window.location?.hostname !== ALLOWED_DEV_HOST;

if (isDevWrongHost) {
  const root = document.getElementById("root");
  root.innerHTML = "";
  const div = document.createElement("div");
  div.setAttribute("role", "alert");
  div.style.cssText =
    "min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;font-family:system-ui,sans-serif;text-align:center;background:#1a1a2e;color:#eee;";
  div.innerHTML = `
    <h1 style="font-size:1.5rem;margin-bottom:1rem;">Wrong host in dev</h1>
    <p style="max-width:420px;margin-bottom:0.5rem;">Use <strong>http://localhost:5173</strong> only.</p>
    <p style="max-width:420px;color:#aaa;">Cookies are host-only; opening 127.0.0.1 will not send them and you will be logged out.</p>
    <p style="max-width:420px;margin-top:1rem;font-size:0.9rem;color:#888;">Do not mix localhost and 127.0.0.1 in dev. Clear cookies if you did.</p>
  `;
  root.appendChild(div);
} else {
  bootstrap();
  primeAudio();

  pingHealth().then(
    ({ ok, json }) => (import.meta.env.DEV ? (ok ? console.log("API OK", json) : console.error("API DOWN", json)) : undefined),
    (err) => console.error("API DOWN", err)
  );

  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <Provider store={store}>
        <Router>
          <App />
        </Router>
      </Provider>
    </React.StrictMode>
  );
}
