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
var siteDomainsKey = (siteId) => ["sites", "domains", siteId];
var avatarUser = (person) => person;
var previewImageUrl = (siteId, version) => `/api/plugins/sites/api/site/${encodeURIComponent(siteId)}/preview?v=${version}`;
var PREVIEW_POLL_MS = 4e3;
var awaitingPreview = (sites) => sites.some((site) => site.preview.state === "pending");
var DOMAIN_CHECK_POLL_MS = 2e4;
var awaitingDomain = (domain) => domain.status !== "ready" && domain.removalState === "active";
function relativeTime(iso) {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const locale = document.documentElement.lang || navigator.language || "en";
  const deltaSeconds = Math.round((then - Date.now()) / 1e3);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  const absoluteSeconds = Math.abs(deltaSeconds);
  if (absoluteSeconds < 90) return formatter.format(0, "second");
  const minutes = Math.round(deltaSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(deltaSeconds / 3600);
  if (Math.abs(hours) < 36) return formatter.format(hours, "hour");
  const days = Math.round(deltaSeconds / 86400);
  if (Math.abs(days) < 31) return formatter.format(days, "day");
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(then));
}
var formatBytes = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;

// plugins/sites/web-src/SitesPage.tsx
var import_react6 = __toESM(require_react(), 1);

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

// node_modules/lucide-react/dist/esm/icons/arrow-up-right.js
var ArrowUpRight = createLucideIcon("ArrowUpRight", [
  ["path", { d: "M7 7h10v10", key: "1tivn9" }],
  ["path", { d: "M7 17 17 7", key: "1vkiza" }]
]);

// node_modules/lucide-react/dist/esm/icons/boxes.js
var Boxes = createLucideIcon("Boxes", [
  [
    "path",
    {
      d: "M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z",
      key: "lc1i9w"
    }
  ],
  ["path", { d: "m7 16.5-4.74-2.85", key: "1o9zyk" }],
  ["path", { d: "m7 16.5 5-3", key: "va8pkn" }],
  ["path", { d: "M7 16.5v5.17", key: "jnp8gn" }],
  [
    "path",
    {
      d: "M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z",
      key: "8zsnat"
    }
  ],
  ["path", { d: "m17 16.5-5-3", key: "8arw3v" }],
  ["path", { d: "m17 16.5 4.74-2.85", key: "8rfmw" }],
  ["path", { d: "M17 16.5v5.17", key: "k6z78m" }],
  [
    "path",
    {
      d: "M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z",
      key: "1xygjf"
    }
  ],
  ["path", { d: "M12 8 7.26 5.15", key: "1vbdud" }],
  ["path", { d: "m12 8 4.74-2.85", key: "3rx089" }],
  ["path", { d: "M12 13.5V8", key: "1io7kd" }]
]);

// node_modules/lucide-react/dist/esm/icons/check.js
var Check = createLucideIcon("Check", [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]]);

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

// node_modules/lucide-react/dist/esm/icons/external-link.js
var ExternalLink = createLucideIcon("ExternalLink", [
  ["path", { d: "M15 3h6v6", key: "1q9fwt" }],
  ["path", { d: "M10 14 21 3", key: "gplh6r" }],
  ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", key: "a6xqqp" }]
]);

// node_modules/lucide-react/dist/esm/icons/file-code-2.js
var FileCode2 = createLucideIcon("FileCode2", [
  ["path", { d: "M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4", key: "1pf5j1" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["path", { d: "m5 12-3 3 3 3", key: "oke12k" }],
  ["path", { d: "m9 18 3-3-3-3", key: "112psh" }]
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

// node_modules/lucide-react/dist/esm/icons/image.js
var Image = createLucideIcon("Image", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", ry: "2", key: "1m3agn" }],
  ["circle", { cx: "9", cy: "9", r: "2", key: "af1f0g" }],
  ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21", key: "1xmnt7" }]
]);

// node_modules/lucide-react/dist/esm/icons/key-round.js
var KeyRound = createLucideIcon("KeyRound", [
  [
    "path",
    {
      d: "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z",
      key: "1s6t7t"
    }
  ],
  ["circle", { cx: "16.5", cy: "7.5", r: ".5", fill: "currentColor", key: "w0ekpg" }]
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

// node_modules/lucide-react/dist/esm/icons/plus.js
var Plus = createLucideIcon("Plus", [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "M12 5v14", key: "s699le" }]
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

// node_modules/lucide-react/dist/esm/icons/route.js
var Route = createLucideIcon("Route", [
  ["circle", { cx: "6", cy: "19", r: "3", key: "1kj8tv" }],
  ["path", { d: "M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15", key: "1d8sl" }],
  ["circle", { cx: "18", cy: "5", r: "3", key: "gq8acd" }]
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

// node_modules/lucide-react/dist/esm/icons/star.js
var Star = createLucideIcon("Star", [
  [
    "path",
    {
      d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
      key: "r04s7s"
    }
  ]
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
var displayStatus = (site) => site.degraded ? "degraded" : site.status;
var STATUS_ORDER = ["live", "degraded", "draft", "failed"];
var STATUS_STRING = {
  live: "statusLive",
  degraded: "statusDegraded",
  draft: "statusDraft",
  failed: "statusFailed"
};
var STATUS_ICON = {
  live: CircleDot,
  degraded: TriangleAlert,
  draft: CircleDashed,
  failed: TriangleAlert
};
var STATUS_TONE = {
  live: "success",
  degraded: "warning",
  draft: "muted",
  failed: "danger"
};
var KIND_ICON = {
  static: FileCode2,
  proxy: Server
};
function siteAddress(site) {
  if (site.url === null) return site.slug;
  try {
    return new URL(site.url).host;
  } catch {
    return site.slug;
  }
}
function monogram(title) {
  const first = [...title.trim()][0];
  return first ? first.toLocaleUpperCase() : "";
}

// plugins/sites/web-src/SiteCard.tsx
var import_react3 = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
function SitePlate({ site, strings }) {
  const KindIcon = KIND_ICON[site.kind];
  const state = displayStatus(site);
  const preview = site.preview;
  const [refusedVersion, setRefusedVersion] = (0, import_react3.useState)(null);
  const picture = preview.version > 0 && refusedVersion !== preview.version;
  const frame = state === "failed" ? "border-destructive/40" : state === "degraded" ? "border-warning/40" : "border-border/60";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      "data-site-plate": state,
      "data-site-preview": preview.state,
      className: `relative aspect-[16/6] w-full shrink-0 overflow-hidden rounded-lg border bg-muted/40 ${frame}`,
      children: [
        picture ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "img",
          {
            src: previewImageUrl(site.id, preview.version),
            alt: "",
            "aria-hidden": true,
            loading: "lazy",
            decoding: "async",
            "data-site-picture": site.id,
            onError: () => setRefusedVersion(preview.version),
            className: "absolute inset-0 h-full w-full object-cover object-top"
          },
          preview.version
        ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "span",
          {
            "aria-hidden": true,
            className: `absolute inset-0 flex select-none items-center justify-center pb-7 text-[2.75rem] font-semibold leading-none tracking-tight text-foreground/[0.09] ${preview.state === "pending" ? "motion-safe:animate-pulse" : ""}`,
            children: monogram(site.title)
          }
        ) }),
        picture && preview.state === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "span",
          {
            "data-site-picture-state": preview.state,
            title: preview.capturedAt ? strings.previewCapturedAt.replace("{time}", relativeTime(preview.capturedAt)) : void 0,
            className: "absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-card/90 px-1.5 py-0.5 text-[10px] font-medium text-destructive backdrop-blur-sm",
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TriangleAlert, { size: 9, "aria-hidden": true }),
              strings.previewFailed
            ]
          }
        ) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "absolute inset-x-0 bottom-0 flex min-w-0 items-center gap-1.5 border-t border-border/60 bg-card/85 px-2.5 py-1.5 backdrop-blur-sm", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindIcon, { size: 11, "aria-hidden": true, className: "shrink-0 text-muted-foreground" }),
          site.url === null ? (
            // A draft has no address yet, and the slug it would get is not one. Saying so is the whole
            // content of the strip; printing the slug beside it only invites someone to try it.
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "min-w-0 truncate text-[11px] text-muted-foreground", children: strings.noAddress })
          ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { className: "min-w-0 truncate font-mono text-[11px] text-foreground", title: site.url, children: siteAddress(site) })
        ] })
      ]
    }
  );
}
function SiteCard({ site, strings, selected, onOpen, onNavigate }) {
  const { components, hooks, utils } = runtime();
  const { Avatar, Badge, IconButton } = components;
  const { toast } = hooks.useToast();
  const state = displayStatus(site);
  const VisibilityIcon = VISIBILITY_ICON[site.visibility];
  const published = site.lastPublishAt ? relativeTime(site.lastPublishAt) : strings.neverPublished;
  const hint = state === "degraded" ? strings.stateHintDegraded : state === "failed" ? strings.stateHintFailed : null;
  const openLabel = strings.openDetail.replace("{title}", site.title);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      "data-site-card": site.id,
      "data-selected": selected ? "true" : void 0,
      "aria-current": selected ? "true" : void 0,
      onClick: onOpen,
      onKeyDown: (event) => {
        const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? "next" : event.key === "ArrowUp" || event.key === "ArrowLeft" ? "previous" : event.key === "Home" ? "home" : event.key === "End" ? "end" : null;
        if (!direction) return;
        event.preventDefault();
        onNavigate(direction);
      },
      className: `group flex h-full min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-card p-3.5 transition-colors ${selected ? "border-primary/60 bg-primary/[0.055]" : "border-border hover:border-primary/40"}`,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SitePlate, { site, strings }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex min-w-0 items-start gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex min-w-0 flex-1 flex-col gap-0.5", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "min-w-0 truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary", title: site.title, children: site.title }),
            site.summary ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "min-w-0 truncate text-xs leading-tight text-muted-foreground", title: site.summary, children: site.summary }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "flex shrink-0 items-center gap-1", onClick: (event) => event.stopPropagation(), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              IconButton,
              {
                icon: Copy,
                label: strings.copyLink,
                disabled: site.url === null,
                onClick: () => {
                  if (site.url) {
                    utils.copyText(site.url);
                    toast(strings.copied);
                  }
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex min-w-0 flex-wrap items-center gap-1.5", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { tone: STATUS_TONE[state], children: strings[STATUS_STRING[state]] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Badge, { tone: VISIBILITY_TONE[site.visibility], children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(VisibilityIcon, { size: 10, "aria-hidden": true, className: "mr-1" }),
            strings[VISIBILITY_STRING[site.visibility]]
          ] })
        ] }),
        hint ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: `min-w-0 text-[11px] leading-tight text-balance ${state === "failed" ? "text-destructive" : "text-warning"}`, children: hint }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mt-auto flex min-w-0 items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Avatar, { size: 22, name: site.owner.name, user: avatarUser(site.owner) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "min-w-0 flex-1 truncate text-xs text-muted-foreground", title: site.owner.name, children: site.owner.name }),
          site.projectSlug ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "span",
            {
              className: "flex min-w-0 shrink items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] leading-5 text-muted-foreground",
              title: `${strings.project}: ${site.projectSlug}`,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FolderGit2, { size: 11, "aria-hidden": true, className: "shrink-0" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "min-w-0 truncate", children: site.projectSlug })
              ]
            }
          ) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex min-w-0 items-center gap-2 border-t border-border/70 pt-2.5", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "min-w-0 truncate text-[11px] text-muted-foreground", title: `${strings.lastPublish}: ${published}`, children: published }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "flex-1" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "button",
            {
              type: "button",
              "data-site-open": site.id,
              "aria-label": openLabel,
              onClick: (event) => {
                event.stopPropagation();
                onOpen();
              },
              className: "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
              children: [
                strings.openDetailShort,
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowUpRight, { size: 12, "aria-hidden": true })
              ]
            }
          )
        ] })
      ]
    }
  );
}

// plugins/sites/web-src/SiteDetail.tsx
var import_react5 = __toESM(require_react(), 1);

// plugins/sites/web-src/SiteDomains.tsx
var import_react4 = __toESM(require_react(), 1);
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
var domainPath = (siteId, suffix = "") => "/plugins/sites/api/site/" + encodeURIComponent(siteId) + "/domains" + suffix;
var replaceParams = (strings, code, params) => {
  const template = strings[code] ?? code;
  const locale = document.documentElement.lang || navigator.language || "en";
  return Object.entries(params).reduce((text, [key, raw]) => {
    const parsed = key === "date" || key === "time" ? Date.parse(raw) : Number.NaN;
    const value = Number.isNaN(parsed) ? raw : new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: key === "time" ? "short" : void 0
    }).format(new Date(parsed));
    return text.replaceAll("{" + key + "}", value);
  }, template);
};
var errorCode = (error) => {
  if (typeof error !== "object" || error === null || !("details" in error)) return null;
  const details = error.details;
  if (typeof details !== "object" || details === null || !("error" in details)) return null;
  const value = details.error;
  if (typeof value !== "object" || value === null) return null;
  const code = "code" in value && typeof value.code === "string" ? value.code : null;
  if (!code) return null;
  const rawParams = "params" in value && typeof value.params === "object" && value.params !== null ? value.params : {};
  return {
    code,
    params: Object.fromEntries(Object.entries(rawParams).map(([key, item]) => [key, String(item)]))
  };
};
var badgeFor = (domain, strings) => {
  if (domain.status === "ready") return { label: strings.domainReady, tone: "success" };
  if (domain.status === "renewal_blocked") return { label: strings.renewalBlocked, tone: "warning" };
  if (domain.status === "removing") return { label: strings.domainRemoving, tone: "muted" };
  if (["authority_refused", "rate_limited", "expired", "misdirected"].includes(domain.status)) {
    return { label: strings.domainAttention, tone: "danger" };
  }
  return { label: strings.domainPending, tone: "muted" };
};
var stepBadge = (state, strings) => {
  if (state === "ready") return { label: strings.domainReady, tone: "success" };
  if (["unavailable", "misdirected", "authority_refused", "rate_limited", "expired"].includes(state)) {
    return { label: strings.domainAttention, tone: "danger" };
  }
  if (state === "renewal_blocked") return { label: strings.renewalBlocked, tone: "warning" };
  return { label: strings.domainPending, tone: "muted" };
};
function RecordRows({ records, strings }) {
  const { components, utils } = runtime();
  const { IconButton } = components;
  if (records.length === 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "flex min-w-0 flex-col gap-2", children: records.map((record, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "div",
    {
      className: "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-border/60 bg-muted/30 p-2",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "rounded bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground", children: record.type }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "min-w-0", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { className: "block break-all font-mono text-[11px] text-foreground", children: record.name }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { className: "block break-all font-mono text-[11px] text-muted-foreground", children: record.value })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          IconButton,
          {
            icon: Copy,
            label: strings.copy + " " + record.type,
            onClick: () => utils.copyText(record.value)
          }
        )
      ]
    },
    record.type + ":" + record.name + ":" + record.value + ":" + index
  )) });
}
function StepRow({ icon: Icon2, title, badge, done, spin, text, help, last, muted, children }) {
  const { components } = runtime();
  const { Badge, HelpTip } = components;
  const Marker = done ? Check : Icon2;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 gap-3", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex flex-col items-center", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "span",
        {
          className: "grid h-7 w-7 shrink-0 place-items-center rounded-full border " + (done ? "border-success/50 bg-success/10 text-success" : "border-border bg-muted/40 text-muted-foreground"),
          children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Marker, { className: "h-3.5 w-3.5" + (spin ? " animate-spin" : "") })
        }
      ),
      last ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "mt-1 w-px flex-1 bg-border" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "min-w-0 flex-1 " + (last ? "pb-0" : "pb-5"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-wrap items-center gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: muted ? "text-xs text-muted-foreground" : "text-sm font-medium text-foreground", children: title }),
        badge ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Badge, { tone: badge.tone, children: badge.label }) : null,
        help ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(HelpTip, { children: help }) : null
      ] }),
      text === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "mt-1 text-xs leading-relaxed text-muted-foreground", children: text }),
      children ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "mt-2", children }) : null
    ] })
  ] });
}
function SetupBody({ domain, strings, secondsToNextCheck, checking }) {
  const { components } = runtime();
  const { HelpTip } = components;
  const watching = awaitingDomain(domain);
  const routingHelp = [strings[domain.routing.hint], domain.delegatedRootWarning ? strings.delegatedRootHint : ""].filter((line) => line !== "").join(" ");
  const meta = [
    checking || secondsToNextCheck === null ? strings.checking : strings.nextCheckIn.replace("{seconds}", String(secondsToNextCheck)),
    domain.ownership.expiresAt ? strings.reservationExpires.replace("{time}", relativeTime(domain.ownership.expiresAt)) : ""
  ].filter((line) => line !== "");
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-col gap-4", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 items-start gap-1.5", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "min-w-0 text-sm leading-relaxed text-muted-foreground", children: strings.domainSetupIntro }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(HelpTip, { align: "right", children: strings.dnsPropagation })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-col", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        StepRow,
        {
          icon: KeyRound,
          title: strings.ownershipStep,
          badge: stepBadge(domain.ownership.state, strings),
          done: domain.ownership.state === "ready",
          text: replaceParams(strings, domain.ownership.code, domain.ownership.params),
          help: strings.ownershipHint,
          children: domain.ownership.state === "ready" ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(RecordRows, { records: [domain.ownership.record], strings })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        StepRow,
        {
          icon: Route,
          title: strings.routingStep,
          badge: stepBadge(domain.routing.state, strings),
          done: domain.routing.state === "ready",
          text: replaceParams(strings, domain.routing.code, domain.routing.params),
          help: routingHelp,
          children: domain.routing.state === "ready" ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            RecordRows,
            {
              records: [...domain.routing.recommended, ...domain.routing.alternatives],
              strings
            }
          )
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        StepRow,
        {
          icon: ShieldCheck,
          title: strings.secureStep,
          badge: stepBadge(domain.certificate.state, strings),
          done: domain.certificate.state === "ready",
          text: replaceParams(strings, domain.certificate.code, domain.certificate.params),
          last: !watching
        }
      ),
      watching ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        StepRow,
        {
          icon: RefreshCw,
          title: strings.domainAutoChecking,
          done: false,
          spin: true,
          text: meta.join(" \xB7 "),
          muted: true,
          last: true
        }
      ) : null
    ] })
  ] });
}
function ConnectedBody({ domain, strings }) {
  const { components, utils } = runtime();
  const { Badge, IconButton } = components;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 p-3", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-wrap items-center gap-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Badge, { tone: "success", children: strings.domainReady }),
      domain.isPrimary ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Badge, { tone: "accent", children: strings.primary }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { className: "min-w-0 break-all font-mono text-xs text-foreground", children: domain.url }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex shrink-0 items-center gap-1", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconButton, { icon: Copy, label: strings.copyLink, onClick: () => utils.copyText(domain.url) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          IconButton,
          {
            icon: ExternalLink,
            label: strings.openSite,
            onClick: () => window.open(domain.url, "_blank", "noopener,noreferrer")
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-xs leading-relaxed text-muted-foreground", children: replaceParams(strings, domain.certificate.code, domain.certificate.params) })
  ] });
}
function SiteDomains({ siteId }) {
  const { components, hooks, utils } = runtime();
  const {
    Badge,
    Button,
    ConfirmDialog,
    DetailBlock,
    EmptyState,
    ErrorState,
    HelpTip,
    IconButton,
    Input,
    LoadingState,
    Modal,
    ModalBody,
    ModalFooter
  } = components;
  const strings = hooks.usePluginStrings("sites");
  const queryClient = hooks.useQueryClient();
  const { toast } = hooks.useToast();
  const query = hooks.useQuery({
    queryKey: siteDomainsKey(siteId),
    queryFn: () => runtime().api(domainPath(siteId))
  });
  const [dialog, setDialog] = (0, import_react4.useState)(null);
  const [hostname, setHostname] = (0, import_react4.useState)("");
  const [dialogError, setDialogError] = (0, import_react4.useState)(null);
  const [removeDomain, setRemoveDomain] = (0, import_react4.useState)(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: siteDomainsKey(siteId) });
    void queryClient.invalidateQueries({ queryKey: ["sites", "detail", siteId] });
    void queryClient.invalidateQueries({ queryKey: ["sites", "list"] });
  };
  const storeDomain = (domain) => {
    queryClient.setQueryData(siteDomainsKey(siteId), (previous) => {
      if (!previous) return previous;
      const known = previous.domains.some((entry) => entry.id === domain.id);
      return {
        ...previous,
        domains: known ? previous.domains.map((entry) => entry.id === domain.id ? domain : entry) : [...previous.domains, domain]
      };
    });
  };
  const add = hooks.useMutation({
    mutationFn: (value) => runtime().api(domainPath(siteId), jsonBody("POST", { hostname: value })),
    onSuccess: (result) => {
      setDialogError(null);
      setHostname("");
      storeDomain(result.domain);
      setDialog({ mode: "setup", domainId: result.domain.id });
      refresh();
    },
    onError: (error) => {
      const coded = errorCode(error);
      const message = coded ? replaceParams(strings, coded.code, coded.params) : utils.apiErrorMessage(error);
      setDialogError(message);
      toast(message, "error");
    }
  });
  const check = hooks.useMutation({
    mutationFn: (input) => runtime().api(
      domainPath(siteId, "/" + encodeURIComponent(input.id) + "/check"),
      { method: "POST" }
    ),
    onSuccess: (result) => {
      setDialogError(null);
      storeDomain(result.domain);
      refresh();
    },
    onError: (error, input) => {
      const message = utils.apiErrorMessage(error);
      setDialogError(message);
      if (input.manual) toast(message, "error");
    }
  });
  const primary = hooks.useMutation({
    mutationFn: (domain) => runtime().api(
      domainPath(siteId, "/" + encodeURIComponent(domain.id) + "/primary"),
      { method: "POST" }
    ),
    onSuccess: () => {
      toast(strings.saved);
      refresh();
    },
    onError: (error) => toast(utils.apiErrorMessage(error), "error")
  });
  const remove = hooks.useMutation({
    mutationFn: (domain) => runtime().api(
      domainPath(siteId, "/" + encodeURIComponent(domain.id)),
      { method: "DELETE" }
    ),
    onSuccess: (result) => {
      setRemoveDomain(null);
      if (result.removed) {
        if (dialog?.mode === "setup") setDialog(null);
      } else if (result.domain) {
        storeDomain(result.domain);
      }
      refresh();
    },
    onError: (error) => toast(utils.apiErrorMessage(error), "error")
  });
  const open = (url) => window.open(url, "_blank", "noopener,noreferrer");
  const data = query.data;
  const setupId = dialog?.mode === "setup" ? dialog.domainId : null;
  const setupDomain = setupId === null ? null : data?.domains.find((entry) => entry.id === setupId) ?? null;
  const watching = setupDomain !== null && awaitingDomain(setupDomain);
  const [nextCheckAt, setNextCheckAt] = (0, import_react4.useState)(null);
  const [now, setNow] = (0, import_react4.useState)(() => Date.now());
  const checkRef = (0, import_react4.useRef)(check);
  checkRef.current = check;
  (0, import_react4.useEffect)(() => {
    if (!watching || setupId === null) {
      setNextCheckAt(null);
      return void 0;
    }
    setNextCheckAt(Date.now() + DOMAIN_CHECK_POLL_MS);
    const timer = window.setInterval(() => setNow(Date.now()), 1e3);
    return () => window.clearInterval(timer);
  }, [watching, setupId]);
  (0, import_react4.useEffect)(() => {
    if (!watching || setupId === null || nextCheckAt === null || now < nextCheckAt) return;
    if (checkRef.current.isPending) return;
    setNextCheckAt(Date.now() + DOMAIN_CHECK_POLL_MS);
    checkRef.current.mutate({ id: setupId, manual: false });
  }, [now, nextCheckAt, watching, setupId]);
  const secondsToNextCheck = nextCheckAt === null ? null : Math.max(0, Math.ceil((nextCheckAt - now) / 1e3));
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(DetailBlock, { icon: Link2, title: strings.addresses, children: [
      query.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(LoadingState, { variant: "block", height: "h-24" }) : null,
      query.isError ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ErrorState, { message: strings.domainsLoadFailed, onRetry: () => query.refetch() }) : null,
      data ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-col gap-4", "data-site-domains": true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex h-9 items-center gap-1.5", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "text-xs font-semibold text-foreground", children: strings.generatedAddress }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(HelpTip, { children: strings.generatedAddressHint })
        ] }),
        data.generated ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-col gap-3 rounded-lg border border-border/60 p-3 sm:flex-row sm:items-start sm:justify-between", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-wrap items-center gap-1.5", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { className: "break-all font-mono text-xs text-foreground", children: data.generated.displayHostname }),
            data.generated.effective ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Badge, { tone: "accent", children: strings.primary }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex shrink-0 items-center gap-1", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              IconButton,
              {
                icon: Copy,
                label: strings.copyLink,
                onClick: () => utils.copyText(data.generated.url)
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              IconButton,
              {
                icon: ExternalLink,
                label: strings.openSite,
                onClick: () => open(data.generated.url)
              }
            )
          ] })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-xs text-muted-foreground", children: strings.noAddress }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex h-9 items-center justify-between gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "text-xs font-semibold text-foreground", children: strings.customDomains }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            Button,
            {
              variant: "ghost",
              icon: Plus,
              onClick: () => {
                setDialogError(null);
                setDialog({ mode: "add" });
              },
              children: strings.addDomain
            }
          )
        ] }),
        data.domains.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EmptyState, { title: strings.noCustomDomains, icon: Earth }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "flex min-w-0 flex-col gap-3", children: data.domains.map((domain) => {
          const badge = badgeFor(domain, strings);
          return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "div",
            {
              className: "flex min-w-0 flex-col gap-3 rounded-lg border border-border/60 p-3",
              children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between", children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "min-w-0", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-wrap items-center gap-1.5", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { className: "break-all font-mono text-xs text-foreground", children: domain.displayHostname }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Badge, { tone: badge.tone, children: badge.label }),
                    domain.isPrimary ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Badge, { tone: "accent", children: strings.primary }) : null
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "mt-1 text-xs leading-relaxed text-muted-foreground", children: domain.status === "removing" ? strings.domainRemoving : replaceParams(strings, domain.statusCode, domain.statusParams) })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex shrink-0 items-center gap-1", children: [
                  domain.canOpen ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                      IconButton,
                      {
                        icon: Copy,
                        label: strings.copyLink,
                        onClick: () => utils.copyText(domain.url)
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                      IconButton,
                      {
                        icon: ExternalLink,
                        label: strings.openSite,
                        onClick: () => open(domain.url)
                      }
                    )
                  ] }) : null,
                  domain.status === "ready" && !domain.isPrimary ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                    Button,
                    {
                      variant: "ghost",
                      icon: Star,
                      disabled: primary.isPending,
                      onClick: () => primary.mutate(domain),
                      children: strings.makePrimary
                    }
                  ) : null,
                  domain.status !== "ready" && domain.removalState === "active" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                    Button,
                    {
                      variant: "ghost",
                      onClick: () => {
                        setDialogError(null);
                        setDialog({ mode: "setup", domainId: domain.id });
                      },
                      children: strings.continueSetup
                    }
                  ) : null,
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                    IconButton,
                    {
                      icon: Trash2,
                      label: strings.removeDomain,
                      variant: "danger",
                      onClick: () => setRemoveDomain(domain)
                    }
                  )
                ] })
              ] })
            },
            domain.id
          );
        }) })
      ] }) : null
    ] }),
    dialog?.mode === "add" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      Modal,
      {
        title: strings.addDomain,
        description: strings.domainExample,
        icon: Earth,
        size: "sm",
        onClose: () => {
          if (!add.isPending) setDialog(null);
        },
        closeDisabled: add.isPending,
        "aria-busy": add.isPending ? true : void 0,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(ModalBody, { gap: 4, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "flex flex-col gap-2 text-sm font-medium text-foreground", children: [
              strings.domainName,
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                Input,
                {
                  value: hostname,
                  onChange: (event) => setHostname(event.target.value),
                  placeholder: strings.domainExample,
                  "aria-label": strings.domainName,
                  autoComplete: "off",
                  disabled: add.isPending
                }
              )
            ] }),
            dialogError ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", className: "text-sm text-destructive", children: dialogError }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(ModalFooter, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "ghost", disabled: add.isPending, onClick: () => setDialog(null), children: strings.close }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              Button,
              {
                variant: "accent",
                icon: Plus,
                disabled: add.isPending || hostname.trim() === "",
                onClick: () => add.mutate(hostname),
                children: strings.addDomain
              }
            )
          ] })
        ]
      }
    ) : null,
    setupDomain ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      Modal,
      {
        title: (setupDomain.status === "ready" ? strings.domainConnectedTitle : strings.domainSetupTitle).replace("{hostname}", setupDomain.displayHostname),
        icon: Earth,
        size: "md",
        onClose: () => setDialog(null),
        "aria-busy": check.isPending ? true : void 0,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(ModalBody, { gap: 4, children: [
            dialogError ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ErrorState, { message: dialogError }) : null,
            setupDomain.status === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ConnectedBody, { domain: setupDomain, strings }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              SetupBody,
              {
                domain: setupDomain,
                strings,
                secondsToNextCheck,
                checking: check.isPending
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(ModalFooter, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              Button,
              {
                variant: "ghost-danger",
                icon: Trash2,
                onClick: () => setRemoveDomain(setupDomain),
                children: strings.removeDomain
              }
            ),
            setupDomain.status === "ready" && !setupDomain.isPrimary ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              Button,
              {
                variant: "ghost",
                icon: Star,
                disabled: primary.isPending,
                onClick: () => primary.mutate(setupDomain),
                children: strings.makePrimary
              }
            ) : null,
            watching ? (
              // The button neither changes its label nor greys out while an automatic check runs: that
              // happens every few seconds on its own, and a control that blinks with it looks broken.
              // Pressing it brings the next check forward instead of adding a second one.
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                Button,
                {
                  variant: "accent",
                  onClick: () => {
                    if (check.isPending) return;
                    setNextCheckAt(Date.now() + DOMAIN_CHECK_POLL_MS);
                    check.mutate({ id: setupDomain.id, manual: true });
                  },
                  children: strings.checkAgain
                }
              )
            ) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "accent", onClick: () => setDialog(null), children: strings.close })
          ] })
        ]
      }
    ) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      ConfirmDialog,
      {
        open: removeDomain !== null,
        title: strings.removeDomainTitle.replace("{hostname}", removeDomain?.displayHostname ?? ""),
        description: strings.removeDomainHint,
        confirmLabel: strings.removeDomain,
        confirmVariant: "danger",
        pending: remove.isPending,
        onConfirm: () => removeDomain ? remove.mutateAsync(removeDomain) : void 0,
        onClose: () => {
          if (!remove.isPending) setRemoveDomain(null);
        }
      }
    )
  ] });
}
function ReadOnlySiteAddress({ url, strings }) {
  const { components } = runtime();
  const { DetailBlock } = components;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(DetailBlock, { icon: Link2, title: strings.address, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { className: "break-all font-mono text-xs text-foreground", children: url }) });
}

// plugins/sites/web-src/SiteDetail.tsx
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
var basePath = (siteId) => `/plugins/sites/api/site/${siteId}`;
function PreviewBlock({ site, notice, busy, onRefresh, strings }) {
  const { components } = runtime();
  const { Badge, Button, DetailBlock } = components;
  const preview = site.preview;
  const [refusedVersion, setRefusedVersion] = (0, import_react5.useState)(null);
  const picture = preview.version > 0 && refusedVersion !== preview.version;
  const taken = preview.capturedAt ? strings.previewCapturedAt.replace("{time}", relativeTime(preview.capturedAt)) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(DetailBlock, { icon: Image, title: strings.previewTitle, hint: strings.previewHint, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "relative aspect-[16/6] w-full overflow-hidden rounded-lg border border-border/60 bg-muted/40", children: picture ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "img",
      {
        src: previewImageUrl(site.id, preview.version),
        alt: "",
        "aria-hidden": true,
        "data-site-picture": site.id,
        onError: () => setRefusedVersion(preview.version),
        className: "absolute inset-0 h-full w-full object-cover object-top"
      },
      preview.version
    ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "span",
      {
        className: `absolute inset-0 flex items-center justify-center px-4 text-center text-[11px] text-muted-foreground ${preview.state === "pending" ? "motion-safe:animate-pulse" : ""}`,
        children: preview.state === "pending" ? strings.previewPending : strings.previewNone
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex min-w-0 items-center gap-2", children: [
      taken ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "min-w-0 truncate text-[11px] text-muted-foreground", children: taken }) : null,
      preview.state === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Badge, { tone: "danger", children: strings.previewFailed }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "flex-1" }),
      site.canManage ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        Button,
        {
          variant: "ghost",
          icon: RefreshCw,
          disabled: busy || preview.state === "pending",
          onClick: onRefresh,
          children: strings.previewRefresh
        }
      ) : null
    ] }),
    notice ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "text-[11px] leading-tight text-muted-foreground", children: notice }) : null
  ] });
}
function SiteDetail({ siteId, allowPublicSites, onDeleted, onBusyChange }) {
  const { components, hooks, utils } = runtime();
  const {
    Avatar,
    Badge,
    Button,
    IconButton,
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
  const [pendingPublic, setPendingPublic] = (0, import_react5.useState)(false);
  const [confirmDelete, setConfirmDelete] = (0, import_react5.useState)(false);
  const [guestPicker, setGuestPicker] = (0, import_react5.useState)(false);
  const [failedAction, setFailedAction] = (0, import_react5.useState)(null);
  const [failedGuests, setFailedGuests] = (0, import_react5.useState)(null);
  const callRef = (0, import_react5.useRef)(false);
  const guestsRef = (0, import_react5.useRef)(false);
  const detail = hooks.useQuery({
    queryKey: siteDetailKey(siteId),
    queryFn: () => runtime().api(basePath(siteId)),
    // A capture is the only reason this drawer has to look again on its own, and only while one is running:
    // a register nothing is happening in asks for nothing.
    refetchInterval: (query) => query.state.data?.site.preview.state === "pending" ? PREVIEW_POLL_MS : false
  });
  const detailRefetch = (0, import_react5.useRef)(detail.refetch);
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
      const deleted = vars.path === basePath(siteId) && vars.init.method === "DELETE";
      if (deleted) onDeleted();
      else void queryClient.invalidateQueries({ queryKey: siteDetailKey(siteId) });
      void queryClient.invalidateQueries({ queryKey: SITES_LIST_KEY });
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
  (0, import_react5.useEffect)(() => {
    onBusyChange?.(callRef.current || guestsRef.current || call.isPending || saveGuests.isPending);
  }, [call.isPending, onBusyChange, saveGuests.isPending]);
  if (detail.isError) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(EmptyState, { title: strings.loadFailed, icon: Server });
  if (!site) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(LoadingLine, {});
  const setVisibility = (next) => {
    if (callRef.current) return;
    if (next === "public") {
      setPendingPublic(true);
      return;
    }
    runCall({ path: basePath(siteId), init: jsonBody("PATCH", { visibility: next }) });
  };
  const releases = detail.data?.releases ?? [];
  const fileReleases = releases;
  const visits = (detail.data?.hits ?? []).reduce((sum, entry) => sum + entry.count, 0);
  const displayedStatus = displayStatus(site);
  const VisibilityIcon = VISIBILITY_ICON[site.visibility];
  const visibleOptions = VISIBILITY_ORDER.filter((value) => value !== "public" || allowPublicSites);
  const candidates = (directory.data?.accounts ?? []).filter((account) => account.id !== site.ownerUserId);
  const copyAddress = () => {
    if (site.url) {
      utils.copyText(site.url);
      toast(strings.copied);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-col gap-5", children: [
    failedAction ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
    failedGuests ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-col gap-1.5", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex items-start justify-between gap-3", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex min-w-0 flex-wrap items-center gap-1.5", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Badge, { tone: STATUS_TONE[displayedStatus], children: strings[STATUS_STRING[displayedStatus]] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(Badge, { tone: VISIBILITY_TONE[site.visibility], children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(VisibilityIcon, { size: 10, "aria-hidden": true, className: "mr-1" }),
            strings[VISIBILITY_STRING[site.visibility]]
          ] }),
          site.projectSlug ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Badge, { tone: "muted", children: site.projectSlug }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex shrink-0 items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IconButton, { icon: Copy, label: strings.copyLink, disabled: site.url === null, onClick: copyAddress }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
      detail.data?.lastError ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "text-[11px] text-destructive", children: detail.data.lastError }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-col gap-1", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { className: "text-base font-semibold leading-snug text-foreground", children: site.title }),
      site.summary ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "text-sm leading-relaxed text-muted-foreground", children: site.summary }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Avatar, { size: "sm", name: site.owner.name, user: avatarUser(site.owner) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "flex min-w-0 flex-col", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "text-[10px] uppercase tracking-wide text-muted-foreground", children: strings.columnOwner }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "truncate text-xs text-foreground", children: site.owner.name })
      ] })
    ] }),
    canManage ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SiteDomains, { siteId: site.id }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ReadOnlySiteAddress, { url: site.url, strings }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      PreviewBlock,
      {
        site,
        notice: detail.data?.previewNotice ?? null,
        busy: call.isPending,
        strings,
        onRefresh: () => runCall({
          path: `${basePath(siteId)}/preview/refresh`,
          init: { method: "POST" },
          done: strings.previewRefreshed
        })
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "grid grid-cols-3 divide-x divide-border/70 border-y border-border/70", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        Metric,
        {
          icon: Clock,
          label: strings.lastPublish,
          value: site.lastPublishAt ? relativeTime(site.lastPublishAt) : strings.neverPublished,
          title: site.lastPublishAt ? strings.builtBy.replace("{model}", site.lastPublishModel || "\u2014") : void 0
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Metric, { icon: Activity, label: strings.visits, value: String(visits) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        Metric,
        {
          icon: History,
          label: site.kind === "proxy" ? strings.kindProxy : strings.releases,
          value: site.kind === "proxy" ? site.target || "\u2014" : String(fileReleases.length)
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(DetailBlock, { icon: ShieldCheck, title: strings.whoCanOpen, hint: strings.sourceNotice, children: [
      canManage ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        SelectMenu,
        {
          value: site.visibility,
          onChange: setVisibility,
          label: strings.whoCanOpen,
          options: visibleOptions.map((value) => {
            const Icon2 = VISIBILITY_ICON[value];
            return { value, label: strings[VISIBILITY_STRING[value]], icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon2, { size: 16 }) };
          })
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "text-sm text-foreground", children: strings[VISIBILITY_STRING[site.visibility]] }),
      !allowPublicSites ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "text-[11px] text-muted-foreground", children: strings.publicDisabled }) : null
    ] }),
    canManage ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(DetailBlock, { icon: Users, title: strings.guests, hint: strings.guestsHint, children: [
      members.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "text-[11px] text-muted-foreground", children: strings.noGuests }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: "flex flex-col gap-1.5", children: members.map((member) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { className: "flex items-center justify-between gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "flex min-w-0 items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Avatar, { size: "sm", name: member.name, user: avatarUser(member) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "truncate text-sm text-foreground", children: member.name })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Button, { variant: "ghost", icon: Users, disabled: call.isPending || saveGuests.isPending, onClick: () => setGuestPicker(true), children: strings.manageGuests }) })
    ] }) : null,
    site.kind === "proxy" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(DetailBlock, { icon: Boxes, title: strings.kindProxy, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "text-sm text-foreground", children: strings.projectPublicationLink.replace("{project}", site.projectSlug ?? "\u2014") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Button, { variant: "ghost", icon: ExternalLink, onClick: () => runtime().navigate(`/projects?project=${site.projectId}`), children: strings.openProject }) })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DetailBlock, { icon: History, title: strings.releases, children: fileReleases.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "text-[11px] text-muted-foreground", children: strings.noReleases }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: "flex flex-col gap-1.5", children: fileReleases.map((release) => {
      const live = release.id === site.currentReleaseId;
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { className: `flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${live ? "border-primary/40 bg-primary/10" : "border-border bg-muted/40"}`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "flex min-w-0 flex-col", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "flex items-center gap-2 text-xs text-foreground", children: [
            relativeTime(release.createdAt),
            " \xB7 ",
            strings.releaseSummary.replace("{files}", String(release.fileCount)).replace("{size}", formatBytes(release.sizeBytes)),
            live ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Badge, { tone: "success", children: strings.releaseLive }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "truncate text-[11px] text-muted-foreground", children: release.note || release.model })
        ] }),
        canManage && !live ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
    canManage ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(DetailBlock, { icon: Trash2, title: strings.deleteTitle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "text-[11px] text-muted-foreground", children: strings.deleteHint }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Button, { variant: "ghost-danger", icon: Trash2, onClick: () => setConfirmDelete(true), children: strings.delete }) })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
          icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Avatar, { size: 20, name: account.name, user: avatarUser(account) })
        })),
        countLabel: (count) => strings.guestsCount.replace("{n}", String(count)),
        selected: new Set(members.map((member) => String(member.id))),
        onSave: runGuests,
        saving: saveGuests.isPending,
        emptySelectionHint: strings.noGuests
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
          runCall({ path: basePath(siteId), init: { method: "DELETE" }, done: strings.deleted });
        }
      }
    )
  ] });
}
function Metric({ icon: Icon2, label, value, title }) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex min-w-0 flex-col gap-1 px-2 py-3", title, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon2, { size: 11, "aria-hidden": true }),
      label
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "truncate font-mono text-xs text-foreground", children: value })
  ] });
}

// plugins/sites/web-src/SitesPage.tsx
var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
var SECTIONS = ["mine", "shared"];
var isVisibilityFilter = (raw) => raw === "all" || VISIBILITY_ORDER.includes(raw);
var isStatusFilter = (raw) => raw === "all" || STATUS_ORDER.includes(raw);
var matches = (site, needle) => needle === "" || `${site.title} ${site.slug} ${site.summary} ${site.owner.name}`.toLowerCase().includes(needle);
function SitesRegister({ sites, selectedId, onSelect }) {
  const { components, hooks } = runtime();
  const { MotionPresence, MotionLayoutItem } = components;
  const strings = hooks.usePluginStrings("sites");
  return (
    // The container is the WRAPPER, not the grid. A container query resolves against an ancestor
    // container and never against the element declaring itself one, so `@container` on the grid would
    // silently leave the column variants resolving against whatever shell happens to be above it — one
    // column wherever no shell declares itself a container, which is exactly what a Project panel is.
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "@container", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "div",
      {
        role: "list",
        "aria-label": strings.title,
        "data-testid": "sites-register",
        className: "grid grid-cols-1 gap-3 @min-[38rem]:grid-cols-2 @min-[58rem]:grid-cols-3",
        children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(MotionPresence, { children: sites.map((site) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(MotionLayoutItem, { layoutId: `site-${site.id}`, role: "listitem", className: "min-w-0", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          SiteCard,
          {
            site,
            strings,
            selected: selectedId === site.id,
            onOpen: () => onSelect(site.id),
            onNavigate: (direction) => {
              const index = sites.findIndex((item) => item.id === site.id);
              const next = direction === "home" ? sites[0] : direction === "end" ? sites[sites.length - 1] : sites[index + (direction === "next" ? 1 : -1)];
              if (!next) return;
              requestAnimationFrame(() => document.querySelector(`[data-site-open="${next.id}"]`)?.focus());
            }
          }
        ) }, site.id)) })
      }
    ) })
  );
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
    queryFn: () => runtime().api("/plugins/sites/api/sites"),
    // A picture being taken is the only reason this register looks again on its own. The interval is a
    // function of the data, so the moment the last capture lands the polling stops by itself — a register
    // nobody is publishing into costs nothing.
    refetchInterval: (query2) => {
      const data = query2.state.data;
      return data && awaitingPreview([...data.mine, ...data.shared]) ? PREVIEW_POLL_MS : false;
    }
  });
  const [section, setSection] = hooks.usePersistentState("elowen.sites.section", "mine", SECTIONS);
  const [visibility, setVisibility] = hooks.usePersistentState("elowen.sites.visibility", "all", isVisibilityFilter);
  const [status, setStatus] = hooks.usePersistentState("elowen.sites.status", "all", isStatusFilter);
  const [query, setQuery] = (0, import_react6.useState)("");
  const [selectedId, setSelectedId] = (0, import_react6.useState)(null);
  const [detailBusy, setDetailBusy] = (0, import_react6.useState)(false);
  const mine = (0, import_react6.useMemo)(() => list.data?.mine ?? [], [list.data]);
  const shared = (0, import_react6.useMemo)(() => list.data?.shared ?? [], [list.data]);
  const sectionSites = (0, import_react6.useMemo)(
    () => section === "mine" ? mine : shared,
    [section, mine, shared]
  );
  const filtered = (0, import_react6.useMemo)(() => {
    const needle = query.trim().toLowerCase();
    return sectionSites.filter((site) => visibility === "all" || site.visibility === visibility).filter((site) => status === "all" || displayStatus(site) === status).filter((site) => matches(site, needle));
  }, [sectionSites, visibility, status, query]);
  const selected = (0, import_react6.useMemo)(
    () => [...mine, ...shared].find((site) => site.id === selectedId) ?? null,
    [mine, shared, selectedId]
  );
  (0, import_react6.useEffect)(() => {
    if (selectedId !== null && list.data && selected === null) setSelectedId(null);
  }, [selectedId, list.data, selected]);
  const summary = (0, import_react6.useMemo)(() => {
    const all = [...mine, ...shared];
    return {
      total: all.length,
      live: all.filter((site) => site.status === "live").length,
      shared: shared.length,
      published: all.filter((site) => site.visibility === "public").length
    };
  }, [mine, shared]);
  const visibilityOptions = [
    { value: "all", label: strings.filterAllVisibilities, icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Layers, { size: 14 }) },
    ...VISIBILITY_ORDER.map((value) => {
      const Icon2 = VISIBILITY_ICON[value];
      return { value, label: strings[VISIBILITY_STRING[value]], icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon2, { size: 14 }) };
    })
  ];
  const statusOptions = [
    { value: "all", label: strings.filterAllStatuses, icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Layers, { size: 14 }) },
    ...STATUS_ORDER.map((value) => {
      const Icon2 = STATUS_ICON[value];
      return { value, label: strings[STATUS_STRING[value]], icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon2, { size: 14 }) };
    })
  ];
  const toolbarFilters = [
    {
      id: "visibility",
      label: strings.filterVisibility,
      control: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(SelectMenu, { value: visibility, onChange: setVisibility, options: visibilityOptions, label: strings.filterVisibility }),
      ...visibility === "all" ? { active: false } : {
        active: true,
        activeLabel: `${strings.filterVisibility}: ${visibilityOptions.find((option) => option.value === visibility)?.label ?? visibility}`,
        onReset: () => setVisibility("all")
      }
    },
    {
      id: "status",
      label: strings.filterStatus,
      control: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(SelectMenu, { value: status, onChange: setStatus, options: statusOptions, label: strings.filterStatus }),
      ...status === "all" ? { active: false } : {
        active: true,
        activeLabel: `${strings.filterStatus}: ${statusOptions.find((option) => option.value === status)?.label ?? status}`,
        onReset: () => setStatus("all")
      }
    }
  ];
  const register = () => {
    if (sectionSites.length === 0) {
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(EmptyState, { title: section === "mine" ? strings.empty : strings.emptyShared, icon: Globe });
    }
    if (filtered.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(EmptyState, { title: strings.emptySearch, icon: Search });
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(SitesRegister, { sites: filtered, selectedId, onSelect: setSelectedId });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
    SpatialWorkspaceLayout,
    {
      hero: {
        eyebrow: strings.title,
        title: strings.title,
        count: summary.total,
        description: strings.subtitle,
        mascotState: list.isLoading ? "saving" : list.isError ? "error" : "idle",
        metrics: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(WorkspaceMetric, { label: strings.metricTotal, value: summary.total, icon: Globe }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(WorkspaceMetric, { label: strings.metricLive, value: summary.live, icon: CircleCheck }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(WorkspaceMetric, { label: strings.metricShared, value: summary.shared, icon: Users }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(WorkspaceMetric, { label: strings.metricPublic, value: summary.published, icon: Layers })
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
        search: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
      children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ControlSurfaceDocument, { children: list.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(LoadingState, { variant: "cards" }) }) : list.isError ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ControlSurfaceState, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ErrorState, { message: strings.loadFailed, onRetry: () => list.refetch() }) }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "workspace-master-detail", "data-detail": selected != null, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "flex min-w-0 flex-col gap-4", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ControlSurfaceRegister, { className: "flex flex-col gap-4", children: register() }) }),
        selected ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(WorkspaceDetailRail, { label: strings.detailTitle, closeLabel: strings.close, onClose: () => {
          if (!detailBusy) setSelectedId(null);
        }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
var import_react7 = __toESM(require_react(), 1);
var import_jsx_runtime5 = __toESM(require_jsx_runtime(), 1);
function EnterPage() {
  const { components, hooks } = runtime();
  const { WorkspacePage, PluginPageHeader, LoadingState, EmptyState } = components;
  const strings = hooks.usePluginStrings("sites");
  const [phase, setPhase] = (0, import_react7.useState)("working");
  const formRef = (0, import_react7.useRef)(null);
  const [handoff, setHandoff] = (0, import_react7.useState)(null);
  const started = (0, import_react7.useRef)(false);
  (0, import_react7.useEffect)(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const binding = params.get("binding") ?? "";
    const returnPath = params.get("r") ?? "";
    if (!binding) {
      setPhase("denied");
      return;
    }
    void runtime().api("/plugins/sites/api/ticket", jsonBody("POST", { binding, r: returnPath })).then((data) => {
      const ticket = data;
      if (!ticket?.token || !ticket?.action) {
        setPhase("denied");
        return;
      }
      setHandoff({ action: ticket.action, token: ticket.token });
    }).catch(() => setPhase("denied"));
  }, []);
  (0, import_react7.useEffect)(() => {
    if (handoff) formRef.current?.submit();
  }, [handoff]);
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(WorkspacePage, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(PluginPageHeader, { title: strings.title ?? "Sites", icon: Globe }),
    phase === "working" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(LoadingState, {}) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      EmptyState,
      {
        title: strings.emptyShared ?? "You do not have access to this site.",
        description: strings.subtitle,
        icon: Globe
      }
    ),
    handoff ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("form", { ref: formRef, method: "POST", action: handoff.action, className: "hidden", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("input", { type: "hidden", name: "t", value: handoff.token }) }) : null
  ] });
}

// plugins/sites/web-src/SitesProjectPanel.tsx
var import_react8 = __toESM(require_react(), 1);
var import_jsx_runtime6 = __toESM(require_jsx_runtime(), 1);
function SitesProjectPanel({ project }) {
  const { components, hooks } = runtime();
  const { WorkspaceDetailRail, LoadingState, ErrorState, EmptyState } = components;
  const strings = hooks.usePluginStrings("sites");
  const [selectedId, setSelectedId] = (0, import_react8.useState)(null);
  const [detailBusy, setDetailBusy] = (0, import_react8.useState)(false);
  const list = hooks.useQuery({
    queryKey: SITES_LIST_KEY,
    queryFn: () => runtime().api("/plugins/sites/api/sites")
  });
  const sites = (0, import_react8.useMemo)(
    () => [...list.data?.mine ?? [], ...list.data?.shared ?? []].filter((site) => site.projectId === project.id),
    [list.data, project.id]
  );
  const selected = sites.find((site) => site.id === selectedId) ?? null;
  if (list.isLoading) return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(LoadingState, { variant: "list" });
  if (list.isError) return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ErrorState, { message: strings.loadFailed, onRetry: () => list.refetch() });
  if (sites.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(EmptyState, { title: strings.empty, icon: Globe });
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "workspace-master-detail", "data-detail": selected != null, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(SitesRegister, { sites, selectedId, onSelect: setSelectedId }),
    selected ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(WorkspaceDetailRail, { label: strings.detailTitle, closeLabel: strings.close, onClose: () => {
      if (!detailBusy) setSelectedId(null);
    }, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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

// plugins/sites/web-src/index.tsx
registerSitesUi(
  {
    "": SitesPage,
    enter: EnterPage
  },
  { sites: SitesProjectPanel },
  {}
);
