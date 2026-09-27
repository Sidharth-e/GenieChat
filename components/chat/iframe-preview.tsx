"use client";

import * as React from "react";

interface IframePreviewProps {
  code: string;
  className?: string;
}

/**
 * Self-contained React preview component that uses @babel/standalone
 * for client-side JSX transpilation and renders inside an iframe.
 * No external bundler CDN dependency — everything runs locally.
 */
export function IframePreview({ code, className }: IframePreviewProps) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  const processedCode = React.useMemo(() => {
    if (code.includes("export default")) {
      return code;
    }
    const componentName = extractComponentName(code) || "Component";
    return `${code}

export default function App() {
  return (
    <div className="w-full min-h-screen">
      <${componentName} />
    </div>
  );
}`;
  }, [code]);

  const srcdoc = React.useMemo(
    () => buildSrcdoc(processedCode),
    [processedCode],
  );

  React.useEffect(() => {
    setError(null);

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "preview-error") {
        setError(event.data.message);
      }
      if (event.data?.type === "preview-ready") {
        setError(null);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [processedCode]);

  return (
    <div className={`relative w-full h-full ${className ?? ""}`}>
      {error && (
        <div className="absolute inset-0 z-10 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 overflow-auto">
          <p className="font-semibold mb-2">Render Error</p>
          <pre className="text-xs whitespace-pre-wrap">{error}</pre>
        </div>
      )}
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc}
        sandbox="allow-scripts allow-popups"
        className="w-full h-full border-0 bg-white rounded-xl"
        title="React Preview"
      />
    </div>
  );
}

function extractComponentName(code: string): string | null {
  const funcMatch = code.match(/function\s+([A-Z][a-zA-Z0-9]*)\s*\(/);
  if (funcMatch) return funcMatch[1];

  const constMatch = code.match(/const\s+([A-Z][a-zA-Z0-9]*)\s*=/);
  if (constMatch) return constMatch[1];

  return null;
}

function buildSrcdoc(code: string): string {
  // Escape the code for safe embedding inside a script tag
  const escapedCode = code
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>
    html, body, #root {
      margin: 0;
      padding: 0;
      height: 100%;
      background-color: white;
    }

    ::-webkit-scrollbar {
      width: 10px;
      height: 10px;
      background: transparent;
    }
    ::-webkit-scrollbar-corner { background: transparent; }
    ::-webkit-scrollbar-track { background: transparent; border: none; }
    ::-webkit-scrollbar-thumb {
      background: rgba(120, 120, 120, 0.4);
      border: 3px solid transparent;
      background-clip: content-box;
      border-radius: 99px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(120, 120, 120, 0.6);
      border: 3px solid transparent;
      background-clip: content-box;
      border-radius: 99px;
    }
  </style>

  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@19.2.4?dev",
      "react/jsx-runtime": "https://esm.sh/react@19.2.4/jsx-runtime?dev",
      "react/jsx-dev-runtime": "https://esm.sh/react@19.2.4/jsx-dev-runtime?dev",
      "react-dom": "https://esm.sh/react-dom@19.2.4?dev",
      "react-dom/client": "https://esm.sh/react-dom@19.2.4/client?dev",
      "lucide-react": "https://esm.sh/lucide-react@0.577.0?external=react",
      "recharts": "https://esm.sh/recharts@3.8.0?external=react,react-dom",
      "framer-motion": "https://esm.sh/framer-motion@12.37.0?external=react,react-dom"
    }
  }
  <\/script>
</head>
<body>
  <div id="root"></div>

  <script src="https://unpkg.com/@babel/standalone@7/babel.min.js"><\/script>

  <script type="module">
    const userCode = \`${escapedCode}\`;

    try {
      const transformed = Babel.transform(userCode, {
        presets: [
          ["env", { modules: false }],
          ["react", { runtime: "automatic" }],
          ["typescript", { isTSX: true, allExtensions: true }]
        ],
        filename: "App.tsx",
      });

      const moduleBlob = new Blob(
        [transformed.code],
        { type: "text/javascript" }
      );
      const moduleUrl = URL.createObjectURL(moduleBlob);

      const mod = await import(moduleUrl);
      URL.revokeObjectURL(moduleUrl);

      const AppComponent = mod.default;
      if (!AppComponent) {
        throw new Error("No default export found. Make sure your component has an 'export default'.");
      }

      const React = await import("react");
      const ReactDOM = await import("react-dom/client");

      const root = ReactDOM.createRoot(document.getElementById("root"));
      root.render(React.createElement(AppComponent));

      window.parent.postMessage({ type: "preview-ready" }, "*");
    } catch (err) {
      const msg = err?.message || String(err);
      document.getElementById("root").innerHTML =
        '<div style="padding:24px;color:#f87171;font-family:monospace;font-size:13px;white-space:pre-wrap">' +
        '<b>Error</b>\\n' + msg.replace(/</g, "&lt;") + '</div>';
      window.parent.postMessage({ type: "preview-error", message: msg }, "*");
    }
  <\/script>
</body>
</html>`;
}
