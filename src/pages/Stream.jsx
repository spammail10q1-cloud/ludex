import { useEffect, useMemo, useState } from "react";
import {
  Cast,
  Check,
  Copy,
  ExternalLink,
  Loader,
  MonitorPlay,
  Power,
  Radio,
  RefreshCw,
  Send,
  Trash2,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

function Card({ children, className = "" }) {
  return (
    <section className={`rounded-xl border border-border/50 bg-card p-5 shadow ${className}`}>
      {children}
    </section>
  );
}

export default function Stream() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [games, setGames] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedGame, setSelectedGame] = useState("");
  const [profile, setProfile] = useState("balanced");
  const [ttl, setTtl] = useState("720");
  const [invite, setInvite] = useState(null);
  const [busy, setBusy] = useState("");

  const settings = status?.settings;

  const load = async () => {
    try {
      const next = await window.electron.streamGetStatus?.();
      if (!next) return;
      setStatus(next);
      setSessions(next.sessions || []);
      setProfile(previous => previous || next.settings.defaultProfile || "balanced");
      setTtl(previous => previous || String(next.settings.sessionTtlMinutes || 720));
      const gameList = await window.electron.streamListGames?.();
      setGames(gameList || []);
      if (!selectedGame && gameList?.length) setSelectedGame(gameList[0].name);
    } catch (error) {
      console.error("[Stream] load failed", error);
      toast.error("Could not load Ludex Stream");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveSetting = async patch => {
    const next = await window.electron.streamSaveSettings?.(patch);
    if (next) setStatus(previous => ({ ...previous, settings: next }));
    return next;
  };

  const run = async (key, action, successMessage) => {
    setBusy(key);
    try {
      const result = await action();
      if (result?.success === false) throw new Error(result.error || "Action failed");
      if (successMessage) toast.success(successMessage);
      await load();
      return result;
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const createInvite = async () => {
    if (!selectedGame) return;
    setBusy("invite");
    try {
      const session = await window.electron.streamCreateSession?.(selectedGame, {
        profile,
        ttlMinutes: Number(ttl) || 720,
      });
      if (!session) throw new Error("Could not create invite");
      setInvite(session);
      setSessions(previous => [...previous, session]);
      toast.success("Invite link created");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const copyInvite = async () => {
    if (!invite?.url) return;
    await navigator.clipboard.writeText(invite.url);
    toast.success("Invite link copied");
  };

  const profiles = settings?.qualityProfiles || [];
  const activeProfile = useMemo(
    () => profiles.find(item => item.id === profile),
    [profiles, profile]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-muted-foreground">
        <Loader className="mr-3 h-5 w-5 animate-spin" />
        Loading Ludex Stream…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <Cast className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-[0.2em]">
              Ludex Stream
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Your library. Your PC. Your stream.</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Local-first game streaming with Sunshine and Moonlight. No subscription and no
            central server — video and input stay between your devices.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={load}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            className="gap-2 text-secondary"
            onClick={() =>
              run("sync", () => window.electron.streamSyncGames?.(), "Games synced to Sunshine")
            }
            disabled={busy === "sync" || !status?.sunshine?.installed}
          >
            {busy === "sync" ? (
              <Loader className="h-4 w-4 animate-spin" />
            ) : (
              <MonitorPlay className="h-4 w-4" />
            )}
            Sync games
          </Button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Sunshine host</span>
            <span
              className={`rounded-full px-2 py-1 text-xs font-semibold ${
                status?.sunshine?.running
                  ? "bg-green-500/15 text-green-400"
                  : "bg-yellow-500/15 text-yellow-400"
              }`}
            >
              {status?.sunshine?.running ? "Running" : status?.sunshine?.installed ? "Installed" : "Missing"}
            </span>
          </div>
          <p className="mt-3 font-semibold">
            {status?.sunshine?.installed ? "Sunshine is ready" : "Install Sunshine to stream"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground break-all">
            {status?.sunshine?.executable || "No Sunshine executable found"}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {status?.sunshine?.running ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() =>
                  run("stop-sunshine", () => window.electron.streamStopSunshine?.(), "Sunshine stopped")
                }
              >
                <Power className="h-4 w-4" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                className="gap-2 text-secondary"
                disabled={!status?.sunshine?.installed || busy === "start-sunshine"}
                onClick={() =>
                  run("start-sunshine", () => window.electron.streamStartSunshine?.(), "Sunshine started")
                }
              >
                <Power className="h-4 w-4" />
                Start
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => window.electron.streamOpenSunshine?.()}
            >
              <ExternalLink className="h-4 w-4" />
              Sunshine UI
            </Button>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Invite server</span>
            <span
              className={`rounded-full px-2 py-1 text-xs font-semibold ${
                status?.server?.running
                  ? "bg-green-500/15 text-green-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {status?.server?.running ? `Port ${status.server.port}` : "Stopped"}
            </span>
          </div>
          <p className="mt-3 font-semibold">Invite links for friends</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {settings?.lanOnly
              ? "LAN only. Friends on the same network can open links."
              : "Reachable from the network. Port forwarding is your responsibility."}
          </p>
          <div className="mt-4 flex gap-2">
            {status?.server?.running ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  run("stop-server", () => window.electron.streamStopServer?.(), "Invite server stopped")
                }
              >
                Stop server
              </Button>
            ) : (
              <Button
                size="sm"
                className="text-secondary"
                onClick={() =>
                  run("start-server", () => window.electron.streamStartServer?.(), "Invite server started")
                }
              >
                Start server
              </Button>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Wake-on-LAN</span>
            <Wifi className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="mt-3 font-semibold">{settings?.wolMac ? settings.wolMac : "Not configured"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Wake the host from the invite page or from here.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4 gap-2"
            disabled={!settings?.wolMac || busy === "wake"}
            onClick={() => run("wake", () => window.electron.streamWake?.(), "Magic packet sent")}
          >
            <Power className="h-4 w-4" />
            Wake host
          </Button>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <h2 className="text-lg font-semibold">Create an invite</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a game and a quality profile. Ludex creates a temporary link for your friend.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Game</label>
              <Select value={selectedGame} onValueChange={setSelectedGame}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a game" />
                </SelectTrigger>
                <SelectContent>
                  {games.map(game => (
                    <SelectItem key={game.name} value={game.name}>
                      {game.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Quality profile</label>
              <Select value={profile} onValueChange={setProfile}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map(item => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} · {item.width}×{item.height} · {item.fps} FPS
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Expires after (minutes)
              </label>
              <Input
                type="number"
                min="5"
                max="43200"
                value={ttl}
                onChange={event => setTtl(event.target.value)}
              />
            </div>
          </div>
          {activeProfile && (
            <p className="mt-3 text-xs text-muted-foreground">
              {activeProfile.width}×{activeProfile.height} · {activeProfile.fps} FPS ·{" "}
              {Math.round(activeProfile.bitrate / 1000)} Mbps
            </p>
          )}
          <Button
            className="mt-4 w-full gap-2 text-secondary"
            onClick={createInvite}
            disabled={!selectedGame || busy === "invite"}
          >
            {busy === "invite" ? (
              <Loader className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Create invite link
          </Button>

          {invite && (
            <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">Invite ready</p>
              <p className="mt-1 break-all font-mono text-sm">{invite.url}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" className="gap-2 text-secondary" onClick={copyInvite}>
                  <Copy className="h-4 w-4" />
                  Copy link
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={() => window.electron.openURL(invite.url)}
                >
                  <ExternalLink className="h-4 w-4" />
                  Preview
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Active sessions</h2>
            <span className="text-xs text-muted-foreground">{sessions.length}</span>
          </div>
          {sessions.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No active invites.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {sessions.map(session => (
                <div
                  key={session.id}
                  className="flex items-center gap-3 rounded-lg border border-border/40 bg-background/40 p-3"
                >
                  <Radio className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{session.game}</p>
                    <p className="text-xs text-muted-foreground">
                      {session.profileData?.name || session.profile} · expires{" "}
                      {new Date(session.expiresAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      run(
                        `revoke-${session.id}`,
                        () => window.electron.streamRevokeSession?.(session.id),
                        "Invite revoked"
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="text-lg font-semibold">Stream settings</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Host name</label>
            <Input
              value={settings?.hostName || ""}
              onChange={event => saveSetting({ hostName: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Public host / IP (optional)
            </label>
            <Input
              placeholder="e.g. 192.168.1.20 or game.example.com"
              value={settings?.publicHost || ""}
              onChange={event => saveSetting({ publicHost: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Invite server port</label>
            <Input
              type="number"
              min="1024"
              max="65535"
              value={settings?.port || 47991}
              onChange={event => saveSetting({ port: Number(event.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Wake-on-LAN MAC</label>
            <Input
              placeholder="AA:BB:CC:DD:EE:FF"
              value={settings?.wolMac || ""}
              onChange={event => saveSetting({ wolMac: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Default quality profile
            </label>
            <Select
              value={settings?.defaultProfile || "balanced"}
              onValueChange={value => saveSetting({ defaultProfile: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {profiles.map(item => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2">
            <div>
              <p className="text-sm font-medium">LAN only</p>
              <p className="text-xs text-muted-foreground">Block invites from outside your network</p>
            </div>
            <Switch
              checked={settings?.lanOnly !== false}
              onCheckedChange={checked => saveSetting({ lanOnly: checked })}
            />
          </div>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            First-time clients must pair once in Sunshine. Open the Sunshine UI on this PC, start
            pairing, then enter the PIN shown on the client. After that, invite links work
            instantly.
          </p>
        </div>
      </Card>
    </div>
  );
}
