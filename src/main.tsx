import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "@fontsource/quicksand/400.css";
import "@fontsource/quicksand/500.css";
import "@fontsource/quicksand/600.css";
import "@fontsource/quicksand/700.css";
import "@fontsource/caveat/600.css";
import "@fontsource/caveat/700.css";
import "./index.css";
import App from "./App";

// apply saved theme before first paint to avoid a light flash
const stored = localStorage.getItem("coverly:theme");
const dark =
  stored === "dark" ||
  (!stored && matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.classList.toggle("dark", dark);

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
