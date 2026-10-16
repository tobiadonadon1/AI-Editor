import { useEffect, useState } from "react";
import { Mark } from "./Icons";

// A loading screen that says so when something takes too long, instead of sitting there silently.
export function Splash({ label }: { label: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 10000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="center-note">
      <Mark size={36} />
      <span className="spinner" aria-hidden />
      <span>{label}</span>
      {slow && (
        <span className="fine">
          This is taking longer than usual. Check the connection, or{" "}
          <button type="button" className="link" onClick={() => location.reload()}>
            reload
          </button>
          .
        </span>
      )}
    </div>
  );
}
