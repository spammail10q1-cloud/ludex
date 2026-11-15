import { useEffect, useState } from "react";
import {
  Cloud,
  CloudDownload,
  CloudUpload,
  Github,
  Loader,
  Lock,
  LogOut,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

function Card({ children, className = "" }) {
  return (
    <section className={`rounded-xl border border-border/50 bg-card p-5 shadow ${className}`}>
      {children}
    </section>
  );
}

export default function CloudPage() {
  const [config, setConfig] = useState(null);
  const [token, setToken] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("ludex-cloud");
  const [branch, setBranch] = useState("main");
  const [filePath, setFilePath] = useState("ludex-cloud/snapshot.json");
  const [busy, setBusy] = useState("");
  const [lastResult, setLastResult] = useState(null);

  const load = async () => {
    const next = await window.electron.cloudGetConfig?.();
    if (!next) return;
    setConfig(next);
    setOwner(next.owner || "");
    setRepo(next.repo || "ludex-cloud");
    setBranch(next.branch || "main");
    setFilePath(next.path || "ludex-cloud/snapshot.json");
  };

  useEffect(() => {
    load();
  }, []);

  const extras = () => ({
    profileImage: localStorage.getItem("profileImage") || null,
    profileBanner: localStorage.getItem("profileBanner") || null,
    selectedEmoji: localStorage.getItem("selectedEmoji") || null,
    favorites: (() => {
      try {
        return JSON.parse(localStorage.getItem("game-favorites") || "[]");
      } catch {
        return [];
      }
    })(),
  });

  const run = async (key, action) => {
    setBusy(key);
    try {
      const result = await action();
      await load();
      return result;
    } catch (error) {
      console.error("[Cloud]", error);
      toast.error(error.message || "Cloud action failed");
      await load();
      return null;
    } finally {
      setBusy("");
    }
  };

  const connect = async () => {
    if (!token.trim()) {
      toast.error("Paste a GitHub token first");
      return;
    }
    const result = await run("connect", () =>
      window.electron.cloudConnect({
        token: token.trim(),
        owner: owner.trim(),
        repo: repo.trim(),
        branch: branch.trim(),
        path: filePath.trim(),
      })
    );
    if (result) toast.success(`Connected as ${result.login}`);
  };

  const createRepo = async () => {
    const result = await run("create", () =>
      window.electron.cloudCreateRepo({
        token: token.trim() || undefined,
        name: repo.trim() || "ludex-cloud",
        owner: owner.trim() || undefined,
      })
    );
    if (result) toast.success("Private cloud repository is ready");
  };

  const push = async () => {
    const result = await run("push", () => window.electron.cloudPush(extras()));
    if (result) {
      setLastResult(result);
      toast.success(
        `Saved ${result.library} games · ${(result.bytes / 1024).toFixed(1)} KB`
      );
    }
  };

  const pull = async () => {
    const result = await run("pull", () => window.electron.cloudPull());
    if (!result) return;
    setLastResult(result);
    if (result.profile?.image) {
      try {
        localStorage.setItem("profileImage", result.profile.image);
      } catch {}
    }
    if (result.profile?.banner) {
      try {
        localStorage.setItem("profileBanner", result.profile.banner);
      } catch {}
    }
    if (result.profile?.emoji) {
      localStorage.setItem("selectedEmoji", result.profile.emoji);
    }
    if (Array.isArray(result.favorites)) {
      localStorage.setItem("game-favorites", JSON.stringify(result.favorites));
    }
    window.dispatchEvent(new CustomEvent("game-cover-updated"));
    toast.success(`Restored ${result.libraryCount} games · reloading…`);
    setTimeout(() => window.location.reload(), 1200);
  };

  const signOut = async () => {
    await run("signout", () => window.electron.cloudSignOut());
    setToken("");
    toast.success("Signed out of Ludex Cloud");
  };

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-muted-foreground">
        <Loader className="mr-3 h-5 w-5 animate-spin" />
        Loading Ludex Cloud…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <Cloud className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-[0.2em]">
              Ludex Cloud
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Your data. Your GitHub. Zero cost.</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Ludex Cloud stores a private snapshot in a GitHub repository you own. There is no
            Ludex server, no subscription and no database bill — GitHub's free plan is enough.
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={load}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <span
              className={`rounded-full px-2 py-1 text-xs font-semibold ${
                config.connected
                  ? "bg-green-500/15 text-green-400"
                  : "bg-yellow-500/15 text-yellow-400"
              }`}
            >
              {config.connected ? "Connected" : "Not connected"}
            </span>
          </div>
          <p className="mt-3 font-semibold">
            {config.connected ? `${config.owner}/${config.repo}` : "Connect a GitHub token"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {config.connected
              ? `Branch ${config.branch} · ${config.path}`
              : "Your token is stored locally with owner-only permissions."}
          </p>
        </Card>
        <Card>
          <span className="text-sm text-muted-foreground">Last sync</span>
          <p className="mt-3 font-semibold">
            {config.lastSync ? new Date(config.lastSync).toLocaleString() : "Never"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {config.lastDirection === "pull"
              ? "Last action restored from GitHub"
              : config.lastDirection === "push"
                ? "Last action saved to GitHub"
                : "Push or pull to start"}
          </p>
        </Card>
        <Card>
          <span className="text-sm text-muted-foreground">Zero-cost backend</span>
          <p className="mt-3 flex items-center gap-2 font-semibold">
            <Github className="h-4 w-4" />
            Private GitHub repo
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            No central server. No database bill. Your snapshot lives in your own account.
          </p>
        </Card>
      </div>

      {config.lastError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {config.lastError}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <h2 className="text-lg font-semibold">Connect GitHub</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a fine-grained token with <strong>Contents: Read and write</strong> access for
            the repository below. Ludex never sends the token anywhere except api.github.com.
          </p>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">GitHub token</label>
              <Input
                type="password"
                value={token}
                onChange={event => setToken(event.target.value)}
                placeholder="github_pat_… or ghp_…"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Owner (optional)</label>
                <Input
                  value={owner}
                  onChange={event => setOwner(event.target.value)}
                  placeholder="auto-detect from token"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Repository</label>
                <Input value={repo} onChange={event => setRepo(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Branch</label>
                <Input value={branch} onChange={event => setBranch(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Snapshot path</label>
                <Input value={filePath} onChange={event => setFilePath(event.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                className="gap-2 text-secondary"
                onClick={connect}
                disabled={busy === "connect"}
              >
                {busy === "connect" ? (
                  <Loader className="h-4 w-4 animate-spin" />
                ) : (
                  <Github className="h-4 w-4" />
                )}
                Connect
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={createRepo}
                disabled={busy === "create" || (!token.trim() && !config.connected)}
              >
                {busy === "create" ? (
                  <Loader className="h-4 w-4 animate-spin" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                Create private repo
              </Button>
              {config.connected && (
                <Button variant="ghost" className="gap-2" onClick={signOut}>
                  <LogOut className="h-4 w-4" />
                  Sign out
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">Sync</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The snapshot includes your profile picture, banner, emoji, preferences, library
            metadata, favorites and mod profiles. It never includes game files or API keys.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Button
              className="gap-2 text-secondary"
              onClick={push}
              disabled={!config.connected || busy === "push"}
            >
              {busy === "push" ? (
                <Loader className="h-4 w-4 animate-spin" />
              ) : (
                <CloudUpload className="h-4 w-4" />
              )}
              Push to cloud
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={pull}
              disabled={!config.connected || busy === "pull"}
            >
              {busy === "pull" ? (
                <Loader className="h-4 w-4 animate-spin" />
              ) : (
                <CloudDownload className="h-4 w-4" />
              )}
              Pull from cloud
            </Button>
          </div>
          {lastResult && (
            <pre className="mt-4 max-h-48 overflow-auto rounded-lg border border-border/40 bg-background/40 p-3 text-xs text-muted-foreground">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          )}
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              Pull is last-write-wins. Push before switching PCs if you changed profile images or
              preferences on this device.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
