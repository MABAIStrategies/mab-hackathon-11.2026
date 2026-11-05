// Placeholder entry. COR-05 replaces this with the app shell (and adds the Tailwind CSS entry).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <main>MyPl(ai)yer — coming online</main>
  </StrictMode>,
);
