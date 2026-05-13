import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { VideoExportOverlay } from "./components/VideoExportOverlay";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
		<VideoExportOverlay />
	</StrictMode>,
);
