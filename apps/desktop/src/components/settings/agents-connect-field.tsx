import { useState, type ReactElement } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addRemoteAgent,
  connectMcpClient,
  errorMessage,
  MCP_CLIENTS,
  mcpClientConnection,
  mcpClientServers,
  remoteAgents,
  type McpClientId,
} from "@kore/core";
import { Check, Copy } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { openUrlSync } from "@/lib/open-url";
import { cn } from "@/lib/utils";
import {
  requestRemoteAccessRestart,
  useRemoteAccess,
} from "@/lib/remote-access-store";
import { useSettings } from "@/providers/settings-provider";
import { SettingsField } from "./field";
import {
  PROVIDER_BRANDS,
  ProviderLogo,
  type ProviderBrand,
} from "./provider-brands";

/** Cloud apps reach the vault through Remote access, each with its own key. */
const CLOUD_APPS = [
  {
    id: "claude",
    brand: "claude",
    label: "Claude on the web and iPhone",
    agentName: "Claude",
    openLabel: "Open Claude",
    openUrl: "https://claude.ai/customize/connectors",
    where:
      "In Connectors, choose Add custom connector, paste the address, then Add.",
  },
  {
    id: "chatgpt",
    brand: "openai",
    label: "ChatGPT",
    agentName: "ChatGPT",
    openLabel: "Open ChatGPT",
    openUrl: "https://chatgpt.com/",
    where:
      "In Settings → Apps & Connectors → Advanced, turn on Developer mode, then Create and paste the address.",
  },
] as const;

type CloudAppId = (typeof CLOUD_APPS)[number]["id"];

const RESTART_HINT: Record<McpClientId, string> = {
  "claude-desktop": "Connected. Quit and reopen Claude Desktop to use it.",
  "claude-code": "Connected. New Claude Code sessions use it.",
  cursor: "Connected. Reopen Cursor to use it.",
};

/** Which brand mark each app on this Mac wears. */
const LOCAL_BRAND: Record<McpClientId, string> = {
  "claude-desktop": "claude",
  "claude-code": "claude",
  cursor: "cursor",
};

function brandById(id: string): ProviderBrand | undefined {
  return PROVIDER_BRANDS.find((brand) => brand.id === id);
}

const SERVERS_KEY = ["mcp-client-servers"];

/**
 * Settings → Agents → Connect an app: one button per app. Apps on this Mac
 * get the `kore mcp` entry written into their own config (it follows the
 * vault, see `connectMcpClient`); cloud apps turn on Remote access, get
 * their own key, and show the two things to paste with a link to the page
 * where they go.
 */
export function AgentsConnectField({
  cliPath,
}: {
  cliPath: string;
}): ReactElement {
  const queryClient = useQueryClient();
  const { settings, updateSettings } = useSettings();
  const { phase } = useRemoteAccess();
  const { data: servers } = useQuery({
    queryKey: SERVERS_KEY,
    queryFn: mcpClientServers,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<McpClientId | null>(null);
  const [error, setError] = useState<{ app: string; message: string } | null>(
    null,
  );
  const [cloud, setCloud] = useState<{ app: CloudAppId; key: string } | null>(
    null,
  );
  const [copied, setCopied] = useState<"url" | "key" | null>(null);

  async function connectLocal(client: McpClientId): Promise<void> {
    setBusy(client);
    setError(null);
    setDone(null);
    try {
      await connectMcpClient({ client, cliPath, servers: servers ?? [] });
      await queryClient.invalidateQueries({ queryKey: SERVERS_KEY });
      setDone(client);
    } catch (caught) {
      setError({ app: client, message: errorMessage(caught) });
    } finally {
      setBusy(null);
    }
  }

  async function connectCloud(app: (typeof CLOUD_APPS)[number]): Promise<void> {
    setBusy(app.id);
    setError(null);
    setCopied(null);
    try {
      const existing = (await remoteAgents()).find(
        (agent) => agent.name.toLowerCase() === app.agentName.toLowerCase(),
      );
      const agent = existing ?? (await addRemoteAgent(app.agentName, "write"));
      if (!settings.remoteAccessEnabled) {
        updateSettings({ remoteAccessEnabled: true });
      } else if (existing === undefined) {
        // A new key only works once the server restarts with it.
        requestRemoteAccessRestart();
      }
      setCloud({ app: app.id, key: agent.key });
    } catch (caught) {
      setError({ app: app.id, message: errorMessage(caught) });
    } finally {
      setBusy(null);
    }
  }

  async function copy(target: "url" | "key", text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(target);
    } catch (caught) {
      setError({ app: cloud?.app ?? "", message: errorMessage(caught) });
    }
  }

  const state = phase.kind === "on" ? phase.state : null;
  const publicUrl = state?.tunnel.kind === "on" ? state.publicUrl : null;

  return (
    <SettingsField
      legend="Connect an app"
      description="One click and the app can search, read and write your notes. Private notes stay hidden."
    >
      <ul className="mt-3 flex flex-col gap-1">
        {MCP_CLIENTS.map((client) => {
          const connection =
            servers === undefined
              ? null
              : mcpClientConnection(servers, client.label);
          return (
            <AppRow
              key={client.id}
              brand={brandById(LOCAL_BRAND[client.id])}
              label={client.label}
              note={
                done === client.id ? RESTART_HINT[client.id] : "On this Mac"
              }
              error={error?.app === client.id ? error.message : null}
            >
              {connection === "connected" && busy !== client.id ? (
                <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
                  <Check aria-hidden className="size-3.5" />
                  Connected
                </span>
              ) : connection !== null ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void connectLocal(client.id)}
                >
                  {busy === client.id
                    ? "Connecting…"
                    : connection === "pinned"
                      ? "Update"
                      : "Connect"}
                </Button>
              ) : null}
            </AppRow>
          );
        })}
        {CLOUD_APPS.map((app) => (
          <AppRow
            key={app.id}
            brand={brandById(app.brand)}
            label={app.label}
            note="Over the internet, while Kore is open and this Mac is awake"
            error={error?.app === app.id ? error.message : null}
            details={
              cloud?.app === app.id ? (
                <CloudSteps
                  app={app}
                  url={publicUrl}
                  waiting={phase.kind === "starting" || phase.kind === "off"}
                  failure={
                    phase.kind === "error"
                      ? phase.message
                      : state !== null && publicUrl === null
                        ? "Kore is reachable only on this Mac. Set up Tailscale in Remote access below, then try again."
                        : null
                  }
                  copied={copied}
                  onCopy={(target, text) => void copy(target, text)}
                  keyValue={cloud.key}
                />
              ) : null
            }
          >
            <Button
              size="xs"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void connectCloud(app)}
            >
              {busy === app.id ? "Connecting…" : "Connect"}
            </Button>
          </AppRow>
        ))}
      </ul>
    </SettingsField>
  );
}

function AppRow({
  brand,
  label,
  note,
  error,
  details,
  children,
}: {
  brand: ProviderBrand | undefined;
  label: string;
  note: string;
  error: string | null;
  details?: ReactElement | null;
  children: ReactElement | null;
}): ReactElement {
  return (
    <li className="flex flex-col gap-2 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {brand !== undefined ? (
            <span className="flex size-8 flex-none items-center justify-center rounded-lg border border-border bg-surface-sunken text-text">
              <ProviderLogo brand={brand} className="size-4.5" />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-col">
            <span className="text-sm text-text">{label}</span>
            <span className="text-xs text-text-muted">{note}</span>
          </div>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
      {error !== null ? (
        <p
          className={cn(
            "text-xs text-destructive",
            brand !== undefined && "pl-11",
          )}
        >
          {error}
        </p>
      ) : null}
      {details !== undefined && details !== null ? (
        <div className={cn(brand !== undefined && "pl-11")}>{details}</div>
      ) : null}
    </li>
  );
}

function CloudSteps({
  app,
  url,
  waiting,
  failure,
  copied,
  onCopy,
  keyValue,
}: {
  app: (typeof CLOUD_APPS)[number];
  url: string | null;
  waiting: boolean;
  failure: string | null;
  copied: "url" | "key" | null;
  onCopy: (target: "url" | "key", text: string) => void;
  keyValue: string;
}): ReactElement {
  if (url === null) {
    return (
      <p className="rounded-md bg-surface-hover px-3 py-2 text-xs text-text-secondary">
        {failure ??
          (waiting
            ? "Turning on Remote access…"
            : "Waiting for Remote access…")}
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-2.5 rounded-md bg-surface-hover px-3 py-2.5 text-xs text-text-secondary">
      <Step n={1} text="Copy the address of your vault.">
        <Button size="xs" variant="outline" onClick={() => onCopy("url", url)}>
          {copied === "url" ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied === "url" ? "Copied" : "Copy address"}
        </Button>
      </Step>
      <Step n={2} text={app.where}>
        <Button
          size="xs"
          variant="outline"
          onClick={() => openUrlSync(app.openUrl)}
        >
          {app.openLabel}
        </Button>
      </Step>
      <Step
        n={3}
        text={`When Kore asks for a key, paste the one made for ${app.agentName}.`}
      >
        <Button
          size="xs"
          variant="outline"
          onClick={() => onCopy("key", keyValue)}
        >
          {copied === "key" ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied === "key" ? "Copied" : "Copy key"}
        </Button>
      </Step>
    </ol>
  );
}

function Step({
  n,
  text,
  children,
}: {
  n: number;
  text: string;
  children: ReactElement;
}): ReactElement {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 gap-2">
        <span className="text-text-muted tabular-nums">{n}.</span>
        <span>{text}</span>
      </span>
      <span className="shrink-0">{children}</span>
    </li>
  );
}
