import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { ClerkDegraded, ClerkFailed, ClerkLoading, ClerkProvider, Show, SignIn, useAuth } from "@clerk/react";
import { Home } from "./ui/Home";
import { Mark } from "./ui/Icons";
import { Splash } from "./ui/Splash";
import { api, auth } from "./lib/api";
import { cloud } from "./lib/cloud";
import { selectDatabase } from "./lib/db";

// The editor and its video engine load on demand, so sign-in and the project list appear quickly.
const Editor = lazy(() => import("./ui/Editor").then((m) => ({ default: m.Editor })));
const NewProject = lazy(() => import("./ui/NewProject").then((m) => ({ default: m.NewProject })));

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
  return (
    <Suspense fallback={<Splash label="Loading the editor…" />}>
      {route.page === "editor" ? <Editor key={route.id} id={route.id} /> : route.page === "new" ? <NewProject /> : <Home />}
    </Suspense>
  );
}

// A crash in any panel shows a way out instead of an empty page.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[AI Editor] crashed", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-note">
        <Mark size={36} />
        <span>Something went wrong: {this.state.error.message}</span>
        <span className="fine">Your work is saved. Reload to continue.</span>
        <span className="row-gap">
          <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
            Reload
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              location.hash = "#/";
              location.reload();
            }}
          >
            Back to projects
          </button>
        </span>
      </div>
    );
  }
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
    // After signing in Clerk goes to these URLs; a hash on the same page means no second full page load.
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      appearance={appearance}
      localization={localization}
      signInFallbackRedirectUrl="/#/"
      signUpFallbackRedirectUrl="/#/"
      afterSignOutUrl="/"
    >
      <ClerkLoading>
        <Splash label="Loading…" />
      </ClerkLoading>
      <ClerkFailed>
        <SignInUnavailable />
      </ClerkFailed>
      <ClerkDegraded>
        <SignInUnavailable />
      </ClerkDegraded>
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

function SignInUnavailable() {
  return (
    <div className="center-note">
      <Mark size={36} />
      <span>Sign-in could not load.</span>
      <span className="fine">A browser extension or the network may be blocking it. Check the connection, then reload.</span>
      <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
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
      if (!live) return;
      // If the server could not be reached, a signed-in session still assumes the account is there;
      // the calls that need it report their own errors.
      cloud.configure(userId, h.storage || (h.unreachable === true && auth.enabled));
      setReady(userId);
    });
    return () => {
      live = false;
    };
  }, [userId]);
  if (!userId || ready !== userId) return <Splash label="Loading your projects…" />;
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
