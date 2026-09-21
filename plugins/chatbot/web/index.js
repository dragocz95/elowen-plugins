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

// plugins/chatbot/web-src/runtime.ts
function runtime() {
  const value = window.ElowenUiRuntime;
  if (!value) throw new Error("ElowenUiRuntime is not installed");
  return value;
}
function registerChatbotUi(pages) {
  window.__elowenRegisterPluginUi?.("chatbot", { requiresApiVersion: 12, pages });
}
async function apiJson(path, init) {
  return await runtime().api(path, init);
}
function jsonRequest(method, body) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// plugins/chatbot/web-src/ChatbotWorkspace.tsx
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

// node_modules/lucide-react/dist/esm/icons/bot.js
var Bot = createLucideIcon("Bot", [
  ["path", { d: "M12 8V4H8", key: "hb8ula" }],
  ["rect", { width: "16", height: "12", x: "4", y: "8", rx: "2", key: "enze0r" }],
  ["path", { d: "M2 14h2", key: "vft8re" }],
  ["path", { d: "M20 14h2", key: "4cs60a" }],
  ["path", { d: "M15 13v2", key: "1xurst" }],
  ["path", { d: "M9 13v2", key: "rq6x2g" }]
]);

// node_modules/lucide-react/dist/esm/icons/check.js
var Check = createLucideIcon("Check", [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]]);

// node_modules/lucide-react/dist/esm/icons/clipboard-copy.js
var ClipboardCopy = createLucideIcon("ClipboardCopy", [
  ["rect", { width: "8", height: "4", x: "8", y: "2", rx: "1", ry: "1", key: "tgr4d6" }],
  ["path", { d: "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2", key: "4jdomd" }],
  ["path", { d: "M16 4h2a2 2 0 0 1 2 2v4", key: "3hqy98" }],
  ["path", { d: "M21 14H11", key: "1bme5i" }],
  ["path", { d: "m15 10-4 4 4 4", key: "5dvupr" }]
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

// node_modules/lucide-react/dist/esm/icons/list-checks.js
var ListChecks = createLucideIcon("ListChecks", [
  ["path", { d: "m3 17 2 2 4-4", key: "1jhpwq" }],
  ["path", { d: "m3 7 2 2 4-4", key: "1obspn" }],
  ["path", { d: "M13 6h8", key: "15sg57" }],
  ["path", { d: "M13 12h8", key: "h98zly" }],
  ["path", { d: "M13 18h8", key: "oe0vm4" }]
]);

// node_modules/lucide-react/dist/esm/icons/plus.js
var Plus = createLucideIcon("Plus", [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "M12 5v14", key: "s699le" }]
]);

// node_modules/lucide-react/dist/esm/icons/power.js
var Power = createLucideIcon("Power", [
  ["path", { d: "M12 2v10", key: "mnfbl" }],
  ["path", { d: "M18.4 6.6a9 9 0 1 1-12.77.04", key: "obofu9" }]
]);

// node_modules/lucide-react/dist/esm/icons/save.js
var Save = createLucideIcon("Save", [
  [
    "path",
    {
      d: "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
      key: "1c8476"
    }
  ],
  ["path", { d: "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7", key: "1ydtos" }],
  ["path", { d: "M7 3v4a1 1 0 0 0 1 1h7", key: "t51u73" }]
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

// plugins/chatbot/web-src/BotDetail.tsx
var import_react3 = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
function blockerText(blockers, projectCount, s) {
  return blockers.map((blocker) => {
    if (blocker === "account_unknown") return s.accountUnknown;
    if (blocker === "account_not_chatbot") return s.accountNotChatbot;
    if (blocker === "account_admin") return s.accountAdmin;
    if (blocker === "several_projects") return s.detailProjectSeveral.replace("{count}", String(projectCount));
    return s.detailProjectNone;
  });
}
function originHint(value, existing) {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^https?:\/\/[^\s/]+$/i.test(trimmed)) return "invalid";
  if (existing.includes(trimmed)) return "duplicate";
  return null;
}
function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "\u2014" : new Intl.DateTimeFormat(void 0, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function statusText(bot, s) {
  if (bot.blockers.length > 0) return s.statusAttention;
  return bot.status === "enabled" ? s.statusEnabled : bot.status === "disabled" ? s.statusDisabled : s.statusDraft;
}
function BotDetail({ bot, onChanged, unknownError }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("chatbot");
  const { toast } = hooks.useToast();
  const [displayName, setDisplayName] = (0, import_react3.useState)(bot.displayName);
  const [prompt, setPrompt] = (0, import_react3.useState)(bot.prompt);
  const [origins, setOrigins] = (0, import_react3.useState)(bot.origins);
  const [draftOrigin, setDraftOrigin] = (0, import_react3.useState)("");
  const [pending, setPending] = (0, import_react3.useState)(false);
  const [error, setError] = (0, import_react3.useState)(null);
  const [confirming, setConfirming] = (0, import_react3.useState)(null);
  (0, import_react3.useEffect)(() => {
    setDisplayName(bot.displayName);
    setPrompt(bot.prompt);
    setOrigins(bot.origins);
    setDraftOrigin("");
    setError(null);
    setConfirming(null);
  }, [bot.chatbotUserId]);
  (0, import_react3.useEffect)(() => {
    setDisplayName(bot.displayName);
    setPrompt(bot.prompt);
    setOrigins(bot.origins);
  }, [bot.updatedAt, bot.displayName, bot.prompt, bot.origins]);
  const dirty = displayName !== bot.displayName || prompt !== bot.prompt || origins.join("\n") !== bot.origins.join("\n");
  const hint = originHint(draftOrigin, origins);
  const blockers = blockerText(bot.blockers, bot.projects.length, s);
  const save = async (action) => {
    setPending(true);
    setError(null);
    try {
      const answer = await apiJson("/plugins/chatbot/api/bots", jsonRequest("PATCH", {
        chatbotUserId: bot.chatbotUserId,
        expectedUpdatedAt: bot.updatedAt,
        displayName,
        prompt,
        origins,
        ...action === null ? {} : { action }
      }));
      onChanged(answer.bot);
      setConfirming(null);
    } catch (reason) {
      setError(utils.apiErrorMessage(reason) || unknownError);
    } finally {
      setPending(false);
    }
  };
  const addOrigin = () => {
    if (hint !== null) return;
    setOrigins([...origins, draftOrigin.trim()]);
    setDraftOrigin("");
  };
  const snippet = bot.embedSnippet;
  const copySnippet = async () => {
    if (snippet === null) return;
    try {
      await navigator.clipboard.writeText(snippet);
      toast(s.embedCopied);
    } catch {
      toast(s.embedCopyFailed, "error");
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-5", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-wrap items-start justify-between gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "min-w-0", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "truncate text-base font-semibold text-foreground", children: bot.displayName || s.botFallback }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "break-all font-mono text-[11px] text-subtle-foreground", children: bot.publicId })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: bot.status === "enabled" && bot.blockers.length === 0 ? "success" : bot.blockers.length > 0 ? "warning" : void 0, children: statusText(bot, s) }),
        bot.status === "enabled" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "ghost", icon: Power, disabled: pending, onClick: () => setConfirming("disable"), children: s.disableAction }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "accent", icon: Power, disabled: pending || dirty, onClick: () => setConfirming("enable"), children: s.enableAction })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", { className: "grid gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4 text-sm sm:grid-cols-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "min-w-0", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { className: "text-xs font-medium uppercase tracking-wide text-muted-foreground", children: s.detailAccount }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { className: "mt-1 truncate text-foreground", children: bot.account === null ? "\u2014" : `@${bot.account.username}` })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "min-w-0", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { className: "text-xs font-medium uppercase tracking-wide text-muted-foreground", children: s.detailProject }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { className: "mt-1 truncate text-foreground", children: bot.projects.length === 1 ? bot.projects[0].slug : "\u2014" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "col-span-full", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { className: "text-xs font-medium uppercase tracking-wide text-muted-foreground", children: s.detailUpdated }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { className: "mt-1 text-muted-foreground", children: formatTimestamp(bot.updatedAt) })
      ] })
    ] }),
    blockers.map((text) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground", children: text }, text)),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.promptLabel, hint: s.promptHint, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "textarea",
      {
        value: prompt,
        onChange: (event) => setPrompt(event.target.value),
        rows: 5,
        placeholder: s.promptPlaceholder,
        className: "w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rounded-xl border border-border bg-card p-4", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-sm font-semibold text-foreground", children: s.originsLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-1 text-xs leading-relaxed text-muted-foreground", children: s.originsHint }),
      origins.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-3 text-xs text-muted-foreground", children: s.originsEmpty }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "mt-3 flex flex-col gap-1", children: origins.map((origin) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { className: "flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-1.5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "break-all font-mono text-xs text-foreground", children: origin }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          C.Button,
          {
            variant: "ghost",
            icon: Trash2,
            "aria-label": s.originsRemove.replace("{value}", origin),
            disabled: pending,
            onClick: () => setOrigins(origins.filter((candidate) => candidate !== origin))
          }
        )
      ] }, origin)) }),
      bot.insecureOrigins.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-3 text-xs text-destructive", children: s.originsInsecure }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mt-3 flex flex-wrap items-end gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.originsAdd, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          C.Input,
          {
            value: draftOrigin,
            placeholder: s.originsPlaceholder,
            onChange: (event) => setDraftOrigin(event.target.value)
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { icon: Plus, disabled: pending || draftOrigin.trim() === "" || hint !== null, onClick: addOrigin, children: s.originsAdd })
      ] }),
      hint === "invalid" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-2 text-xs text-destructive", children: s.originsInvalid }) : null,
      hint === "duplicate" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-2 text-xs text-destructive", children: s.originsDuplicate }) : null
    ] }),
    snippet === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rounded-xl border border-border bg-card p-4", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-sm font-semibold text-foreground", children: s.embedTitle }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-1 text-xs leading-relaxed text-muted-foreground", children: s.embedHint }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "mt-3 overflow-x-auto rounded-lg bg-muted/40 p-3 font-mono text-[11px] text-foreground", children: snippet }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { className: "mt-3", variant: "ghost", icon: ClipboardCopy, onClick: () => void copySnippet(), children: s.embedCopy })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-wrap items-center gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "accent", icon: dirty ? Save : Check, disabled: pending || !dirty, onClick: () => void save(null), children: pending ? s.saveSaving : s.saveAction }),
      error !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs text-destructive", role: "alert", children: error }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      C.ConfirmDialog,
      {
        open: confirming !== null,
        title: confirming === "enable" ? s.enableTitle : s.disableTitle,
        description: confirming === "enable" ? s.enableBody : s.disableBody,
        confirmLabel: confirming === "enable" ? s.enableConfirm : s.disableConfirm,
        confirmVariant: confirming === "enable" ? "accent" : "danger",
        pending,
        onConfirm: () => void save(confirming),
        onClose: () => setConfirming(null)
      }
    )
  ] });
}

// plugins/chatbot/web-src/CreateBotDialog.tsx
var import_react4 = __toESM(require_react(), 1);
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
var NEXT_STEP = { account: "account", project: "project", register: "register" };
function CreateBotDialog({ projects, candidates, onClose, onCreated }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("chatbot");
  const [mode, setMode] = (0, import_react4.useState)(candidates.length > 0 ? "existing" : "new");
  const [username, setUsername] = (0, import_react4.useState)("");
  const [accountId, setAccountId] = (0, import_react4.useState)(candidates[0] === void 0 ? "" : String(candidates[0].id));
  const [displayName, setDisplayName] = (0, import_react4.useState)("");
  const [projectId, setProjectId] = (0, import_react4.useState)(projects[0] === void 0 ? "" : String(projects[0].id));
  const [pending, setPending] = (0, import_react4.useState)(false);
  const [failure, setFailure] = (0, import_react4.useState)(null);
  const stepLabel = { account: s.stepAccount, project: s.stepProject, register: s.stepRegister };
  const ready = projectId !== "" && (mode === "existing" ? accountId !== "" : username.trim() !== "");
  const submit = async () => {
    setPending(true);
    setFailure(null);
    let chatbotUserId = failure?.chatbotUserId ?? null;
    let step = failure === null ? "account" : NEXT_STEP[failure.step];
    if (mode === "existing" && chatbotUserId === null) {
      chatbotUserId = Number(accountId);
      step = "project";
    }
    if (step === "account") {
      try {
        const created = await apiJson("/users", jsonRequest("POST", { username: username.trim(), type: "chatbot" }));
        chatbotUserId = created.id;
        step = "project";
      } catch (error) {
        setFailure({ step: "account", detail: utils.apiErrorMessage(error), chatbotUserId: null });
        setPending(false);
        return;
      }
    }
    if (step === "project") {
      try {
        await apiJson(`/users/${chatbotUserId}/projects`, jsonRequest("POST", { projectId: Number(projectId) }));
        step = "register";
      } catch (error) {
        setFailure({ step: "project", detail: utils.apiErrorMessage(error), chatbotUserId });
        setPending(false);
        return;
      }
    }
    try {
      const answer = await apiJson("/plugins/chatbot/api/bots", jsonRequest("POST", {
        chatbotUserId,
        displayName: displayName.trim()
      }));
      onCreated(answer.bot);
      onClose();
    } catch (error) {
      setFailure({ step: "register", detail: utils.apiErrorMessage(error), chatbotUserId });
    } finally {
      setPending(false);
    }
  };
  const accountOptions = [{ value: "", label: s.createAccountLabel }, ...candidates.map((candidate) => ({
    value: String(candidate.id),
    label: `@${candidate.username}`
  }))];
  const projectOptions = projects.length === 0 ? [{ value: "", label: s.createProjectNone }] : projects.map((project) => ({ value: String(project.id), label: project.slug }));
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    C.Modal,
    {
      title: s.createTitle,
      onClose,
      closeLabel: s.cancel,
      closeDisabled: pending,
      ...pending ? { "aria-busy": true } : {},
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.ModalBody, { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex flex-col gap-4", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.createModeLabel, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            C.SelectMenu,
            {
              value: mode,
              onChange: (value) => {
                setMode(value);
                setFailure(null);
              },
              options: [{ value: "new", label: s.createModeNew }, { value: "existing", label: s.createModeExisting }],
              label: s.createModeLabel,
              disabled: pending || failure !== null
            }
          ) }),
          mode === "new" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.createUsernameLabel, hint: s.createUsernameHint, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Input, { value: username, onChange: (event) => setUsername(event.target.value), disabled: pending || failure !== null }) }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.createAccountLabel, hint: s.createAccountHint, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            C.SelectMenu,
            {
              value: accountId,
              onChange: (value) => setAccountId(value),
              options: accountOptions,
              label: s.createAccountLabel,
              disabled: pending || failure !== null
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.createDisplayNameLabel, hint: s.createDisplayNameHint, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Input, { value: displayName, onChange: (event) => setDisplayName(event.target.value), disabled: pending }) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.createProjectLabel, hint: s.createProjectHint, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            C.SelectMenu,
            {
              value: projectId,
              onChange: (value) => setProjectId(value),
              options: projectOptions,
              label: s.createProjectLabel,
              disabled: pending || projects.length === 0 || failure !== null
            }
          ) }),
          failure === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground", role: "alert", children: failure.chatbotUserId === null ? `${s.createFailed} \u2014 ${failure.detail}` : `${s.createPartial.replace("{step}", stepLabel[failure.step])} \u2014 ${failure.detail}` })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(C.ModalFooter, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Button, { variant: "ghost", onClick: onClose, disabled: pending, children: s.cancel }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Button, { variant: "accent", disabled: pending || !ready, onClick: () => void submit(), children: pending ? s.createPending : failure === null ? s.createSubmit : s.retry })
        ] })
      ]
    }
  );
}

// plugins/chatbot/web-src/ChatbotWorkspace.tsx
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
var REGISTER_COLUMNS = "minmax(0,2fr) minmax(0,1.2fr) minmax(0,1fr) 8rem 1.25rem";
var REGISTER_COMPACT_COLUMNS = "minmax(0,2fr) minmax(0,1fr) 8rem 1.25rem";
var REGISTER_MOBILE_COLUMNS = "minmax(0,1fr) 8rem 1.25rem";
function ChatbotWorkspace() {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("chatbot");
  const [answer, setAnswer] = (0, import_react5.useState)(null);
  const [loadError, setLoadError] = (0, import_react5.useState)(null);
  const [search, setSearch] = (0, import_react5.useState)("");
  const [filter, setFilter] = (0, import_react5.useState)("all");
  const [selectedId, setSelectedId] = (0, import_react5.useState)(null);
  const [creating, setCreating] = (0, import_react5.useState)(false);
  const load = (0, import_react5.useCallback)(() => {
    setLoadError(null);
    void apiJson("/plugins/chatbot/api/bots").then((value) => setAnswer(value)).catch((error) => setLoadError(utils.apiErrorMessage(error) || s.botsLoadError));
  }, [s.botsLoadError, utils]);
  (0, import_react5.useEffect)(() => {
    load();
  }, [load]);
  const bots = (0, import_react5.useMemo)(() => answer?.bots ?? [], [answer]);
  const replaceBot = (updated) => {
    setAnswer((current) => current === null ? current : {
      ...current,
      bots: current.bots.map((candidate) => candidate.chatbotUserId === updated.chatbotUserId ? updated : candidate)
    });
  };
  const visible = (0, import_react5.useMemo)(() => bots.filter((bot) => {
    if (filter === "enabled" && bot.status !== "enabled") return false;
    if (filter === "not_enabled" && bot.status === "enabled") return false;
    if (filter === "attention" && bot.blockers.length === 0) return false;
    const needle = search.trim().toLowerCase();
    if (needle === "") return true;
    const haystack = `${bot.displayName} ${bot.publicId} ${bot.account?.username ?? ""} ${bot.projects.map((project) => project.slug).join(" ")}`;
    return haystack.toLowerCase().includes(needle);
  }), [bots, filter, search]);
  const selected = bots.find((bot) => bot.chatbotUserId === selectedId) ?? visible[0] ?? null;
  const enabledCount = bots.filter((bot) => bot.status === "enabled").length;
  const attentionCount = bots.filter((bot) => bot.blockers.length > 0).length;
  const filterOptions = [
    { value: "all", label: s.filterAll, icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Layers, { size: 14 }) },
    { value: "enabled", label: s.filterEnabled, icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Bot, { size: 14 }) },
    { value: "not_enabled", label: s.filterNotEnabled, icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Bot, { size: 14 }) },
    { value: "attention", label: s.filterAttention, icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(TriangleAlert, { size: 14 }) }
  ];
  const toolbarFilters = [{
    id: "state",
    label: s.botsFilter,
    control: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      C.SelectMenu,
      {
        value: filter,
        onChange: (value) => setFilter(value),
        options: filterOptions,
        label: s.botsFilter
      }
    ),
    ...filter === "all" ? { active: false } : {
      active: true,
      activeLabel: `${s.botsFilter}: ${filterOptions.find((option) => option.value === filter)?.label ?? filter}`,
      onReset: () => setFilter("all")
    }
  }];
  const hero = {
    eyebrow: s.workspaceEyebrow,
    title: s.title,
    description: s.workspaceIntro,
    status: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "workspace-status", children: loadError === null ? s.workspaceReady : s.workspaceSetup }),
    action: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "accent", icon: Plus, onClick: () => setCreating(true), children: s.newBot }),
    // Figures the register can actually answer for. A visitor count would need a second query and belongs
    // with the conversation and usage surfaces, not bolted onto a hero.
    metrics: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.WorkspaceMetric, { label: s.metricBots, value: answer === null ? "\u2014" : bots.length, icon: Bot }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.WorkspaceMetric, { label: s.metricEnabled, value: answer === null ? "\u2014" : enabledCount, icon: ListChecks }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.WorkspaceMetric, { label: s.metricIncomplete, value: answer === null ? "\u2014" : attentionCount, icon: TriangleAlert })
    ] })
  };
  const body = loadError !== null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ControlSurfaceState, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ErrorState, { message: `${s.botsLoadError} \u2014 ${loadError}`, onRetry: load }) }) }) : answer === null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.LoadingState, { variant: "list" }) }) }) : bots.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.EmptyState, { title: s.botsEmptyTitle, description: s.botsEmptyDescription, icon: Bot }) }) }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.ControlSurfaceRegister, { className: "grid min-h-[31rem] grid-cols-1 gap-4 p-4 lg:!grid-cols-[22rem_minmax(0,1fr)] lg:items-start", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "min-w-0", children: visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.EmptyState, { title: s.botsNoResults, description: s.botsNoResultsDescription, icon: Search }) }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      C.DataTable,
      {
        ariaLabel: s.botsTab,
        columns: REGISTER_COLUMNS,
        compactColumns: REGISTER_COMPACT_COLUMNS,
        mobileColumns: REGISTER_MOBILE_COLUMNS,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTableRow, { header: true, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, lines: 1, children: s.columnBot }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", children: s.columnAccount }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", children: s.columnProject }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, lines: 1, children: s.columnStatus }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableChevronCell, {})
          ] }),
          visible.map((bot) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            C.DataTableRow,
            {
              selected: selected?.chatbotUserId === bot.chatbotUserId,
              onOpen: () => setSelectedId(bot.chatbotUserId),
              openLabel: s.openBot.replace("{name}", bot.displayName || s.botFallback),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { lines: 1, children: bot.displayName || s.botFallback }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { lines: 1, priority: "wide", children: bot.account === null ? "\u2014" : `@${bot.account.username}` }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { lines: 1, priority: "wide", children: bot.projects.length === 1 ? bot.projects[0].slug : "\u2014" }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { lines: "auto", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { tone: bot.blockers.length > 0 ? "warning" : bot.status === "enabled" ? "success" : void 0, children: statusText(bot, s) }) }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableChevronCell, {})
              ]
            },
            bot.chatbotUserId
          ))
        ]
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "min-w-0 rounded-xl border border-border bg-muted/30 p-5 lg:sticky lg:top-4 lg:self-start", children: selected === null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "text-sm text-muted-foreground", children: s.detailSelectHint }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(BotDetail, { bot: selected, onChanged: replaceBot, unknownError: s.saveFailed }) })
  ] }) });
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    C.WorkspaceShell,
    {
      variant: "register",
      hero,
      toolbar: answer === null || bots.length === 0 ? void 0 : {
        search: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          C.RegisterSearch,
          {
            value: search,
            onChange: setSearch,
            placeholder: s.botsSearch,
            label: s.botsSearch,
            onClear: () => setSearch(""),
            clearLabel: s.botsSearchClear
          }
        ),
        filters: toolbarFilters
      },
      children: [
        body,
        creating && answer !== null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          CreateBotDialog,
          {
            projects: answer.projects,
            candidates: answer.candidates,
            onClose: () => setCreating(false),
            onCreated: (bot) => {
              replaceBot(bot);
              setSelectedId(bot.chatbotUserId);
            }
          }
        ) : null
      ]
    }
  );
}

// plugins/chatbot/web-src/index.tsx
registerChatbotUi({ "": ChatbotWorkspace });
