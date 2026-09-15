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
var import_react7 = __toESM(require_react(), 1);

// plugins/cronjob/web-src/runtime.ts
function runtime() {
  const rt = window.ElowenUiRuntime;
  if (!rt) throw new Error("ElowenUiRuntime is not installed");
  return rt;
}
var apiErrorCode = (error) => {
  if (typeof error !== "object" || error === null) return void 0;
  const code = error.code;
  return typeof code === "string" ? code : void 0;
};
var localDateLabel = (day) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
function registerCronUi(registration) {
  window.__elowenRegisterPluginUi?.("cronjob", registration);
}

// plugins/cronjob/web-src/CreateJobDialog.tsx
var import_react4 = __toESM(require_react(), 1);

// plugins/cronjob/web-src/fields.tsx
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

// node_modules/lucide-react/dist/esm/icons/alarm-clock.js
var AlarmClock = createLucideIcon("AlarmClock", [
  ["circle", { cx: "12", cy: "13", r: "8", key: "3y4lt7" }],
  ["path", { d: "M12 9v4l2 2", key: "1c63tq" }],
  ["path", { d: "M5 3 2 6", key: "18tl5t" }],
  ["path", { d: "m22 6-3-3", key: "1opdir" }],
  ["path", { d: "M6.38 18.7 4 21", key: "17xu3x" }],
  ["path", { d: "M17.64 18.67 20 21", key: "kv2oe2" }]
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

// node_modules/lucide-react/dist/esm/icons/circle-pause.js
var CirclePause = createLucideIcon("CirclePause", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["line", { x1: "10", x2: "10", y1: "15", y2: "9", key: "c1nkhi" }],
  ["line", { x1: "14", x2: "14", y1: "15", y2: "9", key: "h65svq" }]
]);

// node_modules/lucide-react/dist/esm/icons/clock.js
var Clock = createLucideIcon("Clock", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["polyline", { points: "12 6 12 12 16 14", key: "68esgv" }]
]);

// node_modules/lucide-react/dist/esm/icons/hash.js
var Hash = createLucideIcon("Hash", [
  ["line", { x1: "4", x2: "20", y1: "9", y2: "9", key: "4lhtct" }],
  ["line", { x1: "4", x2: "20", y1: "15", y2: "15", key: "vyu0kd" }],
  ["line", { x1: "10", x2: "8", y1: "3", y2: "21", key: "1ggp8o" }],
  ["line", { x1: "16", x2: "14", y1: "3", y2: "21", key: "weycgp" }]
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

// node_modules/lucide-react/dist/esm/icons/play.js
var Play = createLucideIcon("Play", [
  ["polygon", { points: "6 3 20 12 6 21 6 3", key: "1oa8hb" }]
]);

// node_modules/lucide-react/dist/esm/icons/shield-question.js
var ShieldQuestion = createLucideIcon("ShieldQuestion", [
  [
    "path",
    {
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      key: "oel41y"
    }
  ],
  ["path", { d: "M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3", key: "mhlwft" }],
  ["path", { d: "M12 17h.01", key: "p32p05" }]
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

// plugins/cronjob/web-src/fields.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
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
function ConversationField({ value, saved, unresolved, owner, myId, required, mismatch, onChange }) {
  const { components: C, hooks } = runtime();
  const { t } = hooks.useTranslation();
  const s = hooks.usePluginStrings("cronjob");
  const [open, setOpen] = (0, import_react3.useState)(false);
  const [picked, setPicked] = (0, import_react3.useState)(null);
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
  const icon = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MessagesSquare, { size: 12, "aria-hidden": true });
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-1.5", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
    unavailable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs text-destructive", children: s.conversationUnavailableHint }) : unresolved ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs text-muted-foreground", children: s.conversationUnresolvedHint }) : mismatch ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs text-destructive", children: s.conversationOwnerHint }) : required && !chosen ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs text-muted-foreground", children: s.conversationRequired }) : !value ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: "muted", children: s.conversationUnassigned }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
  const preview = useSchedulePreview(builder ? void 0 : schedule);
  const valid = builder ? true : preview?.valid === true;
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
            "aria-label": s.scheduleAdvancedValue,
            invalid: schedule !== "" && preview?.valid === false
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "absolute right-2.5 top-1/2 -translate-y-1/2", children: preview === void 0 ? null : valid ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, { size: 14, className: "text-success", "aria-label": s.scheduleValid }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { size: 14, className: "text-destructive", "aria-label": s.scheduleInvalid }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs text-muted-foreground", children: preview?.error ? `${s.scheduleInvalid}: ${preview.error}` : s.scheduleAdvancedHint }),
      schedule !== "" && preview?.valid === true && preview.occurrences.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "text-xs text-muted-foreground", children: [
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

// plugins/cronjob/web-src/CreateJobDialog.tsx
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
function CreateJobDialog({ lifecycle, myId, isAdmin, onClose, onCreated }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { toast } = hooks.useToast();
  const models = hooks.useBrainModels();
  const requestIdRef = (0, import_react4.useRef)(crypto.randomUUID());
  const [name, setName] = (0, import_react4.useState)("");
  const [prompt, setPrompt] = (0, import_react4.useState)("");
  const [schedule, setSchedule] = (0, import_react4.useState)("every 1h");
  const [localRun, setLocalRun] = (0, import_react4.useState)({ date: "", time: "" });
  const [conversationSessionId, setConversationSessionId] = (0, import_react4.useState)("");
  const [hours, setHours] = (0, import_react4.useState)(void 0);
  const [enabled, setEnabled] = (0, import_react4.useState)(true);
  const [scope, setScope] = (0, import_react4.useState)(isAdmin ? "instance" : "mine");
  const [projectRef] = (0, import_react4.useState)(void 0);
  const [model, setModel] = (0, import_react4.useState)(void 0);
  const [notifyChannelId] = (0, import_react4.useState)(void 0);
  const [submitting, setSubmitting] = (0, import_react4.useState)(false);
  const check = void 0;
  const [plain, setPlain] = (0, import_react4.useState)(void 0);
  const oneShot = lifecycle === "oneShot";
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
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    C.Modal,
    {
      open: true,
      onClose: submitting ? void 0 : onClose,
      title: oneShot ? s.createOneShotTitle : s.createRecurringTitle,
      closeLabel: s.close,
      onOpenChange: (open) => {
        if (!open && !submitting) onClose();
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.ModalBody, { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-col gap-3", "data-testid": "cron-create-form", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.name, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Input, { value: name, onChange: (e) => setName(e.target.value), placeholder: oneShot ? "verify-deploy" : "morning-digest" }) }),
          oneShot ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.date, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Input, { type: "date", value: localRun.date, onChange: (e) => setLocalRun((cur) => ({ ...cur, date: e.target.value })), "aria-label": s.date }) }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.time, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Input, { type: "time", step: 60, value: localRun.time, onChange: (e) => setLocalRun((cur) => ({ ...cur, time: e.target.value })), "aria-label": s.time }) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-xs text-muted-foreground", children: s.hoursTimeZone })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ScheduleField, { schedule, onChange: setSchedule }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.prompt, hint: s.helpCreatePrompt, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("textarea", { value: prompt, onChange: (e) => setPrompt(e.target.value), rows: 4, className: "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-ring" }) }),
          isAdmin ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.ownerColumn, hint: s.ownerFieldHint, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
          oneShot ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "flex flex-col gap-3 rounded-md border border-border px-3 py-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { className: "cursor-pointer text-sm font-medium text-foreground", children: s.createAdvanced }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.hours, hint: s.helpHours, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ActiveHoursField, { value: hours, onChange: setHours }) }) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.model, hint: s.helpModel, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.conversation, hint: s.helpConversation, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "flex flex-col gap-3 rounded-md border border-border px-3 py-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { className: "cursor-pointer text-sm font-medium text-foreground", children: s.createAdvanced }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.hours, hint: s.helpHours, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ActiveHoursField, { value: hours, onChange: setHours }) }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.header, hint: s.helpHeader, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "flex h-9 items-center text-sm text-muted-foreground", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Toggle, { checked: plain !== true, onChange: (v) => setPlain(v ? void 0 : true), label: `${s.header}: ${name ? name : s.jobNew}` }) }) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.model, hint: s.helpModel, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.enabled, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "flex h-9 items-center gap-2 text-sm text-muted-foreground", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Toggle, { checked: enabled, onChange: setEnabled, label: `${s.createPaused}: ${enabled ? s.enabled : s.paused}` }),
            enabled ? s.enabled : s.paused
          ] }) })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(C.ModalFooter, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Button, { variant: "ghost", onClick: onClose, disabled: submitting, children: s.cancel }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            C.Button,
            {
              variant: "accent",
              disabled: !ready || submitting,
              onClick: () => void submit(),
              children: oneShot ? s.createOneShotSubmit : s.createRecurringSubmit
            }
          ),
          !oneShot && !filedReady ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-xs text-muted-foreground", children: s.conversationRequired }) : null
        ] })
      ]
    }
  );
}

// plugins/cronjob/web-src/JobDrawer.tsx
var import_react5 = __toESM(require_react(), 1);
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
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
function JobDrawer({ job, myId, adminFields, destinations, models, onClose, onRemoved, onRefresh }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { t } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const save = hooks.useSaveCronJob();
  const del = hooks.useDeleteCronJob();
  const projects = hooks.useQuery({ queryKey: ["projects"], queryFn: () => runtime().api("/projects") });
  const [draft, setDraft] = (0, import_react5.useState)(job);
  const [confirming, setConfirming] = (0, import_react5.useState)(false);
  const [runPending, setRunPending] = (0, import_react5.useState)(false);
  const [togglePending, setTogglePending] = (0, import_react5.useState)(false);
  const [editVersion, setEditVersion] = (0, import_react5.useState)(0);
  const draftRef = (0, import_react5.useRef)(draft);
  draftRef.current = draft;
  const dirty = (0, import_react5.useRef)(false);
  const inFlight = (0, import_react5.useRef)(null);
  const everSaved = (0, import_react5.useRef)(true);
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
  (0, import_react5.useEffect)(() => {
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
      onRefresh();
    } catch (error) {
      if (apiErrorCode(error) === "run_already_queued") toast(s.runQueued, "ok");
      else toast(`${s.runError} \u2014 ${utils.apiErrorMessage(error)}`, "error");
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
  const localRun = (0, import_react5.useMemo)(() => localRunOf(draft), [draft.localRunAt, draft.nextOccurrence?.occurrenceId]);
  const enabled = draft.enabled !== false;
  const mayPatch = adminFields || job.ownerUserId != null && job.ownerUserId === myId;
  const name = draft.name || s.jobNew;
  const nextOccurrence = job.nextOccurrence;
  const dispositionLine = nextOccurrence?.disposition === "deferredByHours" ? s.badgeDeferredHint : nextOccurrence?.disposition === "catchUp" ? s.badgeCatchUpHint : nextOccurrence?.disposition === "dueNow" || nextOccurrence?.disposition === "late" ? s.badgeLateHint : nextOccurrence?.guarded ? s.badgeGuardedHint : null;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.WorkspaceDetailRail, { label: name, closeLabel: t.common.close, onClose, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex min-w-0 flex-col gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.name, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { value: draft.name, disabled: !mayPatch, onChange: (e) => patch({ name: e.target.value }), placeholder: "morning-digest" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: oneShot ? s.badgeOneShot : s.badgeRecurring, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "flex h-9 items-center gap-2 text-sm text-muted-foreground", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { tone: "default", children: oneShot ? s.badgeOneShot : s.badgeRecurring }),
          job.manualQueued ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { tone: "muted", children: s.runQueued }) : null,
          mayPatch ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "sr-only", children: enabled ? s.enabled : s.paused }),
          !enabled ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "inline-flex items-center gap-1", "aria-hidden": true, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(CirclePause, { size: 12 }),
            s.paused
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { "aria-hidden": true, children: s.enabled })
        ] }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-col gap-1 rounded-md border border-border bg-document px-3 py-2 text-xs text-muted-foreground", "data-testid": "cron-next-run", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "text-sm font-medium text-foreground", children: s.nextRun }),
        enabled && nextOccurrence ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "font-mono text-xs text-foreground", children: [
            nextOccurrence.localDate,
            " ",
            nextOccurrence.localTime,
            " \xB7 ",
            nextOccurrence.timezone
          ] }),
          dispositionLine ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: dispositionLine }) : null
        ] }) : !enabled ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: s.nextRunPaused }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: s.nextRunUnknown })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.schedule, hint: s.helpSchedule, children: oneShot ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.date, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { type: "date", value: localRun.date, onChange: (e) => patchLocalRun({ date: e.target.value }), "aria-label": s.date, disabled: !mayPatch }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.time, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { type: "time", step: 60, value: localRun.time, onChange: (e) => patchLocalRun({ time: e.target.value }), "aria-label": s.time, disabled: !mayPatch }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "text-xs text-muted-foreground sm:col-span-2", children: s.hoursTimeZone })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ScheduleField, { schedule: draft.schedule, onChange: (schedule) => patch({ schedule }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.hours, hint: s.helpHours, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ActiveHoursField, { value: draft.hours, onChange: (hours) => patch({ hours }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.header, hint: s.helpHeader, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "flex h-9 items-center text-sm text-muted-foreground", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Toggle, { checked: draft.plain !== true, onChange: (v) => patch({ plain: v ? void 0 : true }), label: `${name}: ${s.header}`, disabled: !mayPatch }) }) })
      ] }),
      adminFields && (draft.ownerUserId == null || draft.ownerUserId === myId) ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.ownerColumn, hint: s.ownerFieldHint, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.Field, { label: s.executionProject, hint: s.helpExecutionProject, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
        projects.isError ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "alert", className: "text-sm text-destructive", children: s.executionUnavailable }) : null
      ] }),
      !oneShot ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.conversation, hint: s.helpConversation, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
      adminFields || draft.projectRef?.kind === "managed" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.check, hint: s.helpCheck, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { value: draft.check ?? "", onChange: (e) => patch({ check: e.target.value || void 0 }), rows: 2, className: textareaClass, placeholder: 'test -n "$(ls /new-bookings 2>/dev/null)" && cat /new-bookings/*' }) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.prompt, hint: s.helpPrompt, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { value: draft.prompt, onChange: (e) => patch({ prompt: e.target.value }), rows: 8, className: textareaClass, disabled: !mayPatch }) }),
      adminFields && (draft.ownerUserId == null || draft.ownerUserId === myId) ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.channel, hint: s.helpChannel, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        DestinationField,
        {
          value: draft.notifyChannelId ?? "",
          onChange: (v) => patch({ notifyChannelId: v || void 0 }),
          destinations
        }
      ) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.model, hint: s.helpModel, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex min-w-0 flex-col gap-1", "data-testid": "cron-last-run", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "text-sm font-medium text-foreground", children: s.lastStarted }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "text-xs text-muted-foreground", children: job.lastRun ? `${s.lastRunAt} ${utils.parseTs(job.lastRun) != null ? new Date(utils.parseTs(job.lastRun)).toLocaleString() : ""}` : "\u2014" }),
        job.lastResult ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground", children: job.lastResult }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3", children: [
        !oneShot ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          C.Button,
          {
            variant: "outline",
            icon: Play,
            disabled: dirty.current || autosave.status === "saving" || runPending,
            onClick: () => void runNow(),
            children: runPending ? s.runStarting : s.runNow
          }
        ) : !job.manualQueued ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", {}),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "ml-auto flex items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "ghost-danger", icon: Trash2, onClick: () => setConfirming(true), children: s.removeJob })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.AutoSaveStatus, { status: autosave.status, onRetry: autosave.retry })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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

// plugins/cronjob/web-src/AgendaView.tsx
var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
var statusBadge = (occurrence, s) => {
  const { components: C } = runtime();
  switch (occurrence.disposition) {
    case "late":
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Badge, { tone: "danger", children: s.badgeLate });
    case "catchUp":
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "inline-flex items-center gap-1", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(AlarmClock, { size: 10, "aria-hidden": true }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Badge, { tone: "muted", children: s.badgeCatchUp })
      ] });
    case "deferredByHours":
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "inline-flex items-center gap-1", title: s.badgeDeferredHint, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ShieldQuestion, { size: 10, "aria-hidden": true }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Badge, { tone: "muted", children: s.badgeDeferred })
      ] });
    case "dueNow":
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Badge, { tone: "muted", children: s.badgeDueNow });
    default:
      return null;
  }
};
function OccurrenceCard({ occurrence, job, onOpen }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const name = job?.name ?? occurrence.jobId;
  const oneShot = occurrence.lifecycle === "oneShot";
  const paused = job?.enabled === false;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
    "button",
    {
      type: "button",
      className: "flex min-h-[44px] w-full min-w-0 items-start gap-3 rounded-md border border-border bg-document px-3 py-2 text-left transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring",
      onClick: () => onOpen(occurrence.jobId),
      "aria-label": s.openJob.replace("{name}", name),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "shrink-0 pt-0.5 font-mono text-xs text-foreground tabular-nums", children: occurrence.localTime }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "flex min-w-0 flex-col gap-0.5", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "truncate text-sm text-foreground", children: name }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "flex flex-wrap items-center gap-1.5 text-[11px] leading-tight text-muted-foreground", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "inline-flex max-w-full items-center gap-1 truncate", children: [
              oneShot ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(CalendarClock, { size: 10, "aria-hidden": true }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Clock, { size: 10, "aria-hidden": true }),
              oneShot ? s.badgeOneShot : occurrence.guarded ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { title: s.badgeGuardedHint, children: job?.schedule ?? "" }) : job?.schedule ?? ""
            ] }),
            occurrence.guarded ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "inline-flex items-center gap-1", title: s.badgeGuardedHint, children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ShieldQuestion, { size: 10, "aria-hidden": true }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Badge, { tone: "muted", children: s.badgeGuarded })
            ] }) : null,
            paused ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Badge, { tone: "muted", children: s.paused }) : null,
            !paused ? statusBadge(occurrence, s) : null,
            !paused && !oneShot ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "sr-only", children: s.badgeRecurring }) : null
          ] })
        ] })
      ]
    }
  );
}
function AgendaView({ occurrences, jobs, onOpen }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const byJob = new Map(jobs.map((j) => [j.id, j]));
  const paused = jobs.filter((j) => j.enabled === false);
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "flex min-w-0 flex-col gap-2", "data-testid": "cron-agenda", children: occurrences.length === 0 && paused.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.EmptyState, { title: s.calDayEmpty, icon: Clock }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
    occurrences.map((occurrence) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(OccurrenceCard, { occurrence, job: byJob.get(occurrence.jobId), onOpen }, occurrence.id)),
    paused.map((job) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      "button",
      {
        type: "button",
        className: "flex min-h-[44px] w-full min-w-0 items-start gap-3 rounded-md border border-border bg-document px-3 py-2 text-left transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring",
        onClick: () => onOpen(job.id),
        "aria-label": s.openJob.replace("{name}", job.name || s.jobNew),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "shrink-0 pt-0.5 font-mono text-xs text-muted-foreground", "aria-hidden": true, children: "\u2014" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "flex min-w-0 flex-col gap-0.5", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "truncate text-sm text-muted-foreground", children: job.name || s.jobNew }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "text-[11px] text-muted-foreground", children: s.paused })
          ] })
        ]
      },
      job.id
    ))
  ] }) });
}

// plugins/cronjob/web-src/CalendarPage.tsx
var import_react6 = __toESM(require_react(), 1);
var import_jsx_runtime5 = __toESM(require_jsx_runtime(), 1);
function CalendarPage({ surface }) {
  const deck = surface === "deck";
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { t } = hooks.useTranslation();
  const me = hooks.useMe();
  const myId = me.data?.user?.id ?? null;
  const isAdmin = me.data?.user?.is_admin === true;
  const destinations = hooks.useNotificationDestinations();
  const models = hooks.useBrainModels();
  const mobile = hooks.useMobile();
  const deepLink = !deck;
  const today = (0, import_react6.useMemo)(() => localDateLabel(/* @__PURE__ */ new Date()), []);
  const [monthState, setMonthState] = (0, import_react6.useState)(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [selected, setSelected] = (0, import_react6.useState)(deck ? null : today);
  const [view, setView] = (0, import_react6.useState)("month");
  const [query, setQuery] = (0, import_react6.useState)("");
  const [scope, setScope] = (0, import_react6.useState)("all");
  const [opening, setOpening] = (0, import_react6.useState)(null);
  const [openJobId, setOpenJobId] = (0, import_react6.useState)(null);
  const [missingLink, setMissingLink] = (0, import_react6.useState)(null);
  const [runUntil, setRunUntil] = (0, import_react6.useState)(null);
  const [openingDatePane, setOpeningDatePane] = (0, import_react6.useState)(null);
  const queryClient = hooks.useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["cron-calendar"] });
  };
  const scopeParam = scope === "all" ? void 0 : scope === "mine" ? "personal" : "instance";
  const monthStart = `${String(monthState.year).padStart(4, "0")}-${String(monthState.month).padStart(2, "0")}-01`;
  const monthDays = new Date(Date.UTC(monthState.year, monthState.month, 0)).getUTCDate();
  const summary = hooks.useQuery({
    queryKey: ["cron-calendar", "summary", monthStart, monthDays, scope],
    queryFn: () => runtime().api(calendarUrl("summary", monthStart, monthDays, scopeParam)),
    staleTime: 15e3,
    refetchInterval: runUntil !== null ? 2e3 : 3e4,
    refetchIntervalInBackground: false
  });
  (0, import_react6.useEffect)(() => {
    if (runUntil === null) return;
    const stop = window.setTimeout(() => setRunUntil(null), Math.max(0, runUntil - Date.now()));
    return () => window.clearTimeout(stop);
  }, [runUntil]);
  const agenda = hooks.useQuery({
    queryKey: ["cron-calendar", "agenda", selected, scope],
    enabled: selected !== null,
    queryFn: () => runtime().api(calendarUrl("agenda", selected ?? "", 1, scopeParam, 100)),
    staleTime: 15e3
  });
  const stepMonth = (delta) => {
    setMonthState((cur) => {
      let year = cur.year;
      let month = cur.month + delta;
      if (month > 12) {
        month = 1;
        year += 1;
      } else if (month < 1) {
        month = 12;
        year -= 1;
      }
      return { year, month };
    });
  };
  const goToday = () => {
    const label = localDateLabel(/* @__PURE__ */ new Date());
    setMonthState({ year: Number(label.slice(0, 4)), month: Number(label.slice(5, 7)) });
    setSelected(label);
    setView("agenda");
  };
  const selectJob = (jobId) => {
    setOpenJobId(jobId);
    setMissingLink(null);
    if (deepLink) writeJobParam(jobId);
  };
  const closeJob = () => {
    setOpenJobId(null);
    if (deepLink) writeJobParam(null);
  };
  const [pendingLink] = (0, import_react6.useState)(() => deepLink ? jobIdParam() : null);
  (0, import_react6.useEffect)(() => {
    if (pendingLink === null || !summary.data) return;
    if (summary.data.jobs.some((job) => job.id === pendingLink)) setOpenJobId(pendingLink);
    else setMissingLink(pendingLink);
  }, [pendingLink, summary.data]);
  const jobs = summary.data?.jobs ?? [];
  const filteredJobs = (0, import_react6.useMemo)(() => {
    const needle = query.trim().toLowerCase();
    return jobs.filter((job) => {
      if (scope === "mine" && !(job.ownerUserId != null && job.ownerUserId === myId)) return false;
      if (scope === "instance" && job.ownerUserId != null) return false;
      if (needle === "") return true;
      return (job.name ?? "").toLowerCase().includes(needle) || (job.schedule ?? "").toLowerCase().includes(needle) || (job.prompt ?? "").toLowerCase().includes(needle);
    });
  }, [jobs, query, scope, myId]);
  const filteredIds = (0, import_react6.useMemo)(() => new Set(filteredJobs.map((j) => j.id)), [filteredJobs]);
  const agendaOccurrences = (0, import_react6.useMemo)(
    () => (agenda.data?.occurrences ?? []).filter((o) => filteredIds.has(o.jobId)),
    [agenda.data?.occurrences, filteredIds]
  );
  const sampleDays = (0, import_react6.useMemo)(
    () => new Map((summary.data?.days ?? []).map((day) => [day.date, day])),
    [summary.data?.days]
  );
  const dayContent = (day) => {
    const label = localDateLabel(day.date);
    const info = sampleDays.get(label);
    const entries = info?.samples ?? [];
    const inMonth = day.date.getMonth() === day.displayMonth.getMonth();
    const count = info?.total ?? 0;
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
      "span",
      {
        className: "flex min-w-0 flex-col items-center gap-0.5",
        "aria-label": count > 0 ? s.calDayAria.replace("{date}", label).replace("{count}", String(count)) : void 0,
        "data-testid": `cron-day-${label}`,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "text-xs tabular-nums", children: day.date.getDate() }),
          inMonth ? entries.map((occurrence) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "max-w-full truncate text-[10px] leading-tight text-muted-foreground", children: occurrence.localTime }, occurrence.id)) : null,
          inMonth && info && info.overflow > 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "text-[10px] font-medium leading-tight text-primary", children: s.calMore.replace("{n}", String(info.overflow)) }) : null
        ]
      }
    );
  };
  const todayToolbar = /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "flex min-w-0 flex-wrap items-center gap-2 pb-2", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.Button, { variant: "ghost", icon: ChevronLeft, "aria-label": s.calPrevMonth, className: "size-11 sm:size-9", onClick: () => stepMonth(-1) }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "text-sm font-medium text-foreground tabular-nums", children: [
      monthState.year,
      "-",
      String(monthState.month).padStart(2, "0")
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.Button, { variant: "ghost", icon: ChevronRight, "aria-label": s.calNextMonth, className: "size-11 sm:size-9", onClick: () => stepMonth(1) }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.Button, { variant: "outline", onClick: goToday, children: s.calToday }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      C.Modal,
      {
        open: openingDatePane === "month",
        title: s.calMonthLabel,
        onClose: () => setOpeningDatePane(null),
        closeLabel: t.common.close,
        children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.ModalBody, { children: openingDatePane === "month" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          C.Calendar,
          {
            "aria-label": s.calMonthLabel,
            mode: "single",
            month: parseDate(monthStart),
            onMonthChange: (next) => setMonthState(monthKey(localDateLabel(next))),
            selected: selected ? parseDate(selected) : void 0,
            onSelect: (day) => {
              setOpeningDatePane(null);
              if (day) {
                setSelected(localDateLabel(day));
                setView("agenda");
              }
            }
          }
        ) : null })
      }
    ),
    mobile ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.Button, { variant: "outline", onClick: () => setOpeningDatePane("month"), children: s.calDatePicker }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      C.Segmented,
      {
        value: view,
        onChange: (next) => {
          setView(next);
          if (next === "agenda") setSelected(null);
        },
        options: [
          { value: "month", label: s.calMonthLabel },
          { value: "agenda", label: s.calAgendaHeading }
        ],
        "aria-label": s.calViewTitle
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.Input, { value: query, onChange: (e) => setQuery(e.target.value), placeholder: s.searchPlaceholder, "aria-label": s.searchPlaceholder, className: "min-w-40 max-w-64" }),
    isAdmin ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      C.Segmented,
      {
        value: scope,
        onChange: (next) => setScope(next),
        options: [
          { value: "all", label: s.filterAll },
          { value: "mine", label: s.filterMine },
          { value: "instance", label: s.filterInstance }
        ],
        "aria-label": s.ownerColumn
      }
    ) : null
  ] });
  const oneShotButton = /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.Button, { variant: "accent", onClick: () => setOpening("oneShot"), disabled: opening !== null, children: s.createOneShot });
  const recurringButton = /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.Button, { variant: "outline", onClick: () => setOpening("recurring"), disabled: opening !== null, children: s.createRecurring });
  const runningStatus = summary.data?.scheduler.ready && summary.data.scheduler.runningJobId ? ` \xB7 ${s.runningSince.replace("{t}", utils.compactElapsed(Date.now() - Date.parse(summary.data.scheduler.runningSince ?? summary.data.generatedAt)))}` : null;
  const body = summary.isError ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.ErrorState, { message: t.common.daemonUnreachable, onRetry: () => summary.refetch() }) : !summary.data ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.LoadingState, { variant: "cards" }) : jobs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
    C.EmptyState,
    {
      title: s.calEmptyTitle,
      description: s.calEmptyHint,
      icon: CalendarDays,
      action: scope === "all" && query === "" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "flex flex-wrap items-center gap-2", children: [
        recurringButton,
        oneShotButton
      ] }) : void 0
    }
  ) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "flex min-w-0 flex-col gap-3", "aria-busy": summary.isLoading, "data-testid": "cron-calendar-body", children: [
    todayToolbar,
    missingLink ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { role: "status", className: "flex flex-col gap-0.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "font-medium text-destructive", children: s.linkUnavailable }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "text-muted-foreground", children: s.linkUnavailableHint })
    ] }) : null,
    summary.data.truncated ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { role: "status", className: "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "font-medium text-destructive", children: s.calTruncated }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "block text-muted-foreground", children: s.calTruncatedHint })
    ] }) : null,
    openingDatePane !== null ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CreateJobDialog, { lifecycle: "oneShot", myId, isAdmin, onClose: () => setOpeningDatePane(null), onCreated: (created) => {
      setOpeningDatePane(null);
      invalidate();
      selectJob(created.id);
    } }) : null,
    selected !== null && !mobile ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem] xl:gap-5", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "min-w-0", "data-testid": "cron-month-grid", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        C.Calendar,
        {
          mode: "single",
          selected: selected ? parseDate(selected) : void 0,
          onSelect: (day) => {
            if (day) {
              setSelected(localDateLabel(day));
            }
          },
          month: parseDate(monthStart),
          onMonthChange: (next) => setMonthState(monthKey(localDateLabel(next))),
          showOutsideDays: false,
          "aria-label": s.calMonthLabel,
          components: { DayContent: dayContent }
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("aside", { className: "flex min-w-0 flex-col gap-2 border-t border-border pt-3 xl:border-t-0 xl:pt-0", "aria-label": s.calAgendaHeading, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { "aria-live": "polite", className: "text-sm font-medium text-foreground", children: formatLocalDay(selected) }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(AgendaView, { occurrences: agendaOccurrences, jobs: filteredJobs, onOpen: (jobId) => selectJob(jobId) })
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "flex min-w-0 flex-col gap-2", "data-testid": "cron-agenda-only", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(AgendaView, { occurrences: agendaOccurrences, jobs: filteredJobs, onOpen: (jobId) => selectJob(jobId) }) })
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.ModuleHeader, { title: s.calModuleTitle, icon: CalendarDays }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(C.WorkspacePage, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        C.WorkspaceHero,
        {
          eyebrow: s.workspaceEyebrow,
          title: s.workspaceTitle,
          icon: CalendarDays,
          description: s.calDescription,
          status: summary.data ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "workspace-status", "data-testid": "cron-calendar-timezone", children: [
            summary.data.timezone,
            runningStatus
          ] }) : void 0,
          action: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "flex flex-wrap items-center gap-2", children: [
            recurringButton,
            oneShotButton
          ] })
        }
      ),
      body
    ] }),
    opening !== null ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      CreateJobDialog,
      {
        lifecycle: opening,
        myId,
        isAdmin,
        onClose: () => setOpening(null),
        onCreated: (created) => {
          invalidate();
          setRunUntil(Date.now() + 12e4);
          setOpening(null);
          selectJob(created.id);
        }
      }
    ) : null,
    openJobId !== null && summary.data ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      JobDrawer,
      {
        job: summary.data.jobs.find((job) => job.id === openJobId),
        myId,
        adminFields: isAdmin,
        destinations: destinations.data ?? [],
        models: models.data ?? [],
        onClose: closeJob,
        onRemoved: () => {
          closeJob();
          invalidate();
          setRunUntil(Date.now() + 12e4);
        },
        onRefresh: () => invalidate()
      }
    ) : null,
    summary.data && !summary.data.scheduler.ready ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { role: "status", className: "sr-only", children: s.schedulerUnavailable }) : null
  ] });
}
var parseDate = (label) => {
  const [, y, mo, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label) ?? [];
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
};
var monthKey = (label) => {
  const [y, mo] = label.split("-").map(Number);
  return { year: y, month: mo };
};
var formatLocalDay = (label) => new Intl.DateTimeFormat(void 0, { weekday: "short", month: "long", year: "numeric", day: "numeric" }).format(parseDate(label));
var JOB_PARAM = "job";
var jobIdParam = () => {
  const value = new URLSearchParams(window.location.search).get(JOB_PARAM);
  return value && value.trim() !== "" ? value : null;
};
var writeJobParam = (id) => {
  const url = new URL(window.location.href);
  if (id === null) url.searchParams.delete(JOB_PARAM);
  else url.searchParams.set(JOB_PARAM, id);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  window.history.pushState(window.history.state, "", next);
};
var calendarUrl = (detail, startLabel, daysCount, scopeValue, limit) => {
  const params = new URLSearchParams({ detail, start: startLabel, days: String(daysCount) });
  if (scopeValue) params.set("scope", scopeValue);
  if (detail === "agenda" && limit !== void 0) params.set("limit", String(limit));
  return `/plugins/cronjob/api/calendar?${params.toString()}`;
};

// plugins/cronjob/web-src/index.tsx
var import_jsx_runtime6 = __toESM(require_jsx_runtime(), 1);
function CronJobApp({ surface }) {
  if (surface === "page") return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(CalendarPage, { surface: "page" });
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(DeckAgenda, {});
}
function DeckAgenda() {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("cronjob");
  const { t } = hooks.useTranslation();
  const me = hooks.useMe();
  const myId = me.data?.user?.id ?? null;
  const isAdmin = me.data?.user?.is_admin === true;
  const destinations = hooks.useNotificationDestinations();
  const models = hooks.useBrainModels();
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const [opening, setOpening] = (0, import_react7.useState)(null);
  const [openJobId, setOpenJobId] = (0, import_react7.useState)(null);
  const summary = hooks.useQuery({
    queryKey: ["cron-calendar", "summary", today, 7, "all"],
    queryFn: () => runtime().api(`/plugins/cronjob/api/calendar?detail=summary&start=${encodeURIComponent(today)}&days=7`),
    staleTime: 15e3,
    refetchInterval: 3e4
  });
  const jobs = summary.data?.jobs ?? [];
  const agendaOccurrences = (summary.data?.days ?? []).flatMap((d) => d.samples);
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      C.PluginSection,
      {
        title: s.title,
        description: s.sectionHint,
        action: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { className: "flex flex-wrap items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.Button, { variant: "outline", onClick: () => setOpening("recurring"), disabled: opening !== null, children: s.createRecurring }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.Button, { variant: "accent", onClick: () => setOpening("oneShot"), disabled: opening !== null, children: s.createOneShot })
        ] }),
        children: summary.isError ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.ErrorState, { message: t.common.daemonUnreachable, onRetry: () => summary.refetch() }) : summary.isLoading && !summary.data ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.LoadingState, { variant: "cards" }) : jobs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.EmptyState, { title: s.calEmptyTitle, description: s.calEmptyHint, icon: CalendarDays }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "flex min-w-0 flex-col gap-2", "data-testid": "cron-deck-agenda", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(AgendaView, { occurrences: agendaOccurrences, jobs, onOpen: (jobId) => setOpenJobId(jobId) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { className: "text-xs text-muted-foreground", children: [
            s.metricActive,
            " ",
            jobs.filter((job) => job.enabled !== false).length,
            " \xB7 ",
            s.metricPaused,
            " ",
            jobs.filter((job) => job.enabled === false).length,
            " \xB7 ",
            s.nextRun,
            " ",
            utils.compactElapsed(Date.now() - Date.parse(jobs.find((job) => job.enabled !== false)?.nextOccurrence?.expectedAt ?? summary.data.generatedAt))
          ] })
        ] })
      }
    ),
    opening !== null ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      CreateJobDialog,
      {
        lifecycle: opening,
        myId,
        isAdmin,
        onClose: () => setOpening(null),
        onCreated: () => setOpening(null)
      }
    ) : null,
    openJobId !== null && summary.data ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      JobDrawer,
      {
        job: jobs.find((job) => job.id === openJobId),
        myId,
        adminFields: isAdmin,
        destinations: destinations.data ?? [],
        models: models.data ?? [],
        onClose: () => setOpenJobId(null),
        onRemoved: () => {
          setOpenJobId(null);
          void summary.refetch();
        },
        onRefresh: () => void summary.refetch()
      }
    ) : null
  ] });
}
registerCronUi({
  requiresApiVersion: 17,
  settings: {
    "jobs": CronJobApp
  },
  ownsPageFrame: ["jobs"]
});
