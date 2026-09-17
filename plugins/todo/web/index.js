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

// plugins/todo/web-src/runtime.ts
function runtime() {
  const value = window.ElowenUiRuntime;
  if (!value) throw new Error("ElowenUiRuntime is not installed");
  return value;
}
function registerTodoUi(registration) {
  window.__elowenRegisterPluginUi?.("todo", registration);
}

// plugins/todo/web-src/TasksPicker.tsx
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

// node_modules/lucide-react/dist/esm/icons/circle-check.js
var CircleCheck = createLucideIcon("CircleCheck", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "m9 12 2 2 4-4", key: "dzmm74" }]
]);

// node_modules/lucide-react/dist/esm/icons/circle-dot.js
var CircleDot = createLucideIcon("CircleDot", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["circle", { cx: "12", cy: "12", r: "1", key: "41hilf" }]
]);

// node_modules/lucide-react/dist/esm/icons/circle.js
var Circle = createLucideIcon("Circle", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }]
]);

// node_modules/lucide-react/dist/esm/icons/ellipsis.js
var Ellipsis = createLucideIcon("Ellipsis", [
  ["circle", { cx: "12", cy: "12", r: "1", key: "41hilf" }],
  ["circle", { cx: "19", cy: "12", r: "1", key: "1wjl8i" }],
  ["circle", { cx: "5", cy: "12", r: "1", key: "1pcz8c" }]
]);

// node_modules/lucide-react/dist/esm/icons/list-checks.js
var ListChecks = createLucideIcon("ListChecks", [
  ["path", { d: "m3 17 2 2 4-4", key: "1jhpwq" }],
  ["path", { d: "m3 7 2 2 4-4", key: "1obspn" }],
  ["path", { d: "M13 6h8", key: "15sg57" }],
  ["path", { d: "M13 12h8", key: "h98zly" }],
  ["path", { d: "M13 18h8", key: "oe0vm4" }]
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

// node_modules/lucide-react/dist/esm/icons/trash-2.js
var Trash2 = createLucideIcon("Trash2", [
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", key: "4alrt4" }],
  ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", key: "v07s0e" }],
  ["line", { x1: "10", x2: "10", y1: "11", y2: "17", key: "1uufr5" }],
  ["line", { x1: "14", x2: "14", y1: "11", y2: "17", key: "xtxkd" }]
]);

// plugins/todo/web-src/TasksPicker.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
function TasksPicker({ sessionId, close }) {
  const { components: C, hooks, utils } = runtime();
  const strings = hooks.usePluginStrings("todo");
  const { toast } = hooks.useToast();
  const query = hooks.useSessionTasks(sessionId);
  const update = hooks.useUpdateSessionTask();
  const remove = hooks.useDeleteSessionTask();
  const clear = hooks.useClearSessionTasks();
  const [filter, setFilter] = (0, import_react3.useState)("");
  const [renaming, setRenaming] = (0, import_react3.useState)(null);
  const [draft, setDraft] = (0, import_react3.useState)("");
  const [deleteTarget, setDeleteTarget] = (0, import_react3.useState)(null);
  const [clearTarget, setClearTarget] = (0, import_react3.useState)(null);
  const busy = update.isPending || remove.isPending || clear.isPending;
  const rows = (0, import_react3.useMemo)(() => {
    const needle = filter.trim().toLowerCase();
    const all = query.data?.tasks ?? [];
    return needle ? all.filter((task) => task.subject.toLowerCase().includes(needle) || task.description.toLowerCase().includes(needle)) : all;
  }, [filter, query.data]);
  const patch = (task, value) => {
    if (!sessionId) return;
    update.mutate({ sessionId, taskId: task.id, ...value }, { onError: (error) => toast(utils.apiErrorMessage(error), "error") });
  };
  const taskActions = (task) => [
    { label: strings.pending, icon: Circle, onSelect: () => patch(task, { status: "pending" }) },
    { label: strings.inProgress, icon: CircleDot, onSelect: () => patch(task, { status: "in_progress" }) },
    { label: strings.completed, icon: CircleCheck, onSelect: () => patch(task, { status: "completed" }) },
    { label: strings.rename, icon: Pencil, onSelect: () => {
      setDraft(task.subject);
      setRenaming(task.id);
    } },
    { label: strings.delete, icon: Trash2, tone: "danger", onSelect: () => setDeleteTarget(task) }
  ];
  const runDelete = () => {
    if (!sessionId || !deleteTarget) return;
    remove.mutate({ sessionId, taskId: deleteTarget.id }, { onSuccess: () => setDeleteTarget(null), onError: (error) => toast(utils.apiErrorMessage(error), "error") });
  };
  const runClear = () => {
    if (!sessionId || !clearTarget) return;
    clear.mutate({ sessionId, scope: clearTarget }, { onSuccess: () => setClearTarget(null), onError: (error) => toast(utils.apiErrorMessage(error), "error") });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.Modal, { title: strings.title, onClose: close, size: "md", icon: ListChecks, intent: "inspect", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.ModalBody, { gap: 4, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Input, { value: filter, onChange: (event) => setFilter(event.target.value), placeholder: strings.filter, "aria-label": strings.filter }),
        query.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.LoadingState, { variant: "list" }) : query.isError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ErrorState, { message: strings.unavailable, onRetry: () => query.refetch() }) : rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.EmptyState, { title: strings.empty, description: strings.emptyDesc, icon: ListChecks }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex flex-col gap-px overflow-hidden rounded-md border border-border bg-border/50", children: rows.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center gap-2 bg-card px-3 py-2", children: [
          task.status === "in_progress" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Spinner, { size: "xs" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              disabled: busy,
              "aria-label": task.subject,
              "aria-pressed": task.status === "completed",
              onClick: () => patch(task, { status: task.status === "completed" ? "pending" : "completed" }),
              className: "shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-50",
              children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Checkbox, { checked: task.status === "completed" })
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "min-w-0 flex-1", children: [
            renaming === task.id ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Input, { autoFocus: true, value: draft, onChange: (event) => setDraft(event.target.value), onBlur: () => {
              if (draft.trim()) patch(task, { subject: draft.trim() });
              setRenaming(null);
            }, onKeyDown: (event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (draft.trim()) patch(task, { subject: draft.trim() });
                setRenaming(null);
              }
            } }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: task.status === "completed" ? "text-sm text-muted-foreground line-through" : "text-sm text-foreground", children: task.subject }),
            task.description ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "text-xs text-muted-foreground", children: task.description }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ActionMenu, { variant: "kebab", items: taskActions(task), label: strings.actions + ": " + task.subject, trigger: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ellipsis, { size: 15, "aria-hidden": true }) })
        ] }, task.id)) })
      ] }),
      query.data?.tasks.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.ModalFooter, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "ghost", disabled: busy || !query.data.tasks.some((task) => task.status === "completed"), onClick: () => setClearTarget("completed"), children: strings.clearCompleted }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "ghost-danger", disabled: busy, onClick: () => setClearTarget("all"), children: strings.clearAll })
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ConfirmDialog, { open: deleteTarget !== null, title: strings.deleteTitle, description: deleteTarget?.subject, pending: remove.isPending, onConfirm: runDelete, onClose: () => setDeleteTarget(null) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ConfirmDialog, { open: clearTarget !== null, title: clearTarget === "completed" ? strings.clearCompletedTitle : strings.clearAllTitle, description: clearTarget === "completed" ? strings.clearCompletedDesc : strings.clearAllDesc, confirmLabel: clearTarget === "completed" ? strings.clearCompleted : strings.clearAll, pending: clear.isPending, onConfirm: runClear, onClose: () => setClearTarget(null) })
  ] });
}

// plugins/todo/web-src/TodoCard.tsx
var import_react4 = __toESM(require_react(), 1);
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
function useClock(running) {
  const [now, setNow] = (0, import_react4.useState)(() => Date.now());
  (0, import_react4.useEffect)(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1e3);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}
function TodoCard({ card, sessionId, live, open }) {
  const { components: C, hooks, utils } = runtime();
  const strings = hooks.usePluginStrings("todo");
  const query = hooks.useSessionTasks(sessionId);
  const update = hooks.useUpdateSessionTask();
  const tasks = query.data?.tasks ?? (card.items ?? []).flatMap((item) => item.id ? [{
    id: item.id,
    subject: item.label ?? item.text,
    description: "",
    status: item.status ?? "pending",
    ...item.startedAt === void 0 ? {} : { startedAt: item.startedAt },
    ...item.owner === void 0 ? {} : { owner: item.owner },
    blockedBy: item.blockedBy ?? [],
    blocks: []
  }] : []);
  const now = useClock(live && tasks.some((task) => task.status === "in_progress" && task.startedAt != null));
  const setStatus = (task, status) => {
    if (!sessionId || status === task.status) return;
    update.mutate({ sessionId, taskId: task.id, status });
  };
  const taskActions = (task) => [
    { label: strings.pending, icon: Circle, onSelect: () => setStatus(task, "pending") },
    { label: strings.inProgress, icon: CircleDot, onSelect: () => setStatus(task, "in_progress") },
    { label: strings.completed, icon: CircleCheck, onSelect: () => setStatus(task, "completed") }
  ];
  if (tasks.length > 0 && tasks.every((task) => task.status === "completed")) return null;
  const done = tasks.filter((task) => task.status === "completed").length;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { "data-testid": "chat-card", className: "flex max-w-[min(100%,28rem)] flex-col self-start leading-tight", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex items-center gap-1.5 text-muted-foreground", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", onClick: () => open("tasks"), className: "flex min-w-0 items-center gap-1.5 text-left hover:text-foreground", "aria-label": strings.title, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ListChecks, { size: 12, "aria-hidden": true }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate", children: strings.title }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "tabular-nums opacity-70", children: [
          done,
          "/",
          tasks.length
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: () => open("tasks"), className: "ml-auto rounded px-1 text-xs hover:bg-accent", "aria-label": strings.open, title: strings.open, children: "\u2197" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "flex flex-col", children: tasks.slice(0, 4).map((task) => {
      const label = task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject;
      const elapsed = task.status === "in_progress" && task.startedAt != null ? utils.formatDuration(now - task.startedAt) : null;
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { className: "flex min-w-0 items-center gap-1", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        C.ActionMenu,
        {
          items: taskActions(task),
          label: strings.actions + ": " + label,
          align: "left",
          openOnHover: false,
          className: "min-w-0 flex-1",
          triggerClassName: "flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-accent",
          trigger: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            task.status === "in_progress" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Spinner, { size: "xs", tone: "text-primary" }) : task.status === "completed" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(CircleCheck, { size: 11, "aria-hidden": true, className: "shrink-0 text-success" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Circle, { size: 11, "aria-hidden": true, className: "shrink-0 text-muted-foreground" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { title: label, className: `min-w-0 flex-1 truncate ${task.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"}`, children: label }),
            elapsed ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "shrink-0 tabular-nums text-primary", children: [
              "\xB7 ",
              elapsed
            ] }) : null
          ] })
        }
      ) }, task.id);
    }) }),
    tasks.length > 4 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", onClick: () => open("tasks"), className: "self-start px-1 text-xs text-muted-foreground hover:text-foreground", children: [
      "+",
      tasks.length - 4,
      " more"
    ] }) : null,
    card.body ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "whitespace-pre-wrap break-words text-muted-foreground", children: card.body }) : null
  ] });
}

// plugins/todo/web-src/TasksRail.tsx
var import_react5 = __toESM(require_react(), 1);
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
function parseData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const tasks = data.tasks;
  if (!Array.isArray(tasks)) return null;
  const parsed = tasks.map((task) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) return null;
    const value = task;
    const subject = typeof value.subject === "string" ? value.subject : value.label;
    if (typeof value.id !== "string" || typeof subject !== "string" || value.status !== "pending" && value.status !== "in_progress" && value.status !== "completed" || !Array.isArray(value.blockedBy) || !value.blockedBy.every((item) => typeof item === "string")) return null;
    return {
      id: value.id,
      subject,
      description: typeof value.description === "string" ? value.description : "",
      status: value.status,
      blockedBy: value.blockedBy,
      blocks: [],
      ...typeof value.startedAt === "number" ? { startedAt: value.startedAt } : {},
      ...typeof value.activeForm === "string" ? { activeForm: value.activeForm } : {}
    };
  });
  return parsed.every((task) => task !== null) ? { tasks: parsed } : null;
}
function RailTaskRow({ task, now, onStatus, open, strings, busy, ActionMenu }) {
  const active = task.status === "in_progress";
  const elapsed = active && task.startedAt != null ? `${Math.max(0, Math.round((now - task.startedAt) / 1e3))}s` : null;
  const label = active && task.activeForm ? task.activeForm : task.subject;
  const actions = [
    { label: strings.pending, onSelect: () => onStatus("pending") },
    { label: strings.inProgress, onSelect: () => onStatus("in_progress") },
    { label: strings.completed, onSelect: () => onStatus("completed") }
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { className: "flex min-w-0 items-center gap-1.5", "data-testid": "telemetry-row", children: [
    active ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(CircleDot, { size: 11, "aria-hidden": true, className: "shrink-0 text-primary" }) : task.status === "completed" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(CircleCheck, { size: 11, "aria-hidden": true, className: "shrink-0 text-success" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Circle, { size: 11, "aria-hidden": true, className: "shrink-0 text-muted-foreground" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: open, className: "min-w-0 flex-1 truncate text-left text-xs text-foreground hover:text-primary", title: task.subject, children: label }),
    elapsed ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "shrink-0 font-mono text-tiny text-muted-foreground", children: elapsed }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ActionMenu, { variant: "kebab", items: actions, label: strings.actions + ": " + label, trigger: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Ellipsis, { size: 13, "aria-hidden": true }), disabled: busy })
  ] });
}
function TasksRail({ variant, data, sessionId, open }) {
  const { components: C, hooks } = runtime();
  const strings = hooks.usePluginStrings("todo");
  const parsed = (0, import_react5.useMemo)(() => parseData(data), [data]);
  const [expanded, setExpanded] = (0, import_react5.useState)(false);
  const [now, setNow] = (0, import_react5.useState)(() => Date.now());
  const update = hooks.useUpdateSessionTask();
  (0, import_react5.useEffect)(() => {
    if (!parsed?.tasks.some((task) => task.status === "in_progress" && task.startedAt != null)) return;
    const timer = setInterval(() => setNow(Date.now()), 1e3);
    return () => clearInterval(timer);
  }, [parsed]);
  if (!parsed || parsed.tasks.length === 0) return null;
  const active = parsed.tasks.filter((task) => task.status !== "completed");
  if (active.length === 0) return null;
  const shown = expanded ? active : active.slice(0, 4);
  const done = parsed.tasks.length - active.length;
  if (variant === "compact") return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { "data-testid": "telemetry-compact-tasks", className: "flex w-10 flex-col items-center gap-1 rounded-md px-1 py-1.5", title: strings.railTitle ?? strings.title, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ListChecks, { size: 14, "aria-hidden": true, className: "text-primary" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "font-mono text-[9px] leading-none text-muted-foreground", children: [
      done,
      "/",
      parsed.tasks.length
    ] })
  ] });
  const setStatus = (task, status) => {
    if (!sessionId || status === task.status) return;
    update.mutate({ sessionId, taskId: task.id, status });
    setNow(Date.now());
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { "data-testid": "telemetry-tasks", className: "flex flex-col gap-1", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex w-full min-w-0 items-center gap-1.5 text-xs uppercase tracking-wide text-subtle-foreground", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ListChecks, { size: 11, "aria-hidden": true }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "min-w-0 truncate", children: strings.railTitle ?? strings.title }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "ml-auto shrink-0 rounded bg-muted px-1 py-0 text-tiny tabular-nums", children: [
        done,
        "/",
        parsed.tasks.length
      ] })
    ] }),
    variant === "expanded" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Progress, { className: "h-1", value: done / parsed.tasks.length * 100, "aria-label": strings.railTitle ?? strings.title }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: "flex flex-col gap-0.5", children: shown.map((task) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(RailTaskRow, { task, now, onStatus: (status) => setStatus(task, status), open: () => open("tasks"), strings, busy: update.isPending, ActionMenu: C.ActionMenu }, task.id)) }),
    active.length > shown.length ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { type: "button", onClick: () => setExpanded((value) => !value), className: "self-start px-1 text-tiny text-muted-foreground hover:text-foreground", children: [
      "+",
      active.length - shown.length,
      " ",
      strings.more
    ] }) : null
  ] });
}

// plugins/todo/web-src/index.tsx
registerTodoUi({
  requiresApiVersion: 17,
  chatPickers: { tasks: TasksPicker },
  chatCards: { todos: TodoCard },
  chatRailSections: { todo: TasksRail }
});
