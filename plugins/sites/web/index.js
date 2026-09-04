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

// plugins/sites/web-src/runtime.ts
function runtime() {
  const value = window.ElowenUiRuntime;
  if (!value) throw new Error("ElowenUiRuntime is not installed");
  return value;
}
function registerSitesUi(pages, project, settings) {
  window.__elowenRegisterPluginUi?.("sites", {
    requiresApiVersion: 12,
    pages,
    project,
    settings
  });
}
var jsonBody = (method, value) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value)
});
var SITES_LIST_KEY = ["sites", "list"];
var siteDetailKey = (siteId) => ["sites", "detail", siteId];
var avatarUser = (person) => person;
function relativeTime(iso) {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1e3));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} d ago`;
  return new Date(then).toISOString().slice(0, 10);
}
var formatBytes = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;

// plugins/sites/web-src/SitesPage.tsx
var import_react5 = __toESM(require_react(), 1);

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

// node_modules/lucide-react/dist/esm/icons/camera.js
var Camera = createLucideIcon("Camera", [
  [
    "path",
    {
      d: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z",
      key: "1tc9qg"
    }
  ],
  ["circle", { cx: "12", cy: "13", r: "3", key: "1vg3eu" }]
]);

// node_modules/lucide-react/dist/esm/icons/chevron-right.js
var ChevronRight = createLucideIcon("ChevronRight", [
  ["path", { d: "m9 18 6-6-6-6", key: "mthhwq" }]
]);

// node_modules/lucide-react/dist/esm/icons/circle-check.js
var CircleCheck = createLucideIcon("CircleCheck", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "m9 12 2 2 4-4", key: "dzmm74" }]
]);

// node_modules/lucide-react/dist/esm/icons/circle-dashed.js
var CircleDashed = createLucideIcon("CircleDashed", [
  ["path", { d: "M10.1 2.182a10 10 0 0 1 3.8 0", key: "5ilxe3" }],
  ["path", { d: "M13.9 21.818a10 10 0 0 1-3.8 0", key: "11zvb9" }],
  ["path", { d: "M17.609 3.721a10 10 0 0 1 2.69 2.7", key: "1iw5b2" }],
  ["path", { d: "M2.182 13.9a10 10 0 0 1 0-3.8", key: "c0bmvh" }],
  ["path", { d: "M20.279 17.609a10 10 0 0 1-2.7 2.69", key: "1ruxm7" }],
  ["path", { d: "M21.818 10.1a10 10 0 0 1 0 3.8", key: "qkgqxc" }],
  ["path", { d: "M3.721 6.391a10 10 0 0 1 2.7-2.69", key: "1mcia2" }],
  ["path", { d: "M6.391 20.279a10 10 0 0 1-2.69-2.7", key: "1fvljs" }]
]);

// node_modules/lucide-react/dist/esm/icons/circle-dot.js
var CircleDot = createLucideIcon("CircleDot", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["circle", { cx: "12", cy: "12", r: "1", key: "41hilf" }]
]);

// node_modules/lucide-react/dist/esm/icons/clock.js
var Clock = createLucideIcon("Clock", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["polyline", { points: "12 6 12 12 16 14", key: "68esgv" }]
]);

// node_modules/lucide-react/dist/esm/icons/copy.js
var Copy = createLucideIcon("Copy", [
  ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2", key: "17jyea" }],
  ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2", key: "zix9uf" }]
]);

// node_modules/lucide-react/dist/esm/icons/external-link.js
var ExternalLink = createLucideIcon("ExternalLink", [
  ["path", { d: "M15 3h6v6", key: "1q9fwt" }],
  ["path", { d: "M10 14 21 3", key: "gplh6r" }],
  ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", key: "a6xqqp" }]
]);

// node_modules/lucide-react/dist/esm/icons/folder-git-2.js
var FolderGit2 = createLucideIcon("FolderGit2", [
  [
    "path",
    {
      d: "M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5",
      key: "1w6njk"
    }
  ],
  ["circle", { cx: "13", cy: "12", r: "2", key: "1j92g6" }],
  ["path", { d: "M18 19c-2.8 0-5-2.2-5-5v8", key: "pkpw2h" }],
  ["circle", { cx: "20", cy: "19", r: "2", key: "1obnsp" }]
]);

// node_modules/lucide-react/dist/esm/icons/gauge.js
var Gauge = createLucideIcon("Gauge", [
  ["path", { d: "m12 14 4-4", key: "9kzdfg" }],
  ["path", { d: "M3.34 19a10 10 0 1 1 17.32 0", key: "19p75a" }]
]);

// node_modules/lucide-react/dist/esm/icons/globe.js
var Globe = createLucideIcon("Globe", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", key: "13o1zl" }],
  ["path", { d: "M2 12h20", key: "9i4pu4" }]
]);

// node_modules/lucide-react/dist/esm/icons/history.js
var History = createLucideIcon("History", [
  ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", key: "1357e3" }],
  ["path", { d: "M3 3v5h5", key: "1xhq8a" }],
  ["path", { d: "M12 7v5l4 2", key: "1fdv2h" }]
]);

// node_modules/lucide-react/dist/esm/icons/layers.js
var Layers = createLucideIcon("Layers", [
  [
    "path",
    {
      d: "m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z",
      key: "8b97xw"
    }
  ],
  ["path", { d: "m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65", key: "dd6zsq" }],
  ["path", { d: "m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65", key: "ep9fru" }]
]);

// node_modules/lucide-react/dist/esm/icons/link-2.js
var Link2 = createLucideIcon("Link2", [
  ["path", { d: "M9 17H7A5 5 0 0 1 7 7h2", key: "8i5ue5" }],
  ["path", { d: "M15 7h2a5 5 0 1 1 0 10h-2", key: "1b9ql8" }],
  ["line", { x1: "8", x2: "16", y1: "12", y2: "12", key: "1jonct" }]
]);

// node_modules/lucide-react/dist/esm/icons/lock.js
var Lock = createLucideIcon("Lock", [
  ["rect", { width: "18", height: "11", x: "3", y: "11", rx: "2", ry: "2", key: "1w4ew1" }],
  ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4", key: "fwvmzm" }]
]);

// node_modules/lucide-react/dist/esm/icons/network.js
var Network = createLucideIcon("Network", [
  ["rect", { x: "16", y: "16", width: "6", height: "6", rx: "1", key: "4q2zg0" }],
  ["rect", { x: "2", y: "16", width: "6", height: "6", rx: "1", key: "8cvhb9" }],
  ["rect", { x: "9", y: "2", width: "6", height: "6", rx: "1", key: "1egb70" }],
  ["path", { d: "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3", key: "1jsf9p" }],
  ["path", { d: "M12 12V8", key: "2874zd" }]
]);

// node_modules/lucide-react/dist/esm/icons/package-check.js
var PackageCheck = createLucideIcon("PackageCheck", [
  ["path", { d: "m16 16 2 2 4-4", key: "gfu2re" }],
  [
    "path",
    {
      d: "M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14",
      key: "e7tb2h"
    }
  ],
  ["path", { d: "m7.5 4.27 9 5.15", key: "1c824w" }],
  ["polyline", { points: "3.29 7 12 12 20.71 7", key: "ousv84" }],
  ["line", { x1: "12", x2: "12", y1: "22", y2: "12", key: "a4e8g8" }]
]);

// node_modules/lucide-react/dist/esm/icons/play.js
var Play = createLucideIcon("Play", [
  ["polygon", { points: "6 3 20 12 6 21 6 3", key: "1oa8hb" }]
]);

// node_modules/lucide-react/dist/esm/icons/refresh-cw.js
var RefreshCw = createLucideIcon("RefreshCw", [
  ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", key: "v9h5vc" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }],
  ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", key: "3uifl3" }],
  ["path", { d: "M8 16H3v5", key: "1cv678" }]
]);

// node_modules/lucide-react/dist/esm/icons/rotate-ccw.js
var RotateCcw = createLucideIcon("RotateCcw", [
  ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", key: "1357e3" }],
  ["path", { d: "M3 3v5h5", key: "1xhq8a" }]
]);

// node_modules/lucide-react/dist/esm/icons/scroll-text.js
var ScrollText = createLucideIcon("ScrollText", [
  ["path", { d: "M15 12h-5", key: "r7krc0" }],
  ["path", { d: "M15 8h-5", key: "1khuty" }],
  ["path", { d: "M19 17V5a2 2 0 0 0-2-2H4", key: "zz82l3" }],
  [
    "path",
    {
      d: "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3",
      key: "1ph1d7"
    }
  ]
]);

// node_modules/lucide-react/dist/esm/icons/search.js
var Search = createLucideIcon("Search", [
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ["path", { d: "m21 21-4.3-4.3", key: "1qie3q" }]
]);

// node_modules/lucide-react/dist/esm/icons/server.js
var Server = createLucideIcon("Server", [
  ["rect", { width: "20", height: "8", x: "2", y: "2", rx: "2", ry: "2", key: "ngkwjq" }],
  ["rect", { width: "20", height: "8", x: "2", y: "14", rx: "2", ry: "2", key: "iecqi9" }],
  ["line", { x1: "6", x2: "6.01", y1: "6", y2: "6", key: "16zg32" }],
  ["line", { x1: "6", x2: "6.01", y1: "18", y2: "18", key: "nzw8ys" }]
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

// node_modules/lucide-react/dist/esm/icons/square.js
var Square = createLucideIcon("Square", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }]
]);

// node_modules/lucide-react/dist/esm/icons/terminal.js
var Terminal = createLucideIcon("Terminal", [
  ["polyline", { points: "4 17 10 11 4 5", key: "akl6gq" }],
  ["line", { x1: "12", x2: "20", y1: "19", y2: "19", key: "q2wloq" }]
]);

// node_modules/lucide-react/dist/esm/icons/trash-2.js
var Trash2 = createLucideIcon("Trash2", [
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", key: "4alrt4" }],
  ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", key: "v07s0e" }],
  ["line", { x1: "10", x2: "10", y1: "11", y2: "17", key: "1uufr5" }],
  ["line", { x1: "14", x2: "14", y1: "11", y2: "17", key: "xtxkd" }]
]);

// node_modules/lucide-react/dist/esm/icons/triangle-alert.js
var TriangleAlert = createLucideIcon("TriangleAlert", [
  [
    "path",
    {
      d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
      key: "wmoenq"
    }
  ],
  ["path", { d: "M12 9v4", key: "juzpu7" }],
  ["path", { d: "M12 17h.01", key: "p32p05" }]
]);

// node_modules/lucide-react/dist/esm/icons/user-minus.js
var UserMinus = createLucideIcon("UserMinus", [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
  ["line", { x1: "22", x2: "16", y1: "11", y2: "11", key: "1shjgl" }]
]);

// node_modules/lucide-react/dist/esm/icons/users.js
var Users = createLucideIcon("Users", [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
  ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87", key: "kshegd" }],
  ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75", key: "1da9ce" }]
]);

// plugins/sites/web-src/meta.ts
var VISIBILITY_ORDER = ["private", "project", "authenticated", "public"];
var VISIBILITY_STRING = {
  private: "visibilityPrivate",
  project: "visibilityProject",
  authenticated: "visibilityAuthenticated",
  public: "visibilityPublic"
};
var VISIBILITY_ICON = {
  private: Lock,
  project: FolderGit2,
  authenticated: Users,
  public: Globe
};
var VISIBILITY_TONE = {
  private: "muted",
  project: "muted",
  authenticated: "accent",
  public: "warning"
};
var STATUS_ORDER = ["live", "draft", "failed"];
var STATUS_STRING = {
  live: "statusLive",
  draft: "statusDraft",
  failed: "statusFailed"
};
var STATUS_ICON = {
  live: CircleDot,
  draft: CircleDashed,
  failed: TriangleAlert
};
var STATUS_TONE = {
  live: "success",
  draft: "muted",
  failed: "danger"
};

// plugins/sites/web-src/SiteDetail.tsx
var import_react4 = __toESM(require_react(), 1);

// plugins/sites/web-src/EnvironmentDetail.tsx
var import_react3 = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
function EnvironmentDetail({
  siteId,
  currentReleaseId,
  environment,
  snapshots,
  busy,
  runCall
}) {
  const host = runtime();
  const { Badge, Button, ConfirmDialog, DetailBlock, HelpTip, Input, Toggle } = host.components;
  const strings = host.hooks.usePluginStrings("sites");
  const [snapshotNote, setSnapshotNote] = (0, import_react3.useState)("");
  const [includeData, setIncludeData] = (0, import_react3.useState)(true);
  const [restore, setRestore] = (0, import_react3.useState)(null);
  const [restoreData, setRestoreData] = (0, import_react3.useState)(false);
  const [limits, setLimits] = (0, import_react3.useState)({ cpus: "", memoryMb: "", pidsLimit: "", diskSoftMb: "" });
  (0, import_react3.useEffect)(() => {
    const source = environment.limitOverrides;
    if (!source) return;
    setLimits({
      cpus: source.cpus === null ? "" : String(source.cpus),
      memoryMb: source.memoryMb === null ? "" : String(source.memoryMb),
      pidsLimit: source.pidsLimit === null ? "" : String(source.pidsLimit),
      diskSoftMb: source.diskSoftMb === null ? "" : String(source.diskSoftMb)
    });
  }, [environment.limitOverrides]);
  const logs = host.hooks.useQuery({
    queryKey: ["sites", "environment-logs", siteId],
    queryFn: () => runtime().api(`/plugins/sites/api/site/${siteId}/logs?lines=200`),
    enabled: environment.canReadLogs === true
  });
  const actionPending = environment.action?.lastError === null;
  const hasError = Boolean(environment.lastError || environment.action?.lastError);
  const mutationBlocked = busy || actionPending;
  const canControl = environment.canControl === true;
  const canSnapshot = canControl && environment.state === "running" && environment.desiredState === "running" && !environment.action;
  const control = (action) => runCall({
    path: `/plugins/sites/api/site/${siteId}/control`,
    init: jsonBody("POST", { action }),
    done: strings.environmentActionScheduled
  });
  const snapshot = () => {
    if (!canSnapshot || mutationBlocked) return;
    runCall({
      path: `/plugins/sites/api/site/${siteId}/snapshot`,
      init: jsonBody("POST", { includeData, note: snapshotNote.trim() }),
      done: strings.environmentSnapshotScheduled
    }, () => setSnapshotNote(""));
  };
  const numberOrNull = (value) => value.trim() === "" ? null : Number(value);
  const saveLimits = () => {
    const values = Object.values(limits).filter((value) => value.trim() !== "").map(Number);
    if (values.some((value) => !Number.isFinite(value))) return;
    runCall({
      path: `/plugins/sites/api/site/${siteId}`,
      init: jsonBody("PATCH", {
        environmentCpus: numberOrNull(limits.cpus),
        environmentMemoryMb: numberOrNull(limits.memoryMb),
        environmentPidsLimit: numberOrNull(limits.pidsLimit),
        environmentDiskSoftMb: numberOrNull(limits.diskSoftMb)
      }),
      done: strings.environmentLimitsSaved
    });
  };
  const stateTone = environment.state === "running" ? "success" : environment.state === "paused" ? "warning" : "danger";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-5", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DetailBlock, { icon: Activity, title: strings.environmentState, hint: strings.environmentTransportLimit, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "grid grid-cols-1 gap-2 sm:grid-cols-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs text-muted-foreground", children: strings.environmentObservedState }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { tone: stateTone, children: environment.state ?? strings.environmentStatusUnavailable })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs text-muted-foreground", children: strings.environmentDesiredState }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { tone: environment.desiredState === "running" ? "success" : environment.desiredState === "restarting" ? "warning" : "muted", children: environment.desiredState })
        ] })
      ] }),
      environment.action ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: `rounded-md border px-3 py-2 text-xs ${environment.action.lastError ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/40 bg-primary/10 text-foreground"}`, role: "status", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: environment.action.lastError ? strings.environmentActionError : strings.environmentActionPending }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mt-1 font-mono", children: [
          environment.action.kind,
          " \xB7 ",
          environment.action.snapshotId
        ] }),
        environment.action.lastError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-1", children: environment.action.lastError }) : null
      ] }) : environment.lastError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs text-destructive", children: environment.lastError }) : null,
      canControl ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-wrap gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "ghost", icon: Play, disabled: mutationBlocked || environment.desiredState === "running" && !hasError, onClick: () => control("start"), children: strings.environmentStart }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "ghost", icon: Square, disabled: mutationBlocked || environment.desiredState === "stopped", onClick: () => control("stop"), children: strings.environmentStop }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "ghost", icon: RefreshCw, disabled: mutationBlocked, onClick: () => control("restart"), children: strings.environmentRestart })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-[11px] text-muted-foreground", children: strings.environmentTransportLimit })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DetailBlock, { icon: Camera, title: strings.environmentSnapshots, hint: strings.environmentCrashConsistent, children: [
      canControl ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "space-y-3 rounded-md border border-border bg-muted/20 p-3", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "flex flex-col gap-1", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-[10px] uppercase tracking-wide text-muted-foreground", children: strings.environmentSnapshotNote }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            Input,
            {
              value: snapshotNote,
              onChange: (event) => setSnapshotNote(event.target.value),
              placeholder: strings.environmentSnapshotNotePlaceholder,
              disabled: mutationBlocked,
              "aria-label": strings.environmentSnapshotNote
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center gap-2 text-xs text-foreground", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            Toggle,
            {
              checked: includeData,
              disabled: mutationBlocked,
              label: strings.environmentIncludeData,
              onChange: setIncludeData
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HelpTip, { children: strings.environmentIncludeDataHelp })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "ghost", icon: Camera, disabled: mutationBlocked || !canSnapshot, onClick: snapshot, children: strings.environmentSnapshot })
      ] }) : null,
      snapshots.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-[11px] text-muted-foreground", children: strings.environmentNoSnapshots }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "flex flex-col gap-2", children: snapshots.map((item) => {
        const active = item.id === currentReleaseId;
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { className: `rounded-md border px-3 py-2 ${active ? "border-primary/40 bg-primary/10" : "border-border bg-muted/30"}`, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-wrap items-start justify-between gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "min-w-0", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "flex flex-wrap items-center gap-2 text-xs text-foreground", children: [
              relativeTime(item.createdAt),
              active ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { tone: "success", children: strings.environmentSnapshotActive }) : null,
              item.includesData ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { tone: "muted", children: "/data" }) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "mt-1 block truncate text-[11px] text-muted-foreground", children: item.note || item.model })
          ] }),
          canControl && !active ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-wrap gap-1", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              Button,
              {
                variant: "ghost",
                icon: RotateCcw,
                disabled: mutationBlocked,
                onClick: () => {
                  setRestoreData(false);
                  setRestore(item);
                },
                children: strings.environmentRestoreRoot
              }
            ),
            item.includesData ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              Button,
              {
                variant: "ghost",
                icon: RotateCcw,
                disabled: mutationBlocked,
                onClick: () => {
                  setRestoreData(true);
                  setRestore(item);
                },
                children: strings.environmentRestoreData
              }
            ) : null
          ] }) : null
        ] }) }, item.id);
      }) })
    ] }),
    environment.canReadLogs ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DetailBlock, { icon: ScrollText, title: strings.environmentLogs, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex justify-end", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "ghost", icon: RefreshCw, disabled: logs.isLoading, onClick: () => logs.refetch(), children: strings.refresh }) }),
      logs.isError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs text-destructive", children: host.utils.apiErrorMessage(logs.error) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] text-muted-foreground", children: logs.data ? [logs.data.lifecycle, logs.data.journal].filter(Boolean).join("\n\n") || strings.runtimeEmptyLog : strings.environmentLogsLoading })
    ] }) : null,
    environment.canSetLimits && environment.limits && environment.limitOverrides ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DetailBlock, { icon: Gauge, title: strings.environmentLimits, hint: strings.environmentLimitsHint, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
        ["cpus", strings.environmentLimitCpu, environment.limits.cpus],
        ["memoryMb", strings.environmentLimitMemory, environment.limits.memoryMb],
        ["pidsLimit", strings.environmentLimitPids, environment.limits.pidsLimit],
        ["diskSoftMb", strings.environmentLimitDisk, environment.limits.diskSoftMb]
      ].map(([key, label, effective]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "flex flex-col gap-1", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-[10px] uppercase tracking-wide text-muted-foreground", children: label }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          Input,
          {
            type: "number",
            value: limits[key],
            onChange: (event) => setLimits((current) => ({ ...current, [key]: event.target.value })),
            placeholder: String(effective),
            disabled: mutationBlocked,
            "aria-label": label
          }
        )
      ] }, key)) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-[11px] text-muted-foreground", children: strings.environmentLimitsHint }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "ghost", disabled: mutationBlocked, onClick: saveLimits, children: strings.environmentSaveLimits })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      ConfirmDialog,
      {
        open: restore !== null,
        title: strings.environmentRestoreConfirmTitle,
        description: restoreData ? strings.environmentRestoreWithDataWarning : strings.environmentRestoreRootWarning,
        confirmLabel: strings.environmentRestore,
        pending: busy,
        onClose: () => {
          if (!busy) setRestore(null);
        },
        onConfirm: () => {
          if (!restore || busy) return;
          const selected = restore;
          runCall({
            path: `/plugins/sites/api/site/${siteId}/rollback`,
            init: jsonBody("POST", { releaseId: selected.id, restoreData }),
            done: strings.environmentRestoreScheduled
          }, () => setRestore(null));
        }
      }
    )
  ] });
}

// plugins/sites/web-src/SiteDetail.tsx
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
var basePath = (siteId) => `/plugins/sites/api/site/${siteId}`;
function SiteDetail({ siteId, allowPublicSites, onDeleted, onBusyChange }) {
  const { components, hooks, utils } = runtime();
  const {
    Avatar,
    Badge,
    Button,
    IconButton,
    Input,
    SelectMenu,
    ConfirmDialog,
    ManageSelectionModal,
    DetailBlock,
    EmptyState,
    ErrorState,
    LoadingLine
  } = components;
  const strings = hooks.usePluginStrings("sites");
  const { toast } = hooks.useToast();
  const queryClient = hooks.useQueryClient();
  const [pendingPublic, setPendingPublic] = (0, import_react4.useState)(false);
  const [confirmDelete, setConfirmDelete] = (0, import_react4.useState)(false);
  const [guestPicker, setGuestPicker] = (0, import_react4.useState)(false);
  const [runtimeCommand, setRuntimeCommand] = (0, import_react4.useState)("");
  const [runtimeBind, setRuntimeBind] = (0, import_react4.useState)("socket");
  const [failedAction, setFailedAction] = (0, import_react4.useState)(null);
  const [failedGuests, setFailedGuests] = (0, import_react4.useState)(null);
  const callRef = (0, import_react4.useRef)(false);
  const guestsRef = (0, import_react4.useRef)(false);
  const detail = hooks.useQuery({
    queryKey: siteDetailKey(siteId),
    queryFn: () => runtime().api(basePath(siteId))
  });
  const detailRefetch = (0, import_react4.useRef)(detail.refetch);
  detailRefetch.current = detail.refetch;
  const site = detail.data?.site;
  const members = detail.data?.members ?? [];
  const canManage = site?.canManage === true;
  const directory = hooks.useQuery({
    queryKey: ["sites", "directory"],
    queryFn: () => runtime().api("/plugins/sites/api/directory"),
    enabled: canManage
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: siteDetailKey(siteId) });
    void queryClient.invalidateQueries({ queryKey: SITES_LIST_KEY });
  };
  const call = hooks.useMutation({
    mutationFn: (vars) => runtime().api(vars.path, vars.init),
    onSuccess: (_data, vars) => {
      setFailedAction(null);
      refresh();
      toast(vars.done ?? strings.saved);
    },
    onError: (error, vars) => {
      const message = utils.apiErrorMessage(error);
      setFailedAction({ ...vars, message });
      toast(message, "error");
    }
  });
  const saveGuests = hooks.useMutation({
    mutationFn: (next) => runtime().api(`${basePath(siteId)}/members/replace`, jsonBody("POST", {
      userIds: [...next].map(Number)
    })),
    onSuccess: () => {
      setFailedGuests(null);
      refresh();
      toast(strings.saved);
    },
    onError: (error, next) => {
      const message = utils.apiErrorMessage(error);
      setFailedGuests({ next: new Set(next), message });
      refresh();
      toast(message, "error");
    }
  });
  const runCall = (vars, onSuccess) => {
    if (callRef.current) return;
    callRef.current = true;
    call.mutate(vars, {
      onSuccess: () => {
        callRef.current = false;
        onSuccess?.();
      },
      onError: () => {
        callRef.current = false;
      }
    });
  };
  const runGuests = async (next) => {
    if (guestsRef.current) return;
    guestsRef.current = true;
    try {
      await saveGuests.mutateAsync(next);
    } finally {
      guestsRef.current = false;
    }
  };
  (0, import_react4.useEffect)(() => {
    onBusyChange?.(callRef.current || guestsRef.current || call.isPending || saveGuests.isPending);
  }, [call.isPending, onBusyChange, saveGuests.isPending]);
  (0, import_react4.useEffect)(() => {
    const next = detail.data?.runtime;
    if (!next) return;
    setRuntimeCommand(next.startCommand ?? "");
    setRuntimeBind(next.bind === "port" ? "port" : "socket");
  }, [detail.data?.runtime]);
  const pollingAction = detail.data?.environment?.action;
  const pollingDesiredState = detail.data?.environment?.desiredState;
  const pollingRuntime = detail.data?.site.runtime;
  (0, import_react4.useEffect)(() => {
    const actionInFlight = pollingAction?.lastError === null;
    const lifecycleInFlight = !pollingAction && pollingDesiredState === "restarting";
    if (pollingRuntime !== "environment" || !actionInFlight && !lifecycleInFlight) return;
    const timer = window.setInterval(() => detailRefetch.current(), 2e3);
    return () => window.clearInterval(timer);
  }, [pollingAction, pollingDesiredState, pollingRuntime]);
  if (detail.isError) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EmptyState, { title: strings.loadFailed, icon: Server });
  if (!site) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(LoadingLine, {});
  const setVisibility = (next) => {
    if (callRef.current) return;
    if (next === "public") {
      setPendingPublic(true);
      return;
    }
    runCall({ path: basePath(siteId), init: jsonBody("PATCH", { visibility: next }) });
  };
  const saveRuntime = () => {
    const command = runtimeCommand.trim();
    if (!command || !detail.data?.runtime || callRef.current) return;
    runCall({
      path: basePath(siteId),
      init: jsonBody("PATCH", { startCommand: command, bind: runtimeBind }),
      done: strings.saved
    });
  };
  const releases = detail.data?.releases ?? [];
  const snapshots = releases.filter((release) => release.kind === "environment-snapshot");
  const fileReleases = releases.filter((release) => release.kind !== "environment-snapshot");
  const visits = (detail.data?.hits ?? []).reduce((sum, entry) => sum + entry.count, 0);
  const runtimeState = detail.data?.runtime ?? null;
  const environment = detail.data?.environment ?? null;
  const VisibilityIcon = VISIBILITY_ICON[site.visibility];
  const visibleOptions = VISIBILITY_ORDER.filter((value) => value !== "public" || allowPublicSites);
  const candidates = (directory.data?.accounts ?? []).filter((account) => account.id !== site.ownerUserId);
  const copyAddress = () => {
    if (site.url) {
      utils.copyText(site.url);
      toast(strings.copied);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex flex-col gap-5", children: [
    failedAction ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      ErrorState,
      {
        message: failedAction.message,
        onRetry: () => {
          const retry = failedAction;
          setFailedAction(null);
          runCall(retry);
        }
      }
    ) : null,
    failedGuests ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      ErrorState,
      {
        message: failedGuests.message,
        onRetry: () => {
          const retry = failedGuests.next;
          setFailedGuests(null);
          void runGuests(retry);
        }
      }
    ) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex items-start justify-between gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-wrap items-center gap-1.5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Badge, { tone: STATUS_TONE[site.status], children: strings[STATUS_STRING[site.status]] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(Badge, { tone: VISIBILITY_TONE[site.visibility], children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(VisibilityIcon, { size: 10, "aria-hidden": true, className: "mr-1" }),
          strings[VISIBILITY_STRING[site.visibility]]
        ] }),
        site.projectSlug ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Badge, { tone: "muted", children: site.projectSlug }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex shrink-0 items-center gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconButton, { icon: Copy, label: strings.copyLink, disabled: site.url === null, onClick: copyAddress }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          IconButton,
          {
            icon: ExternalLink,
            label: strings.openSite,
            disabled: site.status !== "live" || site.url === null,
            onClick: () => {
              if (site.url) window.open(site.url, "_blank", "noopener,noreferrer");
            }
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex flex-col gap-1", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { className: "text-base font-semibold leading-snug text-foreground", children: site.title }),
      site.summary ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-sm leading-relaxed text-muted-foreground", children: site.summary }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Avatar, { size: "sm", name: site.owner.name, user: avatarUser(site.owner) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "flex min-w-0 flex-col", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "text-[10px] uppercase tracking-wide text-muted-foreground", children: strings.columnOwner }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate text-xs text-foreground", children: site.owner.name })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(DetailBlock, { icon: Link2, title: strings.address, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { className: "break-all font-mono text-xs text-foreground", children: site.url }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "grid grid-cols-3 divide-x divide-border/70 border-y border-border/70", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Metric,
        {
          icon: Clock,
          label: strings.lastPublish,
          value: site.lastPublishAt ? relativeTime(site.lastPublishAt) : strings.neverPublished,
          title: site.lastPublishAt ? strings.builtBy.replace("{model}", site.lastPublishModel || "\u2014") : void 0
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Metric, { icon: Activity, label: strings.visits, value: String(visits) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Metric,
        {
          icon: History,
          label: site.runtime === "environment" ? strings.environmentSnapshots : strings.releases,
          value: String(site.runtime === "environment" ? snapshots.length : fileReleases.length)
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(DetailBlock, { icon: ShieldCheck, title: strings.whoCanOpen, hint: strings.sourceNotice, children: [
      canManage ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        SelectMenu,
        {
          value: site.visibility,
          onChange: setVisibility,
          label: strings.whoCanOpen,
          options: visibleOptions.map((value) => {
            const Icon2 = VISIBILITY_ICON[value];
            return { value, label: strings[VISIBILITY_STRING[value]], icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon2, { size: 16 }) };
          })
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "text-sm text-foreground", children: strings[VISIBILITY_STRING[site.visibility]] }),
      !allowPublicSites ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-[11px] text-muted-foreground", children: strings.publicDisabled }) : null
    ] }),
    canManage ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(DetailBlock, { icon: Users, title: strings.guests, hint: strings.guestsHint, children: [
      members.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-[11px] text-muted-foreground", children: strings.noGuests }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "flex flex-col gap-1.5", children: members.map((member) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "flex items-center justify-between gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "flex min-w-0 items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Avatar, { size: "sm", name: member.name, user: avatarUser(member) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate text-sm text-foreground", children: member.name })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          IconButton,
          {
            icon: UserMinus,
            label: strings.removeGuest,
            variant: "danger",
            disabled: call.isPending || saveGuests.isPending,
            onClick: () => runCall({ path: `${basePath(siteId)}/members/${member.id}`, init: { method: "DELETE" } })
          }
        )
      ] }, member.id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "ghost", icon: Users, disabled: call.isPending || saveGuests.isPending, onClick: () => setGuestPicker(true), children: strings.manageGuests }) })
    ] }) : null,
    site.runtime === "environment" && environment ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      EnvironmentDetail,
      {
        siteId,
        currentReleaseId: site.currentReleaseId,
        environment,
        snapshots,
        busy: call.isPending,
        runCall
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(DetailBlock, { icon: History, title: strings.releases, children: fileReleases.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-[11px] text-muted-foreground", children: strings.noReleases }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "flex flex-col gap-1.5", children: fileReleases.map((release) => {
      const live = release.id === site.currentReleaseId;
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: `flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${live ? "border-primary/40 bg-primary/10" : "border-border bg-muted/40"}`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "flex min-w-0 flex-col", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "flex items-center gap-2 text-xs text-foreground", children: [
            relativeTime(release.createdAt),
            " \xB7 ",
            strings.releaseSummary.replace("{files}", String(release.fileCount)).replace("{size}", formatBytes(release.sizeBytes)),
            live ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Badge, { tone: "success", children: strings.releaseLive }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate text-[11px] text-muted-foreground", children: release.note || release.model })
        ] }),
        canManage && !live ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          IconButton,
          {
            icon: RotateCcw,
            label: strings.rollback,
            disabled: call.isPending,
            onClick: () => runCall({
              path: `${basePath(siteId)}/rollback`,
              init: jsonBody("POST", { releaseId: release.id }),
              done: strings.rollbackDone
            })
          }
        ) : null
      ] }, release.id);
    }) }) }),
    runtimeState ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(DetailBlock, { icon: Terminal, title: strings.runtime, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex items-center justify-between gap-3", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Badge, { tone: runtimeState.running ? "success" : "danger", children: runtimeState.running ? strings.runtimeRunning : strings.runtimeStopped }),
        canManage ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          IconButton,
          {
            icon: RefreshCw,
            label: strings.restart,
            disabled: call.isPending,
            onClick: () => runCall({ path: `${basePath(siteId)}/restart`, init: { method: "POST" }, done: strings.restarted })
          }
        ) : null
      ] }),
      canManage ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex flex-col gap-3", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "flex flex-col gap-1", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "text-[10px] uppercase tracking-wide text-muted-foreground", children: strings.runtimeCommand }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            Input,
            {
              value: runtimeCommand,
              onChange: (event) => setRuntimeCommand(event.target.value),
              "aria-label": strings.runtimeCommand,
              className: "font-mono",
              disabled: call.isPending
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          SelectMenu,
          {
            value: runtimeBind,
            onChange: (value) => setRuntimeBind(value === "port" ? "port" : "socket"),
            label: strings.runtimeBind,
            options: [
              { value: "socket", label: strings.runtimeSocket },
              ...runtimeState.allowLoopbackPorts || runtimeBind === "port" ? [{ value: "port", label: strings.runtimePort }] : []
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex items-center justify-between gap-3 text-xs", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "text-muted-foreground", children: strings.runtimeNetwork }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Badge, { tone: runtimeState.network === "shared" ? "warning" : "muted", children: runtimeState.network === "shared" ? strings.runtimeNetworkShared : strings.runtimeNetworkIsolated })
        ] }),
        runtimeBind === "port" && runtimeState.port !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("code", { className: "font-mono text-[11px] text-muted-foreground", children: [
          "127.0.0.1:",
          runtimeState.port
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "ghost", disabled: call.isPending || runtimeCommand.trim() === "", onClick: saveRuntime, children: strings.saveRuntime }) })
      ] }) : runtimeState.startCommand ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex flex-col gap-1", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "text-[10px] uppercase tracking-wide text-muted-foreground", children: strings.runtimeCommand }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { className: "break-all font-mono text-[11px] text-foreground", children: runtimeState.startCommand })
      ] }) : null,
      runtimeState.lastError ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-[11px] text-destructive", children: runtimeState.lastError }) : null,
      runtimeState.logTail !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex flex-col gap-1", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "text-[10px] uppercase tracking-wide text-muted-foreground", children: strings.runtimeLog }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { className: "max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] text-muted-foreground", children: runtimeState.logTail || strings.runtimeEmptyLog })
      ] }) : null
    ] }) : null,
    canManage ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(DetailBlock, { icon: Trash2, title: strings.deleteTitle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-[11px] text-muted-foreground", children: strings.deleteHint }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "ghost-danger", icon: Trash2, onClick: () => setConfirmDelete(true), children: strings.delete }) })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      ManageSelectionModal,
      {
        open: guestPicker,
        title: strings.guestsPickerTitle,
        subtitle: strings.guestsPickerSubtitle,
        onClose: () => setGuestPicker(false),
        items: candidates.map((account) => ({
          id: String(account.id),
          label: account.name,
          group: "accounts",
          groupLabel: strings.guestsGroup,
          icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Avatar, { size: 20, name: account.name, user: avatarUser(account) })
        })),
        countLabel: (count) => strings.guestsCount.replace("{n}", String(count)),
        selected: new Set(members.map((member) => String(member.id))),
        onSave: runGuests,
        saving: saveGuests.isPending,
        emptySelectionHint: strings.noGuests
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      ConfirmDialog,
      {
        open: pendingPublic,
        title: strings.publicConfirm,
        description: strings.publicWarning,
        confirmLabel: strings.publicConfirm,
        onClose: () => setPendingPublic(false),
        onConfirm: () => {
          if (callRef.current) return;
          setPendingPublic(false);
          runCall({ path: basePath(siteId), init: jsonBody("PATCH", { visibility: "public" }) });
        }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      ConfirmDialog,
      {
        open: confirmDelete,
        title: strings.deleteTitle,
        description: strings.deleteHint,
        confirmLabel: strings.delete,
        onClose: () => setConfirmDelete(false),
        onConfirm: () => {
          if (callRef.current) return;
          setConfirmDelete(false);
          runCall(
            { path: basePath(siteId), init: { method: "DELETE" }, done: strings.deleted },
            onDeleted
          );
        }
      }
    )
  ] });
}
function Metric({ icon: Icon2, label, value, title }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-col gap-1 px-2 py-3", title, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon2, { size: 11, "aria-hidden": true }),
      label
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate font-mono text-xs text-foreground", children: value })
  ] });
}

// plugins/sites/web-src/SitesPage.tsx
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
var SECTIONS = ["mine", "shared"];
var isVisibilityFilter = (raw) => raw === "all" || VISIBILITY_ORDER.includes(raw);
var isStatusFilter = (raw) => raw === "all" || STATUS_ORDER.includes(raw);
var matches = (site, needle) => needle === "" || `${site.title} ${site.slug} ${site.summary} ${site.owner.name}`.toLowerCase().includes(needle);
function SitesRegister({ sites, selectedId, onSelect }) {
  const { components, hooks } = runtime();
  const { DataTable, DataTableRow, DataTableCell, MotionPresence, MotionLayoutItem } = components;
  const strings = hooks.usePluginStrings("sites");
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    DataTable,
    {
      ariaLabel: strings.title,
      columns: "minmax(0,1fr) 11rem 8rem 7rem 6.5rem 1.75rem 1.25rem",
      compactColumns: "minmax(0,1fr) 1.75rem 1.25rem",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(DataTableRow, { header: true, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DataTableCell, { header: true, children: strings.columnSite }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DataTableCell, { header: true, priority: "wide", children: strings.columnOwner }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DataTableCell, { header: true, priority: "wide", children: strings.columnVisibility }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DataTableCell, { header: true, priority: "wide", children: strings.columnStatus }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DataTableCell, { header: true, priority: "wide", children: strings.columnPublished }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DataTableCell, { header: true, role: "presentation", "aria-hidden": true, children: null }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DataTableCell, { header: true, role: "presentation", "aria-hidden": true, children: null })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { role: "rowgroup", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(MotionPresence, { children: sites.map((site) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          MotionLayoutItem,
          {
            layoutId: `site-${site.id}`,
            role: "presentation",
            className: "border-b border-border/70 last:border-b-0",
            children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              SiteRow,
              {
                site,
                strings,
                active: selectedId === site.id,
                onSelect: () => onSelect(site.id),
                onNavigate: (direction) => {
                  const index = sites.findIndex((item) => item.id === site.id);
                  const next = direction === "home" ? sites[0] : direction === "end" ? sites[sites.length - 1] : sites[index + (direction === "next" ? 1 : -1)];
                  if (!next) return;
                  requestAnimationFrame(() => document.querySelector(`[data-site-open="${next.id}"]`)?.focus());
                }
              }
            )
          },
          site.id
        )) }) })
      ]
    }
  );
}
function SiteRow({ site, strings, active, onSelect, onNavigate }) {
  const { components } = runtime();
  const { DataTableRow, DataTableCell, Badge, Avatar, IconButton } = components;
  const StatusIcon = STATUS_ICON[site.status];
  const VisibilityIcon = VISIBILITY_ICON[site.visibility];
  const published = site.lastPublishAt ? relativeTime(site.lastPublishAt) : "\u2014";
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(DataTableRow, { selected: active, interactive: true, "aria-selected": active, className: "group", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DataTableCell, { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "button",
      {
        type: "button",
        "data-site-open": site.id,
        onClick: onSelect,
        onKeyDown: (event) => {
          const direction = event.key === "ArrowDown" ? "next" : event.key === "ArrowUp" ? "previous" : event.key === "Home" ? "home" : event.key === "End" ? "end" : null;
          if (!direction) return;
          event.preventDefault();
          onNavigate(direction);
        },
        className: "flex w-full min-w-0 flex-col items-start gap-0.5 text-left",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "flex min-w-0 max-w-full items-center gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(StatusIcon, { size: 12, "aria-hidden": true, className: site.status === "live" ? "shrink-0 text-success" : site.status === "failed" ? "shrink-0 text-destructive" : "shrink-0 text-muted-foreground" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "truncate text-sm text-foreground", children: site.title })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "max-w-full truncate font-mono text-[11px] text-muted-foreground", children: site.url })
        ]
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DataTableCell, { priority: "wide", title: site.owner.name, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "flex min-w-0 items-center gap-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Avatar, { size: 22, name: site.owner.name, user: avatarUser(site.owner) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "truncate text-xs text-muted-foreground", children: site.owner.name })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DataTableCell, { priority: "wide", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(Badge, { tone: VISIBILITY_TONE[site.visibility], children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(VisibilityIcon, { size: 10, "aria-hidden": true, className: "mr-1" }),
      strings[VISIBILITY_STRING[site.visibility]]
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DataTableCell, { priority: "wide", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Badge, { tone: STATUS_TONE[site.status], children: strings[STATUS_STRING[site.status]] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DataTableCell, { priority: "wide", className: "whitespace-nowrap text-xs text-muted-foreground", children: published }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DataTableCell, { children: site.status === "live" && site.url !== null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      IconButton,
      {
        icon: ExternalLink,
        label: strings.openSite,
        onClick: () => window.open(site.url, "_blank", "noopener,noreferrer")
      }
    ) : null }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DataTableCell, { "aria-hidden": true, className: "text-muted-foreground/50 transition-colors group-hover:text-foreground", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ChevronRight, { size: 15 }) })
  ] });
}
function SitesPage() {
  const { components, hooks } = runtime();
  const {
    SpatialWorkspaceLayout,
    WorkspaceMetric,
    WorkspaceDetailRail,
    ControlSurfaceDocument,
    ControlSurfaceRegister,
    ControlSurfaceState,
    RegisterSearch,
    SelectMenu,
    LoadingState,
    ErrorState,
    EmptyState
  } = components;
  const strings = hooks.usePluginStrings("sites");
  const list = hooks.useQuery({
    queryKey: SITES_LIST_KEY,
    queryFn: () => runtime().api("/plugins/sites/api/sites")
  });
  const [section, setSection] = hooks.usePersistentState("elowen.sites.section", "mine", SECTIONS);
  const [visibility, setVisibility] = hooks.usePersistentState("elowen.sites.visibility", "all", isVisibilityFilter);
  const [status, setStatus] = hooks.usePersistentState("elowen.sites.status", "all", isStatusFilter);
  const [query, setQuery] = (0, import_react5.useState)("");
  const [selectedId, setSelectedId] = (0, import_react5.useState)(null);
  const [detailBusy, setDetailBusy] = (0, import_react5.useState)(false);
  const mine = (0, import_react5.useMemo)(() => list.data?.mine ?? [], [list.data]);
  const shared = (0, import_react5.useMemo)(() => list.data?.shared ?? [], [list.data]);
  const sectionSites = (0, import_react5.useMemo)(
    () => section === "mine" ? mine : shared,
    [section, mine, shared]
  );
  const filtered = (0, import_react5.useMemo)(() => {
    const needle = query.trim().toLowerCase();
    return sectionSites.filter((site) => visibility === "all" || site.visibility === visibility).filter((site) => status === "all" || site.status === status).filter((site) => matches(site, needle));
  }, [sectionSites, visibility, status, query]);
  const selected = (0, import_react5.useMemo)(
    () => [...mine, ...shared].find((site) => site.id === selectedId) ?? null,
    [mine, shared, selectedId]
  );
  (0, import_react5.useEffect)(() => {
    if (selectedId !== null && list.data && selected === null) setSelectedId(null);
  }, [selectedId, list.data, selected]);
  const summary = (0, import_react5.useMemo)(() => {
    const all = [...mine, ...shared];
    return {
      total: all.length,
      live: all.filter((site) => site.status === "live").length,
      shared: shared.length,
      published: all.filter((site) => site.visibility === "public").length
    };
  }, [mine, shared]);
  const visibilityOptions = [
    { value: "all", label: strings.filterAllVisibilities, icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Layers, { size: 14 }) },
    ...VISIBILITY_ORDER.map((value) => {
      const Icon2 = VISIBILITY_ICON[value];
      return { value, label: strings[VISIBILITY_STRING[value]], icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon2, { size: 14 }) };
    })
  ];
  const statusOptions = [
    { value: "all", label: strings.filterAllStatuses, icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Layers, { size: 14 }) },
    ...STATUS_ORDER.map((value) => {
      const Icon2 = STATUS_ICON[value];
      return { value, label: strings[STATUS_STRING[value]], icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon2, { size: 14 }) };
    })
  ];
  const toolbarFilters = [
    {
      id: "visibility",
      label: strings.filterVisibility,
      control: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SelectMenu, { value: visibility, onChange: setVisibility, options: visibilityOptions, label: strings.filterVisibility }),
      ...visibility === "all" ? { active: false } : {
        active: true,
        activeLabel: `${strings.filterVisibility}: ${visibilityOptions.find((option) => option.value === visibility)?.label ?? visibility}`,
        onReset: () => setVisibility("all")
      }
    },
    {
      id: "status",
      label: strings.filterStatus,
      control: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SelectMenu, { value: status, onChange: setStatus, options: statusOptions, label: strings.filterStatus }),
      ...status === "all" ? { active: false } : {
        active: true,
        activeLabel: `${strings.filterStatus}: ${statusOptions.find((option) => option.value === status)?.label ?? status}`,
        onReset: () => setStatus("all")
      }
    }
  ];
  const register = () => {
    if (sectionSites.length === 0) {
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(EmptyState, { title: section === "mine" ? strings.empty : strings.emptyShared, icon: Globe });
    }
    if (filtered.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(EmptyState, { title: strings.emptySearch, icon: Search });
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SitesRegister, { sites: filtered, selectedId, onSelect: setSelectedId });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    SpatialWorkspaceLayout,
    {
      hero: {
        eyebrow: strings.title,
        title: strings.title,
        count: summary.total,
        description: strings.subtitle,
        mascotState: list.isLoading ? "saving" : list.isError ? "error" : "idle",
        metrics: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(WorkspaceMetric, { label: strings.metricTotal, value: summary.total, icon: Globe }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(WorkspaceMetric, { label: strings.metricLive, value: summary.live, icon: CircleCheck }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(WorkspaceMetric, { label: strings.metricShared, value: summary.shared, icon: Users }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(WorkspaceMetric, { label: strings.metricPublic, value: summary.published, icon: Layers })
        ] })
      },
      navigation: {
        sections: [
          { id: "mine", label: strings.mine, icon: Globe, count: mine.length },
          { id: "shared", label: strings.shared, icon: Users, count: shared.length }
        ],
        value: section,
        onChange: (value) => setSection(value),
        ariaLabel: strings.title
      },
      toolbar: {
        search: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          RegisterSearch,
          {
            value: query,
            onChange: setQuery,
            placeholder: strings.searchPlaceholder,
            label: strings.searchPlaceholder,
            onClear: () => setQuery("")
          }
        ),
        filters: toolbarFilters
      },
      children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ControlSurfaceDocument, { children: list.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(LoadingState, { variant: "cards" }) }) : list.isError ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ControlSurfaceState, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ErrorState, { message: strings.loadFailed, onRetry: () => list.refetch() }) }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "workspace-master-detail", "data-detail": selected != null, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "flex min-w-0 flex-col gap-4", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ControlSurfaceRegister, { className: "flex flex-col gap-4", children: register() }) }),
        selected ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(WorkspaceDetailRail, { label: strings.detailTitle, closeLabel: strings.close, onClose: () => {
          if (!detailBusy) setSelectedId(null);
        }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          SiteDetail,
          {
            siteId: selected.id,
            allowPublicSites: list.data?.allowPublicSites ?? false,
            onDeleted: () => setSelectedId(null),
            onBusyChange: setDetailBusy
          }
        ) }) : null
      ] }) })
    }
  );
}

// plugins/sites/web-src/EnterPage.tsx
var import_react6 = __toESM(require_react(), 1);
var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
function EnterPage() {
  const { components, hooks } = runtime();
  const { WorkspacePage, PluginPageHeader, LoadingState, EmptyState } = components;
  const strings = hooks.usePluginStrings("sites");
  const [phase, setPhase] = (0, import_react6.useState)("working");
  const formRef = (0, import_react6.useRef)(null);
  const [handoff, setHandoff] = (0, import_react6.useState)(null);
  const started = (0, import_react6.useRef)(false);
  (0, import_react6.useEffect)(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("site") ?? "";
    const returnPath = params.get("r") ?? "";
    if (!slug) {
      setPhase("denied");
      return;
    }
    void runtime().api("/plugins/sites/api/ticket", jsonBody("POST", { slug, r: returnPath })).then((data) => {
      const ticket = data;
      if (!ticket?.token || !ticket?.action) {
        setPhase("denied");
        return;
      }
      setHandoff({ action: ticket.action, token: ticket.token });
    }).catch(() => setPhase("denied"));
  }, []);
  (0, import_react6.useEffect)(() => {
    if (handoff) formRef.current?.submit();
  }, [handoff]);
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(WorkspacePage, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PluginPageHeader, { title: strings.title ?? "Sites", icon: Globe }),
    phase === "working" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(LoadingState, {}) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      EmptyState,
      {
        title: strings.emptyShared ?? "You do not have access to this site.",
        description: strings.subtitle,
        icon: Globe
      }
    ),
    handoff ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("form", { ref: formRef, method: "POST", action: handoff.action, className: "hidden", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { type: "hidden", name: "t", value: handoff.token }) }) : null
  ] });
}

// plugins/sites/web-src/SitesProjectPanel.tsx
var import_react7 = __toESM(require_react(), 1);
var import_jsx_runtime5 = __toESM(require_jsx_runtime(), 1);
function SitesProjectPanel({ project }) {
  const { components, hooks } = runtime();
  const { WorkspaceDetailRail, LoadingState, ErrorState, EmptyState } = components;
  const strings = hooks.usePluginStrings("sites");
  const [selectedId, setSelectedId] = (0, import_react7.useState)(null);
  const [detailBusy, setDetailBusy] = (0, import_react7.useState)(false);
  const list = hooks.useQuery({
    queryKey: SITES_LIST_KEY,
    queryFn: () => runtime().api("/plugins/sites/api/sites")
  });
  const sites = (0, import_react7.useMemo)(
    () => [...list.data?.mine ?? [], ...list.data?.shared ?? []].filter((site) => site.projectId === project.id),
    [list.data, project.id]
  );
  const selected = sites.find((site) => site.id === selectedId) ?? null;
  if (list.isLoading) return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(LoadingState, { variant: "list" });
  if (list.isError) return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ErrorState, { message: strings.loadFailed, onRetry: () => list.refetch() });
  if (sites.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(EmptyState, { title: strings.empty, icon: Globe });
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "workspace-master-detail", "data-detail": selected != null, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(SitesRegister, { sites, selectedId, onSelect: setSelectedId }),
    selected ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(WorkspaceDetailRail, { label: strings.detailTitle, closeLabel: strings.close, onClose: () => {
      if (!detailBusy) setSelectedId(null);
    }, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      SiteDetail,
      {
        siteId: selected.id,
        allowPublicSites: list.data?.allowPublicSites ?? false,
        onDeleted: () => setSelectedId(null),
        onBusyChange: setDetailBusy
      }
    ) }) : null
  ] });
}

// plugins/sites/web-src/EnvironmentsSetup.tsx
var import_react8 = __toESM(require_react(), 1);
var import_jsx_runtime6 = __toESM(require_jsx_runtime(), 1);
var gatewayTone = (status) => status === "ready" ? "success" : status === "missing" ? "warning" : "danger";
function EnvironmentsSetup({ surface }) {
  const host = runtime();
  const {
    Badge,
    Button,
    ConfirmDialog,
    ErrorState,
    HelpTip,
    LoadingState,
    PluginPageHeader,
    SettingsDocument,
    SettingsGroup,
    SettingsRow
  } = host.components;
  const strings = host.hooks.usePluginStrings("sites");
  const { toast } = host.hooks.useToast();
  const [confirmInstall, setConfirmInstall] = (0, import_react8.useState)(false);
  const [provisionError, setProvisionError] = (0, import_react8.useState)(null);
  const installing = (0, import_react8.useRef)(false);
  const gateway = host.hooks.useQuery({
    queryKey: ["sites", "gateway-readiness"],
    queryFn: () => runtime().api("/plugins/sites/api/gateway/readiness"),
    refetchInterval: 3e4
  });
  const environment = host.hooks.useQuery({
    queryKey: ["sites", "environment-readiness"],
    queryFn: () => runtime().api("/plugins/sites/api/environments/readiness")
  });
  const provision = host.hooks.useMutation({
    mutationFn: () => runtime().api("/plugins/sites/api/environments/provision", { method: "POST" }),
    onSuccess: (status) => {
      setProvisionError(null);
      toast(status.ready ? strings.environmentSetupReady : strings.environmentSetupAttention, status.ready ? "ok" : "error");
    },
    onError: (error) => {
      const message = host.utils.apiErrorMessage(error);
      setProvisionError(message);
      toast(message, "error");
    }
  });
  const install = async () => {
    if (installing.current || provision.isPending) return;
    installing.current = true;
    try {
      await provision.mutateAsync();
    } catch {
    } finally {
      installing.current = false;
      setConfirmInstall(false);
      environment.refetch();
    }
  };
  const copy = (value) => {
    host.utils.copyText(value);
    toast(strings.copied);
  };
  if (gateway.isLoading || environment.isLoading) return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(LoadingState, { variant: "block", height: "14rem" });
  if (gateway.isError) return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ErrorState, { message: host.utils.apiErrorMessage(gateway.error), onRetry: () => gateway.refetch() });
  if (environment.isError) return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ErrorState, { message: host.utils.apiErrorMessage(environment.error), onRetry: () => environment.refetch() });
  if (!gateway.data || !environment.data) return null;
  const gatewayStatus = gateway.data.status === "ready" ? strings.environmentStatusReady : gateway.data.status === "missing" ? strings.environmentStatusMissing : gateway.data.status === "misdirected" ? strings.environmentStatusMisdirected : strings.environmentStatusUnavailable;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "space-y-4", children: [
    surface === "page" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      PluginPageHeader,
      {
        title: strings.environmentSetupTitle,
        description: strings.environmentSetupDescription,
        icon: Network
      }
    ) : null,
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(SettingsDocument, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
        SettingsGroup,
        {
          icon: Network,
          title: strings.environmentGatewayTitle,
          description: strings.environmentGatewayDescription,
          density: "compact",
          actions: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Badge, { tone: gatewayTone(gateway.data.status), children: gatewayStatus }),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              SettingsRow,
              {
                label: strings.environmentGatewayCheck,
                trailingLayout: "stack",
                status: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Badge, { tone: gatewayTone(gateway.data.status), children: gatewayStatus }),
                control: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "space-y-1 text-left", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "text-xs text-muted-foreground", children: gateway.data.detail }),
                  gateway.data.observedTargets.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { className: "break-all font-mono text-[11px] text-foreground", children: [
                    strings.environmentObservedTarget,
                    ": ",
                    gateway.data.observedTargets.join(", ")
                  ] }) : null
                ] })
              }
            ),
            gateway.data.expectedRecord ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "grid grid-cols-1 gap-2 sm:grid-cols-3", children: [
              [strings.environmentRecordType, gateway.data.expectedRecord.type],
              [strings.environmentRecordName, gateway.data.expectedRecord.name],
              [strings.environmentRecordValue, gateway.data.expectedRecord.value]
            ].map(([label, value]) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "min-w-0 rounded-md border border-border bg-muted/30 p-3", children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "mb-1 flex items-center justify-between gap-2", children: [
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "text-[10px] uppercase tracking-wide text-muted-foreground", children: label }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Button, { variant: "ghost", icon: Copy, onClick: () => copy(value), title: `${strings.copy} ${label}`, children: strings.copy })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("code", { className: "block break-all font-mono text-xs text-foreground", children: value })
            ] }, label)) }) : null
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
        SettingsGroup,
        {
          icon: PackageCheck,
          title: strings.environmentDependenciesTitle,
          description: strings.environmentDependenciesDescription,
          density: "compact",
          actions: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Badge, { tone: environment.data.ready ? "success" : "warning", children: environment.data.ready ? strings.environmentStatusReady : strings.environmentSetupAttention }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(HelpTip, { children: strings.environmentProvisionHelp })
          ] }),
          children: [
            environment.data.items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              SettingsRow,
              {
                label: item.label,
                icon: item.ok ? CircleCheck : TriangleAlert,
                trailingLayout: item.detail ? "stack" : "inline",
                status: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Badge, { tone: item.ok ? "success" : "danger", children: item.ok ? strings.pass : strings.fail }),
                control: item.detail ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "text-xs text-muted-foreground", children: item.detail }) : void 0
              },
              item.id
            )),
            environment.data.detail ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "px-1 text-xs text-muted-foreground", children: environment.data.detail }) : null,
            provisionError ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "px-1 text-xs text-destructive", role: "alert", children: provisionError }) : null,
            environment.data.canProvision ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "flex justify-end", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              Button,
              {
                variant: "accent",
                icon: PackageCheck,
                disabled: environment.data.ready || provision.isPending || installing.current,
                onClick: () => setConfirmInstall(true),
                children: strings.environmentProvision
              }
            ) }) : null
          ]
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      ConfirmDialog,
      {
        open: confirmInstall,
        title: strings.environmentProvisionConfirmTitle,
        description: strings.environmentProvisionConfirmDescription,
        confirmLabel: strings.environmentProvision,
        pending: provision.isPending,
        onClose: () => {
          if (!provision.isPending) setConfirmInstall(false);
        },
        onConfirm: install
      }
    )
  ] });
}

// plugins/sites/web-src/index.tsx
registerSitesUi(
  {
    "": SitesPage,
    enter: EnterPage
  },
  { sites: SitesProjectPanel },
  { "environment-setup": EnvironmentsSetup }
);
