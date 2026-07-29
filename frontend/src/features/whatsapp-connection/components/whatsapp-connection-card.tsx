"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, PlugZap, RefreshCw, ShieldAlert, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuthSession } from "@/features/auth/hooks/use-auth-session";
import { CustomerOwnedMetaAppWizard, whatsappConnectionQueryKey } from "./customer-owned-meta-app-wizard";
import { getMetaEmbeddedSignupConfig } from "../config/meta-embedded-signup-config";
import { useMetaEmbeddedSignup } from "../hooks/use-meta-embedded-signup";
import {
  httpEmbeddedSignupCompletionService,
  type CurrentWhatsAppConnection,
  type WhatsAppConnectionStatus,
} from "../services/embedded-signup-completion-service";
import { whatsappConnectionErrorMessage } from "../utils/whatsapp-connection-error-message";

type ConfirmationKind = "replace" | "disconnect" | null;
type WizardMode = "new" | "replace" | "resume" | null;

const STATUS_LABELS: Record<WhatsAppConnectionStatus, string> = {
  PENDING: "Setup pending",
  VERIFYING: "Verifying",
  ACTIVE: "Connected",
  REPLACEMENT_PENDING: "Replacement pending",
  ACTION_REQUIRED: "Action required",
  ERROR: "Needs retry",
  DISCONNECTED: "Disconnected",
  REVOKED: "Revoked",
};

function canManageWhatsApp(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

function formatDate(value: string | null): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusTone(status: WhatsAppConnectionStatus | null): "default" | "secondary" | "outline" | "destructive" {
  if (status === "ACTIVE") return "default";
  if (status === "ERROR" || status === "ACTION_REQUIRED" || status === "REVOKED") return "destructive";
  if (status === "DISCONNECTED" || status === null) return "outline";
  return "secondary";
}

function stateCopy(connection: CurrentWhatsAppConnection | null): { title: string; description: string } {
  if (!connection) {
    return {
      title: "No WhatsApp connection",
      description: "Choose a trusted setup method. AgentWhatsApp will use the number only after backend verification.",
    };
  }

  if (connection.status === "ACTIVE") {
    return {
      title: "WhatsApp is connected",
      description: "Outbound replies and incoming messages use this verified active connection.",
    };
  }

  if (connection.status === "REPLACEMENT_PENDING") {
    return {
      title: "Replacement setup is in progress",
      description: "The current number remains active until the replacement is fully verified by the backend.",
    };
  }

  if (connection.status === "PENDING" || connection.status === "VERIFYING") {
    return {
      title: "Setup is in progress",
      description: "Refresh this page after backend verification completes. A duplicate connection launch is disabled while setup is active.",
    };
  }

  if (connection.status === "ERROR" || connection.status === "ACTION_REQUIRED") {
    return {
      title: "Connection needs attention",
      description: "Review the guided setup. Detailed Meta errors are kept out of the dashboard.",
    };
  }

  return {
    title: connection.status === "REVOKED" ? "Connection was revoked" : "Connection is disconnected",
    description: "Connect again with a fresh verification flow when you are ready.",
  };
}

function connectionDetails(connection: CurrentWhatsAppConnection): Array<{ label: string; value: string }> {
  return [
    { label: "Phone", value: connection.maskedPhoneNumber ?? "Not available" },
    { label: "Business name", value: connection.verifiedName ?? "Not available" },
    { label: "Connection method", value: connection.connectionMethod === "CUSTOMER_OWNED_META_APP" ? "Your Meta App" : "Meta Embedded Signup" },
    { label: "Health", value: connection.health ?? (connection.status === "ACTIVE" ? "Healthy" : "Not available") },
    { label: "Connected", value: formatDate(connection.connectedAt) },
    { label: "Last verified", value: formatDate(connection.lastVerifiedAt) },
    ...(connection.disconnectedAt ? [{ label: "Disconnected", value: formatDate(connection.disconnectedAt) }] : []),
  ];
}

export function WhatsappConnectionCard() {
  const queryClient = useQueryClient();
  const { memberships } = useAuthSession();
  const currentRole = memberships[0]?.role;
  const hasManagePermission = canManageWhatsApp(currentRole);
  const configState = getMetaEmbeddedSignupConfig();
  const [confirmation, setConfirmation] = useState<ConfirmationKind>(null);
  const [wizardMode, setWizardMode] = useState<WizardMode>(null);

  const currentQuery = useQuery({
    queryKey: whatsappConnectionQueryKey,
    queryFn: () => httpEmbeddedSignupCompletionService.loadCurrent(),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const refreshCurrent = async () => {
    await queryClient.invalidateQueries({ queryKey: whatsappConnectionQueryKey });
  };

  const signup = useMetaEmbeddedSignup({
    configState,
    onCompleted: refreshCurrent,
  });

  const disconnectMutation = useMutation({
    mutationFn: (connectionId: string) => httpEmbeddedSignupCompletionService.disconnect(connectionId),
    onSuccess: async () => {
      setConfirmation(null);
      await refreshCurrent();
      toast.success("WhatsApp connection disconnected.");
    },
    onError: (error) => {
      toast.error(whatsappConnectionErrorMessage(error));
    },
  });

  const connection = currentQuery.data?.connection ?? null;
  const safeActiveConnection = connection?.activeConnection ?? (connection?.status === "ACTIVE" ? connection : null);
  const safePendingConnection = connection?.pendingConnection ?? (connection?.status === "REPLACEMENT_PENDING" ? connection : null);
  const copy = stateCopy(connection);
  const isLoading = currentQuery.isLoading || (currentQuery.isFetching && !currentQuery.data);
  const isSetupInProgress = connection?.status === "PENDING" || connection?.status === "VERIFYING" || connection?.status === "REPLACEMENT_PENDING";
  const canLaunch = hasManagePermission && !isSetupInProgress && signup.canLaunch && !disconnectMutation.isPending && wizardMode === null;
  const canReplace = hasManagePermission && connection?.status === "ACTIVE" && !disconnectMutation.isPending && !signup.isBusy && wizardMode === null;
  const canDisconnect = hasManagePermission && connection?.status === "ACTIVE" && !signup.isBusy && !disconnectMutation.isPending;
  const hasResumableCustomerOwnedSetup =
    connection?.connectionMethod === "CUSTOMER_OWNED_META_APP" &&
    (connection.status === "PENDING" || connection.status === "VERIFYING" || connection.status === "ACTION_REQUIRED" || connection.status === "ERROR");
  const canResumeCustomerOwnedSetup = hasManagePermission && hasResumableCustomerOwnedSetup;
  const showConnect =
    (!connection || connection.status === "DISCONNECTED" || connection.status === "REVOKED" || connection.status === "ERROR") &&
    !hasResumableCustomerOwnedSetup;
  const canStartGuidedSetup =
    hasManagePermission &&
    !hasResumableCustomerOwnedSetup &&
    !disconnectMutation.isPending &&
    !signup.isBusy &&
    wizardMode === null;

  const statusMessage = useMemo(() => {
    if (signup.isBusy || signup.message) return signup.message;
    if (currentQuery.error) return "Connection status could not be loaded.";
    if (!hasManagePermission) return "You can view this connection, but only workspace owners and admins can manage it.";
    return null;
  }, [currentQuery.error, hasManagePermission, signup.isBusy, signup.message]);

  const launchSignup = () => {
    if (!canLaunch) return;
    void signup.launch();
  };

  const confirmReplace = () => {
    setConfirmation(null);
    setWizardMode("replace");
  };

  const confirmDisconnect = () => {
    if (!connection || connection.status !== "ACTIVE") return;
    disconnectMutation.mutate(connection.connectionId);
  };

  if (wizardMode) {
    return (
      <section aria-labelledby="whatsapp-guided-setup-heading" className="mx-auto w-full max-w-[1120px]">
        <CustomerOwnedMetaAppWizard
          initialConnection={wizardMode === "replace" ? safePendingConnection : connection}
          mode={wizardMode}
          onCancel={() => setWizardMode(null)}
          onDone={async () => {
            setWizardMode(null);
            await refreshCurrent();
          }}
          selectedPhoneFromStatus={connection ? { maskedPhoneNumber: connection.maskedPhoneNumber, verifiedName: connection.verifiedName } : null}
        />
      </section>
    );
  }

  return (
    <div className="space-y-5">
    <Card className="rounded-lg border-marketing-border bg-marketing-surface shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.35)]">
      <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Settings / WhatsApp</p>
          <CardTitle className="mt-2 text-2xl font-semibold text-foreground">Connection status</CardTitle>
          <CardDescription className="mt-2 max-w-2xl leading-6">
            Manage the WhatsApp Business number used by AgentWhatsApp. Connection state is always loaded from the backend.
          </CardDescription>
        </div>
        <div aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-marketing-subtle text-marketing-primary ring-1 ring-marketing-border">
          <MessageCircle className="size-5" />
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="rounded-lg border border-marketing-border bg-marketing-canvas p-4">
          {isLoading ? (
            <div className="flex min-h-28 items-center gap-3" role="status">
              <Loader2 aria-hidden="true" className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
              <p className="text-sm text-muted-foreground">Loading WhatsApp connection status.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {connection?.status === "ACTIVE" ? (
                      <CheckCircle2 aria-hidden="true" className="size-5 text-marketing-primary" />
                    ) : connection?.status === "ERROR" || connection?.status === "ACTION_REQUIRED" || connection?.status === "REVOKED" ? (
                      <ShieldAlert aria-hidden="true" className="size-5 text-destructive" />
                    ) : (
                      <PlugZap aria-hidden="true" className="size-5 text-muted-foreground" />
                    )}
                    <p className="font-semibold text-foreground">{copy.title}</p>
                    <Badge variant={statusTone(connection?.status ?? null)}>{connection ? STATUS_LABELS[connection.status] : "Not connected"}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.description}</p>
                </div>
                <Button className="min-h-11 w-full sm:w-auto" onClick={() => void refreshCurrent()} type="button" variant="outline">
                  <RefreshCw aria-hidden="true" />
                  Refresh
                </Button>
              </div>

              {connection ? (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {connectionDetails(connection).map((item) => (
                    <div className="min-w-0 rounded-lg border border-marketing-border bg-background px-3 py-2.5" key={item.label}>
                      <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
                      <dd className="mt-1 break-words font-semibold text-foreground">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {connection?.status === "REPLACEMENT_PENDING" && safeActiveConnection ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm leading-6 text-emerald-950">
                  Current active number {safeActiveConnection.maskedPhoneNumber ?? "not available"} remains operational while the replacement is prepared.
                </div>
              ) : null}
            </div>
          )}
        </div>

        {statusMessage ? (
          <p className="rounded-lg border border-marketing-border bg-background px-3 py-2.5 text-sm leading-6 text-muted-foreground" role={currentQuery.error ? "alert" : "status"}>
            {statusMessage}
          </p>
        ) : null}

        {canResumeCustomerOwnedSetup && wizardMode === null ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="font-semibold text-emerald-950">{connection.status === "VERIFYING" ? "Connection is ready to continue" : "Setup in progress"}</p>
            <p className="mt-1 text-sm leading-6 text-emerald-950/80">
              Credentials already accepted by the backend stay stored securely there. Continue without entering secrets again unless Meta access needs to be refreshed.
            </p>
            <Button className="mt-3 min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto" onClick={() => setWizardMode("resume")} type="button">
              {connection.status === "VERIFYING" ? "Continue connection" : "Resume setup"}
            </Button>
          </div>
        ) : null}

        {showConnect && wizardMode === null ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-[0_12px_28px_-26px_oklch(0.25_0.04_155/0.45)]">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-foreground">Connect your own Meta App</p>
                <Badge className="bg-emerald-600 text-white">Recommended</Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Connect using a Meta App owned by your business.</p>
              <p className="mt-1 text-xs font-medium text-muted-foreground">About 10-15 minutes</p>
              <Button
                className="mt-4 min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={!canStartGuidedSetup}
                onClick={() => setWizardMode("new")}
                type="button"
              >
                Start guided setup
              </Button>
            </div>

            <div className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-foreground">Quick connection with Meta</p>
                <Badge variant={configState.isConfigured ? "secondary" : "outline"}>{configState.isConfigured ? "Supported" : "Coming soon"}</Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {configState.isConfigured
                  ? "Use Meta Embedded Signup when it is available for your workspace."
                  : "Quick connection - Coming soon while platform approval is completed."}
              </p>
              <Button aria-busy={signup.isBusy} className="mt-4 min-h-11 w-full" disabled={!canLaunch} onClick={launchSignup} type="button" variant="outline">
                {signup.isBusy ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <PlugZap aria-hidden="true" />}
                {configState.isConfigured ? "Use quick connection" : "Quick connection - Coming soon"}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {connection?.status === "ACTIVE" ? (
            <>
              <Button className="min-h-11 w-full sm:w-auto" disabled={!canReplace} onClick={() => setConfirmation("replace")} type="button" variant="outline">
                <PlugZap aria-hidden="true" />
                Replace connection
              </Button>
              <Button className="min-h-11 w-full sm:w-auto" disabled={!canDisconnect} onClick={() => setConfirmation("disconnect")} type="button" variant="destructive">
                {disconnectMutation.isPending ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Unplug aria-hidden="true" />}
                Disconnect
              </Button>
            </>
          ) : null}
        </div>

        <Dialog open={confirmation === "replace"} onOpenChange={(open) => setConfirmation(open ? "replace" : null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Replace WhatsApp number?</DialogTitle>
              <DialogDescription>
                Your current WhatsApp connection will stay active until the new connection is completely ready.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button className="min-h-11" type="button" variant="outline" />}>Cancel</DialogClose>
              <Button className="min-h-11" disabled={!canReplace} onClick={confirmReplace} type="button">
                Start guided setup
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={confirmation === "disconnect"} onOpenChange={(open) => setConfirmation(open ? "disconnect" : null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Disconnect WhatsApp?</DialogTitle>
              <DialogDescription>
                AgentWhatsApp will stop using this connection for new inbound or outbound runtime resolution. Existing conversations, orders, and history remain available.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-6 text-foreground">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p>Reconnect later through a fresh verification flow.</p>
            </div>
            <DialogFooter>
              <DialogClose render={<Button className="min-h-11" type="button" variant="outline" />}>Cancel</DialogClose>
              <Button className="min-h-11" disabled={!canDisconnect} onClick={confirmDisconnect} type="button" variant="destructive">
                {disconnectMutation.isPending ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Unplug aria-hidden="true" />}
                Disconnect
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>

    </div>
  );
}
