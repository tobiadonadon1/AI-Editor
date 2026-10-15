import { useEffect, useState, type ReactNode } from "react";
import { ClerkLoading, ClerkProvider, Show, SignIn, useAuth } from "@clerk/react";
import { Home } from "./ui/Home";
import { NewProject } from "./ui/NewProject";
import { Editor } from "./ui/Editor";
import { Mark } from "./ui/Icons";
import { api, auth } from "./lib/api";
import { cloud } from "./lib/cloud";
import { selectDatabase } from "./lib/db";

type Route = { page: "home" } | { page: "new" } | { page: "editor"; id: string };

const parse = (): Route => {
  const h = window.location.hash;
  const m = h.match(/^#\/p\/([a-z0-9_-]+)/i);
  if (m) return { page: "editor", id: m[1] };
  if (h.startsWith("#/new")) return { page: "new" };
  return { page: "home" };
};

function Routes() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  if (route.page === "editor") return <Editor key={route.id} id={route.id} />;
  if (route.page === "new") return <NewProject />;
  return <Home />;
}

const PUBLISHABLE_KEY: string | undefined = import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
auth.enabled = Boolean(PUBLISHABLE_KEY);

// Clerk's screens in the editor's own dark palette.
const appearance = {
  variables: {
    colorPrimary: "#2d8ceb",
    colorPrimaryForeground: "#ffffff",
    colorBackground: "#1d1d1d",
    colorForeground: "#f2f2f2",
    colorMutedForeground: "#a3a3a3",
    colorMuted: "#232323",
    colorInput: "#2b2b2b",
    colorInputForeground: "#f2f2f2",
    colorNeutral: "#ffffff",
    colorBorder: "#3d3d3d",
    colorDanger: "#e5484d",
    fontFamily: '"Source Sans 3", -apple-system, "Segoe UI", system-ui, sans-serif',
    borderRadius: "6px",
    // The editor's root font is 12px for dense panels; Clerk would scale down with it.
    fontSize: "15px",
    spacing: "17px",
  },
  elements: { cardBox: { width: "100%", maxWidth: "440px" }, rootBox: { width: "100%", maxWidth: "440px" } },
};

const localization = {
  signIn: { start: { title: "Sign in to AI Editor", subtitle: "Welcome back. Sign in to open your projects." } },
  signUp: { start: { title: "Create your AI Editor account", subtitle: "Your projects and media are saved to it." } },
};

export function App() {
  if (!PUBLISHABLE_KEY)
    // Development without Clerk: one implicit user, synced to the cloud when the server has storage.
    return (
      <Session userId="local">
        <Routes />
      </Session>
    );
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} appearance={appearance} localization={localization}>
      <ClerkLoading>
        <div className="center-note">Loading…</div>
      </ClerkLoading>
      <Show when="signed-out">
        <SignInScreen />
      </Show>
      <Show when="signed-in">
        <SignedInSession />
      </Show>
    </ClerkProvider>
  );
}

function SignedInSession() {
  const { userId } = useAuth();
  return (
    <Session userId={userId ?? null}>
      <Routes />
    </Session>
  );
}

// Points local storage and cloud sync at the account before anything loads a project.
function Session({ userId, children }: { userId: string | null; children: ReactNode }) {
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    selectDatabase(userId === "local" ? null : userId);
    void api.health(true).then((h) => {
      cloud.configure(userId, h.storage);
      if (live) setReady(userId);
    });
    return () => {
      live = false;
    };
  }, [userId]);
  if (!userId || ready !== userId) return <div className="center-note">Loading your projects…</div>;
  return <>{children}</>;
}

function SignInScreen() {
  return (
    <div className="signin">
      <section className="signin-brand">
        <Mark size={44} />
        <h1>AI Editor</h1>
        <p>Edit video like in Premiere Pro, or just describe the edit: cuts, colour and light, titles, animations, captions and sound.</p>
        <ul>
          <li>Your projects and media are saved to your account</li>
          <li>Open them from any computer</li>
          <li>Export MP4 in 9:16, 4:5, 1:1 or 16:9</li>
        </ul>
      </section>
      <section className="signin-form">
        <SignIn routing="hash" />
      </section>
    </div>
  );
}
