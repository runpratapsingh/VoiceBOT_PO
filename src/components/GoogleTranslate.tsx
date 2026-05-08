"use client";

import { color } from "framer-motion";
import Script from "next/script";

declare global {
  interface Window {
    googleTranslateElementInit?: () => void;
    google?: {
      translate?: {
        TranslateElement: new (
          options: {
            pageLanguage: string;
            autoDisplay?: boolean;
            layout?: unknown;
          },
          element: string,
        ) => void;
      };
    };
  }
}

export default function GoogleTranslate() {
  return (
    <div className="google-translate-shell skiptranslate" translate="no">
      <span className="google-translate-label" >
        Translate
      </span>
      <div id="google_translate_element" />

      <Script id="google-translate-init" strategy="afterInteractive">
        {`
          window.googleTranslateElementInit = function () {
            if (!window.google || !window.google.translate) return;
            new window.google.translate.TranslateElement(
              {
                pageLanguage: 'en',
                autoDisplay: false
              },
              'google_translate_element'
            );
          };
        `}
      </Script>
      <Script
        src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"
        strategy="afterInteractive"
      />
    </div>
  );
}
