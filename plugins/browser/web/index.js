var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/elowen-plugin-ui-kit/shims/react.cjs
var require_react = __commonJS({
  "node_modules/elowen-plugin-ui-kit/shims/react.cjs"(exports, module) {
    var runtime2 = typeof window !== "undefined" ? window.ElowenUiRuntime : void 0;
    if (!runtime2) throw new Error("elowen-plugin-ui-kit: window.ElowenUiRuntime is missing \u2014 plugin bundles only run inside the Elowen web app");
    module.exports = runtime2.react;
  }
});

// node_modules/elowen-plugin-ui-kit/shims/jsx-runtime.cjs
var require_jsx_runtime = __commonJS({
  "node_modules/elowen-plugin-ui-kit/shims/jsx-runtime.cjs"(exports, module) {
    var runtime2 = typeof window !== "undefined" ? window.ElowenUiRuntime : void 0;
    if (!runtime2) throw new Error("elowen-plugin-ui-kit: window.ElowenUiRuntime is missing \u2014 plugin bundles only run inside the Elowen web app");
    module.exports = runtime2.jsxRuntime;
  }
});

// node_modules/elowen-plugin-ui-kit/shims/react-dom.cjs
var require_react_dom = __commonJS({
  "node_modules/elowen-plugin-ui-kit/shims/react-dom.cjs"(exports, module) {
    var runtime2 = typeof window !== "undefined" ? window.ElowenUiRuntime : void 0;
    if (!runtime2) throw new Error("elowen-plugin-ui-kit: window.ElowenUiRuntime is missing \u2014 plugin bundles only run inside the Elowen web app");
    module.exports = runtime2.reactDom;
  }
});

// plugins/browser/web-src/BrowserAccount.tsx
var import_react3 = __toESM(require_react(), 1);

// node_modules/lucide-react/dist/esm/createLucideIcon.js
var import_react2 = __toESM(require_react());

// node_modules/lucide-react/dist/esm/shared/src/utils.js
var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
var mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();

// node_modules/lucide-react/dist/esm/Icon.js
var import_react = __toESM(require_react());

// node_modules/lucide-react/dist/esm/defaultAttributes.js
var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};

// node_modules/lucide-react/dist/esm/Icon.js
var Icon = (0, import_react.forwardRef)(
  ({
    color = "currentColor",
    size = 24,
    strokeWidth = 2,
    absoluteStrokeWidth,
    className = "",
    children,
    iconNode,
    ...rest
  }, ref) => {
    return (0, import_react.createElement)(
      "svg",
      {
        ref,
        ...defaultAttributes,
        width: size,
        height: size,
        stroke: color,
        strokeWidth: absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
        className: mergeClasses("lucide", className),
        ...rest
      },
      [
        ...iconNode.map(([tag, attrs]) => (0, import_react.createElement)(tag, attrs)),
        ...Array.isArray(children) ? children : [children]
      ]
    );
  }
);

// node_modules/lucide-react/dist/esm/createLucideIcon.js
var createLucideIcon = (iconName, iconNode) => {
  const Component = (0, import_react2.forwardRef)(
    ({ className, ...props }, ref) => (0, import_react2.createElement)(Icon, {
      ref,
      iconNode,
      className: mergeClasses(`lucide-${toKebabCase(iconName)}`, className),
      ...props
    })
  );
  Component.displayName = `${iconName}`;
  return Component;
};

// node_modules/lucide-react/dist/esm/icons/activity.js
var Activity = createLucideIcon("Activity", [
  [
    "path",
    {
      d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
      key: "169zse"
    }
  ]
]);

// node_modules/lucide-react/dist/esm/icons/arrow-left.js
var ArrowLeft = createLucideIcon("ArrowLeft", [
  ["path", { d: "m12 19-7-7 7-7", key: "1l729n" }],
  ["path", { d: "M19 12H5", key: "x3x0zl" }]
]);

// node_modules/lucide-react/dist/esm/icons/arrow-right.js
var ArrowRight = createLucideIcon("ArrowRight", [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "m12 5 7 7-7 7", key: "xquz4c" }]
]);

// node_modules/lucide-react/dist/esm/icons/database.js
var Database = createLucideIcon("Database", [
  ["ellipse", { cx: "12", cy: "5", rx: "9", ry: "3", key: "msslwz" }],
  ["path", { d: "M3 5V19A9 3 0 0 0 21 19V5", key: "1wlel7" }],
  ["path", { d: "M3 12A9 3 0 0 0 21 12", key: "mv7ke4" }]
]);

// node_modules/lucide-react/dist/esm/icons/earth.js
var Earth = createLucideIcon("Earth", [
  ["path", { d: "M21.54 15H17a2 2 0 0 0-2 2v4.54", key: "1djwo0" }],
  [
    "path",
    {
      d: "M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17",
      key: "1tzkfa"
    }
  ],
  ["path", { d: "M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05", key: "14pb5j" }],
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }]
]);

// node_modules/lucide-react/dist/esm/icons/expand.js
var Expand = createLucideIcon("Expand", [
  ["path", { d: "m21 21-6-6m6 6v-4.8m0 4.8h-4.8", key: "1c15vz" }],
  ["path", { d: "M3 16.2V21m0 0h4.8M3 21l6-6", key: "1fsnz2" }],
  ["path", { d: "M21 7.8V3m0 0h-4.8M21 3l-6 6", key: "hawz9i" }],
  ["path", { d: "M3 7.8V3m0 0h4.8M3 3l6 6", key: "u9ee12" }]
]);

// node_modules/lucide-react/dist/esm/icons/gauge.js
var Gauge = createLucideIcon("Gauge", [
  ["path", { d: "m12 14 4-4", key: "9kzdfg" }],
  ["path", { d: "M3.34 19a10 10 0 1 1 17.32 0", key: "19p75a" }]
]);

// node_modules/lucide-react/dist/esm/icons/hand.js
var Hand = createLucideIcon("Hand", [
  ["path", { d: "M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2", key: "1fvzgz" }],
  ["path", { d: "M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2", key: "1kc0my" }],
  ["path", { d: "M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8", key: "10h0bg" }],
  [
    "path",
    {
      d: "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
      key: "1s1gnw"
    }
  ]
]);

// node_modules/lucide-react/dist/esm/icons/monitor.js
var Monitor = createLucideIcon("Monitor", [
  ["rect", { width: "20", height: "14", x: "2", y: "3", rx: "2", key: "48i651" }],
  ["line", { x1: "8", x2: "16", y1: "21", y2: "21", key: "1svkeh" }],
  ["line", { x1: "12", x2: "12", y1: "17", y2: "21", key: "vw1qmm" }]
]);

// node_modules/lucide-react/dist/esm/icons/power.js
var Power = createLucideIcon("Power", [
  ["path", { d: "M12 2v10", key: "mnfbl" }],
  ["path", { d: "M18.4 6.6a9 9 0 1 1-12.77.04", key: "obofu9" }]
]);

// node_modules/lucide-react/dist/esm/icons/rotate-cw.js
var RotateCw = createLucideIcon("RotateCw", [
  ["path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", key: "1p45f6" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }]
]);

// node_modules/lucide-react/dist/esm/icons/shield-check.js
var ShieldCheck = createLucideIcon("ShieldCheck", [
  [
    "path",
    {
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      key: "oel41y"
    }
  ],
  ["path", { d: "m9 12 2 2 4-4", key: "dzmm74" }]
]);

// node_modules/lucide-react/dist/esm/icons/trash-2.js
var Trash2 = createLucideIcon("Trash2", [
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", key: "4alrt4" }],
  ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", key: "v07s0e" }],
  ["line", { x1: "10", x2: "10", y1: "11", y2: "17", key: "1uufr5" }],
  ["line", { x1: "14", x2: "14", y1: "11", y2: "17", key: "xtxkd" }]
]);

// node_modules/lucide-react/dist/esm/icons/x.js
var X = createLucideIcon("X", [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
]);

// plugins/browser/web-src/runtime.ts
function runtime() {
  const value = window.ElowenUiRuntime;
  if (!value) throw new Error("ElowenUiRuntime is not installed");
  return value;
}
function registerBrowserUi(artifact, settings, account) {
  window.__elowenRegisterPluginUi?.("browser", {
    requiresApiVersion: 14,
    chatArtifacts: { "browser-session": artifact },
    settings: { runtime: settings },
    account: { profile: account }
  });
}
function jsonRequest(method, value) {
  return {
    method,
    headers: value === void 0 ? void 0 : { "content-type": "application/json" },
    body: value === void 0 ? void 0 : JSON.stringify(value)
  };
}
var apiError = (error) => runtime().utils.apiErrorMessage(error) || "Browser operation failed.";

// plugins/browser/web-src/BrowserAccount.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var bytes = (value) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
};
function BrowserAccount({ surface }) {
  const host = runtime();
  const { PluginPageHeader, DetailBlock, Badge, Button, ConfirmDialog, LoadingState, ErrorState, EmptyState } = host.components;
  const strings = host.hooks.usePluginStrings("browser");
  const toast = host.hooks.useToast();
  const client = host.hooks.useQueryClient();
  const [confirmClear, setConfirmClear] = (0, import_react3.useState)(false);
  const profile = runtime().hooks.useQuery({ queryKey: ["browser", "profile"], queryFn: () => runtime().api("/plugins/browser/api/profile") });
  const sessions = runtime().hooks.useQuery({ queryKey: ["browser", "sessions"], queryFn: () => runtime().api("/plugins/browser/api/sessions"), refetchInterval: 5e3 });
  const clear = runtime().hooks.useMutation({
    mutationFn: () => runtime().api("/plugins/browser/api/profile", jsonRequest("DELETE")),
    onSuccess: async () => {
      setConfirmClear(false);
      await client.invalidateQueries({ queryKey: ["browser"] });
      toast.toast(strings.profileCleared || "Browser data cleared.", "ok");
    },
    onError: (error2) => toast.toast(apiError(error2), "error")
  });
  const close = runtime().hooks.useMutation({
    mutationFn: (sessionId) => runtime().api(`/plugins/browser/api/close?sessionId=${encodeURIComponent(sessionId)}`, jsonRequest("POST")),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["browser"] });
    },
    onError: (error2) => toast.toast(apiError(error2), "error")
  });
  const loading = profile.isLoading || sessions.isLoading;
  const error = profile.isError ? profile.error : sessions.isError ? sessions.error : null;
  const live = sessions.data?.live ?? [];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "space-y-4", children: [
    surface === "page" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PluginPageHeader, { title: strings.accountTitle || "Browser profile", description: strings.accountDescription || "Your private Chrome profile keeps browser sign-ins between sessions on this Elowen instance.", icon: Earth }) : null,
    loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoadingState, { variant: "block", height: "12rem" }) : error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ErrorState, { message: apiError(error), onRetry: () => {
      void profile.refetch();
      void sessions.refetch();
    } }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "grid gap-3 md:grid-cols-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DetailBlock, { icon: Database, title: strings.profileStorage || "Stored browser data", hint: strings.profileStorageHint || "Cookies and sign-in state live only in your account profile. Live images are never stored.", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { tone: "muted", children: bytes(profile.data?.profileBytes ?? 0) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Badge, { tone: live.length ? "accent" : "muted", children: [
              live.length,
              " ",
              strings.activeSessions || "active sessions"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mt-3", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "ghost-danger", icon: Trash2, onClick: () => setConfirmClear(true), disabled: live.length > 0 || clear.isPending, children: strings.clearProfile || "Clear browser data" }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DetailBlock, { icon: Earth, title: strings.liveSessions || "Live sessions", hint: strings.liveSessionsHint || "Closing a tab session does not erase your saved browser profile.", children: live.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, { title: strings.noSessions || "No browser session is running", description: strings.noSessionsDescription || "A session appears here when your agent opens the browser.", icon: Earth }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "space-y-2", children: live.map((session) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "min-w-0", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "truncate font-mono text-xs text-foreground", children: [
              session.id.slice(0, 12),
              "\u2026"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "text-xs text-muted-foreground", children: session.state === "user" ? strings.userControl || "User control" : strings.agentControl || "Agent control" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "ghost-danger", icon: X, onClick: () => close.mutate(session.id), disabled: close.isPending, children: strings.closeSession || "Close" })
        ] }, session.id)) }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ConfirmDialog,
        {
          open: confirmClear,
          title: strings.clearConfirmTitle || "Clear your browser data?",
          description: strings.clearConfirmDescription || "Stored cookies, sign-ins and site data will be permanently removed. This cannot be undone.",
          confirmLabel: strings.clearProfile || "Clear browser data",
          confirmVariant: "danger",
          pending: clear.isPending,
          onConfirm: () => clear.mutate(),
          onClose: () => setConfirmClear(false)
        }
      )
    ] })
  ] });
}

// plugins/browser/web-src/BrowserArtifact.tsx
var import_react5 = __toESM(require_react(), 1);
var import_react_dom = __toESM(require_react_dom(), 1);

// plugins/browser/web-src/useBrowserStream.ts
var import_react4 = __toESM(require_react(), 1);
var initialState = {
  frame: null,
  cursor: null,
  control: { state: "agent" },
  action: null,
  connected: false,
  closed: false,
  error: null
};
function parseSse(buffer) {
  const frames = [];
  let index;
  while ((index = buffer.indexOf("\n\n")) >= 0) {
    const block = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += `${data ? "\n" : ""}${line.slice(5).replace(/^ /, "")}`;
    }
    if (data) frames.push({ event, data });
  }
  return { frames, rest: buffer };
}
var object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
function useBrowserStream(path) {
  const [state, setState] = (0, import_react4.useState)(initialState);
  const generation = (0, import_react4.useRef)(0);
  (0, import_react4.useEffect)(() => {
    if (!path) return;
    const current = ++generation.current;
    const controller = new AbortController();
    let retry = 500;
    let terminal = false;
    const apply = (frame) => {
      let raw;
      try {
        raw = JSON.parse(frame.data);
      } catch {
        return;
      }
      const data = object(raw);
      if (!data) return;
      if (frame.event === "frame" && typeof data.data === "string") {
        setState((value) => ({
          ...value,
          frame: {
            data: data.data,
            mimeType: typeof data.mimeType === "string" ? data.mimeType : "image/jpeg",
            width: typeof data.width === "number" ? data.width : 1280,
            height: typeof data.height === "number" ? data.height : 800,
            timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now()
          },
          connected: true,
          error: null
        }));
        return;
      }
      if (frame.event === "cursor" && data.cleared === true) {
        setState((value) => ({ ...value, cursor: null }));
        return;
      }
      if (frame.event === "cursor" && typeof data.x === "number" && typeof data.y === "number") {
        setState((value) => ({ ...value, cursor: { x: data.x, y: data.y, moving: data.moving === true } }));
        return;
      }
      if (frame.event === "action") {
        const action = typeof data.action === "string" ? { kind: data.action, ...typeof data.target === "string" ? { target: data.target } : {} } : null;
        const at = typeof data.x === "number" && typeof data.y === "number" ? { x: data.x, y: data.y } : null;
        setState((value) => ({
          ...value,
          action,
          cursor: at ? { ...value.cursor, ...at, moving: false, clicking: data.action === "click" } : value.cursor && data.action === "click" ? { ...value.cursor, clicking: true } : value.cursor
        }));
        if (data.action === "click") setTimeout(() => {
          if (generation.current !== current) return;
          setState((value) => ({ ...value, cursor: value.cursor ? { ...value.cursor, clicking: false } : null }));
        }, 420);
        return;
      }
      if (frame.event === "control" || frame.event === "session") {
        const lease = frame.event === "session" ? object(data.lease) : null;
        const controlState = data.state === "user" ? "user" : "agent";
        const rawExpiresAt = lease?.expiresAt ?? data.expiresAt;
        const seeded = object(data.cursor);
        setState((value) => ({
          ...value,
          connected: true,
          closed: false,
          error: null,
          cursor: value.cursor ?? (typeof seeded?.x === "number" && typeof seeded?.y === "number" ? { x: seeded.x, y: seeded.y, moving: false } : null),
          control: {
            state: controlState,
            expiresAt: typeof rawExpiresAt === "number" ? rawExpiresAt : void 0,
            reason: typeof data.reason === "string" ? data.reason : void 0
          }
        }));
        return;
      }
      if (frame.event === "closed") {
        terminal = true;
        setState((value) => ({ ...value, connected: false, closed: true }));
      }
    };
    const connect = async () => {
      while (!controller.signal.aborted && !terminal) {
        try {
          const response = await fetch(`/api${path}`, { credentials: "same-origin", signal: controller.signal });
          if (!response.ok || !response.body) throw new Error(`Browser stream returned ${response.status}`);
          retry = 500;
          setState((value) => ({ ...value, connected: true, error: null }));
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!controller.signal.aborted && !terminal) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
            const parsed = parseSse(buffer);
            buffer = parsed.rest;
            for (const frame of parsed.frames) apply(frame);
          }
          if (controller.signal.aborted || terminal) return;
          setState((value) => value.closed ? value : { ...value, connected: false });
        } catch (error) {
          if (controller.signal.aborted) return;
          setState((value) => ({ ...value, connected: false, error: error instanceof Error ? error.message : String(error) }));
        }
        await new Promise((resolve) => setTimeout(resolve, retry));
        retry = Math.min(5e3, retry * 2);
      }
    };
    setState(initialState);
    void connect();
    return () => {
      controller.abort();
      if (generation.current === current) generation.current += 1;
    };
  }, [path]);
  return state;
}

// plugins/browser/web-src/BrowserArtifact.tsx
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
var asData = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value;
  if (typeof raw.browserSessionId !== "string") return null;
  return {
    browserSessionId: raw.browserSessionId,
    state: raw.state ?? "agent",
    title: typeof raw.title === "string" ? raw.title : "",
    url: typeof raw.url === "string" ? raw.url : "",
    lastAction: typeof raw.lastAction === "string" ? raw.lastAction : null
  };
};
var inputPath = (sessionId, action) => `/plugins/browser/api/${action}?sessionId=${encodeURIComponent(sessionId)}`;
var siteName = (url) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};
function GlassButton({ icon: Icon2, label, onClick, disabled, tone, className = "" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    "button",
    {
      type: "button",
      className: `browser-artifact__icon ${className}`.trim(),
      "data-tone": tone,
      "aria-label": label,
      title: label,
      onClick,
      disabled,
      children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon2, { size: 14, "aria-hidden": true })
    }
  );
}
function CanvasOverlay({ label, aspect, onClose, children }) {
  const surface = (0, import_react5.useRef)(null);
  const opener = (0, import_react5.useRef)(null);
  const pressedScrim = (0, import_react5.useRef)(false);
  (0, import_react5.useEffect)(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    surface.current?.focus();
    const { body } = document;
    const overflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = overflow;
      opener.current?.focus();
    };
  }, []);
  const onKeyDown = (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !surface.current) return;
    const stops = Array.from(surface.current.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === surface.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (0, import_react_dom.createPortal)(
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "div",
      {
        className: "browser-artifact__overlay",
        onPointerDown: (event) => {
          pressedScrim.current = event.target === event.currentTarget;
        },
        onClick: (event) => {
          if (event.target !== event.currentTarget || !pressedScrim.current) return;
          pressedScrim.current = false;
          onClose();
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "div",
          {
            ref: surface,
            className: "browser-artifact__surface",
            style: aspect ? { "--browser-aspect": String(aspect) } : void 0,
            role: "dialog",
            "aria-modal": "true",
            "aria-label": label,
            tabIndex: -1,
            onKeyDown,
            children
          }
        )
      }
    ),
    document.body
  );
}
function BrowserArtifact({ artifact, narration }) {
  const host = runtime();
  const { Button, ConfirmDialog, Spinner } = host.components;
  const strings = host.hooks.usePluginStrings("browser");
  const toast = host.hooks.useToast();
  const data = asData(artifact.data);
  const stream = useBrowserStream(artifact.media?.path);
  const [expanded, setExpanded] = (0, import_react5.useState)(false);
  const [confirmClose, setConfirmClose] = (0, import_react5.useState)(false);
  const [pending, setPending] = (0, import_react5.useState)(null);
  const [lease, setLease] = (0, import_react5.useState)(null);
  const pointerTimer = (0, import_react5.useRef)(null);
  const pendingMove = (0, import_react5.useRef)(null);
  const sessionId = data?.browserSessionId ?? "";
  const title = data?.title || strings.sessionTitle || "Browser session";
  const url = data?.url || "";
  const site = url ? siteName(url) : "";
  const state = stream.closed ? "closed" : lease || stream.control.state === "user" || data?.state === "user" ? "user" : data?.state ?? "agent";
  const takeoverRequested = stream.control.state === "agent" && stream.control.reason === "requested";
  const speech = (narration ?? "").trim();
  const frame = stream.frame;
  const frameAspect = frame && frame.height > 0 ? frame.width / frame.height : null;
  const aspectStyle = frameAspect ? { "--browser-aspect": String(frameAspect) } : void 0;
  const action = stream.action ? `${strings[`action_${stream.action.kind}`] || stream.action.kind}${stream.action.target ? ` \xB7 ${stream.action.target}` : ""}` : takeoverRequested ? strings.waitingForUser || "Waiting for user input" : data?.lastAction;
  (0, import_react5.useEffect)(() => () => {
    if (pointerTimer.current) clearTimeout(pointerTimer.current);
  }, []);
  (0, import_react5.useEffect)(() => {
    if (!lease) return;
    const interval = setInterval(() => {
      void runtime().api(inputPath(sessionId, "heartbeat"), jsonRequest("POST", { leaseId: lease.leaseId })).then((value) => {
        const next = value;
        if (typeof next.expiresAt === "number") setLease((current) => current?.leaseId === lease.leaseId ? { ...current, expiresAt: next.expiresAt } : current);
      }).catch(() => setLease((current) => current?.leaseId === lease.leaseId ? null : current));
    }, 2e4);
    return () => clearInterval(interval);
  }, [lease, sessionId]);
  (0, import_react5.useEffect)(() => {
    if (stream.control.state === "agent") setLease(null);
  }, [stream.control.state]);
  (0, import_react5.useEffect)(() => {
    if (lease) return;
    if (pointerTimer.current) {
      clearTimeout(pointerTimer.current);
      pointerTimer.current = null;
    }
    pendingMove.current = null;
  }, [lease]);
  const status = (0, import_react5.useMemo)(() => {
    if (stream.closed || state === "closed") return { tone: "muted", label: strings.closed || "Closed" };
    if (stream.error) return { tone: "danger", label: strings.disconnected || "Disconnected" };
    if (state === "user") return { tone: "accent", label: lease ? strings.youControl || "You control" : strings.userControl || "User control" };
    if (takeoverRequested) return { tone: "warning", label: strings.waitingForUser || "Waiting for user input" };
    return { tone: stream.connected ? "success" : "warning", label: stream.connected ? strings.agentControl || "Agent control" : strings.connecting || "Connecting" };
  }, [lease, state, stream.closed, stream.connected, stream.error, strings, takeoverRequested]);
  const run = async (name, operation) => {
    setPending(name);
    try {
      return await operation();
    } catch (error) {
      toast.toast(apiError(error), "error");
      return void 0;
    } finally {
      setPending(null);
    }
  };
  const takeControl = async () => {
    const result = await run("takeover", () => runtime().api(inputPath(sessionId, "takeover"), jsonRequest("POST")));
    if (result) setLease(result);
  };
  const releaseControl = async () => {
    if (!lease) return;
    const released = await run("release", () => runtime().api(inputPath(sessionId, "release"), jsonRequest("POST", { leaseId: lease.leaseId })));
    if (released !== void 0) setLease(null);
  };
  const closeSession = async () => {
    const closed = await run("close", () => runtime().api(inputPath(sessionId, "close"), jsonRequest("POST")));
    if (closed !== void 0) {
      setConfirmClose(false);
      setExpanded(false);
    }
  };
  const command = async (events) => {
    if (!lease || events.length === 0) return;
    await runtime().api(inputPath(sessionId, "input"), jsonRequest("POST", { leaseId: lease.leaseId, events }));
  };
  const shortcut = (key, code, modifiers = []) => {
    void command([
      { type: "key", action: "down", key, code, modifiers },
      { type: "key", action: "up", key, code, modifiers }
    ]).catch((error) => toast.toast(apiError(error), "error"));
  };
  const pointerEvent = (event, actionName) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      type: "pointer",
      action: actionName,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      surfaceWidth: rect.width,
      surfaceHeight: rect.height,
      button: event.button === 1 ? "middle" : event.button === 2 ? "right" : "left",
      modifiers: [event.altKey ? "Alt" : "", event.ctrlKey ? "Control" : "", event.metaKey ? "Meta" : "", event.shiftKey ? "Shift" : ""].filter(Boolean)
    };
  };
  const onPointerMove = (event) => {
    if (!lease) return;
    pendingMove.current = pointerEvent(event, "move");
    if (pointerTimer.current) return;
    pointerTimer.current = setTimeout(() => {
      pointerTimer.current = null;
      const next = pendingMove.current;
      pendingMove.current = null;
      if (next) void command([next]).catch((error) => toast.toast(apiError(error), "error"));
    }, 50);
  };
  const onPointerDown = (event) => {
    if (!lease) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    void command([pointerEvent(event, "down")]).catch((error) => toast.toast(apiError(error), "error"));
  };
  const onPointerUp = (event) => {
    if (!lease) return;
    void command([pointerEvent(event, "up")]).catch((error) => toast.toast(apiError(error), "error"));
  };
  const onWheel = (event) => {
    if (!lease) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    void command([{
      type: "wheel",
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      surfaceWidth: rect.width,
      surfaceHeight: rect.height,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      modifiers: [event.altKey ? "Alt" : "", event.ctrlKey ? "Control" : "", event.metaKey ? "Meta" : "", event.shiftKey ? "Shift" : ""].filter(Boolean)
    }]).catch((error) => toast.toast(apiError(error), "error"));
  };
  const onKey = (event, actionName) => {
    if (!lease) return;
    if (actionName === "down") event.preventDefault();
    void command([{
      type: "key",
      action: actionName,
      key: event.key,
      code: event.code,
      modifiers: [event.altKey ? "Alt" : "", event.ctrlKey ? "Control" : "", event.metaKey ? "Meta" : "", event.shiftKey ? "Shift" : ""].filter(Boolean)
    }]).catch((error) => toast.toast(apiError(error), "error"));
  };
  const onPaste = (event) => {
    if (!lease) return;
    const text = event.clipboardData.getData("text");
    if (!text) return;
    event.preventDefault();
    void command([{ type: "paste", text }]).catch((error) => toast.toast(apiError(error), "error"));
  };
  const canvas = (interactive) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "div",
    {
      className: "browser-artifact__canvas",
      "data-interactive": interactive && lease ? "true" : void 0,
      role: interactive && lease ? "application" : void 0,
      tabIndex: interactive && lease ? 0 : -1,
      onPointerMove: interactive ? onPointerMove : void 0,
      onPointerDown: interactive ? onPointerDown : void 0,
      onPointerUp: interactive ? onPointerUp : void 0,
      onWheel: interactive ? onWheel : void 0,
      onKeyDown: interactive ? (event) => onKey(event, "down") : void 0,
      onKeyUp: interactive ? (event) => onKey(event, "up") : void 0,
      onPaste: interactive ? onPaste : void 0,
      onContextMenu: interactive && lease ? (event) => event.preventDefault() : void 0,
      "aria-label": strings.browserViewport || "Live browser view",
      children: [
        frame ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("img", { src: `data:${frame.mimeType};base64,${frame.data}`, alt: "", draggable: false }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "browser-artifact__waiting", role: "status", "aria-live": "polite", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Spinner, { size: "lg" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: stream.error || strings.waitingFrame || "Waiting for the browser image\u2026" })
        ] }),
        interactive && state !== "user" && stream.cursor && frame ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "span",
          {
            className: `browser-artifact__cursor ${stream.cursor.clicking ? "is-clicking" : ""}`,
            style: { left: `${stream.cursor.x / frame.width * 100}%`, top: `${stream.cursor.y / frame.height * 100}%` },
            "aria-hidden": true,
            children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { width: "28", height: "34", viewBox: "0 0 28 34", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M2 2l19 15-9 2 5 10-5 2-5-10-5 6z" }) })
          }
        ) : null,
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: `browser-artifact__activity ${interactive && action ? "has-action" : ""}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "browser-artifact__dot", "data-tone": status.tone, "aria-hidden": true }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "sr-only", children: status.label }),
          interactive && action ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate", children: action }) : null
        ] })
      ]
    }
  );
  const controlAction = () => state === "user" && lease ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "accent", icon: ShieldCheck, onClick: () => {
    void releaseControl();
  }, disabled: pending !== null, children: strings.returnToAgent || "Return to agent" }) : state === "user" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "ghost", icon: Hand, disabled: true, children: strings.controlledElsewhere || "Controlled in another window" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "ghost", icon: Hand, onClick: () => {
    void takeControl();
  }, disabled: pending !== null || stream.closed, children: strings.takeControl || "Take control" });
  if (!data) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "browser-artifact__fallback", children: artifact.fallback });
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "browser-artifact", style: aspectStyle, "aria-label": strings.sessionTitle || "Browser session", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: "browser-artifact__tile", onClick: () => setExpanded(true), "aria-label": strings.enlarge || "Enlarge browser", children: [
      canvas(false),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "browser-artifact__expand", "aria-hidden": true, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Expand, { size: 13 }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mt-1.5 flex items-center gap-2 text-caption text-muted-foreground", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "min-w-0 flex-1 truncate", children: site || strings.noAddress || "No address yet" }),
      controlAction()
    ] }),
    expanded ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(CanvasOverlay, { label: title, aspect: frameAspect, onClose: () => setExpanded(false), children: [
      canvas(true),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(GlassButton, { icon: X, label: strings.closeView || "Close view", onClick: () => setExpanded(false), className: "browser-artifact__dismiss" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "browser-artifact__dock", children: [
        speech ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "browser-artifact__narration", role: "status", "aria-live": "polite", "aria-atomic": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "browser-artifact__narration-text", children: speech }) }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "browser-artifact__controls", children: [
          lease ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(GlassButton, { icon: ArrowLeft, label: strings.back || "Back", onClick: () => shortcut("ArrowLeft", "ArrowLeft", ["Alt"]) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(GlassButton, { icon: ArrowRight, label: strings.forward || "Forward", onClick: () => shortcut("ArrowRight", "ArrowRight", ["Alt"]) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(GlassButton, { icon: RotateCw, label: strings.reload || "Reload", onClick: () => shortcut("r", "KeyR", ["Control"]) })
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "browser-artifact__site", children: site || strings.noAddress || "No address yet" }),
          controlAction(),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(GlassButton, { icon: Power, label: strings.closeSession || "Close session", tone: "danger", onClick: () => setConfirmClose(true), disabled: pending !== null || stream.closed })
        ] })
      ] })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      ConfirmDialog,
      {
        open: confirmClose,
        title: strings.closeConfirmTitle || "Close browser session?",
        description: strings.closeConfirmDescription || "The live view and tab will close. Your browser profile and sign-in data remain stored.",
        confirmLabel: strings.closeSession || "Close session",
        confirmVariant: "danger",
        pending: pending === "close",
        onConfirm: () => {
          void closeSession();
        },
        onClose: () => setConfirmClose(false)
      }
    )
  ] });
}

// plugins/browser/web-src/BrowserSettings.tsx
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
function BrowserSettings({ surface }) {
  const host = runtime();
  const { PluginPageHeader, DetailBlock, Badge, LoadingState, ErrorState } = host.components;
  const strings = host.hooks.usePluginStrings("browser");
  const query = host.hooks.useQuery({
    queryKey: ["browser", "admin-status"],
    queryFn: () => runtime().api("/plugins/browser/api/admin-status"),
    refetchInterval: 1e4
  });
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "space-y-4", children: [
    surface === "page" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(PluginPageHeader, { title: strings.settingsTitle || "Browser runtime", description: strings.settingsDescription || "Live capacity and isolation status for managed Chrome sessions.", icon: Monitor }) : null,
    query.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(LoadingState, { variant: "block", height: "10rem" }) : query.isError ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ErrorState, { message: apiError(query.error), onRetry: () => query.refetch() }) : query.data ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "grid gap-3 md:grid-cols-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DetailBlock, { icon: Activity, title: strings.liveCapacity || "Live capacity", hint: strings.liveCapacityHint || "Only counts active Chrome processes and tab sessions. Browser content remains private to its account.", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-wrap gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(Badge, { tone: query.data.activeUsers >= query.data.maxActiveUsers ? "warning" : "success", children: [
          query.data.activeUsers,
          " / ",
          query.data.maxActiveUsers,
          " ",
          strings.activeAccounts || "active accounts"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(Badge, { tone: "muted", children: [
          query.data.activeSessions,
          " ",
          strings.activeSessions || "tab sessions"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(Badge, { tone: "muted", children: [
          strings.perAccountLimit || "Per account",
          ": ",
          query.data.maxSessionsPerUser
        ] })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DetailBlock, { icon: ShieldCheck, title: strings.isolationTitle || "Isolation", hint: strings.isolationHint || "Every account has a separate persistent profile and Chrome process. All traffic must cross the pinned enforcing proxy.", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-wrap gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Badge, { tone: "success", children: strings.profileIsolation || "Per-account profiles" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Badge, { tone: "success", children: strings.proxyIsolation || "Pinned DNS proxy" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Badge, { tone: query.data.artifactsAvailable ? "success" : "warning", children: query.data.artifactsAvailable ? strings.chatReady || "Chat live view ready" : strings.chatUnavailable || "Chat live view unavailable" })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DetailBlock, { icon: Gauge, title: strings.limitsTitle || "Limits", hint: strings.limitsHint || "The sliders above are enforced before allocating Chrome, frames, viewers or input events.", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "text-sm text-muted-foreground", children: strings.limitsBody || "Idle and hard timeouts close sessions automatically. Stream frames use a bounded latest-frame queue and a global bitrate budget." }) })
    ] }) : null
  ] });
}

// plugins/browser/web-src/index.tsx
registerBrowserUi(BrowserArtifact, BrowserSettings, BrowserAccount);
