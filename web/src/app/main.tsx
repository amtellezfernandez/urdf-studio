import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element.");
}

class StartupErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="startup-error" role="alert">
          <section>
            <strong>URDF Studio failed to start</strong>
            <span>{this.state.error.message}</span>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

createRoot(rootElement).render(
  <StartupErrorBoundary>
    <App />
  </StartupErrorBoundary>,
);
