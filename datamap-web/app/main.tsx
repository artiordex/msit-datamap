import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DataMapClient } from "./DataMapClient";
import "./globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <DataMapClient />
  </StrictMode>,
);
