import { Link, useLocation } from "react-router-dom";

const NotFound = () => {
  const location = useLocation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#141414] px-6 text-[#f5f5f5]">
      <div className="w-full max-w-[420px] rounded-lg border border-white/12 bg-[#1b1b1b] p-6 shadow-[0_18px_70px_rgba(0,0,0,0.4)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
          Route not found
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-white">This workspace route does not exist.</h1>
        <p className="mt-3 text-sm leading-6 text-white/65">
          Studio could not open <span className="font-mono text-white/80">{location.pathname}</span>.
          Return to the main workspace and reopen the tool from the top bar.
        </p>
        <Link
          to="/"
          className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-white px-4 text-sm font-medium text-[#111] transition hover:bg-white/90"
        >
          Return to workspace
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
