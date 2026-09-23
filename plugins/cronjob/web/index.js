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

// plugins/cronjob/web-src/index.tsx
var import_react11 = __toESM(require_react(), 1);

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

// node_modules/lucide-react/dist/esm/icons/arrow-right.js
var ArrowRight = createLucideIcon("ArrowRight", [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "m12 5 7 7-7 7", key: "xquz4c" }]
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

// node_modules/lucide-react/dist/esm/icons/calendar-clock.js
var CalendarClock = createLucideIcon("CalendarClock", [
  ["path", { d: "M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5", key: "1osxxc" }],
  ["path", { d: "M16 2v4", key: "4m81vk" }],
  ["path", { d: "M8 2v4", key: "1cmpym" }],
  ["path", { d: "M3 10h5", key: "r794hk" }],
  ["path", { d: "M17.5 17.5 16 16.3V14", key: "akvzfd" }],
  ["circle", { cx: "16", cy: "16", r: "6", key: "qoo3c4" }]
]);

// node_modules/lucide-react/dist/esm/icons/calendar-days.js
var CalendarDays = createLucideIcon("CalendarDays", [
  ["path", { d: "M8 2v4", key: "1cmpym" }],
  ["path", { d: "M16 2v4", key: "4m81vk" }],
  ["rect", { width: "18", height: "18", x: "3", y: "4", rx: "2", key: "1hopcy" }],
  ["path", { d: "M3 10h18", key: "8toen8" }],
  ["path", { d: "M8 14h.01", key: "6423bh" }],
  ["path", { d: "M12 14h.01", key: "1etili" }],
  ["path", { d: "M16 14h.01", key: "1gbofw" }],
  ["path", { d: "M8 18h.01", key: "lrp35t" }],
  ["path", { d: "M12 18h.01", key: "mhygvu" }],
  ["path", { d: "M16 18h.01", key: "kzsmim" }]
]);

// node_modules/lucide-react/dist/esm/icons/check.js
var Check = createLucideIcon("Check", [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]]);

// node_modules/lucide-react/dist/esm/icons/chevron-left.js
var ChevronLeft = createLucideIcon("ChevronLeft", [
  ["path", { d: "m15 18-6-6 6-6", key: "1wnfg3" }]
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

// node_modules/lucide-react/dist/esm/icons/circle-pause.js
var CirclePause = createLucideIcon("CirclePause", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["line", { x1: "10", x2: "10", y1: "15", y2: "9", key: "c1nkhi" }],
  ["line", { x1: "14", x2: "14", y1: "15", y2: "9", key: "h65svq" }]
]);

// node_modules/lucide-react/dist/esm/icons/circle-x.js
var CircleX = createLucideIcon("CircleX", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "m15 9-6 6", key: "1uzhvr" }],
  ["path", { d: "m9 9 6 6", key: "z0biqf" }]
]);

// node_modules/lucide-react/dist/esm/icons/clock-3.js
var Clock3 = createLucideIcon("Clock3", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["polyline", { points: "12 6 12 12 16.5 12", key: "1aq6pp" }]
]);

// node_modules/lucide-react/dist/esm/icons/clock.js
var Clock = createLucideIcon("Clock", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["polyline", { points: "12 6 12 12 16 14", key: "68esgv" }]
]);

// node_modules/lucide-react/dist/esm/icons/external-link.js
var ExternalLink = createLucideIcon("ExternalLink", [
  ["path", { d: "M15 3h6v6", key: "1q9fwt" }],
  ["path", { d: "M10 14 21 3", key: "gplh6r" }],
  ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", key: "a6xqqp" }]
]);

// node_modules/lucide-react/dist/esm/icons/file-text.js
var FileText = createLucideIcon("FileText", [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["path", { d: "M10 9H8", key: "b1mrlr" }],
  ["path", { d: "M16 13H8", key: "t4e002" }],
  ["path", { d: "M16 17H8", key: "z1uh3a" }]
]);

// node_modules/lucide-react/dist/esm/icons/hash.js
var Hash = createLucideIcon("Hash", [
  ["line", { x1: "4", x2: "20", y1: "9", y2: "9", key: "4lhtct" }],
  ["line", { x1: "4", x2: "20", y1: "15", y2: "15", key: "vyu0kd" }],
  ["line", { x1: "10", x2: "8", y1: "3", y2: "21", key: "1ggp8o" }],
  ["line", { x1: "16", x2: "14", y1: "3", y2: "21", key: "weycgp" }]
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

// node_modules/lucide-react/dist/esm/icons/message-square.js
var MessageSquare = createLucideIcon("MessageSquare", [
  ["path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", key: "1lielz" }]
]);

// node_modules/lucide-react/dist/esm/icons/messages-square.js
var MessagesSquare = createLucideIcon("MessagesSquare", [
  ["path", { d: "M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z", key: "p1xzt8" }],
  ["path", { d: "M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1", key: "1cx29u" }]
]);

// node_modules/lucide-react/dist/esm/icons/pause.js
var Pause = createLucideIcon("Pause", [
  ["rect", { x: "14", y: "4", width: "4", height: "16", rx: "1", key: "zuxfzm" }],
  ["rect", { x: "6", y: "4", width: "4", height: "16", rx: "1", key: "1okwgv" }]
]);

// node_modules/lucide-react/dist/esm/icons/pencil.js
var Pencil = createLucideIcon("Pencil", [
  [
    "path",
    {
      d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      key: "1a8usu"
    }
  ],
  ["path", { d: "m15 5 4 4", key: "1mk7zo" }]
]);

// node_modules/lucide-react/dist/esm/icons/play.js
var Play = createLucideIcon("Play", [
  ["polygon", { points: "6 3 20 12 6 21 6 3", key: "1oa8hb" }]
]);

// node_modules/lucide-react/dist/esm/icons/plus.js
var Plus = createLucideIcon("Plus", [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "M12 5v14", key: "s699le" }]
]);

// node_modules/lucide-react/dist/esm/icons/repeat.js
var Repeat = createLucideIcon("Repeat", [
  ["path", { d: "m17 2 4 4-4 4", key: "nntrym" }],
  ["path", { d: "M3 11v-1a4 4 0 0 1 4-4h14", key: "84bu3i" }],
  ["path", { d: "m7 22-4-4 4-4", key: "1wqhfi" }],
  ["path", { d: "M21 13v1a4 4 0 0 1-4 4H3", key: "1rx37r" }]
]);

// node_modules/lucide-react/dist/esm/icons/trash-2.js
var Trash2 = createLucideIcon("Trash2", [
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", key: "4alrt4" }],
  ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", key: "v07s0e" }],
  ["line", { x1: "10", x2: "10", y1: "11", y2: "17", key: "1uufr5" }],
  ["line", { x1: "14", x2: "14", y1: "11", y2: "17", key: "xtxkd" }]
]);

// node_modules/lucide-react/dist/esm/icons/user.js
var User = createLucideIcon("User", [
  ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", key: "975kel" }],
  ["circle", { cx: "12", cy: "7", r: "4", key: "17ys0d" }]
]);

// node_modules/lucide-react/dist/esm/icons/x.js
var X = createLucideIcon("X", [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
]);

// plugins/cronjob/web-src/AutomationPage.tsx
var import_react10 = __toESM(require_react(), 1);

// plugins/cronjob/web-src/CalendarTab.tsx
var import_react5 = __toESM(require_react(), 1);

// plugins/cronjob/web-src/runtime.ts
function runtime() {
  const rt = window.ElowenUiRuntime;
  if (!rt) throw new Error("ElowenUiRuntime is not installed");
  return rt;
}
var errorBody = (error) => {
  if (typeof error !== "object" || error === null) return void 0;
  const details = error.details;
  if (details && typeof details === "object" && !Array.isArray(details)) return details;
  return error;
};
var apiErrorCode = (error) => {
  const code = errorBody(error)?.code;
  return typeof code === "string" ? code : void 0;
};
function registerCronUi(registration) {
  window.__elowenRegisterPluginUi?.("cronjob", registration);
}

// plugins/cronjob/web-src/DayCard.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var dotTone = (state) => {
  if (state === "running") return "animate-pulse bg-primary";
  if (state === "ok") return "bg-emerald-500";
  if (state === "error") return "bg-destructive";
  if (state === "skipped") return "bg-muted-foreground/40";
  if (state === "paused") return "border border-muted-foreground/60 bg-transparent";
  return "border border-muted-foreground/60 bg-transparent";
};
var stateLabel = (state, s) => ({
  waiting: s.runWaiting || "Waiting",
  running: s.runRunning || "Running",
  ok: s.runOk || "Succeeded",
  error: s.runErrorState || "Failed",
  skipped: s.runSkipped || "Skipped",
  paused: s.paused || "Paused"
})[state];
var hasReceipt = (state) => state === "ok" || state === "error" || state === "skipped" || state === "running";
function DayCard({ card, job, localDate, compact = false, onOpen, onRun, onToggle, onShowResult }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const owner = job.owner?.name || job.owner?.username || s.ownerSystem || "System";
  const hidden = Math.max(0, card.remaining - 1 - card.moreTimes.length);
  const paused = card.state === "paused";
  const items = [
    ...onShowResult && hasReceipt(card.state) ? [{ id: "result", label: s.showResult || "Show result", icon: FileText, onSelect: () => onShowResult(job, localDate, card.localTime) }] : [],
    { id: "run", label: s.runNow || "Run now", icon: Play, disabled: job.lifecycle === "oneShot", onSelect: () => onRun(job) },
    { id: "toggle", label: job.enabled === false ? s.pauseLabelOn || "Enable" : s.pauseLabel || "Pause", icon: job.enabled === false ? Clock3 : Pause, onSelect: () => onToggle(job) },
    { id: "edit", label: s.edit || "Edit", icon: Pencil, onSelect: () => onOpen(job.id) }
  ];
  if (compact) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "group/card relative min-w-0", "data-testid": `cron-card-${card.jobId}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          onClick: () => onOpen(card.jobId),
          className: `flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md pl-1.5 pr-7 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${paused ? "opacity-55" : ""} ${card.state === "error" ? "bg-destructive/[0.07]" : ""}`,
          "aria-label": `${(s.openJob || "Open \u201C{name}\u201D").replace("{name}", job.name)} \xB7 ${card.localTime} \xB7 ${owner} \xB7 ${stateLabel(card.state, s)}`,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `size-1.5 shrink-0 rounded-full ${dotTone(card.state)}` }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "shrink-0 font-mono text-meta tabular-nums text-muted-foreground", children: card.localTime }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "truncate text-xs text-foreground", children: job.name }),
            card.remaining > 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ml-auto shrink-0 text-meta tabular-nums text-muted-foreground", children: [
              "+",
              card.remaining - 1
            ] }) : null
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "absolute inset-y-0 right-0 flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100 pointer-coarse:opacity-100", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ActionMenu, { variant: "kebab", label: s.actions || "Actions", items }) })
    ] });
  }
  return (
    // The paused wash goes on the ROW, never on this wrapper: an element below full opacity becomes a
    // stacking context, and the actions menu inside it was then painted under the following cards and
    // faded along with them — the three dots were unreadable and the panel see-through.
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        className: "relative min-w-0 rounded-lg border",
        style: { backgroundColor: "var(--color-control)", borderColor: "var(--color-hairline)" },
        "data-testid": `cron-card-${card.jobId}`,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "button",
            {
              type: "button",
              onClick: () => onOpen(card.jobId),
              className: `flex min-h-[44px] w-full min-w-0 items-center gap-3 rounded-lg py-2.5 pl-3 pr-10 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)] ${paused ? "opacity-70" : ""}`,
              "aria-label": (s.openJob || "Open \u201C{name}\u201D").replace("{name}", job.name),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "flex w-14 shrink-0 items-center gap-1.5", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `size-2 shrink-0 rounded-full ${dotTone(card.state)}` }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "font-mono text-xs font-medium tabular-nums text-foreground", children: card.localTime })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "flex min-w-0 flex-col", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "truncate text-sm font-medium text-foreground", children: job.name }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "truncate text-meta text-muted-foreground", children: owner })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ml-auto flex shrink-0 items-center gap-2 text-meta text-muted-foreground", children: [
                  card.remaining > 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "tabular-nums", children: [
                    "+",
                    card.remaining - 1
                  ] }) : null,
                  hidden > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "tabular-nums", children: [
                    "+",
                    hidden
                  ] }) : null,
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Avatar, { name: owner, src: job.owner?.avatar || void 0, size: 20 })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "sr-only", children: stateLabel(card.state, s) })
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "absolute inset-y-0 right-1 flex items-center", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ActionMenu, { variant: "kebab", label: s.actions || "Actions", items }) })
        ]
      }
    )
  );
}

// plugins/cronjob/scheduleGrammar.mjs
var EVERY_PATTERN = /^every\s+(\d+)\s*(m|h)$/i;
var DAILY_PATTERN = /^daily\s+([01]?\d|2[0-3]):([0-5]\d)$/i;
var WEEKLY_PATTERN = /^weekly\s+(sun|mon|tue|wed|thu|fri|sat)\s+([01]?\d|2[0-3]):([0-5]\d)$/i;

// plugins/cronjob/web-src/scheduleBuilder.ts
var WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
var timeValue = (hour, minute) => `${String(Number(hour)).padStart(2, "0")}:${minute}`;
function parseBuilderSchedule(value) {
  const text = String(value ?? "").trim();
  let match = EVERY_PATTERN.exec(text);
  if (match) {
    const amount = Number(match[1]);
    if (Number.isSafeInteger(amount) && amount >= 1) {
      return { mode: "every", amount, unit: match[2].toLowerCase() };
    }
    return null;
  }
  match = DAILY_PATTERN.exec(text);
  if (match) return { mode: "daily", time: timeValue(match[1], match[2]) };
  match = WEEKLY_PATTERN.exec(text);
  if (match) {
    return {
      mode: "weekly",
      day: match[1].toLowerCase(),
      time: timeValue(match[2], match[3])
    };
  }
  return null;
}
function renderBuilderSchedule(builder) {
  if (builder.mode === "every") return `every ${builder.amount}${builder.unit}`;
  if (builder.mode === "daily") return `daily ${builder.time}`;
  return `weekly ${builder.day} ${builder.time}`;
}
function builderForMode(mode, current) {
  if (current?.mode === mode) return current;
  if (mode === "every") return { mode, amount: 1, unit: "h" };
  const time = current && current.mode !== "every" ? current.time : "06:00";
  if (mode === "daily") return { mode, time };
  return { mode, day: current?.mode === "weekly" ? current.day : "mon", time };
}
function parseActiveHours(value) {
  if (!value) return null;
  const match = /^([01]?\d|2[0-3])\s*-\s*([01]?\d|2[0-3])$/.exec(value.trim());
  return match ? { start: Number(match[1]), end: Number(match[2]) } : null;
}
function renderActiveHours(start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || start > 23 || end < 0 || end > 23) return null;
  return `${start}-${end}`;
}

// plugins/cronjob/web-src/IntervalsStrip.tsx
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
function intervalText(schedule, strings, locale) {
  const parsed = parseBuilderSchedule(schedule);
  if (!parsed || parsed.mode !== "every") return schedule;
  const plural = new Intl.PluralRules(locale).select(parsed.amount);
  const key = parsed.unit === "h" ? "intervalHours" : "intervalMinutes";
  const form = plural === "one" ? "One" : plural === "few" ? "Few" : "Other";
  return strings[`${key}${form}`].replace("{count}", String(parsed.amount));
}
function IntervalsStrip({ intervals, jobs, referenceDate, onOpenJob }) {
  const { hooks } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { locale } = hooks.useTranslation();
  const rows = intervals.filter((row) => jobs.has(row.jobId));
  if (rows.length === 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "flex min-w-0 flex-col gap-2", "data-testid": "cron-intervals-strip", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { className: "text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground", children: s.intervalsTitle || "Recurring jobs" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "flex flex-wrap gap-1.5", children: rows.map((row) => {
      const job = jobs.get(row.jobId);
      const nextHere = row.nextLocalTime && row.nextLocalDate === referenceDate ? row.nextLocalTime : null;
      const state = row.enabled ? "" : ` \xB7 ${s.paused}`;
      const label = intervalText(row.schedule, s, locale);
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
        "button",
        {
          type: "button",
          onClick: () => onOpenJob(row.jobId),
          className: `flex min-h-8 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)] ${row.enabled ? "text-foreground" : "text-muted-foreground opacity-70"}`,
          "aria-label": `${(s.openJob || "Open \u201C{name}\u201D").replace("{name}", job.name)} \xB7 ${label}${nextHere ? ` \xB7 ${s.nextRun || "Next run"} ${nextHere}` : ""}${state}`,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate", children: job.name }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "font-mono text-meta text-muted-foreground", children: label }),
            nextHere ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "flex items-center gap-0.5 font-mono text-meta tabular-nums text-muted-foreground", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ArrowRight, { size: 11, "aria-hidden": true }),
              nextHere
            ] }) : null,
            row.enabled ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "text-meta", children: s.paused })
          ]
        },
        row.jobId
      );
    }) })
  ] });
}

// plugins/cronjob/web-src/RunResultModal.tsx
var import_react3 = __toESM(require_react(), 1);
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
var contentText = (message) => {
  if (typeof message.text === "string") return message.text;
  if (typeof message.content === "string") {
    try {
      const parsed = JSON.parse(message.content);
      if (typeof parsed.content === "string") return parsed.content;
      if (Array.isArray(parsed.content)) {
        return parsed.content.filter((part) => typeof part === "object" && part !== null && part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
      }
    } catch {
      return message.content;
    }
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content.filter((part) => typeof part === "object" && part !== null && part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
  }
  return "";
};
var statusLabel = (run, s) => ({
  waiting: s.runWaiting || "Waiting",
  running: s.runRunning || "Running",
  ok: s.runOk || "Succeeded",
  error: s.runErrorState || "Failed",
  skipped: s.runSkipped || "Skipped"
})[run.outcome];
var tone = (run) => run.outcome === "ok" ? "success" : run.outcome === "error" ? "danger" : run.outcome === "running" ? "accent" : "muted";
function RunResultModal({ run: initial, job, onClose, onOpenJob, onRun }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { t, locale } = hooks.useTranslation();
  const detail = hooks.useQuery({
    queryKey: ["cron-run", initial.id],
    queryFn: () => runtime().api(`/plugins/cronjob/api/runs/${encodeURIComponent(initial.id)}`),
    staleTime: 3e4
  });
  const run = detail.data ?? initial;
  const [full, setFull] = (0, import_react3.useState)({ state: "idle" });
  const showFull = async () => {
    if (!run.sessionId || !run.messageId) return;
    setFull({ state: "loading" });
    try {
      const message = await runtime().api(`/brain/messages/${encodeURIComponent(run.messageId)}?session=${encodeURIComponent(run.sessionId)}`);
      const text = contentText(message);
      setFull(text ? { state: "ready", text } : { state: "gone" });
    } catch {
      setFull({ state: "gone" });
    }
  };
  const format = (value) => value ? new Intl.DateTimeFormat(locale || void 0, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value)) : "\u2014";
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    C.Modal,
    {
      title: run.jobName,
      onClose,
      closeLabel: t.common.close,
      size: "lg",
      presentation: "auto",
      intent: "inspect",
      "data-testid": "cron-run-modal",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.ModalBody, { gap: 5, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { tone: tone(run), children: statusLabel(run, s) }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "text-xs text-muted-foreground", children: run.trigger })
          ] }),
          run.errorMessage ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive", children: run.errorMessage }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dl", { className: "grid gap-3 text-sm sm:grid-cols-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { className: "text-xs text-muted-foreground", children: s.runScheduledAt || "Scheduled" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dd", { className: "font-mono text-xs", children: [
                run.localDate,
                " ",
                run.localTime,
                " ",
                run.timezone
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { className: "text-xs text-muted-foreground", children: s.runStartedAt || "Started" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: format(run.startedAt) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { className: "text-xs text-muted-foreground", children: s.runFinishedAt || "Finished" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: format(run.finishedAt) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { className: "text-xs text-muted-foreground", children: s.colDuration || "Duration" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: run.durationMs === null ? "\u2014" : `${Math.round(run.durationMs / 100) / 10} s` })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { className: "text-xs text-muted-foreground", children: s.schedule || "Schedule" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: run.schedule || s.badgeOneShot })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { className: "text-xs text-muted-foreground", children: s.colModel || "Model" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dd", { children: [
                run.model || "\u2014",
                run.tokensTotal !== void 0 ? ` \xB7 ${run.tokensTotal} tokens` : ""
              ] })
            ] })
          ] }),
          job ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "outline", icon: ExternalLink, onClick: () => onOpenJob(job.id), children: s.runOpenJob || "Open job" }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "flex min-w-0 flex-col gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { className: "text-sm font-medium", children: s.runResultTitle || "Result" }),
            run.preview ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("pre", { className: "max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-canvas p-3 text-xs", children: run.preview }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "text-sm text-muted-foreground", children: s.runNoResult || "No result body was recorded." }),
            full.state === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("pre", { className: "max-h-[50dvh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-canvas p-3 text-xs", "data-testid": "cron-run-full-result", children: full.text }) : null,
            full.state === "gone" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "text-sm text-muted-foreground", children: s.runResultGone || "The full transcript result is no longer available. The preview above was retained." }) : null,
            run.sessionId && run.messageId && full.state !== "ready" && full.state !== "gone" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "outline", icon: Clock, disabled: full.state === "loading", onClick: () => void showFull(), children: full.state === "loading" ? s.loading || "Loading\u2026" : s.runFullResult || "Show full result" }) : null
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.ModalFooter, { children: [
          run.outcome === "error" && job && onRun ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "accent", onClick: () => onRun(job), children: s.runNow || "Run now" }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "outline", onClick: onClose, children: t.common.close })
        ] })
      ]
    }
  );
}

// plugins/cronjob/web-src/WeekGrid.tsx
var import_react4 = __toESM(require_react(), 1);
var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
var parseDate = (label) => {
  const [year, month, day] = label.split("-").map(Number);
  return new Date(year, month - 1, day);
};
var weekdayLabel = (label, locale) => new Intl.DateTimeFormat(locale || void 0, { weekday: "short" }).format(parseDate(label));
var dayNumber = (label, locale) => new Intl.DateTimeFormat(locale || void 0, { day: "numeric" }).format(parseDate(label));
var shortDay = (label, locale) => new Intl.DateTimeFormat(locale || void 0, { weekday: "short", day: "numeric", month: "numeric" }).format(parseDate(label));
function WeekGrid({ days, jobs, selectedDate, todayLocalDate, onSelectDate, onOpenJob, onRun, onToggle, onShowResult, onAddAt }) {
  const { hooks } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { locale } = hooks.useTranslation();
  const selectOffset = (offset) => {
    const index = days.findIndex((day) => day.localDate === selectedDate);
    const next = days[Math.min(Math.max(index + offset, 0), days.length - 1)];
    if (next) onSelectDate(next.localDate);
  };
  return (
    // NOT `role="grid"`: a day column holds a variable number of entries and none of them is a cell in a
    // shared row, so the grid pattern's rows, cells and focus contract cannot be honoured here. Each day is
    // a labelled region instead, which is what this actually is — seven small agendas side by side.
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "div",
      {
        "aria-label": s.tabCalendar || "Calendar",
        className: "grid min-w-0 grid-cols-7 overflow-hidden rounded-xl border",
        style: { backgroundColor: "var(--color-raised)", borderColor: "var(--color-hairline)" },
        "data-testid": "cron-week-grid",
        children: days.map((day) => {
          const selected = day.localDate === selectedDate;
          const today = day.localDate === todayLocalDate;
          return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
            "section",
            {
              "aria-label": shortDay(day.localDate, locale),
              className: `flex min-w-0 flex-col border-l border-border/50 first:border-l-0 ${selected ? "bg-primary/[0.03]" : ""}`,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
                  "button",
                  {
                    type: "button",
                    "aria-current": selected ? "date" : void 0,
                    onClick: () => onSelectDate(day.localDate),
                    onKeyDown: (event) => {
                      if (event.key === "ArrowLeft") {
                        event.preventDefault();
                        selectOffset(-1);
                      }
                      if (event.key === "ArrowRight") {
                        event.preventDefault();
                        selectOffset(1);
                      }
                    },
                    className: "flex w-full flex-col items-center gap-0.5 px-2 py-2.5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)]",
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: `text-meta font-medium uppercase tracking-[0.08em] ${selected ? "text-foreground" : "text-muted-foreground"}`, children: weekdayLabel(day.localDate, locale) }),
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                        "span",
                        {
                          className: `flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-colors ${today ? "bg-primary text-primary-foreground" : selected ? "bg-accent text-accent-foreground" : "text-foreground"}`,
                          children: dayNumber(day.localDate, locale)
                        }
                      ),
                      today ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "sr-only", children: s.calToday || "Today" }) : null
                    ]
                  }
                ) }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex min-h-[13rem] min-w-0 flex-1 flex-col gap-0.5 border-t border-border/50 p-1", children: [
                  day.cards.map((card) => {
                    const job = jobs.get(card.jobId);
                    return job ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                      DayCard,
                      {
                        card,
                        job,
                        localDate: day.localDate,
                        compact: true,
                        onOpen: onOpenJob,
                        onRun,
                        onToggle,
                        onShowResult
                      },
                      card.jobId
                    ) : null;
                  }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                    "button",
                    {
                      type: "button",
                      "data-testid": `cron-day-add-${day.localDate}`,
                      onClick: () => {
                        onSelectDate(day.localDate);
                        onAddAt(day.localDate);
                      },
                      "aria-label": (s.dayAddTask || "Schedule a task on {date}").replace("{date}", shortDay(day.localDate, locale)),
                      className: "group/add flex min-h-8 flex-1 items-start justify-center rounded-md pt-1 text-muted-foreground/0 transition-colors hover:bg-accent hover:text-muted-foreground focus-visible:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:text-muted-foreground/60",
                      children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Plus, { size: 14, "aria-hidden": true })
                    }
                  )
                ] })
              ]
            },
            day.localDate
          );
        })
      }
    )
  );
}
function MobileDayStrip({ days, selectedDate, todayLocalDate, onSelectDate }) {
  const { hooks } = runtime();
  const { locale } = hooks.useTranslation();
  const selectedRef = (0, import_react4.useRef)(null);
  (0, import_react4.useEffect)(() => {
    selectedRef.current?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [selectedDate]);
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "flex snap-x gap-2 overflow-x-auto pb-2", "data-testid": "cron-day-strip", children: days.map((day) => {
    const selected = day.localDate === selectedDate;
    const today = day.localDate === todayLocalDate;
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      "button",
      {
        ref: selected ? selectedRef : void 0,
        type: "button",
        "aria-current": selected ? "date" : void 0,
        onClick: () => onSelectDate(day.localDate),
        className: `flex min-h-[44px] min-w-[4rem] snap-center flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 pointer-coarse:min-h-[var(--touch-target)] ${selected ? "border-primary/60 bg-primary/10" : "border-border/70"}`,
        style: selected ? void 0 : { backgroundColor: "var(--color-control)" },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "sr-only", children: shortDay(day.localDate, locale) }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { "aria-hidden": true, className: `text-meta font-medium uppercase tracking-[0.08em] ${selected ? "text-primary" : "text-muted-foreground"}`, children: weekdayLabel(day.localDate, locale) }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "span",
            {
              "aria-hidden": true,
              className: `flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${today ? "bg-primary text-primary-foreground" : selected ? "text-primary" : "text-foreground"}`,
              children: dayNumber(day.localDate, locale)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { "aria-hidden": true, className: `size-1 rounded-full ${day.dayTotal > 0 ? "bg-muted-foreground/60" : "bg-transparent"}` })
        ]
      },
      day.localDate
    );
  }) });
}

// plugins/cronjob/web-src/runsApi.ts
var runsUrl = (params) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== void 0) query.set(key, String(value));
  const suffix = query.toString();
  return `/plugins/cronjob/api/runs${suffix ? `?${suffix}` : ""}`;
};

// plugins/cronjob/web-src/CalendarTab.tsx
var import_jsx_runtime5 = __toESM(require_jsx_runtime(), 1);
var shiftDate = (date, days) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
var dayTitle = (label, locale) => {
  const [year, month, day] = label.split("-").map(Number);
  return new Intl.DateTimeFormat(locale || void 0, { weekday: "long", day: "numeric", month: "long" }).format(new Date(year, month - 1, day));
};
var weekUrl = (start, days = 7) => {
  const query = new URLSearchParams();
  if (start) query.set("start", start);
  if (days !== 7) query.set("days", String(days));
  const suffix = query.toString();
  return `/plugins/cronjob/api/week${suffix ? `?${suffix}` : ""}`;
};
function CalendarTab({ start, selectedDate, view, query, owner, state, kind, onSelectedDate, onData, onWindowShift, onOpenJob, onRun, onToggle, onAddAt }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { t, locale } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const me = hooks.useMe();
  const mobile = hooks.useMobile();
  const [openRun, setOpenRun] = (0, import_react5.useState)(null);
  const showResult = (0, import_react5.useCallback)(async (job, localDate, localTime) => {
    let response;
    try {
      response = await runtime().api(runsUrl({ date: localDate, jobId: job.id, limit: 50 }));
    } catch (error) {
      toast(`${s.runLoadError || "The run could not be loaded"} \u2014 ${runtime().utils.apiErrorMessage(error)}`, "error");
      return;
    }
    const run = response.runs.find((row) => row.localTime === localTime) ?? response.runs[0];
    if (run) setOpenRun(run);
    else toast(s.runNoneForDay || "No run was recorded for this job on that day.", "error");
  }, [s.runLoadError, s.runNoneForDay, toast]);
  const week = hooks.useQuery({
    queryKey: ["cron-week", start],
    queryFn: () => runtime().api(weekUrl(start)),
    staleTime: 15e3,
    refetchInterval: 3e4
  });
  const data = week.data;
  (0, import_react5.useEffect)(() => {
    if (!data) return;
    onData(data);
    if (!selectedDate || !data.days.some((day) => day.localDate === selectedDate)) {
      onSelectedDate(data.days.find((day) => day.localDate === data.todayLocalDate)?.localDate ?? data.days[0].localDate);
    }
  }, [data, onData, onSelectedDate, selectedDate]);
  const actualDate = selectedDate && data?.days.some((day) => day.localDate === selectedDate) ? selectedDate : data?.days[0]?.localDate ?? null;
  const filtered = (0, import_react5.useMemo)(() => {
    if (!data) return null;
    const myId = me.data?.user?.id ?? null;
    const needle = query.trim().toLowerCase();
    const visibleJobs = data.jobs.filter((job) => {
      if (owner === "mine" && job.ownerUserId !== myId) return false;
      if (owner === "instance" && job.ownerUserId != null) return false;
      if (state === "active" && job.enabled === false) return false;
      if (state === "paused" && job.enabled !== false) return false;
      const jobKind = job.lifecycle === "oneShot" ? "oneShot" : data.intervals.some((row) => row.jobId === job.id) ? "interval" : "fixed";
      if (kind !== "all" && kind !== jobKind) return false;
      return !needle || job.name.toLowerCase().includes(needle) || job.schedule.toLowerCase().includes(needle) || job.prompt.toLowerCase().includes(needle);
    });
    const ids = new Set(visibleJobs.map((job) => job.id));
    return {
      jobs: new Map(visibleJobs.map((job) => [job.id, job])),
      days: data.days.map((day) => {
        const cards = day.cards.filter((card) => ids.has(card.jobId));
        return { ...day, cards, dayTotal: cards.length };
      }),
      intervals: data.intervals.filter((row) => ids.has(row.jobId))
    };
  }, [data, kind, me.data?.user?.id, owner, query, state]);
  if (week.isError) return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.ErrorState, { message: t.common.daemonUnreachable, onRetry: () => week.refetch() });
  if (!data || !filtered || !actualDate) return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.LoadingState, { variant: "cards" });
  const selectedDay = filtered.days.find((day) => day.localDate === actualDate) ?? filtered.days[0];
  const selectedIndex = filtered.days.findIndex((day) => day.localDate === selectedDay.localDate);
  const moveDay = (offset) => {
    const next = filtered.days[selectedIndex + offset];
    if (next) onSelectedDate(next.localDate);
    else onWindowShift(offset < 0 ? -7 : 7);
  };
  const showWeek = view === "week" && !mobile;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "flex min-w-0 flex-col gap-6", "aria-busy": week.isLoading, "data-testid": "cron-calendar-tab", children: [
    mobile ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(MobileDayStrip, { days: filtered.days, selectedDate: selectedDay.localDate, todayLocalDate: data.todayLocalDate, onSelectDate: onSelectedDate }) : null,
    showWeek ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      WeekGrid,
      {
        days: filtered.days,
        jobs: filtered.jobs,
        selectedDate: selectedDay.localDate,
        todayLocalDate: data.todayLocalDate,
        onSelectDate: onSelectedDate,
        onOpenJob,
        onRun,
        onToggle,
        onShowResult: (job, date, time) => void showResult(job, date, time),
        onAddAt
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: "flex min-w-0 flex-col gap-3", "data-testid": "cron-day-cards", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "flex items-center justify-between gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "flex items-center gap-1", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.IconButton, { icon: ChevronLeft, label: s.dayPrevious || "Previous day", onClick: () => moveDay(-1) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h2", { className: "text-lg font-semibold capitalize", children: dayTitle(selectedDay.localDate, locale) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.IconButton, { icon: ChevronRight, label: s.dayNext || "Next day", onClick: () => moveDay(1) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.Button, { variant: "ghost", icon: Plus, onClick: () => onAddAt(selectedDay.localDate), "data-testid": "cron-day-add-selected", children: s.addJob || "Add job" })
      ] }),
      selectedDay.cards.length === 0 && filtered.intervals.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.EmptyState, { title: s.dayNothing || "No fixed-time jobs", icon: CalendarDays }) : selectedDay.cards.map((card) => {
        const job = filtered.jobs.get(card.jobId);
        return job ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          DayCard,
          {
            card,
            job,
            localDate: selectedDay.localDate,
            onOpen: onOpenJob,
            onRun,
            onToggle,
            onShowResult: (target, date, time) => void showResult(target, date, time)
          },
          card.jobId
        ) : null;
      })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      IntervalsStrip,
      {
        intervals: filtered.intervals,
        jobs: filtered.jobs,
        referenceDate: selectedDay.localDate,
        onOpenJob
      }
    ),
    openRun ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      RunResultModal,
      {
        run: openRun,
        job: data.jobs.find((job) => job.id === openRun.jobId),
        onClose: () => setOpenRun(null),
        onOpenJob: (jobId) => {
          setOpenRun(null);
          onOpenJob(jobId);
        },
        onRun
      }
    ) : null
  ] });
}

// plugins/cronjob/web-src/CreateJobDialog.tsx
var import_react7 = __toESM(require_react(), 1);

// plugins/cronjob/web-src/fields.tsx
var import_react6 = __toESM(require_react(), 1);
var import_jsx_runtime6 = __toESM(require_jsx_runtime(), 1);
function useSchedulePreview(schedule, hours) {
  const { hooks } = runtime();
  const query = hooks.useQuery({
    queryKey: ["cron-schedule-preview", schedule ?? "", hours ?? ""],
    enabled: schedule !== void 0,
    queryFn: async () => runtime().api("/plugins/cronjob/api/schedule-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schedule, hours })
      // schedule always a string when enabled
    }),
    // The draft is typist input: a value 300ms old is what the reader sees, so hold it a beat.
    staleTime: 0
  });
  return query.data;
}
function DestinationField({ value, onChange, destinations }) {
  const { components: C, hooks } = runtime();
  const { t } = hooks.useTranslation();
  const s = hooks.usePluginStrings("cronjob");
  const [open, setOpen] = (0, import_react6.useState)(false);
  const selected = destinations.find((destination) => destination.value === value);
  const icon = (kind) => kind === "channel" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Hash, { size: 12, "aria-hidden": true }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(MessageSquare, { size: 12, "aria-hidden": true });
  const items = [
    { id: "", label: s.pillDefault, group: "" },
    ...value && !selected ? [{ id: value, label: value, group: "", icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Hash, { size: 12, "aria-hidden": true }) }] : [],
    ...destinations.map((destination) => ({
      id: destination.value,
      label: destination.label,
      group: `${destination.platform}:${destination.group ?? destination.platform}`,
      groupLabel: destination.group ?? destination.platform,
      icon: icon(destination.kind),
      badges: destination.subtitle ? [{ text: destination.subtitle }] : void 0
    }))
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      C.SelectionSummary,
      {
        countText: value ? "" : "\u2014",
        samples: value ? [{ label: selected?.label ?? value, icon: icon(selected?.kind ?? "channel") }] : [],
        moreCount: 0,
        onManage: () => setOpen(true),
        manageLabel: t.managePicker.manage
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      C.ManageSelectionModal,
      {
        title: s.channel,
        subtitle: s.helpChannel,
        open,
        onClose: () => setOpen(false),
        items,
        selected: /* @__PURE__ */ new Set([value]),
        single: true,
        onSave: (next) => onChange([...next][0] ?? "")
      }
    )
  ] });
}
function ConversationField({ value, saved, unresolved, owner, myId, required, mismatch, onChange }) {
  const { components: C, hooks } = runtime();
  const { t } = hooks.useTranslation();
  const s = hooks.usePluginStrings("cronjob");
  const [open, setOpen] = (0, import_react6.useState)(false);
  const [picked, setPicked] = (0, import_react6.useState)(null);
  const query = owner === null ? "?scope=instance" : owner === myId ? "" : `?owner=${encodeURIComponent(String(owner))}`;
  const list = hooks.useQuery({
    queryKey: ["cronjob-conversations", query],
    queryFn: () => runtime().api(`/plugins/cronjob/api/conversations${query}`),
    enabled: open,
    staleTime: 3e4
  });
  const options = list.data?.status === "available" ? list.data.conversations : [];
  const chosen = picked?.id === value ? picked : saved?.id === value ? saved : options.find((c) => c.id === value) ?? null;
  const unavailable = saved === null && chosen === null && !unresolved;
  const icon = /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(MessagesSquare, { size: 12, "aria-hidden": true });
  const items = [
    ...unavailable ? [{ id: value, label: s.conversationUnavailable, group: "", disabled: true, disabledHint: s.conversationUnavailableHint }] : chosen && !options.some((c) => c.id === chosen.id) ? [{ id: chosen.id, label: chosen.title || chosen.id, group: "", icon }] : [],
    ...options.map((c) => ({
      id: c.id,
      label: c.title || c.id,
      group: c.platform ?? "own",
      groupLabel: c.platform ?? s.conversationOwnChat,
      icon
    }))
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "flex flex-col gap-1.5", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      C.SelectionSummary,
      {
        countText: "",
        samples: chosen ? [{ label: chosen.title || chosen.id, icon }] : unavailable ? [{ label: s.conversationUnavailable, icon }] : [],
        moreCount: 0,
        onManage: () => setOpen(true),
        manageLabel: t.managePicker.manage,
        manageAriaLabel: s.conversationManage
      }
    ),
    unavailable ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "text-xs text-destructive", children: s.conversationUnavailableHint }) : unresolved ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "text-xs text-muted-foreground", children: s.conversationUnresolvedHint }) : mismatch ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "text-xs text-destructive", children: s.conversationOwnerHint }) : required && !chosen ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "text-xs text-muted-foreground", children: s.conversationRequired }) : !value ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.Badge, { tone: "muted", children: s.conversationUnassigned }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      C.ManageSelectionModal,
      {
        title: s.conversation,
        subtitle: list.isLoading ? s.conversationLoading : list.isError ? s.conversationListError : list.data?.status === "unavailable" ? s.conversationDirectoryUnavailable : s.helpConversation,
        open,
        onClose: () => setOpen(false),
        items,
        selected: new Set(value ? [value] : []),
        single: true,
        onSave: (next) => {
          const id = [...next][0] ?? "";
          if (!id || id === value) return;
          setPicked(options.find((c) => c.id === id) ?? null);
          onChange(id);
        }
      }
    )
  ] });
}
function ScheduleField({ schedule, onChange }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const parsed = parseBuilderSchedule(schedule);
  const [mode, setMode] = (0, import_react6.useState)(parsed?.mode ?? "advanced");
  const emitted = (0, import_react6.useRef)(null);
  (0, import_react6.useEffect)(() => {
    if (emitted.current === schedule) {
      emitted.current = null;
      return;
    }
    setMode(parseBuilderSchedule(schedule)?.mode ?? "advanced");
  }, [schedule]);
  const emit = (value) => {
    emitted.current = value;
    onChange(value);
  };
  const selectMode = (next) => {
    setMode(next);
    if (next === "advanced") return;
    const value = renderBuilderSchedule(builderForMode(next, parsed));
    if (value !== schedule) emit(value);
  };
  const updateBuilder = (builder2) => emit(renderBuilderSchedule(builder2));
  const builder = mode === "advanced" ? null : builderForMode(mode, parsed);
  const weekdayLabels = WEEKDAYS.map((day) => ({
    value: day,
    label: s[`weekday${day[0].toUpperCase()}${day.slice(1)}`]
  }));
  const preview = useSchedulePreview(builder ? void 0 : schedule);
  const valid = builder ? true : preview?.valid === true;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "flex flex-col gap-3", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      C.Segmented,
      {
        value: mode,
        onChange: selectMode,
        options: [
          { value: "every", label: s.scheduleEvery },
          { value: "daily", label: s.scheduleDaily },
          { value: "weekly", label: s.scheduleWeekly },
          { value: "advanced", label: s.scheduleAdvanced }
        ],
        "aria-label": s.scheduleMode
      }
    ),
    builder?.mode === "every" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.Field, { label: s.scheduleInterval, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        C.Input,
        {
          type: "number",
          min: 1,
          step: 1,
          value: builder.amount,
          onChange: (event) => {
            const amount = Number(event.target.value);
            if (Number.isSafeInteger(amount) && amount >= 1) updateBuilder({ ...builder, amount });
          }
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.Field, { label: s.scheduleUnit, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        C.Segmented,
        {
          value: builder.unit,
          onChange: (unit) => updateBuilder({ ...builder, unit }),
          options: [
            { value: "m", label: s.scheduleMinutes },
            { value: "h", label: s.scheduleHours }
          ],
          "aria-label": s.scheduleUnit
        }
      ) })
    ] }) : null,
    builder?.mode === "daily" || builder?.mode === "weekly" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
      builder.mode === "weekly" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.Field, { label: s.scheduleWeekday, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        C.ChoiceField,
        {
          title: s.scheduleWeekday,
          options: weekdayLabels,
          value: builder.day,
          onChange: (day) => updateBuilder({ ...builder, day }),
          manageAriaLabel: s.scheduleWeekday
        }
      ) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.Field, { label: s.scheduleTime, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        C.Input,
        {
          type: "time",
          step: 60,
          value: builder.time,
          onChange: (event) => {
            if (/^([01]\d|2[0-3]):[0-5]\d$/.test(event.target.value)) {
              updateBuilder({ ...builder, time: event.target.value });
            }
          }
        }
      ) })
    ] }) : null,
    builder ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { className: "flex flex-wrap items-center gap-2 text-xs text-muted-foreground", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: s.scheduleGenerated }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("code", { className: "rounded border border-border bg-background px-2 py-1 text-foreground", children: renderBuilderSchedule(builder) })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "flex flex-col gap-1", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "relative", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          C.Input,
          {
            value: schedule,
            onChange: (event) => emit(event.target.value),
            className: "pr-8 font-mono",
            placeholder: "0 9 * * 1-5",
            "aria-label": s.scheduleAdvancedValue,
            invalid: schedule !== "" && preview?.valid === false
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "absolute right-2.5 top-1/2 -translate-y-1/2", children: preview === void 0 ? null : valid ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Check, { size: 14, className: "text-success", "aria-label": s.scheduleValid }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(X, { size: 14, className: "text-destructive", "aria-label": s.scheduleInvalid }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "text-xs text-muted-foreground", children: preview?.error ? `${s.scheduleInvalid}: ${preview.error}` : s.scheduleAdvancedHint }),
      schedule !== "" && preview?.valid === true && preview.occurrences.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { className: "text-xs text-muted-foreground", children: [
        s.schedulePreviewNext,
        " ",
        preview.occurrences.slice(0, 3).map((occurrence) => occurrence.localTime).join(", "),
        " \xB7 ",
        preview.timezone
      ] }) : null
    ] })
  ] });
}
function ActiveHoursField({ value, onChange }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const parsed = parseActiveHours(value);
  const legacy = Boolean(value && !parsed);
  const mode = legacy ? "legacy" : parsed ? "window" : "off";
  const options = [
    { value: "off", label: s.hoursOff },
    { value: "window", label: s.hoursWindow },
    ...legacy ? [{ value: "legacy", label: s.hoursLegacy }] : []
  ];
  const setHour = (part, raw) => {
    if (!parsed || raw === "") return;
    const hour = Number(raw);
    const next = renderActiveHours(part === "start" ? hour : parsed.start, part === "end" ? hour : parsed.end);
    if (next) onChange(next);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "flex flex-col gap-3", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      C.Segmented,
      {
        value: mode,
        onChange: (next) => {
          if (next === "off") onChange(void 0);
          else if (next === "window" && !parsed) onChange("8-17");
        },
        options,
        "aria-label": s.hoursMode
      }
    ),
    parsed ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "grid grid-cols-2 gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.Field, { label: s.hoursStart, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        C.Input,
        {
          type: "number",
          min: 0,
          max: 23,
          step: 1,
          value: parsed.start,
          onChange: (event) => setHour("start", event.target.value)
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.Field, { label: s.hoursEnd, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        C.Input,
        {
          type: "number",
          min: 0,
          max: 23,
          step: 1,
          value: parsed.end,
          onChange: (event) => setHour("end", event.target.value)
        }
      ) })
    ] }) : legacy ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { className: "text-xs text-muted-foreground", children: [
      s.hoursLegacyHint,
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("code", { className: "text-foreground", children: value })
    ] }) : null
  ] });
}

// plugins/cronjob/web-src/CreateJobDialog.tsx
var import_jsx_runtime7 = __toESM(require_jsx_runtime(), 1);
function CreateJobDialog({ lifecycle, initialDate, myId, isAdmin, onClose, onCreated }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { toast } = hooks.useToast();
  const models = hooks.useBrainModels();
  const requestIdRef = (0, import_react7.useRef)(crypto.randomUUID());
  const [name, setName] = (0, import_react7.useState)("");
  const [prompt, setPrompt] = (0, import_react7.useState)("");
  const [schedule, setSchedule] = (0, import_react7.useState)("every 1h");
  const [localRun, setLocalRun] = (0, import_react7.useState)({ date: initialDate ?? "", time: "" });
  const [conversationSessionId, setConversationSessionId] = (0, import_react7.useState)("");
  const [hours, setHours] = (0, import_react7.useState)(void 0);
  const [enabled, setEnabled] = (0, import_react7.useState)(true);
  const [scope, setScope] = (0, import_react7.useState)("mine");
  const [projectRef] = (0, import_react7.useState)(void 0);
  const [model, setModel] = (0, import_react7.useState)(void 0);
  const [notifyChannelId] = (0, import_react7.useState)(void 0);
  const [submitting, setSubmitting] = (0, import_react7.useState)(false);
  const check = void 0;
  const [plain, setPlain] = (0, import_react7.useState)(void 0);
  const oneShot = lifecycle === "oneShot";
  const presets = [
    { id: "digest", label: s.presetDigest, name: s.presetDigestName, prompt: s.presetDigestPrompt, schedule: "daily 08:00" },
    { id: "inbox", label: s.presetInbox, name: s.presetInboxName, prompt: s.presetInboxPrompt, schedule: "every 1h" },
    { id: "weekly", label: s.presetWeekly, name: s.presetWeeklyName, prompt: s.presetWeeklyPrompt, schedule: "weekly mon 09:00" },
    { id: "reminder", label: s.presetReminder, name: s.presetReminderName, prompt: s.presetReminderPrompt, schedule: "daily 18:00" }
  ];
  const applyPreset = (preset) => {
    setName(preset.name);
    setPrompt(preset.prompt);
    if (!oneShot) setSchedule(preset.schedule);
    else if (!localRun.time) setLocalRun((cur) => ({ ...cur, time: preset.schedule.slice(-5) }));
  };
  const QUICK_TIMES = ["07:00", "09:00", "12:00", "15:00", "18:00", "21:00"];
  const filedReady = !oneShot && conversationSessionId.trim() !== "";
  const ready = name.trim() !== "" && prompt.trim() !== "" && (oneShot ? localRun.date !== "" && localRun.time !== "" && /^([01]\d|2[0-3]):[0-5]\d$/.test(localRun.time) : filedReady) && schedule.trim() !== "";
  const submit = async () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    try {
      const body = {
        requestId: requestIdRef.current,
        lifecycle: oneShot ? "oneShot" : "recurring",
        // Personal scope is ALWAYS the caller on HTTP; an admin has to say instance explicitly.
        scope: scope === "instance" && isAdmin ? "instance" : "personal",
        name: name.trim(),
        prompt,
        ...oneShot ? { localRunAt: { date: localRun.date, time: localRun.time } } : { schedule, conversationSessionId },
        ...enabled ? {} : { enabled: false },
        ...oneShot ? {} : { hours, check, plain: plain === true ? true : void 0 },
        ...projectRef ? { projectRef } : {},
        ...model ? { model } : {},
        ...notifyChannelId ? { notifyChannelId } : {}
      };
      const response = await runtime().api("/plugins/cronjob/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response || !response.job) throw new Error(s.saveErrorResponse);
      toast(response.idempotentReplay ? s.createReplayed : s.createDone, "ok");
      if (response.job) onCreated(response.job);
    } catch (error) {
      if (apiErrorCode(error) === "idempotency_conflict") {
        toast(s.createPayloadMismatch, "error");
        requestIdRef.current = crypto.randomUUID();
      } else {
        toast(`${s.createError} \u2014 ${utils.apiErrorMessage(error)}`, "error");
      }
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  };
  return (
    // The host Modal is MOUNTED WHEN OPEN: there is no `open`/`onOpenChange` pair, and dismissal is
    // blocked with `closeDisabled` rather than by withholding `onClose` — Escape calls it either way.
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
      C.Modal,
      {
        onClose,
        closeDisabled: submitting,
        title: oneShot ? s.createOneShotTitle : s.createRecurringTitle,
        closeLabel: s.close,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.ModalBody, { children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "flex min-w-0 flex-col gap-3", "data-testid": "cron-create-form", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.presetLabel, hint: s.presetHint, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "flex flex-wrap gap-2", "data-testid": "cron-create-presets", children: presets.map((preset) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              "button",
              {
                type: "button",
                onClick: () => applyPreset(preset),
                className: `min-h-9 rounded-full border px-3 text-xs font-medium transition-colors pointer-coarse:min-h-[var(--touch-target)] ${name === preset.name && prompt === preset.prompt ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`,
                children: preset.label
              },
              preset.id
            )) }) }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.name, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Input, { value: name, onChange: (e) => setName(e.target.value), placeholder: oneShot ? "verify-deploy" : "morning-digest" }) }),
            oneShot ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.date, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Input, { type: "date", value: localRun.date, onChange: (e) => setLocalRun((cur) => ({ ...cur, date: e.target.value })), "aria-label": s.date }) }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.time, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Input, { type: "time", step: 60, value: localRun.time, onChange: (e) => setLocalRun((cur) => ({ ...cur, time: e.target.value })), "aria-label": s.time }) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "flex flex-wrap gap-2", "data-testid": "cron-create-quick-times", children: QUICK_TIMES.map((time) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                "button",
                {
                  type: "button",
                  onClick: () => setLocalRun((cur) => ({ ...cur, time })),
                  className: `min-h-9 rounded-full border px-3 font-mono text-xs tabular-nums transition-colors pointer-coarse:min-h-[var(--touch-target)] ${localRun.time === time ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`,
                  children: time
                },
                time
              )) }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "text-xs text-muted-foreground", children: s.hoursTimeZone })
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ScheduleField, { schedule, onChange: setSchedule }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.prompt, hint: s.helpCreatePrompt, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("textarea", { value: prompt, onChange: (e) => setPrompt(e.target.value), rows: 4, className: "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-ring" }) }),
            isAdmin ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.ownerColumn, hint: s.ownerFieldHint, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              C.Segmented,
              {
                value: scope,
                onChange: (value) => setScope(value),
                options: [
                  { value: "mine", label: s.ownerMine },
                  { value: "instance", label: s.ownerInstance }
                ],
                "aria-label": s.ownerColumn
              }
            ) }) : null,
            oneShot ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("details", { className: "flex flex-col gap-3 rounded-md border border-border px-3 py-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("summary", { className: "cursor-pointer text-sm font-medium text-foreground", children: s.createAdvanced }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.hours, hint: s.helpHours, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ActiveHoursField, { value: hours, onChange: setHours }) }) }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.model, hint: s.helpModel, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                C.BrainModelField,
                {
                  value: model ? `${model.provider}/${model.model}` : "",
                  onChange: (v) => {
                    const slash = v.indexOf("/");
                    setModel(slash > 0 ? { provider: v.slice(0, slash), model: v.slice(slash + 1) } : void 0);
                  },
                  models: models.data ?? [],
                  title: s.model,
                  subtitle: s.helpModel,
                  defaultLabel: s.modelDefault,
                  keyOf: (m) => `${m.provider}/${m.model}`
                }
              ) })
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.conversation, hint: s.helpConversation, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                ConversationField,
                {
                  value: conversationSessionId,
                  saved: void 0,
                  unresolved: false,
                  owner: scope === "instance" ? null : myId,
                  myId,
                  required: true,
                  mismatch: false,
                  onChange: setConversationSessionId
                }
              ) }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("details", { className: "flex flex-col gap-3 rounded-md border border-border px-3 py-2", children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("summary", { className: "cursor-pointer text-sm font-medium text-foreground", children: s.createAdvanced }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.hours, hint: s.helpHours, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ActiveHoursField, { value: hours, onChange: setHours }) }),
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.header, hint: s.helpHeader, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "flex h-9 items-center text-sm text-muted-foreground", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Toggle, { checked: plain !== true, onChange: (v) => setPlain(v ? void 0 : true), label: `${s.header}: ${name ? name : s.jobNew}` }) }) })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.model, hint: s.helpModel, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                  C.BrainModelField,
                  {
                    value: model ? `${model.provider}/${model.model}` : "",
                    onChange: (v) => {
                      const slash = v.indexOf("/");
                      setModel(slash > 0 ? { provider: v.slice(0, slash), model: v.slice(slash + 1) } : void 0);
                    },
                    models: models.data ?? [],
                    title: s.model,
                    subtitle: s.helpModel,
                    defaultLabel: s.modelDefault,
                    keyOf: (m) => `${m.provider}/${m.model}`
                  }
                ) })
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.enabled, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "flex h-9 items-center gap-2 text-sm text-muted-foreground", children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Toggle, { checked: enabled, onChange: setEnabled, label: `${s.createPaused}: ${enabled ? s.enabled : s.paused}` }),
              enabled ? s.enabled : s.paused
            ] }) })
          ] }) }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(C.ModalFooter, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Button, { variant: "ghost", onClick: onClose, disabled: submitting, children: s.cancel }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              C.Button,
              {
                variant: "accent",
                disabled: !ready || submitting,
                onClick: () => void submit(),
                children: oneShot ? s.createOneShotSubmit : s.createRecurringSubmit
              }
            )
          ] })
        ]
      }
    )
  );
}

// plugins/cronjob/web-src/HistoryTab.tsx
var import_react8 = __toESM(require_react(), 1);
var import_jsx_runtime8 = __toESM(require_jsx_runtime(), 1);
var statusLabel2 = (run, s) => ({
  waiting: s.runWaiting || "Waiting",
  running: s.runRunning || "Running",
  ok: s.runOk || "Succeeded",
  error: s.runErrorState || "Failed",
  skipped: s.runSkipped || "Skipped"
})[run.outcome];
var tone2 = (run) => run.outcome === "ok" ? "success" : run.outcome === "error" ? "danger" : run.outcome === "running" ? "accent" : "muted";
function HistoryTab({ query, owner, outcome, range, todayLocalDate, jobs, onOpenJob, onRun }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { t, locale } = hooks.useTranslation();
  const [page, setPage] = (0, import_react8.useState)(0);
  const [pageSize, setPageSize] = (0, import_react8.useState)(25);
  const [selected, setSelected] = (0, import_react8.useState)(null);
  (0, import_react8.useEffect)(() => {
    setPage(0);
  }, [query, owner, outcome, range, todayLocalDate]);
  const from = range === "today" ? todayLocalDate : shiftDate(todayLocalDate, -(Number(range) - 1));
  const request = hooks.useQuery({
    queryKey: ["cron-runs-history", query, owner, outcome, range, page, pageSize, todayLocalDate],
    queryFn: () => runtime().api(runsUrl({
      from,
      to: todayLocalDate,
      q: query || void 0,
      owner: owner === "all" ? void 0 : owner,
      outcome: outcome === "all" ? void 0 : outcome,
      limit: pageSize,
      offset: page * pageSize
    })),
    staleTime: 1e4
  });
  const rows = request.data?.runs ?? [];
  const lastPage = request.data ? Math.max(0, Math.ceil(request.data.total / pageSize) - 1) : 0;
  (0, import_react8.useEffect)(() => {
    if (!request.data || rows.length > 0 || page <= lastPage) return;
    setPage(lastPage);
  }, [lastPage, page, request.data, rows.length]);
  const format = (0, import_react8.useMemo)(() => new Intl.DateTimeFormat(locale || void 0, {
    dateStyle: "medium",
    timeStyle: "short"
  }), [locale]);
  if (request.isError) {
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.ControlSurfaceState, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.ErrorState, { message: t.common.daemonUnreachable, onRetry: () => request.refetch() }) }) });
  }
  if (!request.data) {
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.LoadingState, { variant: "cards" }) }) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(C.ControlSurfaceDocument, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(C.ControlSurfaceRegister, { className: "flex flex-col gap-3", "data-testid": "cron-history-tab", children: [
      rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        C.EmptyState,
        {
          title: s.historyEmpty || "No run history",
          description: s.historyEmptyHint || "Run history is recorded from this upgrade onward."
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
        C.DataTable,
        {
          ariaLabel: s.tabHistory,
          columns: "11rem minmax(0,2fr) minmax(0,1fr) 6rem 8rem minmax(0,1fr) 1.25rem",
          compactColumns: "minmax(0,1fr) 6rem 1.25rem",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(C.DataTableRow, { header: true, children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", children: s.colTime || "Time" }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.DataTableCell, { header: true, lines: 1, children: s.name }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", children: s.colOwner || "Owner" }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", children: s.colDuration || "Duration" }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.DataTableCell, { header: true, lines: 1, children: s.colState || "Status" }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", children: s.colModel || "Model" }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.DataTableCell, { header: true, lines: 1, "aria-hidden": true, children: null })
            ] }),
            rows.map((run) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(C.DataTableRow, { height: "tall", onOpen: () => setSelected(run), openLabel: run.jobName, children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.DataTableCell, { lines: "auto", priority: "wide", className: "font-mono text-xs", children: format.format(new Date(run.startedAt)) }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(C.DataTableCell, { lines: "auto", children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "font-medium", children: run.jobName }),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "text-[11px] text-muted-foreground", children: run.schedule || s.badgeOneShot })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.DataTableCell, { lines: "auto", priority: "wide", children: run.owner?.name || s.ownerSystem || "System" }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.DataTableCell, { lines: 1, priority: "wide", children: run.durationMs === null ? "\u2014" : `${Math.round(run.durationMs / 100) / 10} s` }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.DataTableCell, { lines: "auto", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.Badge, { tone: tone2(run), children: statusLabel2(run, s) }) }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.DataTableCell, { lines: 1, priority: "wide", children: run.model || "\u2014" }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(C.DataTableChevronCell, {})
            ] }, run.id))
          ]
        }
      ),
      request.data.total > 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        C.Pager,
        {
          page,
          pageSize,
          total: request.data.total,
          onPageChange: setPage,
          onPageSizeChange: (size) => {
            setPage(0);
            setPageSize(size);
          },
          ariaLabel: s.tabHistory
        }
      ) : null
    ] }),
    selected ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      RunResultModal,
      {
        run: selected,
        job: jobs.get(selected.jobId),
        onClose: () => setSelected(null),
        onOpenJob: (jobId) => {
          setSelected(null);
          onOpenJob(jobId);
        },
        onRun
      }
    ) : null
  ] });
}

// plugins/cronjob/web-src/JobDrawer.tsx
var import_react9 = __toESM(require_react(), 1);
var import_jsx_runtime9 = __toESM(require_jsx_runtime(), 1);
var textareaClass = "w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-ring";
var writablePayload = (job) => {
  const {
    owner: _owner,
    conversation: _conversation,
    conversationUnresolved: _unresolved,
    runLocation: _runLocation,
    lifecycle: _lifecycle,
    nextOccurrence: _nextOccurrence,
    manualQueued: _manualQueued,
    expectedRevision: _expectedRevision,
    ...payload
  } = job;
  return payload;
};
var localRunOf = (job) => {
  if (typeof job.localRunAt === "object") return { date: job.localRunAt.date, time: job.localRunAt.time };
  const serverLabel = job.nextOccurrence && job.nextOccurrence.disposition === "onTime" ? { date: job.nextOccurrence.localDate, time: job.nextOccurrence.localTime } : null;
  return { date: serverLabel?.date ?? "", time: serverLabel?.time ?? "" };
};
function JobDrawer({ job, myId, adminFields, destinations, models, onClose, onRemoved, onRefresh, onRunQueued }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { t, locale } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const save = hooks.useSaveCronJob();
  const del = hooks.useDeleteCronJob();
  const projects = hooks.useQuery({ queryKey: ["projects"], queryFn: () => runtime().api("/projects") });
  const [draft, setDraft] = (0, import_react9.useState)(job);
  const [confirming, setConfirming] = (0, import_react9.useState)(false);
  const [runPending, setRunPending] = (0, import_react9.useState)(false);
  const [togglePending, setTogglePending] = (0, import_react9.useState)(false);
  const [editVersion, setEditVersion] = (0, import_react9.useState)(0);
  const draftRef = (0, import_react9.useRef)(draft);
  draftRef.current = draft;
  const dirty = (0, import_react9.useRef)(false);
  const inFlight = (0, import_react9.useRef)(null);
  const everSaved = (0, import_react9.useRef)(true);
  const ownerOf = (j) => adminFields ? j.ownerUserId ?? null : myId;
  const isSavable = (j) => j.name.trim() !== "" && j.prompt.trim() !== "";
  const autosave = hooks.useAutoSaveStatus([editVersion], async () => {
    if (draft.runAt && !draft.localRunAt) return;
    const sent = draftRef.current;
    const payload = writablePayload(sent);
    everSaved.current = true;
    const request = save.mutateAsync({ ...payload, expectedRevision: sent.revision ?? 0 });
    inFlight.current = request;
    try {
      await request;
      if (draftRef.current === sent) dirty.current = false;
    } catch (error) {
      toast(`${s.saveError} \u2014 ${utils.apiErrorMessage(error)}`, "error");
      throw error;
    } finally {
      if (inFlight.current === request) inFlight.current = null;
    }
  }, { savable: isSavable(draft), delay: 900 });
  const serverCopy = JSON.stringify(job);
  (0, import_react9.useEffect)(() => {
    if (dirty.current) return;
    setDraft(job);
  }, [serverCopy]);
  const patch = (p) => {
    dirty.current = true;
    setDraft((cur) => ({ ...cur, ...p }));
    setEditVersion((version) => version + 1);
  };
  const patchLocalRun = (p) => {
    const clean = { ...localRunOf(job), ...p };
    if (!clean.date || !clean.time) return;
    dirty.current = true;
    setDraft((cur) => ({ ...cur, localRunAt: { date: clean.date, time: clean.time } }));
    setEditVersion((version) => version + 1);
  };
  const runNow = async () => {
    if (draft.runAt || dirty.current || autosave.status === "saving" || runPending) return;
    setRunPending(true);
    try {
      await runtime().api(`/plugins/cronjob/jobs/${encodeURIComponent(job.id)}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: job.revision ?? 0 })
      });
      toast(s.runQueued, "ok");
      onRunQueued?.();
      onRefresh();
    } catch (error) {
      if (apiErrorCode(error) === "run_already_queued") {
        toast(s.runQueued, "ok");
        onRunQueued?.();
      } else toast(`${s.runError} \u2014 ${utils.apiErrorMessage(error)}`, "error");
    } finally {
      setRunPending(false);
    }
  };
  const toggleEnabled = async (next) => {
    const canWrite = adminFields || job.ownerUserId != null && job.ownerUserId === myId;
    if (!canWrite || togglePending) return;
    const before = draftRef.current;
    const sent = { ...before, enabled: next };
    setDraft(sent);
    dirty.current = true;
    setTogglePending(true);
    everSaved.current = true;
    const request = save.mutateAsync({ ...writablePayload(sent), expectedRevision: before.revision ?? 0 });
    inFlight.current = request;
    try {
      await request;
      if (draftRef.current === sent) dirty.current = false;
    } catch (error) {
      if (draftRef.current === sent) {
        setDraft(before);
        dirty.current = false;
      }
      toast(`${s.saveError} \u2014 ${utils.apiErrorMessage(error)}`, "error");
    } finally {
      if (inFlight.current === request) inFlight.current = null;
      setTogglePending(false);
    }
  };
  const remove = async () => {
    setConfirming(false);
    onRemoved(job.id);
    await inFlight.current?.catch(() => {
    });
    try {
      await del.mutateAsync(job.id);
    } catch {
      toast(s.deleteError, "error");
    }
  };
  const oneShot = draft.runAt !== void 0 && draft.runAt !== null;
  const localRun = (0, import_react9.useMemo)(() => localRunOf(draft), [draft]);
  const enabled = draft.enabled !== false;
  const mayPatch = adminFields || job.ownerUserId != null && job.ownerUserId === myId;
  const name = draft.name || s.jobNew;
  const nextOccurrence = job.nextOccurrence;
  const dispositionLine = nextOccurrence?.disposition === "deferredByHours" ? s.badgeDeferredHint : nextOccurrence?.disposition === "catchUp" ? s.badgeCatchUpHint : nextOccurrence?.disposition === "dueNow" || nextOccurrence?.disposition === "late" ? s.badgeLateHint : nextOccurrence?.guarded ? s.badgeGuardedHint : null;
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(C.WorkspaceDetailRail, { label: name, closeLabel: t.common.close, onClose, children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "flex min-w-0 flex-col gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Field, { label: s.name, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Input, { value: draft.name, disabled: !mayPatch, onChange: (e) => patch({ name: e.target.value }), placeholder: "morning-digest" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Field, { label: oneShot ? s.badgeOneShot : s.badgeRecurring, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { className: "flex h-9 items-center gap-2 text-sm text-muted-foreground", children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Badge, { tone: "default", children: oneShot ? s.badgeOneShot : s.badgeRecurring }),
          job.manualQueued ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Badge, { tone: "muted", children: s.runQueued }) : null,
          mayPatch ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
            C.Toggle,
            {
              checked: enabled,
              onChange: (v) => {
                patch({ enabled: v });
              },
              disabled: autosave.status === "saving",
              label: `${name}: ${s.enabled}`
            }
          ) : null,
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "sr-only", children: enabled ? s.enabled : s.paused }),
          !enabled ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { className: "inline-flex items-center gap-1", "aria-hidden": true, children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(CirclePause, { size: 12 }),
            s.paused
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { "aria-hidden": true, children: s.enabled })
        ] }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "flex flex-col gap-1 rounded-md border border-border bg-document px-3 py-2 text-xs text-muted-foreground", "data-testid": "cron-next-run", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "text-sm font-medium text-foreground", children: s.nextRun }),
        enabled && nextOccurrence ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(import_jsx_runtime9.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { className: "font-mono text-xs text-foreground", children: [
            nextOccurrence.localDate,
            " ",
            nextOccurrence.localTime,
            " \xB7 ",
            nextOccurrence.timezone
          ] }),
          dispositionLine ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: dispositionLine }) : null
        ] }) : !enabled ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: s.nextRunPaused }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: s.nextRunUnknown })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Field, { label: s.schedule, hint: s.helpSchedule, children: oneShot ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Field, { label: s.date, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Input, { type: "date", value: localRun.date, onChange: (e) => patchLocalRun({ date: e.target.value }), "aria-label": s.date, disabled: !mayPatch }) }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Field, { label: s.time, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Input, { type: "time", step: 60, value: localRun.time, onChange: (e) => patchLocalRun({ time: e.target.value }), "aria-label": s.time, disabled: !mayPatch }) }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "text-xs text-muted-foreground sm:col-span-2", children: s.hoursTimeZone })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(ScheduleField, { schedule: draft.schedule, onChange: (schedule) => patch({ schedule }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Field, { label: s.hours, hint: s.helpHours, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(ActiveHoursField, { value: draft.hours, onChange: (hours) => patch({ hours }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Field, { label: s.header, hint: s.helpHeader, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "flex h-9 items-center text-sm text-muted-foreground", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Toggle, { checked: draft.plain !== true, onChange: (v) => patch({ plain: v ? void 0 : true }), label: `${name}: ${s.header}`, disabled: !mayPatch }) }) })
      ] }),
      adminFields && (draft.ownerUserId == null || draft.ownerUserId === myId) ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Field, { label: s.ownerColumn, hint: s.ownerFieldHint, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        C.Segmented,
        {
          value: draft.ownerUserId != null ? "mine" : "instance",
          onChange: (value) => patch({ ownerUserId: value === "mine" ? myId ?? void 0 : null }),
          options: [
            { value: "instance", label: s.ownerInstance },
            { value: "mine", label: s.ownerMine }
          ],
          "aria-label": s.ownerColumn,
          nowrap: true
        }
      ) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(C.Field, { label: s.executionProject, hint: s.helpExecutionProject, children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
          C.ChoiceField,
          {
            title: s.executionProject,
            manageAriaLabel: s.executionProject,
            picker: "always",
            value: draft.projectRef ? `${draft.projectRef.kind}:${draft.projectRef.projectId ?? ""}` : "",
            options: [
              { value: "", label: s.executionLegacy },
              ...adminFields && ownerOf(draft) === null ? [{ value: "host:", label: s.executionHost }] : [],
              ...(projects.data ?? []).filter((project) => project.executionKind !== "managed" || ownerOf(draft) !== null).map((project) => ({ value: `${project.executionKind}:${project.id}`, label: project.slug }))
            ],
            onChange: (value) => {
              if (value === "host:") {
                patch({ projectRef: { kind: "host" } });
                return;
              }
              const project = projects.data?.find((project2) => `${project2.executionKind}:${project2.id}` === value);
              if (project) patch({ projectRef: { kind: project.executionKind, projectId: project.id } });
            },
            "aria-label": s.executionProject
          }
        ),
        projects.isError ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { role: "alert", className: "text-sm text-destructive", children: s.executionUnavailable }) : null
      ] }),
      !oneShot ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Field, { label: s.conversation, hint: s.helpConversation, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        ConversationField,
        {
          value: draft.conversationSessionId ?? "",
          saved: job.conversation,
          unresolved: job.conversationUnresolved === true,
          owner: ownerOf(draft),
          myId,
          required: false,
          mismatch: false,
          onChange: (conversationSessionId) => patch({ conversationSessionId })
        }
      ) }) : null,
      adminFields || draft.projectRef?.kind === "managed" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Field, { label: s.check, hint: s.helpCheck, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("textarea", { value: draft.check ?? "", onChange: (e) => patch({ check: e.target.value || void 0 }), rows: 2, className: textareaClass, placeholder: 'test -n "$(ls /new-bookings 2>/dev/null)" && cat /new-bookings/*' }) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Field, { label: s.prompt, hint: s.helpPrompt, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("textarea", { value: draft.prompt, onChange: (e) => patch({ prompt: e.target.value }), rows: 8, className: textareaClass, disabled: !mayPatch }) }),
      adminFields && (draft.ownerUserId == null || draft.ownerUserId === myId) ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Field, { label: s.channel, hint: s.helpChannel, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        DestinationField,
        {
          value: draft.notifyChannelId ?? "",
          onChange: (v) => patch({ notifyChannelId: v || void 0 }),
          destinations
        }
      ) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Field, { label: s.model, hint: s.helpModel, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        C.BrainModelField,
        {
          value: draft.model ? `${draft.model.provider}/${draft.model.model}` : "",
          onChange: (v) => {
            const slash = v.indexOf("/");
            patch({ model: slash > 0 ? { provider: v.slice(0, slash), model: v.slice(slash + 1) } : void 0 });
          },
          models,
          title: s.model,
          subtitle: s.helpModel,
          defaultLabel: s.modelDefault,
          keyOf: (m) => `${m.provider}/${m.model}`
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "flex min-w-0 flex-col gap-1", "data-testid": "cron-last-run", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "text-sm font-medium text-foreground", children: s.lastStarted }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "text-xs text-muted-foreground", children: job.lastRun && utils.parseTs(job.lastRun) != null ? new Date(utils.parseTs(job.lastRun)).toLocaleString(locale || void 0) : "\u2014" }),
        job.lastResult ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground", children: job.lastResult }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3", children: [
        !oneShot ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
          C.Button,
          {
            variant: "outline",
            icon: Play,
            disabled: dirty.current || autosave.status === "saving" || runPending,
            onClick: () => void runNow(),
            children: runPending ? s.runStarting : s.runNow
          }
        ) : !job.manualQueued ? null : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", {}),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { className: "ml-auto flex items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
            C.Button,
            {
              variant: "outline",
              icon: enabled ? CirclePause : Play,
              "aria-label": enabled ? s.pauseLabel : s.pauseLabelOn,
              disabled: !mayPatch || togglePending,
              onClick: () => void toggleEnabled(!enabled),
              children: enabled ? s.pauseLabel : s.paused
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Button, { variant: "ghost-danger", icon: Trash2, onClick: () => setConfirming(true), children: s.removeJob })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.AutoSaveStatus, { status: autosave.status, onRetry: autosave.retry })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
      C.ConfirmDialog,
      {
        open: confirming,
        title: s.deleteTitle,
        description: s.deleteDesc.replace("{name}", name),
        confirmLabel: s.removeJob,
        onConfirm: remove,
        onClose: () => setConfirming(false)
      }
    )
  ] });
}

// plugins/cronjob/web-src/AutomationPage.tsx
var import_jsx_runtime10 = __toESM(require_jsx_runtime(), 1);
var parseDate2 = (label) => {
  const [year, month, day] = label.split("-").map(Number);
  return new Date(year, month - 1, day);
};
var jobParam = () => {
  const value = new URLSearchParams(window.location.search).get("job");
  return value?.trim() || null;
};
var writeJobParam = (id) => {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("job", id);
  else url.searchParams.delete("job");
  window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};
function AutomationPage() {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { locale } = hooks.useTranslation();
  const me = hooks.useMe();
  const mobile = hooks.useMobile();
  const destinations = hooks.useNotificationDestinations();
  const models = hooks.useBrainModels();
  const save = hooks.useSaveCronJob();
  const queryClient = hooks.useQueryClient();
  const [tab, setTab] = (0, import_react10.useState)("calendar");
  const [view, setView] = (0, import_react10.useState)("week");
  const [start, setStart] = (0, import_react10.useState)(null);
  const [selectedDate, setSelectedDate] = (0, import_react10.useState)(null);
  const [meta, setMeta] = (0, import_react10.useState)(null);
  const [query, setQuery] = (0, import_react10.useState)("");
  const [owner, setOwner] = (0, import_react10.useState)("all");
  const [state, setState] = (0, import_react10.useState)("all");
  const [kind, setKind] = (0, import_react10.useState)("all");
  const [outcome, setOutcome] = (0, import_react10.useState)("all");
  const [range, setRange] = (0, import_react10.useState)("7");
  const [opening, setOpening] = (0, import_react10.useState)(null);
  const [openJobId, setOpenJobId] = (0, import_react10.useState)(jobParam());
  const [missingLink, setMissingLink] = (0, import_react10.useState)(false);
  (0, import_react10.useEffect)(() => {
    if (mobile) setView("day");
  }, [mobile]);
  const jobs = (0, import_react10.useMemo)(() => new Map((meta?.jobs ?? []).map((job) => [job.id, job])), [meta?.jobs]);
  (0, import_react10.useEffect)(() => {
    if (!meta || !openJobId) return;
    setMissingLink(!jobs.has(openJobId));
  }, [jobs, meta, openJobId]);
  const invalidate = (0, import_react10.useCallback)(() => {
    void queryClient.invalidateQueries({ queryKey: ["cron-week"] });
    void queryClient.invalidateQueries({ queryKey: ["cron-runs-day"] });
    void queryClient.invalidateQueries({ queryKey: ["cron-runs-history"] });
  }, [queryClient]);
  const openJob = (0, import_react10.useCallback)((id) => {
    setOpenJobId(id);
    setMissingLink(false);
    writeJobParam(id);
  }, []);
  const closeJob = (0, import_react10.useCallback)(() => {
    setOpenJobId(null);
    setMissingLink(false);
    writeJobParam(null);
  }, []);
  const runJob = (0, import_react10.useCallback)(async (job) => {
    await runtime().api(`/plugins/cronjob/jobs/${encodeURIComponent(job.id)}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: job.revision ?? 0 })
    });
    invalidate();
  }, [invalidate]);
  const toggleJob = (0, import_react10.useCallback)((job) => {
    save.mutate({ ...job, enabled: job.enabled === false, expectedRevision: job.revision ?? 0 }, {
      onSuccess: invalidate
    });
  }, [invalidate, save]);
  const onData = (0, import_react10.useCallback)((data) => {
    setMeta(data);
  }, []);
  const shiftWindow = (0, import_react10.useCallback)((amount) => {
    const base = meta?.window.startLocalDate ?? start;
    if (base) setStart(shiftDate(base, amount));
    setSelectedDate((current) => current ? shiftDate(current, amount) : current);
  }, [meta?.window.startLocalDate, start]);
  const rangeLabel = meta ? new Intl.DateTimeFormat(locale || void 0, {
    day: "numeric",
    month: "short",
    ...parseDate2(meta.window.startLocalDate).getFullYear() !== parseDate2(shiftDate(meta.window.endLocalDateExclusive, -1)).getFullYear() ? { year: "numeric" } : {}
  }).formatRange(parseDate2(meta.window.startLocalDate), parseDate2(shiftDate(meta.window.endLocalDateExclusive, -1))) : "\u2026";
  const labelOf = (options, value) => options.find((option) => option.value === value)?.label ?? value;
  const selectFilter = (value, onChange, options, label) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(C.SelectMenu, { value, onChange: (next) => onChange(next), options, label });
  const ownerOptions = [
    { value: "all", label: s.filterAll, icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Layers, { size: 14 }) },
    { value: "mine", label: s.filterMine, icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(User, { size: 14 }) },
    { value: "instance", label: s.filterInstance, icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Boxes, { size: 14 }) }
  ];
  const stateOptions = [
    { value: "all", label: s.filterAll, icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Layers, { size: 14 }) },
    { value: "active", label: s.metricActive, icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(CircleCheck, { size: 14 }) },
    { value: "paused", label: s.paused, icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(CirclePause, { size: 14 }) }
  ];
  const kindOptions = [
    { value: "all", label: s.filterAll, icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Layers, { size: 14 }) },
    { value: "fixed", label: s.kindFixed || "Fixed time", icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Clock, { size: 14 }) },
    { value: "interval", label: s.kindInterval || "Interval", icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Repeat, { size: 14 }) },
    { value: "oneShot", label: s.badgeOneShot, icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(CalendarClock, { size: 14 }) }
  ];
  const outcomeOptions = [
    { value: "all", label: s.filterAll, icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Layers, { size: 14 }) },
    { value: "ok", label: s.runOk, icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(CircleCheck, { size: 14 }) },
    { value: "error", label: s.runErrorState, icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(CircleX, { size: 14 }) },
    { value: "skipped", label: s.runSkipped, icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(CircleDashed, { size: 14 }) }
  ];
  const rangeOptions = [
    { value: "7", label: s.range7 || "7 days", icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Layers, { size: 14 }) },
    { value: "today", label: s.rangeToday || "Today", icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(CalendarDays, { size: 14 }) },
    { value: "30", label: s.range30 || "30 days", icon: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(CalendarDays, { size: 14 }) }
  ];
  const calendarFields = [
    ...me.data?.user?.is_admin ? [{
      id: "owner",
      label: s.filterOwner || "Owner",
      control: selectFilter(owner, setOwner, ownerOptions, s.filterOwner || "Owner"),
      ...owner !== "all" ? { active: true, activeLabel: `${s.filterOwner}: ${labelOf(ownerOptions, owner)}`, onReset: () => setOwner("all") } : { active: false }
    }] : [],
    {
      id: "state",
      label: s.filterState || "Status",
      control: selectFilter(state, setState, stateOptions, s.filterState || "Status"),
      ...state !== "all" ? { active: true, activeLabel: `${s.filterState}: ${labelOf(stateOptions, state)}`, onReset: () => setState("all") } : { active: false }
    },
    {
      id: "kind",
      label: s.filterKind || "Type",
      control: selectFilter(kind, setKind, kindOptions, s.filterKind || "Type"),
      ...kind !== "all" ? { active: true, activeLabel: `${s.filterKind}: ${labelOf(kindOptions, kind)}`, onReset: () => setKind("all") } : { active: false }
    }
  ];
  const historyFields = [
    ...me.data?.user?.is_admin ? calendarFields.slice(0, 1) : [],
    {
      id: "outcome",
      label: s.filterOutcome || "Outcome",
      control: selectFilter(outcome, setOutcome, outcomeOptions, s.filterOutcome || "Outcome"),
      ...outcome !== "all" ? { active: true, activeLabel: `${s.filterOutcome}: ${labelOf(outcomeOptions, outcome)}`, onReset: () => setOutcome("all") } : { active: false }
    },
    {
      id: "range",
      label: s.filterRange || "Range",
      control: selectFilter(range, setRange, rangeOptions, s.filterRange || "Range"),
      ...range !== "7" ? { active: true, activeLabel: `${s.filterRange}: ${labelOf(rangeOptions, range)}`, onReset: () => setRange("7") } : { active: false }
    }
  ];
  const dateNavigator = tab === "calendar" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "flex min-w-0 flex-wrap items-center gap-1.5", "data-testid": "cron-date-navigator", children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(C.IconButton, { icon: ChevronLeft, label: s.weekPrev || "Previous week", onClick: () => shiftWindow(-7) }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(C.IconButton, { icon: ChevronRight, label: s.weekNext || "Next week", onClick: () => shiftWindow(7) }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(C.Button, { variant: "ghost", onClick: () => {
      setStart(null);
      setSelectedDate(null);
    }, children: s.calToday }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { "aria-live": "polite", className: "min-w-28 text-center text-sm font-semibold", children: rangeLabel }),
    !mobile ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(C.Segmented, { value: view, onChange: setView, options: [
      { value: "day", label: s.viewDay || "Day" },
      { value: "week", label: s.viewWeek || "Week" }
    ], "aria-label": s.viewWeek || "Calendar view" }) : null
  ] }) : void 0;
  const createMenu = /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
    C.ActionMenu,
    {
      variant: "kebab",
      align: "right",
      label: s.newTask || "New task",
      trigger: /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("span", { className: "inline-flex items-center gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Plus, { size: 15, "aria-hidden": true }),
        s.newTask || "New task"
      ] }),
      triggerClassName: "inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[var(--touch-target)]",
      items: [
        { id: "recurring", label: s.createRecurring, icon: Repeat, onSelect: () => setOpening({ lifecycle: "recurring" }) },
        { id: "oneShot", label: s.createOneShot, icon: CalendarClock, onSelect: () => setOpening({ lifecycle: "oneShot" }) }
      ],
      testId: "cron-new-task-menu"
    }
  );
  const selectedJob = openJobId ? jobs.get(openJobId) : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
      C.WorkspaceShell,
      {
        variant: "register",
        hero: {
          eyebrow: s.workspaceEyebrow,
          title: s.workspaceTitle,
          description: s.sectionHint,
          icon: CalendarClock,
          action: createMenu,
          status: meta ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "workspace-status", children: meta.timezone }) : void 0
        },
        navigation: {
          sections: [
            { id: "calendar", label: s.tabCalendar || "Calendar", icon: CalendarDays },
            { id: "history", label: s.tabHistory || "History", icon: Clock }
          ],
          value: tab,
          onChange: (next) => setTab(next),
          ariaLabel: s.workspaceTitle
        },
        toolbar: {
          search: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(C.RegisterSearch, { value: query, onChange: setQuery, onClear: () => setQuery(""), placeholder: s.searchPlaceholder, count: meta?.jobs.length ?? 0 }),
          filters: tab === "calendar" ? calendarFields : historyFields,
          children: dateNavigator
        },
        children: [
          missingLink ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { role: "status", className: "mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive", children: s.linkUnavailableHint }) : null,
          tab === "calendar" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
            CalendarTab,
            {
              start,
              selectedDate,
              view,
              query,
              owner,
              state,
              kind,
              onSelectedDate: setSelectedDate,
              onData,
              onWindowShift: shiftWindow,
              onOpenJob: openJob,
              onRun: (job) => void runJob(job),
              onToggle: toggleJob,
              onAddAt: (date) => setOpening({ lifecycle: "oneShot", date })
            }
          ) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
            HistoryTab,
            {
              query,
              owner,
              outcome,
              range,
              todayLocalDate: meta?.todayLocalDate ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
              jobs,
              onOpenJob: openJob,
              onRun: (job) => void runJob(job)
            }
          )
        ]
      }
    ),
    opening ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
      CreateJobDialog,
      {
        lifecycle: opening.lifecycle,
        ...opening.date ? { initialDate: opening.date } : {},
        myId: me.data?.user?.id ?? null,
        isAdmin: me.data?.user?.is_admin === true,
        onClose: () => setOpening(null),
        onCreated: (created) => {
          setOpening(null);
          invalidate();
          openJob(created.id);
        }
      }
    ) : null,
    selectedJob ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
      JobDrawer,
      {
        job: selectedJob,
        myId: me.data?.user?.id ?? null,
        adminFields: me.data?.user?.is_admin === true,
        destinations: destinations.data ?? [],
        models: models.data ?? [],
        onClose: closeJob,
        onRemoved: () => {
          closeJob();
          invalidate();
        },
        onRefresh: invalidate,
        onRunQueued: invalidate
      }
    ) : null
  ] });
}

// plugins/cronjob/web-src/ConversationHistoryBranch.tsx
var import_jsx_runtime11 = __toESM(require_jsx_runtime(), 1);
function parseJobs(items) {
  const jobs = items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const value = item;
    if (typeof value.jobId !== "string" || typeof value.name !== "string" || typeof value.enabled !== "boolean" || typeof value.href !== "string") return null;
    const run = value.run;
    if (run === void 0) return { jobId: value.jobId, name: value.name, enabled: value.enabled, href: value.href };
    if (!run || typeof run !== "object" || typeof run.sessionId !== "string" || typeof run.continuable !== "boolean") return null;
    return { jobId: value.jobId, name: value.name, enabled: value.enabled, href: value.href, run };
  });
  return jobs.every((job) => job !== null) ? jobs : null;
}
function ConversationHistoryBranch({ parent, items, expanded, toggle, open }) {
  const { components: C, hooks } = runtime();
  const strings = hooks.usePluginStrings("cronjob");
  const jobs = parseJobs(items);
  if (!jobs || jobs.length === 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(import_jsx_runtime11.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(C.DataTableRow, { "data-tree-row": "jobs", "data-parent-session": parent.id, children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(C.DataTableCell, { lines: "auto", className: "flex items-center gap-1.5", style: { gridColumn: "1 / -1" }, children: /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("button", { type: "button", onClick: toggle, "aria-expanded": expanded, className: "flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(ChevronRight, { size: 12, "aria-hidden": true, className: expanded ? "rotate-90" : "" }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "truncate", children: strings.historyBranch }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "font-mono tabular-nums", children: jobs.length })
    ] }) }) }),
    expanded ? jobs.map((job) => job.run ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(C.DataTableRow, { "data-tree-row": "job", children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(C.DataTableCell, { lines: "auto", style: { gridColumn: "1 / -1" }, children: /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("button", { type: "button", onClick: () => open("session:" + encodeURIComponent(job.run?.sessionId ?? "") + ":" + (job.run?.continuable === true ? "1" : "0")), className: "flex min-w-0 items-center gap-1.5 text-left text-xs hover:text-primary", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Clock, { size: 12, "aria-hidden": true }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "truncate", children: job.name }),
      job.enabled ? null : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(C.Badge, { tone: "muted", children: strings.paused })
    ] }) }) }, job.jobId) : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(C.DataTableRow, { "data-tree-row": "job", children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(C.DataTableCell, { lines: "auto", style: { gridColumn: "1 / -1" }, children: /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("a", { href: job.href, className: "flex min-w-0 items-center gap-1.5 text-left text-xs hover:text-primary", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Clock, { size: 12, "aria-hidden": true }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "truncate", children: job.name }),
      job.enabled ? null : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(C.Badge, { tone: "muted", children: strings.paused })
    ] }) }) }, job.jobId)) : null
  ] });
}

// plugins/cronjob/web-src/index.tsx
var import_jsx_runtime12 = __toESM(require_jsx_runtime(), 1);
function CronNextRunMetric({ locale }) {
  const { hooks } = runtime();
  const strings = hooks.usePluginStrings("cronjob");
  const me = hooks.useMe();
  const jobs = hooks.useCronJobs(me.data?.user?.is_admin === true);
  const next = (0, import_react11.useMemo)(() => {
    let best = null;
    for (const job of jobs.data ?? []) {
      const at = job.nextOccurrence ? Date.parse(job.nextOccurrence.expectedAt) : NaN;
      if (Number.isNaN(at)) continue;
      if (!best || at < best.at) best = { at, name: job.name };
    }
    return best;
  }, [jobs.data]);
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("a", { href: "/p/cronjob/settings/jobs", className: "min-w-0 rounded-lg transition-opacity hover:opacity-80", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "font-mono text-xl font-medium tabular-nums text-foreground @2xl:text-2xl", children: next ? new Date(next.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "\u2014" }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "mt-0.5 text-[11px] text-muted-foreground", children: strings.nextRun }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "mt-0.5 truncate text-[11px] text-muted-foreground", children: next?.name ?? strings.nextRunUnknown })
  ] });
}
function CronJobApp({ surface }) {
  return surface === "page" ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(AutomationPage, {}) : /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(AutomationDeck, {});
}
function AutomationDeck() {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { t } = hooks.useTranslation();
  const me = hooks.useMe();
  const destinations = hooks.useNotificationDestinations();
  const models = hooks.useBrainModels();
  const [opening, setOpening] = (0, import_react11.useState)(null);
  const [openJobId, setOpenJobId] = (0, import_react11.useState)(null);
  const board = hooks.useQuery({
    queryKey: ["cron-week", null],
    queryFn: () => runtime().api(weekUrl(null)),
    staleTime: 15e3,
    refetchInterval: 3e4
  });
  const jobs = board.data?.jobs ?? [];
  const openJob = jobs.find((job) => job.id === openJobId);
  const createMenu = /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
    C.ActionMenu,
    {
      variant: "kebab",
      label: s.newTask,
      trigger: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { className: "inline-flex items-center gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Plus, { size: 14, "aria-hidden": true }),
        s.newTask
      ] }),
      triggerClassName: "inline-flex min-h-[44px] items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground pointer-coarse:min-h-[var(--touch-target)]",
      items: [
        { id: "recurring", label: s.createRecurring, icon: Repeat, onSelect: () => setOpening("recurring") },
        { id: "oneShot", label: s.createOneShot, icon: CalendarClock, onSelect: () => setOpening("oneShot") }
      ]
    }
  );
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(C.PluginSection, { title: s.title, description: s.sectionHint, action: createMenu, children: board.isError ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(C.ErrorState, { message: t.common.daemonUnreachable, onRetry: () => board.refetch() }) : !board.data ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(C.LoadingState, { variant: "list" }) : jobs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(C.EmptyState, { title: s.calEmptyTitle, description: s.calEmptyHint, icon: CalendarClock }) : /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(C.EntityList, { children: jobs.map((job) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(C.EntityRow, { children: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
      "button",
      {
        type: "button",
        "aria-label": (s.openJob || "Open \u201C{name}\u201D").replace("{name}", job.name),
        className: "flex min-h-[44px] w-full items-center justify-between gap-3 text-left",
        onClick: () => setOpenJobId(job.id),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { className: "min-w-0", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "block truncate text-sm font-medium", children: job.name }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "block truncate text-xs text-muted-foreground", children: job.schedule })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(C.Badge, { tone: job.enabled === false ? "muted" : "success", children: job.enabled === false ? s.paused : s.metricActive })
        ]
      }
    ) }, job.id)) }) }),
    opening ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
      CreateJobDialog,
      {
        lifecycle: opening,
        myId: me.data?.user?.id ?? null,
        isAdmin: me.data?.user?.is_admin === true,
        onClose: () => setOpening(null),
        onCreated: (created) => {
          setOpening(null);
          void board.refetch();
          setOpenJobId(created.id);
        }
      }
    ) : null,
    openJob ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
      JobDrawer,
      {
        job: openJob,
        myId: me.data?.user?.id ?? null,
        adminFields: me.data?.user?.is_admin === true,
        destinations: destinations.data ?? [],
        models: models.data ?? [],
        onClose: () => setOpenJobId(null),
        onRemoved: () => {
          setOpenJobId(null);
          void board.refetch();
        },
        onRefresh: () => void board.refetch(),
        onRunQueued: () => void board.refetch()
      }
    ) : null
  ] });
}
registerCronUi({
  requiresApiVersion: 17,
  settings: { jobs: CronJobApp },
  ownsPageFrame: ["jobs"],
  dashboardMetrics: { "next-run": CronNextRunMetric },
  historyBranches: { cronjob: ConversationHistoryBranch }
});
export {
  CronNextRunMetric
};
