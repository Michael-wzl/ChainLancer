import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

const appName = import.meta.env.VITE_APP_NAME || "ChainLancer";

// Dynamically set title
document.title = `${appName} — Decentralized Freelance Platform`;

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App appName={appName} />
  </React.StrictMode>,
);
