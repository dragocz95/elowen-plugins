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

// ../../../../elowen-plugins/node_modules/elowen-plugin-ui-kit/shims/react.cjs
var require_react = __commonJS({
  "../../../../elowen-plugins/node_modules/elowen-plugin-ui-kit/shims/react.cjs"(exports, module) {
    var runtime2 = typeof window !== "undefined" ? window.ElowenUiRuntime : void 0;
    if (!runtime2) throw new Error("elowen-plugin-ui-kit: window.ElowenUiRuntime is missing \u2014 plugin bundles only run inside the Elowen web app");
    module.exports = runtime2.react;
  }
});

// ../../../../elowen-plugins/node_modules/elowen-plugin-ui-kit/shims/jsx-runtime.cjs
var require_jsx_runtime = __commonJS({
  "../../../../elowen-plugins/node_modules/elowen-plugin-ui-kit/shims/jsx-runtime.cjs"(exports, module) {
    var runtime2 = typeof window !== "undefined" ? window.ElowenUiRuntime : void 0;
    if (!runtime2) throw new Error("elowen-plugin-ui-kit: window.ElowenUiRuntime is missing \u2014 plugin bundles only run inside the Elowen web app");
    module.exports = runtime2.jsxRuntime;
  }
});

// plugins/cronjob/web-src/runtime.ts
function runtime() {
  const rt = window.ElowenUiRuntime;
  if (!rt) throw new Error("ElowenUiRuntime is not installed");
  return rt;
}
function registerCronUi(registration) {
  window.__elowenRegisterPluginUi?.("cronjob", registration);
}

// plugins/cronjob/web-src/JobsSettings.tsx
var import_react3 = __toESM(require_react(), 1);

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/createLucideIcon.js
var import_react2 = __toESM(require_react());

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/shared/src/utils.js
var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
var mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/Icon.js
var import_react = __toESM(require_react());

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/defaultAttributes.js
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

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/Icon.js
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

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/createLucideIcon.js
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

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/activity.js
var Activity = createLucideIcon("Activity", [
  [
    "path",
    {
      d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
      key: "169zse"
    }
  ]
]);

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/calendar-clock.js
var CalendarClock = createLucideIcon("CalendarClock", [
  ["path", { d: "M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5", key: "1osxxc" }],
  ["path", { d: "M16 2v4", key: "4m81vk" }],
  ["path", { d: "M8 2v4", key: "1cmpym" }],
  ["path", { d: "M3 10h5", key: "r794hk" }],
  ["path", { d: "M17.5 17.5 16 16.3V14", key: "akvzfd" }],
  ["circle", { cx: "16", cy: "16", r: "6", key: "qoo3c4" }]
]);

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/check.js
var Check = createLucideIcon("Check", [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]]);

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/circle-pause.js
var CirclePause = createLucideIcon("CirclePause", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["line", { x1: "10", x2: "10", y1: "15", y2: "9", key: "c1nkhi" }],
  ["line", { x1: "14", x2: "14", y1: "15", y2: "9", key: "h65svq" }]
]);

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/clock.js
var Clock = createLucideIcon("Clock", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["polyline", { points: "12 6 12 12 16 14", key: "68esgv" }]
]);

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/hash.js
var Hash = createLucideIcon("Hash", [
  ["line", { x1: "4", x2: "20", y1: "9", y2: "9", key: "4lhtct" }],
  ["line", { x1: "4", x2: "20", y1: "15", y2: "15", key: "vyu0kd" }],
  ["line", { x1: "10", x2: "8", y1: "3", y2: "21", key: "1ggp8o" }],
  ["line", { x1: "16", x2: "14", y1: "3", y2: "21", key: "weycgp" }]
]);

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/message-square.js
var MessageSquare = createLucideIcon("MessageSquare", [
  ["path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", key: "1lielz" }]
]);

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/play.js
var Play = createLucideIcon("Play", [
  ["polygon", { points: "6 3 20 12 6 21 6 3", key: "1oa8hb" }]
]);

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/plus.js
var Plus = createLucideIcon("Plus", [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "M12 5v14", key: "s699le" }]
]);

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/search.js
var Search = createLucideIcon("Search", [
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ["path", { d: "m21 21-4.3-4.3", key: "1qie3q" }]
]);

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/timer.js
var Timer = createLucideIcon("Timer", [
  ["line", { x1: "10", x2: "14", y1: "2", y2: "2", key: "14vaq8" }],
  ["line", { x1: "12", x2: "15", y1: "14", y2: "11", key: "17fdiu" }],
  ["circle", { cx: "12", cy: "14", r: "8", key: "1e1u0o" }]
]);

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/trash-2.js
var Trash2 = createLucideIcon("Trash2", [
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", key: "4alrt4" }],
  ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", key: "v07s0e" }],
  ["line", { x1: "10", x2: "10", y1: "11", y2: "17", key: "1uufr5" }],
  ["line", { x1: "14", x2: "14", y1: "11", y2: "17", key: "xtxkd" }]
]);

// ../../../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/x.js
var X = createLucideIcon("X", [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
]);

// plugins/cronjob/web-src/scheduleBuilder.ts
var WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
var timeValue = (hour, minute) => `${String(Number(hour)).padStart(2, "0")}:${minute}`;
function parseBuilderSchedule(value) {
  const text = String(value ?? "").trim();
  let match = /^every\s+(\d+)\s*(m|h)$/i.exec(text);
  if (match) {
    const amount = Number(match[1]);
    if (Number.isSafeInteger(amount) && amount >= 1) {
      return { mode: "every", amount, unit: match[2].toLowerCase() };
    }
    return null;
  }
  match = /^daily\s+([01]?\d|2[0-3]):([0-5]\d)$/i.exec(text);
  if (match) return { mode: "daily", time: timeValue(match[1], match[2]) };
  match = /^weekly\s+(sun|mon|tue|wed|thu|fri|sat)\s+([01]?\d|2[0-3]):([0-5]\d)$/i.exec(text);
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

// plugins/cronjob/web-src/JobsSettings.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var PAGE_SIZE = 20;
var textareaClass = "w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-ring";
function DestinationField({ value, onChange, destinations }) {
  const { components: C, hooks } = runtime();
  const { t } = hooks.useTranslation();
  const s = hooks.usePluginStrings("cronjob");
  const [open, setOpen] = (0, import_react3.useState)(false);
  const selected = destinations.find((destination) => destination.value === value);
  const icon = (kind) => kind === "channel" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Hash, { size: 12, "aria-hidden": true }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MessageSquare, { size: 12, "aria-hidden": true });
  const items = [
    { id: "", label: s.pillDefault, group: "" },
    ...value && !selected ? [{ id: value, label: value, group: "", icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Hash, { size: 12, "aria-hidden": true }) }] : [],
    ...destinations.map((destination) => ({
      id: destination.value,
      label: destination.label,
      group: `${destination.platform}:${destination.group ?? destination.platform}`,
      groupLabel: destination.group ?? destination.platform,
      icon: icon(destination.kind),
      badges: destination.subtitle ? [{ text: destination.subtitle }] : void 0
    }))
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      C.SelectionSummary,
      {
        countText: value ? "" : "\u2014",
        samples: value ? [{ label: selected?.label ?? value, icon: icon(selected?.kind ?? "channel") }] : [],
        moreCount: 0,
        onManage: () => setOpen(true),
        manageLabel: t.managePicker.manage
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
function ScheduleField({ schedule, valid, onChange }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const parsed = parseBuilderSchedule(schedule);
  const [mode, setMode] = (0, import_react3.useState)(parsed?.mode ?? "advanced");
  const emitted = (0, import_react3.useRef)(null);
  (0, import_react3.useEffect)(() => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-3", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
    builder?.mode === "every" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.scheduleInterval, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.scheduleUnit, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
    builder?.mode === "daily" || builder?.mode === "weekly" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
      builder.mode === "weekly" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.scheduleWeekday, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        C.ChoiceField,
        {
          title: s.scheduleWeekday,
          options: weekdayLabels,
          value: builder.day,
          onChange: (day) => updateBuilder({ ...builder, day }),
          manageAriaLabel: s.scheduleWeekday
        }
      ) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.scheduleTime, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
    builder ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "flex flex-wrap items-center gap-2 text-xs text-muted-foreground", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: s.scheduleGenerated }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { className: "rounded border border-border bg-background px-2 py-1 text-foreground", children: renderBuilderSchedule(builder) })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-1", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "relative", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          C.Input,
          {
            value: schedule,
            onChange: (event) => emit(event.target.value),
            className: "pr-8 font-mono",
            placeholder: "0 9 * * 1-5",
            "aria-label": s.scheduleAdvancedValue
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "absolute right-2.5 top-1/2 -translate-y-1/2", title: valid ? s.scheduleValid : s.scheduleInvalid, children: valid ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, { size: 14, className: "text-success", "aria-label": s.scheduleValid }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { size: 14, className: "text-destructive", "aria-label": s.scheduleInvalid }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs text-muted-foreground", children: s.scheduleAdvancedHint })
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-3", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
    parsed ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "grid grid-cols-2 gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.hoursStart, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.hoursEnd, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
    ] }) : legacy ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "text-xs text-muted-foreground", children: [
      s.hoursLegacyHint,
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { className: "text-foreground", children: value })
    ] }) : null
  ] });
}
function CronJobRow({ job, persisted, ownerLabel, adminFields, myId, destinations, models, selected, onSelect, onClose, onRemoved, onRefresh }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { t } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const save = hooks.useSaveCronJob();
  const del = hooks.useDeleteCronJob();
  const [draft, setDraft] = (0, import_react3.useState)(job);
  const [confirming, setConfirming] = (0, import_react3.useState)(false);
  const [runPending, setRunPending] = (0, import_react3.useState)(false);
  const [editVersion, setEditVersion] = (0, import_react3.useState)(0);
  const draftRef = (0, import_react3.useRef)(draft);
  draftRef.current = draft;
  const dirty = (0, import_react3.useRef)(false);
  const deleted = (0, import_react3.useRef)(false);
  const inFlight = (0, import_react3.useRef)(null);
  const everSaved = (0, import_react3.useRef)(persisted);
  const isSavable = (j) => j.name.trim() !== "" && j.prompt.trim() !== "" && (j.runAt ? true : utils.isValidSchedule(j.schedule));
  const autosave = hooks.useAutoSaveStatus([editVersion], async () => {
    if (deleted.current) return;
    const sent = draftRef.current;
    const { owner: _owner, expectedRevision: _expectedRevision, ...payload } = sent;
    everSaved.current = true;
    const request = save.mutateAsync({ ...payload, expectedRevision: sent.revision ?? 0 });
    inFlight.current = request;
    try {
      await request;
      if (draftRef.current === sent) dirty.current = false;
    } catch (error) {
      toast(s.saveError, "error");
      throw error;
    } finally {
      if (inFlight.current === request) inFlight.current = null;
    }
  }, { savable: isSavable(draft), delay: 900 });
  const serverCopy = JSON.stringify(job);
  (0, import_react3.useEffect)(() => {
    if (dirty.current || deleted.current) return;
    setDraft(job);
  }, [serverCopy]);
  const patch = (p) => {
    dirty.current = true;
    setDraft((cur) => ({ ...cur, ...p }));
    setEditVersion((version) => version + 1);
  };
  const runNow = async () => {
    if (!persisted || draft.runAt || dirty.current || autosave.status === "saving") return;
    setRunPending(true);
    try {
      await runtime().api(`/plugins/cronjob/jobs/${encodeURIComponent(job.id)}/run`, { method: "POST" });
      toast(s.runQueued, "ok");
      window.setTimeout(onRefresh, 600);
    } catch (error) {
      toast(`${s.runError} \u2014 ${utils.apiErrorMessage(error)}`, "error");
    } finally {
      setRunPending(false);
    }
  };
  const remove = async () => {
    deleted.current = true;
    setConfirming(false);
    onRemoved(job.id);
    await inFlight.current?.catch(() => {
    });
    if (!everSaved.current) return;
    try {
      await del.mutateAsync(job.id);
    } catch {
      deleted.current = false;
      toast(s.deleteError, "error");
    }
  };
  const enabled = draft.enabled !== false;
  const validSchedule = draft.runAt ? true : utils.isValidSchedule(draft.schedule);
  const lastRunMs = utils.parseTs(job.lastRun);
  const destination = draft.notifyChannelId ? destinations.find((option) => option.value === draft.notifyChannelId) : void 0;
  const dest = draft.notifyChannelId ? destination?.label ?? draft.notifyChannelId : job.ownerUserId != null ? s.channelOwnerChat : null;
  const name = draft.name || s.jobNew;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      C.DataTableRow,
      {
        selected,
        "aria-selected": selected,
        onOpen: onSelect,
        openLabel: s.openJob.replace("{name}", name),
        className: "group",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { lines: "auto", priority: "wide", "aria-hidden": true, className: "flex items-center justify-center", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "span",
            {
              className: `inline-block h-2 w-2 shrink-0 rounded-full ${enabled ? "bg-success" : "bg-destructive"}`,
              title: enabled ? s.enabled : s.paused
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.DataTableCell, { lines: "auto", title: name, className: "flex items-center gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "truncate text-sm text-foreground", children: name }),
            !enabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: "muted", children: s.paused }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "sr-only", children: enabled ? s.enabled : s.paused })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { lines: "auto", priority: "wide", className: "whitespace-nowrap", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.Badge, { tone: validSchedule ? "default" : "danger", children: [
            draft.runAt ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CalendarClock, { size: 10, className: "mr-1 inline-block align-[-1px]", "aria-hidden": true }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Clock, { size: 10, className: "mr-1 inline-block align-[-1px]", "aria-hidden": true }),
            draft.schedule
          ] }) }),
          ownerLabel !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { lines: 1, priority: "wide", className: "text-xs text-muted-foreground", children: job.owner ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "flex min-w-0 items-center gap-2", title: `${job.owner.name} (#${job.owner.id})`, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Avatar, { name: job.owner.name || job.owner.username, user: job.owner, size: 22 }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "flex min-w-0 flex-col leading-tight", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "truncate text-xs font-medium text-foreground", children: job.owner.name || job.owner.username }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "text-[10px] text-muted-foreground", children: [
                "#",
                job.owner.id
              ] })
            ] })
          ] }) : ownerLabel }) : null,
          adminFields ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { lines: 1, priority: "wide", title: dest ?? s.channelDefault, className: "text-xs text-muted-foreground", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "flex min-w-0 items-center gap-1.5", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "shrink-0", children: destination && destination.kind !== "channel" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MessageSquare, { size: 12, "aria-hidden": true }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Hash, { size: 12, "aria-hidden": true }) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `truncate ${dest ? "" : "italic text-muted-foreground"}`, children: dest ?? s.channelDefault })
          ] }) }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { lines: 1, priority: "wide", title: lastRunMs != null ? new Date(lastRunMs).toLocaleString() : void 0, className: "whitespace-nowrap text-xs text-muted-foreground", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "flex items-center gap-1.5", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Timer, { size: 12, "aria-hidden": true }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: lastRunMs == null ? "text-muted-foreground" : void 0, children: lastRunMs != null ? utils.compactElapsed(Date.now() - lastRunMs) : "\u2014" })
          ] }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { lines: "auto", className: "flex items-center justify-end", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.AutoSaveStatus, { status: autosave.status, onRetry: autosave.retry }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableChevronCell, {})
        ]
      }
    ),
    selected ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceDetailRail, { label: name, closeLabel: t.common.close, onClose, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.name, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Input, { value: draft.name, onChange: (e) => patch({ name: e.target.value }), placeholder: "morning-digest" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.enabled, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "flex h-9 items-center gap-2 text-sm text-muted-foreground", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Toggle, { checked: enabled, onChange: (v) => patch({ enabled: v }), label: `${name}: ${s.enabled}` }),
          enabled ? s.enabled : s.paused
        ] }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.schedule, hint: s.helpSchedule, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScheduleField, { schedule: draft.schedule, valid: validSchedule, onChange: (schedule) => patch({ schedule }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.hours, hint: s.helpHours, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ActiveHoursField, { value: draft.hours, onChange: (hours) => patch({ hours }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.header, hint: s.helpHeader, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "flex h-9 items-center text-sm text-muted-foreground", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Toggle, { checked: draft.plain !== true, onChange: (v) => patch({ plain: v ? void 0 : true }), label: `${name}: ${s.header}` }) }) })
      ] }),
      adminFields && (job.ownerUserId == null || job.ownerUserId === myId) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.ownerColumn, hint: s.ownerFieldHint, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
      adminFields ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.check, hint: s.helpCheck, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "textarea",
        {
          value: draft.check ?? "",
          onChange: (e) => patch({ check: e.target.value || void 0 }),
          rows: 2,
          className: textareaClass,
          placeholder: 'test -n "$(ls /new-bookings 2>/dev/null)" && cat /new-bookings/*'
        }
      ) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.prompt, hint: s.helpPrompt, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { value: draft.prompt, onChange: (e) => patch({ prompt: e.target.value }), rows: 8, className: textareaClass }) }),
      adminFields ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.channel, hint: s.helpChannel, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        DestinationField,
        {
          value: draft.notifyChannelId ?? "",
          onChange: (v) => patch({ notifyChannelId: v || void 0 }),
          destinations
        }
      ) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.model, hint: s.helpModel, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
      job.lastResult ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.lastResult, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground", children: job.lastResult }) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          C.Button,
          {
            variant: "outline",
            icon: Play,
            disabled: !persisted || Boolean(draft.runAt) || dirty.current || autosave.status === "saving" || runPending,
            onClick: () => void runNow(),
            children: runPending ? s.runStarting : s.runNow
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "ghost-danger", icon: Trash2, onClick: () => setConfirming(true), children: s.removeJob })
      ] })
    ] }) }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
function JobsSettings({ surface }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { t } = hooks.useTranslation();
  const { data, isLoading, isError, refetch } = hooks.useCronJobs();
  const me = hooks.useMe();
  const myId = me.data?.user?.id ?? null;
  const isAdmin = me.data?.user?.is_admin === true;
  const destinations = hooks.useNotificationDestinations();
  const models = hooks.useBrainModels();
  const [drafts, setDrafts] = (0, import_react3.useState)([]);
  const [selectedId, setSelectedId] = (0, import_react3.useState)(null);
  const [query, setQuery] = (0, import_react3.useState)("");
  const [filter, setFilter] = (0, import_react3.useState)("all");
  const [scope, setScope] = (0, import_react3.useState)("all");
  const [page, setPage] = (0, import_react3.useState)(0);
  (0, import_react3.useEffect)(() => {
    if (!data) return;
    const ids = new Set(data.map((j) => j.id));
    setDrafts((cur) => cur.some((j) => ids.has(j.id)) ? cur.filter((j) => !ids.has(j.id)) : cur);
  }, [data]);
  const saved = (0, import_react3.useMemo)(() => new Set((data ?? []).map((j) => j.id)), [data]);
  const rows = (0, import_react3.useMemo)(() => [...data ?? [], ...drafts.filter((j) => !saved.has(j.id))], [data, drafts, saved]);
  const active = rows.filter((j) => j.enabled !== false).length;
  const lastRun = rows.reduce((newest, j) => {
    const ms = utils.parseTs(j.lastRun);
    return ms != null && (newest == null || ms > newest) ? ms : newest;
  }, null);
  const filtered = (0, import_react3.useMemo)(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((j) => {
      if (filter === "active" && j.enabled === false) return false;
      if (filter === "paused" && j.enabled !== false) return false;
      if (scope === "mine" && !(j.ownerUserId != null && j.ownerUserId === myId)) return false;
      if (scope === "instance" && j.ownerUserId != null) return false;
      if (needle === "") return true;
      return j.name.toLowerCase().includes(needle) || j.schedule.toLowerCase().includes(needle) || j.prompt.toLowerCase().includes(needle);
    });
  }, [rows, query, filter, scope, myId]);
  (0, import_react3.useEffect)(() => {
    setPage(0);
  }, [query, filter, scope]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageItems = (0, import_react3.useMemo)(() => filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE), [filtered, clampedPage]);
  const addJob = () => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setDrafts((cur) => [...cur, { id, name: "", schedule: "every 1h", prompt: "", enabled: false, createdAt: (/* @__PURE__ */ new Date()).toISOString() }]);
    setSelectedId(id);
  };
  const dropDraft = (id) => {
    setDrafts((cur) => cur.filter((j) => j.id !== id));
    setSelectedId((cur) => cur === id ? null : cur);
  };
  const addButton = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "accent", icon: Plus, onClick: addJob, children: s.addJob });
  const toolbarFilters = [
    {
      id: "status",
      label: s.enabled,
      control: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        C.Segmented,
        {
          value: filter,
          onChange: (value) => setFilter(value),
          options: [{ value: "all", label: s.filterAll }, { value: "active", label: s.filterActive }, { value: "paused", label: s.filterPaused }],
          "aria-label": s.enabled
        }
      ),
      ...filter === "all" ? { active: false } : { active: true, activeLabel: `${s.enabled}: ${filter === "active" ? s.filterActive : s.filterPaused}`, onReset: () => setFilter("all") }
    },
    ...isAdmin ? [{
      id: "owner",
      label: s.ownerColumn,
      control: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        C.Segmented,
        {
          value: scope,
          onChange: (value) => setScope(value),
          options: [{ value: "all", label: s.filterAll }, { value: "mine", label: s.filterMine }, { value: "instance", label: s.filterInstance }],
          "aria-label": s.ownerColumn
        }
      ),
      ...scope === "all" ? { active: false } : { active: true, activeLabel: `${s.ownerColumn}: ${scope === "mine" ? s.filterMine : s.filterInstance}`, onReset: () => setScope("all") }
    }] : []
  ];
  const table = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex min-w-0 flex-col gap-3", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      C.DataTable,
      {
        ariaLabel: s.title,
        columns: isAdmin ? "2rem minmax(0,1fr) 9.5rem minmax(9rem,11rem) minmax(0,12rem) 7rem 4.5rem 1.25rem" : "2rem minmax(0,1fr) 9.5rem 7rem 4.5rem 1.25rem",
        compactColumns: "minmax(0,1fr) 4.5rem 1.25rem",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.DataTableRow, { header: true, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", role: "presentation", "aria-hidden": true, children: null }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { header: true, lines: 1, children: s.name }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", children: s.schedule }),
            isAdmin ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", children: s.ownerColumn }) : null,
            isAdmin ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", children: s.channel }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", className: "whitespace-nowrap", children: s.colLastRun }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { header: true, lines: 1, labelHidden: true, children: s.colSaveState }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { header: true, lines: 1, "aria-hidden": true, children: null })
          ] }),
          pageItems.map((job) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            CronJobRow,
            {
              job,
              persisted: saved.has(job.id),
              ownerLabel: isAdmin ? job.ownerUserId == null ? s.ownerInstance : `#${job.ownerUserId}` : null,
              adminFields: isAdmin,
              myId,
              destinations: destinations.data ?? [],
              models: models.data ?? [],
              selected: selectedId === job.id,
              onSelect: () => setSelectedId(job.id),
              onClose: () => setSelectedId(null),
              onRemoved: dropDraft,
              onRefresh: refetch
            },
            job.id
          ))
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Pager, { page: clampedPage, pageSize: PAGE_SIZE, total: filtered.length, onPageChange: setPage, ariaLabel: s.title })
  ] });
  const surfaceDocument = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.ControlSurfaceDocument, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      C.ControlSurfaceToolbar,
      {
        search: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.RegisterSearch, { value: query, onChange: setQuery, placeholder: s.searchPlaceholder, label: s.searchPlaceholder }),
        filters: toolbarFilters,
        actions: surface === "deck" ? addButton : void 0
      }
    ),
    isError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceState, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ErrorState, { message: t.common.daemonUnreachable, onRetry: () => refetch() }) }) : isLoading || !data ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.LoadingState, { variant: "cards" }) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex min-w-0 flex-col gap-4", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceRegister, { className: "flex flex-col gap-4", children: rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.EmptyState, { title: s.empty, icon: Clock, action: addButton }) : filtered.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.EmptyState, { title: s.emptySearch, icon: Search }) : table }) })
  ] });
  if (surface === "deck") return surfaceDocument;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    C.WorkspaceShell,
    {
      variant: "register",
      hero: {
        eyebrow: s.workspaceEyebrow,
        title: s.title,
        count: rows.length,
        description: s.sectionHint,
        mascot: isLoading ? "saving" : isError ? "error" : "idle",
        status: !isLoading && !isError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "workspace-status", children: s.workspaceReady }) : void 0,
        action: addButton,
        metrics: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: s.metricActive, value: active, icon: Activity }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: s.metricPaused, value: rows.length - active, icon: CirclePause }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: s.colLastRun, value: lastRun != null ? utils.compactElapsed(Date.now() - lastRun) : "\u2014", icon: Timer })
        ] })
      },
      children: surfaceDocument
    }
  );
}

// plugins/cronjob/web-src/index.tsx
registerCronUi({
  requiresApiVersion: 12,
  settings: {
    "jobs": JobsSettings
  },
  ownsPageFrame: ["jobs"]
});
