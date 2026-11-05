// Placeholder entry. COR-05 replaces this with the app shell.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100">MyPl(ai)yer — coming online</main>
  </StrictMode>,
);
