import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

const appName = import.meta.env.VITE_APP_NAME || "GigSecure";

// Clear local storage on startup in development mode
// if (import.meta.env.DEV) {
//  localStorage.clear();
//  sessionStorage.clear();
//  console.log("[Dev] localStorage and sessionStorage cleared on startup.");
// }

// Dynamically set title
document.title = `${appName} — Decentralized Freelance Platform`;

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App appName={appName} />
  </React.StrictMode>,
);
