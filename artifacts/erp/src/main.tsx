import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// Configure the API client auth token getter
// API calls use relative URLs (/api/...) proxied by Vite to port 8080
setAuthTokenGetter(() => localStorage.getItem("erp_token"));

createRoot(document.getElementById("root")!).render(<App />);
