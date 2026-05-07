import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import "./index.css";
import Blokus from "./Blokus";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Blokus />
    <Analytics />
  </React.StrictMode>
);
