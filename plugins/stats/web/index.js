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

// plugins/stats/web-src/runtime.ts
function runtime() {
  const value = window.ElowenUiRuntime;
  if (!value) throw new Error("ElowenUiRuntime is not installed");
  return value;
}
function registerStatsUi(pages) {
  window.__elowenRegisterPluginUi?.("stats", { requiresApiVersion: 1, pages });
}

// plugins/stats/web-src/StatsView.tsx
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

// node_modules/lucide-react/dist/esm/icons/chart-column.js
var ChartColumn = createLucideIcon("ChartColumn", [
  ["path", { d: "M3 3v16a2 2 0 0 0 2 2h16", key: "c24i48" }],
  ["path", { d: "M18 17V9", key: "2bz60n" }],
  ["path", { d: "M13 17V5", key: "1frdt8" }],
  ["path", { d: "M8 17v-3", key: "17ska0" }]
]);

// node_modules/lucide-react/dist/esm/icons/chevron-left.js
var ChevronLeft = createLucideIcon("ChevronLeft", [
  ["path", { d: "m15 18-6-6 6-6", key: "1wnfg3" }]
]);

// node_modules/lucide-react/dist/esm/icons/chevron-right.js
var ChevronRight = createLucideIcon("ChevronRight", [
  ["path", { d: "m9 18 6-6-6-6", key: "mthhwq" }]
]);

// node_modules/lucide-react/dist/esm/icons/database.js
var Database = createLucideIcon("Database", [
  ["ellipse", { cx: "12", cy: "5", rx: "9", ry: "3", key: "msslwz" }],
  ["path", { d: "M3 5V19A9 3 0 0 0 21 19V5", key: "1wlel7" }],
  ["path", { d: "M3 12A9 3 0 0 0 21 12", key: "mv7ke4" }]
]);

// node_modules/lucide-react/dist/esm/icons/dollar-sign.js
var DollarSign = createLucideIcon("DollarSign", [
  ["line", { x1: "12", x2: "12", y1: "2", y2: "22", key: "7eqyqh" }],
  ["path", { d: "M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6", key: "1b0p4s" }]
]);

// node_modules/lucide-react/dist/esm/icons/gauge.js
var Gauge = createLucideIcon("Gauge", [
  ["path", { d: "m12 14 4-4", key: "9kzdfg" }],
  ["path", { d: "M3.34 19a10 10 0 1 1 17.32 0", key: "19p75a" }]
]);

// node_modules/lucide-react/dist/esm/icons/search.js
var Search = createLucideIcon("Search", [
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ["path", { d: "m21 21-4.3-4.3", key: "1qie3q" }]
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

// plugins/stats/web-src/components/PieChart.tsx
var import_react3 = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var COLORS = [
  "var(--color-accent)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-danger)",
  "var(--color-text-muted)"
];
function calculatePieSegments(data) {
  const valid = data.filter((item) => Number.isFinite(item.value) && item.value > 0);
  const total = valid.reduce((sum, item) => sum + item.value, 0);
  let consumed = 0;
  return valid.sort((a, b) => b.value - a.value).map((item) => {
    const percentage = item.value / total * 100;
    const segment = {
      ...item,
      percentage,
      dashArray: `${percentage} ${100 - percentage}`,
      dashOffset: -consumed
    };
    consumed += percentage;
    return segment;
  });
}
function PieChart({ title, data, emptyText, renderIcon }) {
  const segments = calculatePieSegments(data);
  const [activeId, setActiveId] = (0, import_react3.useState)(null);
  if (segments.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "py-10 text-center text-sm text-text-muted", children: emptyText });
  const active = segments.find((segment) => segment.id === activeId) ?? null;
  const hover = (id) => () => setActiveId(id);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("figure", { className: "grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center", "aria-label": title, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "relative mx-auto h-36 w-36", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { viewBox: "0 0 42 42", role: "img", "aria-label": title, className: "h-full w-full -rotate-90", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "21", cy: "21", r: "15.9155", fill: "none", stroke: "var(--color-border)", strokeWidth: "6" }),
        segments.map((segment, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "circle",
          {
            cx: "21",
            cy: "21",
            r: "15.9155",
            fill: "none",
            stroke: COLORS[index % COLORS.length],
            strokeWidth: active?.id === segment.id ? 7.5 : 6,
            strokeDasharray: segment.dashArray,
            strokeDashoffset: segment.dashOffset,
            opacity: active && active.id !== segment.id ? 0.3 : 1,
            className: "cursor-pointer transition-all duration-150",
            onMouseEnter: hover(segment.id),
            onMouseLeave: hover(null),
            "aria-hidden": true
          },
          segment.id
        ))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-7 text-center", children: active ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        renderIcon?.(active),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "font-mono text-sm tabular-nums text-text", children: [
          active.percentage.toFixed(1),
          "%"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "w-full truncate text-[0.65rem] text-text-muted", children: active.valueLabel })
      ] }) : null })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("figcaption", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "flex min-w-0 flex-col gap-2", children: segments.map((segment, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "li",
      {
        className: "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-1 py-0.5 text-xs transition-colors",
        style: active?.id === segment.id ? { backgroundColor: "var(--color-elevated)" } : void 0,
        onMouseEnter: hover(segment.id),
        onMouseLeave: hover(null),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "flex items-center gap-1.5", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "h-2.5 w-2.5 rounded-sm", style: { backgroundColor: COLORS[index % COLORS.length] }, "aria-hidden": true }),
            renderIcon?.(segment)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "truncate text-text", title: segment.label, children: segment.label }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "whitespace-nowrap font-mono tabular-nums text-text-muted", children: [
            segment.percentage.toFixed(1),
            "% \xB7 ",
            segment.valueLabel
          ] })
        ]
      },
      segment.id
    )) }) })
  ] });
}

// plugins/stats/web-src/components/UsageTrend.tsx
var import_react4 = __toESM(require_react(), 1);
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
var formatTokens = (value, locale) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
var formatCost = (value, locale) => value == null ? "\u2014" : new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
function UsageTrend({ data, locale, tokenLabel, costLabel, emptyText }) {
  const [activeDay, setActiveDay] = (0, import_react4.useState)(null);
  if (data.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "py-10 text-center text-sm text-text-muted", children: emptyText });
  const maxTokens = Math.max(1, ...data.map((row) => row.tokens));
  const maxCost = Math.max(1e-6, ...data.map((row) => row.cost ?? 0));
  const active = data.find((row) => row.day === activeDay) ?? null;
  const hover = (day) => () => setActiveDay(day);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("figure", { className: "flex min-w-0 flex-col gap-3", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("figcaption", { className: "flex min-w-0 items-center gap-4 text-xs text-text-muted", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "inline-flex items-center gap-1.5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "h-2 w-2 rounded-sm bg-accent", "aria-hidden": true }),
        tokenLabel
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "inline-flex items-center gap-1.5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "h-2 w-2 rounded-sm bg-warning", "aria-hidden": true }),
        costLabel
      ] }),
      active ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "ml-auto flex min-w-0 items-center gap-3 font-mono tabular-nums", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate text-text", children: active.day }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "whitespace-nowrap text-accent", children: formatTokens(active.tokens, locale) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "whitespace-nowrap text-warning", children: formatCost(active.cost, locale) })
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "flex h-36 min-w-0 items-end gap-1 overflow-hidden border-b border-border px-1", "aria-hidden": true, children: data.map((row) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "div",
      {
        className: "flex h-full min-w-[3px] flex-1 cursor-pointer items-end justify-center gap-px transition-opacity duration-150",
        style: { opacity: active && active.day !== row.day ? 0.3 : 1 },
        onMouseEnter: hover(row.day),
        onMouseLeave: hover(null),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "w-1/2 min-w-px rounded-t-sm bg-accent", style: { height: `${Math.max(2, row.tokens / maxTokens * 100)}%` } }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "w-1/2 min-w-px rounded-t-sm bg-warning", style: { height: `${row.cost == null ? 0 : Math.max(2, row.cost / maxCost * 100)}%` } })
        ]
      },
      row.day
    )) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex justify-between font-mono text-[10px] text-text-muted", "aria-hidden": true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: data[0]?.day }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: data[data.length - 1]?.day })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "sr-only", children: data.map((row) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { children: [
      row.day,
      ": ",
      tokenLabel,
      " ",
      formatTokens(row.tokens, locale),
      ", ",
      costLabel,
      " ",
      formatCost(row.cost, locale)
    ] }, row.day)) })
  ] });
}

// plugins/stats/web-src/ResetUsageModal.tsx
var import_react5 = __toESM(require_react(), 1);
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
var { Button, Input, Modal, ModalBody, ModalFooter } = runtime().components;
var { usePluginStrings, useResetUsage, useToast, useTranslation } = runtime().hooks;
function ResetUsageModal({ onClose }) {
  const s = usePluginStrings("stats");
  const { t } = useTranslation();
  const { toast } = useToast();
  const reset = useResetUsage();
  const confirmInputId = (0, import_react5.useId)();
  const [typed, setTyped] = (0, import_react5.useState)("");
  const armed = typed.trim().toLocaleUpperCase() === s.resetConfirmWord.toLocaleUpperCase();
  const onConfirm = () => {
    reset.mutate(void 0, {
      onSuccess: () => {
        toast(s.resetDone);
        onClose();
      },
      onError: () => toast(s.resetFailed, "error")
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(Modal, { title: s.resetTitle, onClose, size: "sm", icon: TriangleAlert, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(ModalBody, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "text-sm leading-relaxed text-text-muted", children: s.resetBody }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-col gap-1.5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { htmlFor: confirmInputId, className: "text-xs text-text-muted", children: s.resetConfirmHint.replace("{word}", s.resetConfirmWord) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Input, { id: confirmInputId, value: typed, onChange: (event) => setTyped(event.target.value), autoFocus: true, spellCheck: false, className: "font-mono" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(ModalFooter, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Button, { variant: "ghost", onClick: onClose, children: t.common.cancel }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Button, { variant: "ghost-danger", onClick: onConfirm, disabled: !armed || reset.isPending, children: s.resetConfirm })
    ] })
  ] });
}

// plugins/stats/web-src/StatsView.tsx
var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
var PAGE_SIZE = 20;
var DAY_MS = 864e5;
var {
  Button: Button2,
  ControlSurfaceDocument,
  ControlSurfaceRegister,
  ControlSurfaceState,
  ControlSurfaceToolbar,
  DataTable,
  DataTableCell,
  DataTableRow,
  DateRangeFilter,
  EmptyState,
  ErrorState,
  Input: Input2,
  LoadingState,
  ModelIcon,
  ModuleHeader,
  Segmented,
  SpatialWorkspaceLayout,
  WorkspaceDetailRail,
  WorkspaceMetric
} = runtime().components;
var { useMe, useModelUsage, usePersistentState, usePluginStrings: usePluginStrings2, useTranslation: useTranslation2, useUsageByDay } = runtime().hooks;
var { buildUsageSummary, DEFAULT_RANGE, isStoredRange, parseRange, rangeBounds, serializeRange } = runtime().utils;
var renderModelIcon = (datum) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ModelIcon, { name: datum.id, size: 20 });
var utcDayStart = (timestamp) => {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};
var dayKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
var localDayOrdinal = (timestamp) => {
  const date = new Date(timestamp);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
};
function trendDaysForWindow(window2, now) {
  if (!Number.isFinite(window2.fromMs)) return 90;
  const elapsedDays = Math.floor((localDayOrdinal(now) - localDayOrdinal(window2.fromMs)) / DAY_MS);
  return Math.max(1, Math.min(90, elapsedDays + 1));
}
function isTrendWindowUnavailable(window2, days, now) {
  if (!Number.isFinite(window2.toMs)) return false;
  const availableFrom = utcDayStart(now) - (days - 1) * DAY_MS;
  return utcDayStart(window2.toMs) < availableFrom;
}
function padDailyUsage(rows, days, window2, now) {
  const today = utcDayStart(now);
  const availableFrom = today - (days - 1) * DAY_MS;
  const from = Number.isFinite(window2.fromMs) ? Math.max(availableFrom, utcDayStart(window2.fromMs)) : availableFrom;
  const to = Number.isFinite(window2.toMs) ? Math.min(today, utcDayStart(window2.toMs)) : today;
  if (to < from) return [];
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const padded = [];
  for (let timestamp = from; timestamp <= to; timestamp += DAY_MS) {
    const day = dayKey(timestamp);
    padded.push(byDay.get(day) ?? { day, tokens: 0, cost: 0 });
  }
  return padded;
}
var integer = (value, locale) => new Intl.NumberFormat(locale).format(value);
var percent = (value) => value == null ? "\u2014" : `${value.toFixed(1)}%`;
var cacheTokens = (usage) => usage.cacheRead + usage.cacheWrite;
function ModelDetail({ model, locale, strings }) {
  const usage = model.usage;
  const cacheBase = usage.input + usage.cacheRead;
  const cacheRate = cacheBase > 0 ? usage.cacheRead / cacheBase * 100 : null;
  const costSource = usage.costSource === "provider_reported" ? strings.detailCostProviderReported : usage.costSource === "calculated" ? strings.detailCostCalculated : strings.detailCostUnavailable;
  const rows = [
    [strings.detailInput, integer(usage.input, locale)],
    [strings.detailOutput, integer(usage.output, locale)],
    [strings.detailCacheRead, integer(usage.cacheRead, locale)],
    [strings.detailCacheWrite, integer(usage.cacheWrite, locale)],
    [strings.detailCacheRate, percent(cacheRate)],
    [strings.detailCostSource, costSource]
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex min-w-0 flex-col gap-5", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex min-w-0 items-center gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ModelIcon, { name: model.exec, size: 24 }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { className: "truncate font-mono text-sm text-text", title: model.exec, children: model.exec })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dl", { className: "flex flex-col divide-y divide-border/70", children: rows.map(([label, value]) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex items-center justify-between gap-4 py-3 text-sm", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { className: "text-text-muted", children: label }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { className: "truncate font-mono tabular-nums text-text", title: value, children: value })
    ] }, label)) })
  ] });
}
function StatsView() {
  const s = usePluginStrings2("stats");
  const { t, locale } = useTranslation2();
  const [rangeRaw, setRangeRaw] = usePersistentState("elowen.stats.range", serializeRange(DEFAULT_RANGE), isStoredRange);
  const range = (0, import_react6.useMemo)(() => parseRange(rangeRaw) ?? DEFAULT_RANGE, [rangeRaw]);
  const now = (0, import_react6.useMemo)(() => Date.now(), [rangeRaw]);
  const window2 = (0, import_react6.useMemo)(() => rangeBounds(range, now), [range, now]);
  const trendDays = (0, import_react6.useMemo)(() => trendDaysForWindow(window2, now), [window2, now]);
  const usage = useModelUsage(void 0, window2);
  const daily = useUsageByDay(void 0, trendDays);
  const me = useMe();
  const summary = buildUsageSummary(usage.data);
  const [query, setQuery] = (0, import_react6.useState)("");
  const [filter, setFilter] = (0, import_react6.useState)("all");
  const [page, setPage] = (0, import_react6.useState)(0);
  const [selectedExec, setSelectedExec] = (0, import_react6.useState)(null);
  const [resetOpen, setResetOpen] = (0, import_react6.useState)(false);
  const hasError = usage.isError || daily.isError;
  const isLoading = usage.isLoading || daily.isLoading || !usage.data || !daily.data;
  const modelByExec = (0, import_react6.useMemo)(() => new Map((usage.data ?? []).map((model) => [model.exec, model])), [usage.data]);
  const filtered = (0, import_react6.useMemo)(() => {
    const needle = query.trim().toLocaleLowerCase();
    return summary.rows.filter((row) => {
      const model = modelByExec.get(row.exec);
      if (needle && !row.exec.toLocaleLowerCase().includes(needle)) return false;
      if (filter === "costed" && row.costUsd == null) return false;
      if (filter === "cached" && (!model || cacheTokens(model.usage) === 0)) return false;
      return true;
    });
  }, [filter, modelByExec, query, summary.rows]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);
  const selected = selectedExec ? modelByExec.get(selectedExec) ?? null : null;
  const trendUnavailable = isTrendWindowUnavailable(window2, trendDays, now);
  const trend = (0, import_react6.useMemo)(() => padDailyUsage(daily.data ?? [], trendDays, window2, now), [daily.data, now, trendDays, window2]);
  const rowByExec = (0, import_react6.useMemo)(() => new Map(summary.rows.map((row) => [row.exec, row])), [summary.rows]);
  const pieTokens = (usage.data ?? []).map((model) => ({
    id: model.exec,
    label: model.exec,
    value: model.usage.total,
    valueLabel: rowByExec.get(model.exec)?.tokensLabel ?? integer(model.usage.total, locale)
  }));
  const pieCosts = (usage.data ?? []).filter((model) => model.usage.costUsd != null).map((model) => ({
    id: model.exec,
    label: model.exec,
    value: model.usage.costUsd ?? 0,
    valueLabel: rowByExec.get(model.exec)?.costLabel ?? "\u2014"
  }));
  const resetPage = () => setPage(0);
  const changeRange = (next) => {
    setRangeRaw(serializeRange(next));
    resetPage();
  };
  const retry = () => {
    usage.refetch();
    daily.refetch();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ModuleHeader, { title: s.title, count: summary.modelsUsed, icon: ChartColumn }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(SpatialWorkspaceLayout, { hero: {
      eyebrow: s.workspaceEyebrow,
      title: s.title,
      count: summary.modelsUsed,
      description: s.workspaceIntro,
      mascotState: hasError ? "error" : isLoading ? "saving" : "idle",
      status: !hasError && !isLoading ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "workspace-status", children: s.workspaceReady }) : void 0,
      action: me.data?.user?.is_admin && summary.hasAnyUsage ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Button2, { variant: "ghost-danger", icon: Trash2, onClick: () => setResetOpen(true), children: s.reset }) : void 0,
      metrics: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(WorkspaceMetric, { label: s.metricTokens, value: summary.totalTokensLabel, icon: ChartColumn }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(WorkspaceMetric, { label: s.metricCost, value: summary.totalCostLabel, icon: DollarSign }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(WorkspaceMetric, { label: s.metricCache, value: summary.totalCacheLabel, icon: Database }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(WorkspaceMetric, { label: s.metricSpeed, value: summary.avgSpeedLabel, icon: Gauge })
      ] })
    }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ControlSurfaceDocument, { children: hasError ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ControlSurfaceState, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ErrorState, { message: t.common.daemonUnreachable, onRetry: retry }) }) : isLoading ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(LoadingState, { variant: "cards" }) }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "workspace-master-detail", "data-detail": selected != null, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex min-w-0 flex-col gap-4", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ControlSurfaceToolbar, { className: "flex-col items-stretch", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex min-w-0 flex-wrap items-center gap-2 py-3", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "relative min-w-[15rem] flex-1", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Search, { size: 14, "aria-hidden": true, className: "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Input2, { "aria-label": s.searchPlaceholder, value: query, onChange: (event) => {
              setQuery(event.target.value);
              resetPage();
            }, placeholder: s.searchPlaceholder, className: "pl-9" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            Segmented,
            {
              nowrap: true,
              "aria-label": s.filterLabel,
              value: filter,
              onChange: (value) => {
                setFilter(value);
                resetPage();
              },
              options: [
                { value: "all", label: s.filterAll },
                { value: "costed", label: s.filterCosted },
                { value: "cached", label: s.filterCached }
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DateRangeFilter, { value: range, onChange: changeRange, compact: true })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ControlSurfaceRegister, { className: "flex flex-col gap-5", children: !summary.hasAnyUsage ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(EmptyState, { title: s.emptyTitle, description: s.emptyDescription, icon: ChartColumn }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "grid gap-4 xl:grid-cols-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "rounded-lg border border-border bg-surface p-4", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { className: "text-sm font-semibold text-text", children: s.tokensByModel }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "mb-4 text-xs text-text-muted", children: s.tokensByModelHint }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PieChart, { title: s.tokensByModel, data: pieTokens, emptyText: s.noChartData, renderIcon: renderModelIcon })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "rounded-lg border border-border bg-surface p-4", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { className: "text-sm font-semibold text-text", children: s.costByModel }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "mb-4 text-xs text-text-muted", children: s.costByModelHint }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PieChart, { title: s.costByModel, data: pieCosts, emptyText: s.noChartData, renderIcon: renderModelIcon })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "rounded-lg border border-border bg-surface p-4", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { className: "text-sm font-semibold text-text", children: s.trendTitle }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "mb-4 text-xs text-text-muted", children: s.trendHint }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(UsageTrend, { data: trend, locale, tokenLabel: s.trendTokens, costLabel: s.trendCost, emptyText: trendUnavailable ? s.trendUnavailable : s.noChartData })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex min-w-0 flex-col gap-3", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { className: "text-sm font-semibold text-text", children: s.tableTitle }),
            filtered.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(EmptyState, { title: s.emptySearch, icon: Search }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(DataTable, { ariaLabel: s.tableTitle, columns: "2rem minmax(0,1fr) 8rem 8rem 7rem 7rem 1.25rem", compactColumns: "2rem minmax(0,1fr) 7rem 1.25rem", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(DataTableRow, { header: true, children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DataTableCell, { header: true, role: "presentation", "aria-hidden": true, children: null }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DataTableCell, { header: true, children: s.columnModel }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DataTableCell, { header: true, priority: "wide", className: "text-right", children: s.columnTokens }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DataTableCell, { header: true, className: "text-right", children: s.columnCost }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DataTableCell, { header: true, priority: "wide", className: "text-right", children: s.columnCache }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DataTableCell, { header: true, priority: "wide", className: "text-right", children: s.columnSpeed }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DataTableCell, { header: true, role: "presentation", "aria-hidden": true, children: null })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { role: "rowgroup", children: pageRows.map((row) => {
                return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
                  DataTableRow,
                  {
                    "data-testid": "model-usage-row",
                    interactive: true,
                    tabIndex: 0,
                    className: "group cursor-pointer",
                    onClick: () => setSelectedExec(row.exec),
                    onKeyDown: (event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setSelectedExec(row.exec);
                    },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DataTableCell, { className: "flex items-center gap-1.5 text-text-muted", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ModelIcon, { name: row.exec, size: 12 }) }),
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DataTableCell, { className: "truncate font-mono text-xs text-text", title: row.exec, children: row.exec }),
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DataTableCell, { priority: "wide", className: "truncate text-right font-mono text-xs tabular-nums text-text-muted", title: row.tokensLabel, children: row.tokensLabel }),
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DataTableCell, { className: "truncate text-right font-mono text-xs tabular-nums text-text", title: row.costLabel, children: row.costLabel }),
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DataTableCell, { priority: "wide", className: "truncate text-right font-mono text-xs tabular-nums text-text-muted", title: percent(row.cacheHitPct), children: percent(row.cacheHitPct) }),
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DataTableCell, { priority: "wide", className: "truncate text-right font-mono text-xs tabular-nums text-text-muted", title: row.speedLabel, children: row.speedLabel }),
                      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DataTableCell, { className: "flex items-center justify-end gap-1.5 text-text-muted", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ChevronRight, { size: 12, className: "group-hover:text-text", "aria-hidden": true }) })
                    ]
                  },
                  row.exec
                );
              }) })
            ] }),
            filtered.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex flex-col gap-2 border-b border-border/80 pb-3 sm:flex-row sm:items-center sm:justify-between", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "font-mono text-xs text-text-muted", children: s.pageRange.replace("{from}", String(clampedPage * PAGE_SIZE + 1)).replace("{to}", String(clampedPage * PAGE_SIZE + pageRows.length)).replace("{total}", String(filtered.length)) }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex items-center gap-1", children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Button2, { variant: "ghost", icon: ChevronLeft, disabled: clampedPage === 0, onClick: () => setPage(clampedPage - 1), children: s.previousPage }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "min-w-24 text-center font-mono text-xs text-text-muted", children: s.pageLabel.replace("{page}", String(clampedPage + 1)).replace("{pages}", String(pageCount)) }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Button2, { variant: "ghost", disabled: clampedPage >= pageCount - 1, onClick: () => setPage(clampedPage + 1), children: [
                  s.nextPage,
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ChevronRight, { size: 15, className: "ml-1", "aria-hidden": true })
                ] })
              ] })
            ] }) : null
          ] })
        ] }) })
      ] }),
      selected ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(WorkspaceDetailRail, { label: `${s.detailTitle}: ${selected.exec}`, closeLabel: t.common.close, onClose: () => setSelectedExec(null), children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ModelDetail, { model: selected, locale, strings: s }) }) : null
    ] }) }) }),
    resetOpen ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ResetUsageModal, { onClose: () => setResetOpen(false) }) : null
  ] });
}

// plugins/stats/web-src/index.tsx
registerStatsUi({ "": StatsView });
