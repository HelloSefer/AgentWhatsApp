import type { FacebookSdk } from "../types/facebook-sdk";

const FACEBOOK_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
const FACEBOOK_SDK_SCRIPT_ID = "facebook-jssdk";

type LoadFacebookSdkInput = Readonly<{
  appId: string;
  graphApiVersion: string;
  documentRef?: Document;
  windowRef?: Window;
}>;

let sdkPromise: Promise<FacebookSdk> | null = null;
let initializedKey: string | null = null;

function initializeSdk(fb: FacebookSdk, appId: string, graphApiVersion: string): FacebookSdk {
  const key = `${appId}:${graphApiVersion}`;
  if (initializedKey !== key) {
    fb.init({ appId, version: graphApiVersion, xfbml: false });
    initializedKey = key;
  }
  return fb;
}

export function resetFacebookSdkLoaderForTests() {
  sdkPromise = null;
  initializedKey = null;
}

export function loadFacebookSdk({ appId, graphApiVersion, documentRef, windowRef }: LoadFacebookSdkInput): Promise<FacebookSdk> {
  if (typeof window === "undefined" && !windowRef) {
    return Promise.reject(new Error("Facebook SDK can only load in the browser."));
  }

  const browserWindow = windowRef ?? window;
  const browserDocument = documentRef ?? browserWindow.document;
  const existingSdk = browserWindow.FB;

  if (existingSdk) {
    return Promise.resolve(initializeSdk(existingSdk, appId, graphApiVersion));
  }

  if (sdkPromise) return sdkPromise.then((fb) => initializeSdk(fb, appId, graphApiVersion));

  sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    const previousAsyncInit = browserWindow.fbAsyncInit;

    browserWindow.fbAsyncInit = () => {
      previousAsyncInit?.();
      if (!browserWindow.FB) {
        reject(new Error("Facebook SDK did not initialize."));
        return;
      }
      resolve(initializeSdk(browserWindow.FB, appId, graphApiVersion));
    };

    const existingScript = browserDocument.getElementById(FACEBOOK_SDK_SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("error", () => reject(new Error("Facebook SDK failed to load.")), { once: true });
      return;
    }

    const script = browserDocument.createElement("script");
    script.id = FACEBOOK_SDK_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = FACEBOOK_SDK_SRC;
    script.onerror = () => reject(new Error("Facebook SDK failed to load."));

    const firstScript = browserDocument.getElementsByTagName("script")[0];
    firstScript?.parentNode?.insertBefore(script, firstScript);
    if (!firstScript) browserDocument.body.appendChild(script);
  }).catch((error: unknown) => {
    sdkPromise = null;
    throw error;
  });

  return sdkPromise;
}
