import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
const root = document.getElementById("root");
if (!root) throw new Error("Conteneur principal introuvable.");
createRoot(root).render(
  <React.StrictMode>
    <React.Suspense
      fallback={
        <div className="loading-page" role="status">
          Chargement de votre espace…
        </div>
      }
    >
      <App />
    </React.Suspense>
  </React.StrictMode>,
);
