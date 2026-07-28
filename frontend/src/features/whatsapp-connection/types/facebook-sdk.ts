export type FacebookLoginResponse = Readonly<{
  status?: "connected" | "not_authorized" | "unknown" | string;
  authResponse?: Readonly<{
    code?: string;
  }> | null;
}>;

export type FacebookLoginOptions = Readonly<{
  config_id: string;
  response_type: "code";
  override_default_response_type: true;
  extras: Readonly<{
    setup: Record<string, never>;
  }>;
}>;

export type FacebookInitOptions = Readonly<{
  appId: string;
  version: string;
  xfbml?: boolean;
}>;

export type FacebookSdk = Readonly<{
  init(options: FacebookInitOptions): void;
  login(callback: (response: FacebookLoginResponse) => void, options: FacebookLoginOptions): void;
}>;

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}
