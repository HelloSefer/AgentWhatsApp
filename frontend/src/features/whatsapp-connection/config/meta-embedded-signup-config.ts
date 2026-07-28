export type MetaEmbeddedSignupConfig = Readonly<{
  appId: string;
  configurationId: string;
  graphApiVersion: string;
}>;

export type MetaEmbeddedSignupConfigState =
  | Readonly<{ isConfigured: true; config: MetaEmbeddedSignupConfig }>
  | Readonly<{ isConfigured: false; missingKeys: readonly string[] }>;

const ENV_KEYS = {
  appId: "NEXT_PUBLIC_META_APP_ID",
  configurationId: "NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID",
  graphApiVersion: "NEXT_PUBLIC_META_GRAPH_API_VERSION",
} as const;

function publicValue(key: string): string {
  return (process.env[key] ?? "").trim();
}

export function getMetaEmbeddedSignupConfig(): MetaEmbeddedSignupConfigState {
  const appId = publicValue(ENV_KEYS.appId);
  const configurationId = publicValue(ENV_KEYS.configurationId);
  const graphApiVersion = publicValue(ENV_KEYS.graphApiVersion);
  const missingKeys: string[] = [];

  if (!appId) missingKeys.push(ENV_KEYS.appId);
  if (!configurationId) missingKeys.push(ENV_KEYS.configurationId);
  if (!graphApiVersion) missingKeys.push(ENV_KEYS.graphApiVersion);

  if (missingKeys.length > 0) return { isConfigured: false, missingKeys };
  return { isConfigured: true, config: { appId, configurationId, graphApiVersion } };
}
