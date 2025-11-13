import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Always use dark mode
const root = document.documentElement;
root.classList.remove("light");
root.classList.add("dark");

createRoot(document.getElementById("root")!).render(<App />);
