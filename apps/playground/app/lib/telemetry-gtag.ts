/**
 * gtag wiring for the telemetry seam (PRD #767). The inline gtag loader was
 * removed from index.html; this module injects the script unless the
 * visitor opts out in settings, and forwards recorded events through the
 * TelemetryService forwarder hook (which itself gates on consent).
 *
 * G-PROD-ID is the build-time placeholder the production build rewrites,
 * same as the removed inline script.
 */
import { telemetry } from '@/services/telemetry';

const GTAG_ID = 'G-PROD-ID';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let injected = false;

function injectGtag(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;

  window.dataLayer = window.dataLayer ?? [];
  // ponytail: gtag.js requires an Arguments object (Pb check). Pushing a JS Array drops events silently.
  window.gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GTAG_ID}`;
  document.head.appendChild(script);

  window.gtag('js', new Date());
  window.gtag('config', GTAG_ID);
}

// External sink: record() gates on consent; gtag presence guards the sink.
telemetry.setForwarder((event) => {
  window.gtag?.('event', event.name, event.payload ?? {});
});

if (telemetry.consent) {
  injectGtag();
} else {
  telemetry.subscribeConsent((granted) => {
    if (granted) injectGtag();
  });
}
