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

// ../../elowen-plugins/node_modules/elowen-plugin-ui-kit/shims/react.cjs
var require_react = __commonJS({
  "../../elowen-plugins/node_modules/elowen-plugin-ui-kit/shims/react.cjs"(exports, module) {
    var runtime2 = typeof window !== "undefined" ? window.ElowenUiRuntime : void 0;
    if (!runtime2) throw new Error("elowen-plugin-ui-kit: window.ElowenUiRuntime is missing \u2014 plugin bundles only run inside the Elowen web app");
    module.exports = runtime2.react;
  }
});

// ../../elowen-plugins/node_modules/elowen-plugin-ui-kit/shims/jsx-runtime.cjs
var require_jsx_runtime = __commonJS({
  "../../elowen-plugins/node_modules/elowen-plugin-ui-kit/shims/jsx-runtime.cjs"(exports, module) {
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
var chatbotApi = {
  bots: () => "/plugins/chatbot/api/bots",
  conversations: (input) => `/plugins/chatbot/api/conversations?chatbotUserId=${input.chatbotUserId}&limit=${input.limit}&offset=${input.offset}`,
  conversation: (input) => `/plugins/chatbot/api/conversation?chatbotUserId=${input.chatbotUserId}&visitorId=${encodeURIComponent(input.visitorId)}`,
  stats: (input) => `/plugins/chatbot/api/stats?chatbotUserId=${input.chatbotUserId}&from=${input.from}&to=${input.to}`,
  /** The account's effective tool access, read from the host's own users panel route: the plugin reports
   *  what the account can reach rather than keeping an opinion of its own about it. */
  accountTools: (userId) => `/users/${userId}/tools`
};

// plugins/chatbot/web-src/ChatbotWorkspace.tsx
var import_react8 = __toESM(require_react(), 1);

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/createLucideIcon.js
var import_react2 = __toESM(require_react());

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/shared/src/utils.js
var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
var mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/Icon.js
var import_react = __toESM(require_react());

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/defaultAttributes.js
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

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/Icon.js
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

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/createLucideIcon.js
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

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/activity.js
var Activity = createLucideIcon("Activity", [
  [
    "path",
    {
      d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
      key: "169zse"
    }
  ]
]);

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/bot.js
var Bot = createLucideIcon("Bot", [
  ["path", { d: "M12 8V4H8", key: "hb8ula" }],
  ["rect", { width: "16", height: "12", x: "4", y: "8", rx: "2", key: "enze0r" }],
  ["path", { d: "M2 14h2", key: "vft8re" }],
  ["path", { d: "M20 14h2", key: "4cs60a" }],
  ["path", { d: "M15 13v2", key: "1xurst" }],
  ["path", { d: "M9 13v2", key: "rq6x2g" }]
]);

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/check.js
var Check = createLucideIcon("Check", [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]]);

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/clipboard-copy.js
var ClipboardCopy = createLucideIcon("ClipboardCopy", [
  ["rect", { width: "8", height: "4", x: "8", y: "2", rx: "1", ry: "1", key: "tgr4d6" }],
  ["path", { d: "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2", key: "4jdomd" }],
  ["path", { d: "M16 4h2a2 2 0 0 1 2 2v4", key: "3hqy98" }],
  ["path", { d: "M21 14H11", key: "1bme5i" }],
  ["path", { d: "m15 10-4 4 4 4", key: "5dvupr" }]
]);

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/coins.js
var Coins = createLucideIcon("Coins", [
  ["circle", { cx: "8", cy: "8", r: "6", key: "3yglwk" }],
  ["path", { d: "M18.09 10.37A6 6 0 1 1 10.34 18", key: "t5s6rm" }],
  ["path", { d: "M7 6h1v4", key: "1obek4" }],
  ["path", { d: "m16.71 13.88.7.71-2.82 2.82", key: "1rbuyh" }]
]);

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/external-link.js
var ExternalLink = createLucideIcon("ExternalLink", [
  ["path", { d: "M15 3h6v6", key: "1q9fwt" }],
  ["path", { d: "M10 14 21 3", key: "gplh6r" }],
  ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", key: "a6xqqp" }]
]);

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/gauge.js
var Gauge = createLucideIcon("Gauge", [
  ["path", { d: "m12 14 4-4", key: "9kzdfg" }],
  ["path", { d: "M3.34 19a10 10 0 1 1 17.32 0", key: "19p75a" }]
]);

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/layers.js
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

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/list-checks.js
var ListChecks = createLucideIcon("ListChecks", [
  ["path", { d: "m3 17 2 2 4-4", key: "1jhpwq" }],
  ["path", { d: "m3 7 2 2 4-4", key: "1obspn" }],
  ["path", { d: "M13 6h8", key: "15sg57" }],
  ["path", { d: "M13 12h8", key: "h98zly" }],
  ["path", { d: "M13 18h8", key: "oe0vm4" }]
]);

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/messages-square.js
var MessagesSquare = createLucideIcon("MessagesSquare", [
  ["path", { d: "M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z", key: "p1xzt8" }],
  ["path", { d: "M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1", key: "1cx29u" }]
]);

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/plus.js
var Plus = createLucideIcon("Plus", [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "M12 5v14", key: "s699le" }]
]);

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/power.js
var Power = createLucideIcon("Power", [
  ["path", { d: "M12 2v10", key: "mnfbl" }],
  ["path", { d: "M18.4 6.6a9 9 0 1 1-12.77.04", key: "obofu9" }]
]);

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/save.js
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

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/search.js
var Search = createLucideIcon("Search", [
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ["path", { d: "m21 21-4.3-4.3", key: "1qie3q" }]
]);

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/shield-check.js
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

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/trash-2.js
var Trash2 = createLucideIcon("Trash2", [
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", key: "4alrt4" }],
  ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", key: "v07s0e" }],
  ["line", { x1: "10", x2: "10", y1: "11", y2: "17", key: "1uufr5" }],
  ["line", { x1: "14", x2: "14", y1: "11", y2: "17", key: "xtxkd" }]
]);

// ../../elowen-plugins/node_modules/lucide-react/dist/esm/icons/triangle-alert.js
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
var import_react4 = __toESM(require_react(), 1);

// plugins/chatbot/web-src/format.ts
var formatDateTime = (value, locale) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "\u2014" : new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(date);
};
var formatDay = (day, locale) => {
  const date = /* @__PURE__ */ new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? day : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
};
var integer = (value, locale) => new Intl.NumberFormat(locale).format(value);
var money = (value, locale) => value == null ? "\u2014" : new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(value);
var seconds = (value, locale) => value == null ? "\u2014" : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} s`;

// plugins/chatbot/web-src/SecuritySettings.tsx
var import_react3 = __toESM(require_react(), 1);

// plugins/chatbot/src/publicContract.ts
var WIDGET_ASSET_NAME = "widget.js";
var MESSAGE_MAX_BYTES = 8 * 1024;
var VISITOR_TEXT_MAX_BYTES = 2 * 1024;
var PAGE_STATE_MAX_BYTES = MESSAGE_MAX_BYTES - VISITOR_TEXT_MAX_BYTES - 256;
var ACTION_KINDS = ["read", "focus", "click", "fill", "select", "scroll", "request_submit"];
var CONFIRMATION_ACTION_KIND = "request_submit";
var WIDGET_MAX_ACTIONS_PER_TURN = 20;
var PUBLIC_SEGMENTS = {
  visitors: "visitors",
  refresh: "refresh",
  turns: "turns",
  events: "events",
  actions: "actions",
  result: "result",
  confirmation: "confirmation",
  conversation: "conversation",
  widget: WIDGET_ASSET_NAME
};
var PUBLIC_PATHS = {
  visitors: PUBLIC_SEGMENTS.visitors,
  refresh: `${PUBLIC_SEGMENTS.visitors}/${PUBLIC_SEGMENTS.refresh}`,
  turns: PUBLIC_SEGMENTS.turns,
  conversation: PUBLIC_SEGMENTS.conversation,
  events: (turnId) => `${PUBLIC_SEGMENTS.turns}/${turnId}/${PUBLIC_SEGMENTS.events}`,
  actionResult: (turnId, actionId) => `${PUBLIC_SEGMENTS.turns}/${turnId}/${PUBLIC_SEGMENTS.actions}/${actionId}/${PUBLIC_SEGMENTS.result}`,
  actionDecision: (turnId, actionId) => `${PUBLIC_SEGMENTS.turns}/${turnId}/${PUBLIC_SEGMENTS.actions}/${actionId}/${PUBLIC_SEGMENTS.confirmation}`,
  widget: PUBLIC_SEGMENTS.widget
};
var ACTION_REFUSALS = [
  "unknown_action",
  "stale_snapshot",
  "unknown_target",
  "capability_not_granted",
  "submit_is_its_own_action",
  "not_a_submit_target",
  "invalid_value",
  "action_budget_exhausted"
];
var PAGE_FAILURE_DETAILS = [
  "target_gone",
  "no_form",
  "form_invalid",
  "action_failed",
  "widget_error",
  ...ACTION_REFUSALS
];
function requiresVisitorConfirmation(kind) {
  return kind === CONFIRMATION_ACTION_KIND;
}

// plugins/chatbot/web-src/SecuritySettings.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
function actionRuleKey(rule) {
  return `${rule.origin}${rule.pathPrefix} ${rule.action}`;
}
function draftRuleRefusal(draft, allowedOrigins, existing) {
  if (allowedOrigins.length === 0) return "no_origin";
  if (draft.origin === "") return "pick_origin";
  const path = draft.pathPrefix.trim();
  if (!path.startsWith("/") || /\s/.test(path) || path.includes("?") || path.includes("#")) return "bad_path";
  const limit = Number(draft.maxPerTurn);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > WIDGET_MAX_ACTIONS_PER_TURN) return "bad_limit";
  if (existing.some((rule) => actionRuleKey(rule) === actionRuleKey({ origin: draft.origin, pathPrefix: path, action: draft.action }))) return "duplicate";
  return null;
}
function SecuritySettings({ origins, rules, disabled, onChange }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("chatbot");
  const pathFieldId = (0, import_react3.useId)();
  const limitFieldId = (0, import_react3.useId)();
  const [origin, setOrigin] = (0, import_react3.useState)("");
  const [pathPrefix, setPathPrefix] = (0, import_react3.useState)("/");
  const [action, setAction] = (0, import_react3.useState)("read");
  const [requiresConfirmation, setRequiresConfirmation] = (0, import_react3.useState)(false);
  const [maxPerTurn, setMaxPerTurn] = (0, import_react3.useState)("1");
  const actionLabel = (kind) => s[`action_${kind}`] ?? kind;
  const refusal = draftRuleRefusal({ origin, pathPrefix, action, maxPerTurn }, origins, rules);
  const refusalText = refusal === null ? null : refusal === "no_origin" ? s.ruleOriginNone : refusal === "pick_origin" ? s.ruleOriginRequired : refusal === "bad_path" ? s.rulePathInvalid : refusal === "bad_limit" ? s.ruleLimitInvalid.replace("{max}", String(WIDGET_MAX_ACTIONS_PER_TURN)) : s.ruleDuplicate;
  const add = () => {
    if (refusal !== null) return;
    onChange([...rules, {
      origin,
      pathPrefix: pathPrefix.trim(),
      action,
      // A confirmation is only ever carried for the kind that IS one: the widget's protocol has no frame
      // for any other, and the server refuses such a rule outright.
      requiresConfirmation: requiresVisitorConfirmation(action) && requiresConfirmation,
      maxPerTurn: Number(maxPerTurn)
    }]);
    setPathPrefix("/");
    setRequiresConfirmation(false);
    setMaxPerTurn("1");
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    C.SettingsGroup,
    {
      title: s.securityTitle,
      description: s.securityHint,
      icon: ShieldCheck,
      actions: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.HelpTip, { align: "right", children: s.securityHelp }),
      children: [
        rules.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.SettingsRow, { label: s.rulesEmpty, description: s.rulesEmptyHint }) : rules.map((rule) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          C.SettingsRow,
          {
            label: `${rule.origin}${rule.pathPrefix}`,
            description: actionLabel(rule.action),
            status: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: rule.requiresConfirmation ? "warning" : "muted", children: rule.requiresConfirmation ? s.ruleNeedsConfirmation : s.ruleLimit.replace("{count}", String(rule.maxPerTurn)) }),
            actions: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              C.Button,
              {
                variant: "ghost-danger",
                icon: Trash2,
                disabled,
                "aria-label": s.ruleRemove.replace("{value}", actionRuleKey(rule)),
                onClick: () => onChange(rules.filter((candidate) => actionRuleKey(candidate) !== actionRuleKey(rule)))
              }
            )
          },
          actionRuleKey(rule)
        )),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mt-2 grid gap-3 rounded-xl border border-border bg-muted/20 p-3 sm:grid-cols-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.ruleOriginLabel, hint: s.ruleOriginHint, children: origins.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs text-muted-foreground", children: s.ruleOriginNone }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.SelectMenu, { value: origin, onChange: setOrigin, options: origins.map((value) => ({ value, label: value })), label: s.ruleOriginLabel }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.rulePathLabel, htmlFor: pathFieldId, hint: s.rulePathHint, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            C.Input,
            {
              id: pathFieldId,
              value: pathPrefix,
              onChange: (event) => setPathPrefix(event.target.value),
              placeholder: "/kontakt"
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.ruleActionLabel, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            C.SelectMenu,
            {
              value: action,
              onChange: (value) => setAction(value),
              options: ACTION_KINDS.map((kind) => ({ value: kind, label: actionLabel(kind) })),
              label: s.ruleActionLabel
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.ruleLimitLabel, htmlFor: limitFieldId, hint: s.ruleLimitHint, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            C.Input,
            {
              id: limitFieldId,
              type: "number",
              min: 1,
              max: WIDGET_MAX_ACTIONS_PER_TURN,
              value: maxPerTurn,
              onChange: (event) => setMaxPerTurn(event.target.value)
            }
          ) }),
          requiresVisitorConfirmation(action) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.ruleConfirmationLabel, hint: s.ruleConfirmationHint, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Toggle, { checked: requiresConfirmation, onChange: setRequiresConfirmation, label: s.ruleConfirmationLabel }) }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-wrap items-center gap-3 sm:col-span-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { icon: Plus, disabled: disabled || refusal !== null, onClick: add, children: s.ruleAdd }),
            refusalText === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs text-destructive", children: refusalText })
          ] })
        ] })
      ]
    }
  );
}

// plugins/chatbot/web-src/BotDetail.tsx
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
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
function statusText(bot, s) {
  if (bot.blockers.length > 0) return s.statusAttention;
  return bot.status === "enabled" ? s.statusEnabled : bot.status === "disabled" ? s.statusDisabled : s.statusDraft;
}
function AccountTools({ bot, requiredTools }) {
  const { components: C, hooks, utils, navigate } = runtime();
  const s = hooks.usePluginStrings("chatbot");
  const [tools, setTools] = (0, import_react4.useState)(null);
  const [loadError, setLoadError] = (0, import_react4.useState)(null);
  const load = (0, import_react4.useCallback)(() => {
    setLoadError(null);
    void apiJson(chatbotApi.accountTools(bot.chatbotUserId)).then(setTools).catch((error) => setLoadError(utils.apiErrorMessage(error) || s.toolsLoadError));
  }, [bot.chatbotUserId, s.toolsLoadError, utils]);
  (0, import_react4.useEffect)(() => {
    load();
  }, [load]);
  const reachable = (state) => state === "allowed" || state === "inherited";
  const usable = (tools ?? []).filter((tool) => reachable(tool.state));
  const missing = requiredTools.filter((name) => {
    const tool = (tools ?? []).find((candidate) => candidate.name === name);
    return tool === void 0 || !reachable(tool.state);
  });
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    C.SettingsGroup,
    {
      title: s.toolsTitle,
      description: s.toolsHint,
      icon: ListChecks,
      actions: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Button, { variant: "ghost", icon: ExternalLink, onClick: () => navigate("/users"), children: s.toolsManage }),
      children: [
        loadError !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.ErrorState, { message: `${s.toolsLoadError} \u2014 ${loadError}`, onRetry: load }) : tools === null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.LoadingLine, { layout: "block" }) : tools.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.EmptyState, { title: s.toolsEmptyTitle, description: s.toolsEmptyDescription, icon: ListChecks }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "mb-2 text-xs text-muted-foreground", children: s.toolsCount.replace("{n}", String(usable.length)).replace("{total}", String(tools.length)) }),
          tools.map((tool) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            C.SettingsRow,
            {
              label: tool.name,
              description: tool.plugin ?? s[`toolGroup_${tool.group}`] ?? tool.group,
              status: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Badge, { tone: reachable(tool.state) ? "success" : tool.state === "unavailable" ? "muted" : "warning", children: s[`toolState_${tool.state}`] ?? tool.state })
            },
            tool.name
          ))
        ] }),
        missing.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "mt-3 text-xs text-destructive", children: s.toolsMissing.replace("{names}", missing.join(", ")) })
      ]
    }
  );
}
function BotDetail({ bot, requiredTools, onChanged, unknownError }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("chatbot");
  const { locale } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const [displayName, setDisplayName] = (0, import_react4.useState)(bot.displayName);
  const [prompt, setPrompt] = (0, import_react4.useState)(bot.prompt);
  const [origins, setOrigins] = (0, import_react4.useState)(bot.origins);
  const [rules, setRules] = (0, import_react4.useState)(bot.actionRules);
  const [draftOrigin, setDraftOrigin] = (0, import_react4.useState)("");
  const [pending, setPending] = (0, import_react4.useState)(false);
  const [error, setError] = (0, import_react4.useState)(null);
  const [confirming, setConfirming] = (0, import_react4.useState)(null);
  (0, import_react4.useEffect)(() => {
    setDisplayName(bot.displayName);
    setPrompt(bot.prompt);
    setOrigins(bot.origins);
    setRules(bot.actionRules);
    setDraftOrigin("");
    setError(null);
    setConfirming(null);
  }, [bot.chatbotUserId]);
  (0, import_react4.useEffect)(() => {
    setDisplayName(bot.displayName);
    setPrompt(bot.prompt);
    setOrigins(bot.origins);
    setRules(bot.actionRules);
  }, [bot.updatedAt, bot.displayName, bot.prompt, bot.origins, bot.actionRules]);
  const rulesEqual = rules.map(actionRuleKey).join("\n") === bot.actionRules.map(actionRuleKey).join("\n");
  const dirty = displayName !== bot.displayName || prompt !== bot.prompt || origins.join("\n") !== bot.origins.join("\n") || !rulesEqual;
  const hint = originHint(draftOrigin, origins);
  const blockers = blockerText(bot.blockers, bot.projects.length, s);
  const save = async (action) => {
    setPending(true);
    setError(null);
    try {
      const answer = await apiJson(chatbotApi.bots(), jsonRequest("PATCH", {
        chatbotUserId: bot.chatbotUserId,
        expectedUpdatedAt: bot.updatedAt,
        displayName,
        prompt,
        origins,
        actionRules: rules,
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
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex flex-col gap-5", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex flex-wrap items-start justify-between gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "min-w-0", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { className: "truncate text-base font-semibold text-foreground", children: bot.displayName || s.botFallback }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "break-all font-mono text-[11px] text-subtle-foreground", children: bot.publicId })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Badge, { tone: bot.status === "enabled" && bot.blockers.length === 0 ? "success" : bot.blockers.length > 0 ? "warning" : void 0, children: statusText(bot, s) }),
        bot.status === "enabled" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Button, { variant: "ghost", icon: Power, disabled: pending, onClick: () => setConfirming("disable"), children: s.disableAction }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Button, { variant: "accent", icon: Power, disabled: pending || dirty, onClick: () => setConfirming("enable"), children: s.enableAction })
      ] })
    ] }),
    blockers.map((text) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground", children: text }, text)),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(C.SettingsGroup, { title: s.detailFactsTitle, description: s.detailFactsHint, columns: 1, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.SettingsRow, { label: s.detailAccount, status: bot.account === null ? "\u2014" : `@${bot.account.username}` }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.SettingsRow, { label: s.detailProject, status: bot.projects.length === 1 ? bot.projects[0].slug : "\u2014" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.SettingsRow, { label: s.detailPublicId, status: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "font-mono text-[11px]", children: bot.publicId }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.SettingsRow, { label: s.detailUpdated, status: formatDateTime(bot.updatedAt, locale) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.SettingsGroup, { title: s.promptLabel, description: s.promptHint, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.promptLabel, hint: s.promptHint, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "textarea",
      {
        value: prompt,
        onChange: (event) => setPrompt(event.target.value),
        rows: 5,
        placeholder: s.promptPlaceholder,
        className: "w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
      }
    ) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(C.SettingsGroup, { title: s.originsLabel, description: s.originsHint, children: [
      origins.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-xs text-muted-foreground", children: s.originsEmpty }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "flex flex-col gap-1", children: origins.map((origin) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-1.5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "break-all font-mono text-xs text-foreground", children: origin }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
      bot.insecureOrigins.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "mt-3 text-xs text-destructive", children: s.originsInsecure }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mt-3 flex flex-wrap items-end gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Field, { label: s.originsAdd, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          C.Input,
          {
            value: draftOrigin,
            placeholder: s.originsPlaceholder,
            onChange: (event) => setDraftOrigin(event.target.value)
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Button, { icon: Plus, disabled: pending || draftOrigin.trim() === "" || hint !== null, onClick: addOrigin, children: s.originsAdd })
      ] }),
      hint === "invalid" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "mt-2 text-xs text-destructive", children: s.originsInvalid }) : null,
      hint === "duplicate" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "mt-2 text-xs text-destructive", children: s.originsDuplicate }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SecuritySettings, { origins, rules, disabled: pending, onChange: setRules }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(AccountTools, { bot, requiredTools }),
    snippet === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(C.SettingsGroup, { title: s.embedTitle, description: s.embedHint, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { className: "overflow-x-auto rounded-lg bg-muted/40 p-3 font-mono text-[11px] text-foreground", children: snippet }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Button, { className: "mt-3", variant: "ghost", icon: ClipboardCopy, onClick: () => void copySnippet(), children: s.embedCopy })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex flex-wrap items-center gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Button, { variant: "accent", icon: dirty ? Save : Check, disabled: pending || !dirty, onClick: () => void save(null), children: pending ? s.saveSaving : s.saveAction }),
      error !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-xs text-destructive", role: "alert", children: error }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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

// plugins/chatbot/web-src/ConversationsView.tsx
var import_react5 = __toESM(require_react(), 1);
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
var PAGE_SIZE = 25;
var COLUMNS = "minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr) 4.5rem 7rem 1.25rem";
var COMPACT_COLUMNS = "minmax(0,1.5fr) minmax(0,1fr) 4.5rem 7rem 1.25rem";
var MOBILE_COLUMNS = "minmax(0,1fr) 4.5rem 1.25rem";
function ConversationsView({ bot }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("chatbot");
  const { locale } = hooks.useTranslation();
  const [answer, setAnswer] = (0, import_react5.useState)(null);
  const [loadError, setLoadError] = (0, import_react5.useState)(null);
  const [page, setPage] = (0, import_react5.useState)(0);
  const [open, setOpen] = (0, import_react5.useState)(null);
  (0, import_react5.useEffect)(() => {
    setPage(0);
    setOpen(null);
    setAnswer(null);
    setLoadError(null);
  }, [bot.chatbotUserId]);
  const load = (0, import_react5.useCallback)(() => {
    setLoadError(null);
    void apiJson(chatbotApi.conversations({
      chatbotUserId: bot.chatbotUserId,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE
    })).then(setAnswer).catch((error) => setLoadError(utils.apiErrorMessage(error) || s.conversationsLoadError));
  }, [bot.chatbotUserId, page, s.conversationsLoadError, utils]);
  (0, import_react5.useEffect)(() => {
    load();
  }, [load]);
  if (loadError !== null) {
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ErrorState, { message: `${s.conversationsLoadError} \u2014 ${loadError}`, onRetry: load });
  }
  if (answer === null) {
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.LoadingState, { variant: "list" });
  }
  if (answer.total === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.EmptyState, { title: s.conversationsEmptyTitle, description: s.conversationsEmptyDescription, icon: MessagesSquare });
  }
  const statusTone = (status) => status === "done" ? "success" : status === "error" ? "danger" : "warning";
  const statusLabel = (status) => s[`turnStatus_${status}`] ?? status;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTable, { ariaLabel: s.conversationsTab, columns: COLUMNS, compactColumns: COMPACT_COLUMNS, mobileColumns: MOBILE_COLUMNS, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTableRow, { header: true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, lines: 1, children: s.columnVisitor }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", children: s.columnFirstSeen }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", children: s.columnLastSeen }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, lines: 1, children: s.columnTurns }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, lines: 1, children: s.columnLastTurn }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableChevronCell, {})
      ] }),
      answer.conversations.map((conversation) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
        C.DataTableRow,
        {
          height: "tall",
          onOpen: () => setOpen(conversation),
          openLabel: s.openConversation.replace("{visitor}", conversation.visitorId),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { lines: 1, title: conversation.visitorId, className: "font-mono text-xs", children: conversation.visitorId }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { lines: 1, priority: "wide", children: formatDateTime(conversation.firstAt, locale) }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { lines: 1, priority: "wide", children: formatDateTime(conversation.lastAt, locale) }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTableCell, { lines: 1, children: [
              integer(conversation.turns, locale),
              conversation.errors > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "ml-1 text-destructive", children: [
                "(",
                integer(conversation.errors, locale),
                ")"
              ] }) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { lines: "auto", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { tone: statusTone(conversation.lastStatus), children: statusLabel(conversation.lastStatus) }) }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableChevronCell, {})
          ]
        },
        conversation.visitorId
      ))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      C.Pager,
      {
        page,
        pageSize: PAGE_SIZE,
        total: answer.total,
        onPageChange: setPage,
        ariaLabel: s.conversationsTab
      }
    ),
    open === null ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(TranscriptModal, { bot, conversation: open, onClose: () => setOpen(null) })
  ] });
}
function TranscriptModal({ bot, conversation, onClose }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("chatbot");
  const { locale } = hooks.useTranslation();
  const [answer, setAnswer] = (0, import_react5.useState)(null);
  const [loadError, setLoadError] = (0, import_react5.useState)(null);
  const load = (0, import_react5.useCallback)(() => {
    setLoadError(null);
    void apiJson(chatbotApi.conversation({
      chatbotUserId: bot.chatbotUserId,
      visitorId: conversation.visitorId
    })).then(setAnswer).catch((error) => setLoadError(utils.apiErrorMessage(error) || s.transcriptLoadError));
  }, [bot.chatbotUserId, conversation.visitorId, s.transcriptLoadError, utils]);
  (0, import_react5.useEffect)(() => {
    load();
  }, [load]);
  const statusLabel = (status) => s[`turnStatus_${status}`] ?? status;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    C.Modal,
    {
      size: "lg",
      title: s.transcriptTitle,
      description: conversation.visitorId,
      onClose,
      closeLabel: s.cancel,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ModalBody, { children: loadError !== null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ErrorState, { message: `${s.transcriptLoadError} \u2014 ${loadError}`, onRetry: load }) : answer === null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.LoadingLine, { layout: "block" }) : answer.turns.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.EmptyState, { title: s.transcriptEmptyTitle, description: s.transcriptEmptyDescription, icon: MessagesSquare }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ol", { className: "flex flex-col gap-4", "aria-label": s.transcriptTitle, children: answer.turns.map((turn) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { className: "rounded-xl border border-border bg-card p-3", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "text-[11px] uppercase tracking-wide text-subtle-foreground", children: [
            formatDateTime(turn.at, locale),
            " \xB7 ",
            statusLabel(turn.status)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mt-1 whitespace-pre-wrap text-sm text-foreground", children: turn.visitorText }),
          turn.reply === null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mt-2 text-xs italic text-muted-foreground", children: turn.errorCode === null ? s.transcriptNoReply : `${s.transcriptFailed}: ${turn.errorCode}` }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mt-2 whitespace-pre-wrap rounded-lg bg-muted/40 p-2 text-sm text-muted-foreground", children: turn.reply })
        ] }, turn.turnId)) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ModalFooter, { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "ghost", onClick: onClose, children: s.cancel }) })
      ]
    }
  );
}

// plugins/chatbot/web-src/CreateBotDialog.tsx
var import_react6 = __toESM(require_react(), 1);
var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
var NEXT_STEP = { account: "account", project: "project", grants: "grants", register: "register" };
function CreateBotDialog({ plugin, requiredTools, projects, candidates, onClose, onCreated }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("chatbot");
  const [mode, setMode] = (0, import_react6.useState)(candidates.length > 0 ? "existing" : "new");
  const [username, setUsername] = (0, import_react6.useState)("");
  const [accountId, setAccountId] = (0, import_react6.useState)(candidates[0] === void 0 ? "" : String(candidates[0].id));
  const [displayName, setDisplayName] = (0, import_react6.useState)("");
  const [projectId, setProjectId] = (0, import_react6.useState)(projects[0] === void 0 ? "" : String(projects[0].id));
  const [pending, setPending] = (0, import_react6.useState)(false);
  const [failure, setFailure] = (0, import_react6.useState)(null);
  const stepLabel = { account: s.stepAccount, project: s.stepProject, grants: s.stepGrants, register: s.stepRegister };
  const ready = projectId !== "" && (mode === "existing" ? accountId !== "" : username.trim() !== "");
  const grant = async (chatbotUserId) => {
    const users = await apiJson("/users");
    const account = users.find((candidate) => candidate.id === chatbotUserId);
    if (!account) throw new Error("account_unknown");
    const plugins = new Set(account.granted_plugins ?? []);
    plugins.add(plugin);
    const tools = new Set(account.allowed_tools ?? []);
    for (const tool of requiredTools) tools.add(tool);
    await apiJson(`/users/${chatbotUserId}`, jsonRequest("PATCH", {
      granted_plugins: [...plugins],
      allowed_tools: [...tools]
    }));
  };
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
        step = "grants";
      } catch (error) {
        setFailure({ step: "project", detail: utils.apiErrorMessage(error), chatbotUserId });
        setPending(false);
        return;
      }
    }
    if (step === "grants") {
      try {
        await grant(chatbotUserId);
        step = "register";
      } catch (error) {
        setFailure({ step: "grants", detail: utils.apiErrorMessage(error), chatbotUserId });
        setPending(false);
        return;
      }
    }
    try {
      const answer = await apiJson(chatbotApi.bots(), jsonRequest("POST", {
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
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
    C.Modal,
    {
      title: s.createTitle,
      onClose,
      closeLabel: s.cancel,
      closeDisabled: pending,
      ...pending ? { "aria-busy": true } : {},
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.ModalBody, { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex flex-col gap-4", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Field, { label: s.createModeLabel, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
          mode === "new" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Field, { label: s.createUsernameLabel, hint: s.createUsernameHint, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Input, { value: username, onChange: (event) => setUsername(event.target.value), disabled: pending || failure !== null }) }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Field, { label: s.createAccountLabel, hint: s.createAccountHint, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            C.SelectMenu,
            {
              value: accountId,
              onChange: (value) => setAccountId(value),
              options: accountOptions,
              label: s.createAccountLabel,
              disabled: pending || failure !== null
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Field, { label: s.createDisplayNameLabel, hint: s.createDisplayNameHint, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Input, { value: displayName, onChange: (event) => setDisplayName(event.target.value), disabled: pending }) }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Field, { label: s.createProjectLabel, hint: s.createProjectHint, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            C.SelectMenu,
            {
              value: projectId,
              onChange: (value) => setProjectId(value),
              options: projectOptions,
              label: s.createProjectLabel,
              disabled: pending || projects.length === 0 || failure !== null
            }
          ) }),
          failure === null ? null : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground", role: "alert", children: failure.chatbotUserId === null ? `${s.createFailed} \u2014 ${failure.detail}` : `${s.createPartial.replace("{step}", stepLabel[failure.step])} \u2014 ${failure.detail}` })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(C.ModalFooter, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Button, { variant: "ghost", onClick: onClose, disabled: pending, children: s.cancel }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Button, { variant: "accent", disabled: pending || !ready, onClick: () => void submit(), children: pending ? s.createPending : failure === null ? s.createSubmit : s.retry })
        ] })
      ]
    }
  );
}

// plugins/chatbot/web-src/StatsView.tsx
var import_react7 = __toESM(require_react(), 1);
var import_jsx_runtime5 = __toESM(require_jsx_runtime(), 1);
var WINDOW_DAYS = [7, 30, 90];
var USAGE_ROW_LIMIT = 500;
var SERIES_COLOURS = { turns: "var(--color-chart-1)", errors: "var(--color-chart-2)" };
function statsWindow(days, now) {
  const to = now.toISOString().slice(0, 10);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  const fromMs = toMs - (days - 1) * 864e5;
  return {
    from: new Date(fromMs).toISOString().slice(0, 10),
    to,
    fromMs,
    toMs: toMs + 86399999
  };
}
function chartPoints(days, from, to) {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const points = [];
  const end = Date.parse(`${to}T00:00:00.000Z`);
  for (let at = Date.parse(`${from}T00:00:00.000Z`); at <= end; at += 864e5) {
    const day = new Date(at).toISOString().slice(0, 10);
    const row = byDay.get(day);
    points.push({ label: day, turns: row?.turns ?? 0, errors: row?.errors ?? 0 });
  }
  return points;
}
function StatsView({ bot }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("chatbot");
  const { locale } = hooks.useTranslation();
  const [days, setDays] = (0, import_react7.useState)("30");
  const [answer, setAnswer] = (0, import_react7.useState)(null);
  const [loadError, setLoadError] = (0, import_react7.useState)(null);
  const window2 = (0, import_react7.useMemo)(() => statsWindow(Number(days), /* @__PURE__ */ new Date()), [days]);
  (0, import_react7.useEffect)(() => {
    setAnswer(null);
    setLoadError(null);
  }, [bot.chatbotUserId, window2.from, window2.to]);
  const load = (0, import_react7.useCallback)(() => {
    setLoadError(null);
    void apiJson(chatbotApi.stats({
      chatbotUserId: bot.chatbotUserId,
      from: window2.from,
      to: window2.to
    })).then(setAnswer).catch((error) => setLoadError(utils.apiErrorMessage(error) || s.statsLoadError));
  }, [bot.chatbotUserId, s.statsLoadError, utils, window2.from, window2.to]);
  (0, import_react7.useEffect)(() => {
    load();
  }, [load]);
  const usage = hooks.useUsageByOrigin("pair", { fromMs: window2.fromMs, toMs: window2.toMs }, { limit: USAGE_ROW_LIMIT });
  const spend = (usage.data?.rows ?? []).find((row) => row.userId === bot.chatbotUserId) ?? null;
  const points = answer === null ? [] : chartPoints(answer.days, answer.from, answer.to);
  const series = [
    { key: "turns", label: s.chartTurns, colour: SERIES_COLOURS.turns, variant: "bar", axis: "left", format: (value) => integer(value, locale) },
    { key: "errors", label: s.chartErrors, colour: SERIES_COLOURS.errors, variant: "line", axis: "left", format: (value) => integer(value, locale) }
  ];
  const picker = /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "min-w-[12rem] max-w-xs", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
    C.SelectMenu,
    {
      value: days,
      onChange: setDays,
      options: WINDOW_DAYS.map((value) => ({ value: String(value), label: s.statsWindowDays.replace("{count}", String(value)) })),
      label: s.statsWindowLabel,
      variant: "line"
    }
  ) });
  if (loadError !== null) {
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "flex flex-col gap-4", children: [
      picker,
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.ErrorState, { message: `${s.statsLoadError} \u2014 ${loadError}`, onRetry: load })
    ] });
  }
  if (answer === null) {
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "flex flex-col gap-4", children: [
      picker,
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.LoadingState, { variant: "block" })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "flex flex-col gap-5", children: [
    picker,
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsGroup, { title: s.chartTitle, description: s.chartHint, icon: Activity, children: answer.totals.turns === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.EmptyState, { title: s.statsEmptyTitle, description: s.statsEmptyDescription, icon: Activity }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.TimeSeriesChart, { data: points, series, height: 240, ariaLabel: s.chartTitle, emptyText: s.chartEmpty }) }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(C.SettingsGroup, { title: s.totalsTitle, description: s.totalsHint, icon: Gauge, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.totalTurns, status: integer(answer.totals.turns, locale) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.totalDone, status: integer(answer.totals.done, locale) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.totalErrors, status: integer(answer.totals.errors, locale) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.totalQueued, description: s.totalQueuedHint, status: integer(answer.totals.queued, locale) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.totalRunning, status: integer(answer.totals.running, locale) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        C.SettingsRow,
        {
          label: s.queueWait,
          description: s.queueWaitHint,
          hint: s.queueWaitHelp,
          status: answer.queueWait.samples === 0 ? "\u2014" : `${s.queueWaitP50}: ${seconds(answer.queueWait.p50Seconds, locale)} \xB7 ${s.queueWaitP95}: ${seconds(answer.queueWait.p95Seconds, locale)}`
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(C.SettingsGroup, { title: s.spendTitle, description: s.spendHint, icon: Coins, children: [
      usage.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.LoadingLine, { layout: "block" }) : usage.isError ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.ErrorState, { message: s.spendLoadError }) : spend === null ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.EmptyState, { title: s.spendEmptyTitle, description: s.spendEmptyDescription, icon: Coins }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.spendTurns, status: integer(spend.turns, locale) }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.spendTokens, status: integer(spend.tokens, locale) }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          C.SettingsRow,
          {
            label: s.spendCost,
            description: s.spendCostHint,
            status: money(spend.cost, locale)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.spendPricedTurns, description: s.spendPricedTurnsHint, status: `${integer(spend.costedTurns, locale)} / ${integer(spend.turns, locale)}` }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.spendOrigins, description: s.spendOriginsHint, status: integer(spend.origins, locale) }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.spendFirst, status: formatDateTime(new Date(spend.firstAt).toISOString(), locale) }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.spendLast, status: formatDateTime(new Date(spend.lastAt).toISOString(), locale) })
      ] }),
      usage.data?.trackingSince == null ? null : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "mt-3 text-xs text-muted-foreground", children: s.spendTrackingSince.replace("{day}", formatDay(usage.data.trackingSince, locale)) })
    ] })
  ] });
}

// plugins/chatbot/web-src/ChatbotWorkspace.tsx
var import_jsx_runtime6 = __toESM(require_jsx_runtime(), 1);
var REGISTER_COLUMNS = "minmax(0,2fr) minmax(0,1.2fr) minmax(0,1fr) 8rem 1.25rem";
var REGISTER_COMPACT_COLUMNS = "minmax(0,2fr) minmax(0,1fr) 8rem 1.25rem";
var REGISTER_MOBILE_COLUMNS = "minmax(0,1fr) 8rem 1.25rem";
function ChatbotWorkspace({ plugin }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("chatbot");
  const [answer, setAnswer] = (0, import_react8.useState)(null);
  const [loadError, setLoadError] = (0, import_react8.useState)(null);
  const [tab, setTab] = (0, import_react8.useState)("bots");
  const [search, setSearch] = (0, import_react8.useState)("");
  const [filter, setFilter] = (0, import_react8.useState)("all");
  const [selectedId, setSelectedId] = (0, import_react8.useState)(null);
  const [creating, setCreating] = (0, import_react8.useState)(false);
  const load = (0, import_react8.useCallback)(() => {
    setLoadError(null);
    void apiJson(chatbotApi.bots()).then((value) => setAnswer(value)).catch((error) => setLoadError(utils.apiErrorMessage(error) || s.botsLoadError));
  }, [s.botsLoadError, utils]);
  (0, import_react8.useEffect)(() => {
    load();
  }, [load]);
  const bots = (0, import_react8.useMemo)(() => answer?.bots ?? [], [answer]);
  const replaceBot = (updated) => {
    setAnswer((current) => current === null ? current : {
      ...current,
      bots: current.bots.map((candidate) => candidate.chatbotUserId === updated.chatbotUserId ? updated : candidate)
    });
  };
  const visible = (0, import_react8.useMemo)(() => bots.filter((bot) => {
    if (filter === "enabled" && bot.status !== "enabled") return false;
    if (filter === "not_enabled" && bot.status === "enabled") return false;
    if (filter === "attention" && bot.blockers.length === 0) return false;
    const needle = search.trim().toLowerCase();
    if (needle === "") return true;
    const haystack = `${bot.displayName} ${bot.publicId} ${bot.account?.username ?? ""} ${bot.projects.map((project) => project.slug).join(" ")}`;
    return haystack.toLowerCase().includes(needle);
  }), [bots, filter, search]);
  const selected = bots.find((bot) => bot.chatbotUserId === selectedId) ?? visible[0] ?? bots[0] ?? null;
  const enabledCount = bots.filter((bot) => bot.status === "enabled").length;
  const attentionCount = bots.filter((bot) => bot.blockers.length > 0).length;
  const filterOptions = [
    { value: "all", label: s.filterAll, icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Layers, { size: 14 }) },
    { value: "enabled", label: s.filterEnabled, icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Bot, { size: 14 }) },
    { value: "not_enabled", label: s.filterNotEnabled, icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Bot, { size: 14 }) },
    { value: "attention", label: s.filterAttention, icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(TriangleAlert, { size: 14 }) }
  ];
  const toolbarFilters = [{
    id: "state",
    label: s.botsFilter,
    control: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
    status: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "workspace-status", children: loadError === null ? s.workspaceReady : s.workspaceSetup }),
    action: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.Button, { variant: "accent", icon: Plus, onClick: () => setCreating(true), children: s.newBot }),
    metrics: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.WorkspaceMetric, { label: s.metricBots, value: answer === null ? "\u2014" : bots.length, icon: Bot }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.WorkspaceMetric, { label: s.metricEnabled, value: answer === null ? "\u2014" : enabledCount, icon: ListChecks }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.WorkspaceMetric, { label: s.metricIncomplete, value: answer === null ? "\u2014" : attentionCount, icon: TriangleAlert })
    ] })
  };
  const register = /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(C.ControlSurfaceRegister, { className: "grid min-h-[31rem] grid-cols-1 gap-4 p-4 lg:!grid-cols-[22rem_minmax(0,1fr)] lg:items-start", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "min-w-0", children: visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.EmptyState, { title: s.botsNoResults, description: s.botsNoResultsDescription, icon: Search }) }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
      C.DataTable,
      {
        ariaLabel: s.workspaceTabBots,
        columns: REGISTER_COLUMNS,
        compactColumns: REGISTER_COMPACT_COLUMNS,
        mobileColumns: REGISTER_MOBILE_COLUMNS,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(C.DataTableRow, { header: true, children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.DataTableCell, { header: true, lines: 1, children: s.columnBot }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", children: s.columnAccount }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.DataTableCell, { header: true, lines: 1, priority: "wide", children: s.columnProject }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.DataTableCell, { header: true, lines: 1, children: s.columnStatus }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.DataTableChevronCell, {})
          ] }),
          visible.map((bot) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
            C.DataTableRow,
            {
              selected: selected?.chatbotUserId === bot.chatbotUserId,
              onOpen: () => setSelectedId(bot.chatbotUserId),
              openLabel: s.openBot.replace("{name}", bot.displayName || s.botFallback),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.DataTableCell, { lines: 1, children: bot.displayName || s.botFallback }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.DataTableCell, { lines: 1, priority: "wide", children: bot.account === null ? "\u2014" : `@${bot.account.username}` }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.DataTableCell, { lines: 1, priority: "wide", children: bot.projects.length === 1 ? bot.projects[0].slug : "\u2014" }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.DataTableCell, { lines: "auto", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.Badge, { tone: bot.blockers.length > 0 ? "warning" : bot.status === "enabled" ? "success" : void 0, children: statusText(bot, s) }) }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.DataTableChevronCell, {})
              ]
            },
            bot.chatbotUserId
          ))
        ]
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "min-w-0", children: selected === null ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "text-sm text-muted-foreground", children: s.detailSelectHint }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(BotDetail, { bot: selected, requiredTools: answer?.requiredTools ?? [], onChanged: replaceBot, unknownError: s.saveFailed }) })
  ] });
  const scoped = /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.ControlSurfaceRegister, { className: "flex min-h-[31rem] flex-col gap-4 p-4", children: selected === null ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.EmptyState, { title: s.botsEmptyTitle, description: s.botsEmptyDescription, icon: Bot }) }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "max-w-sm min-w-[14rem]", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      C.SelectMenu,
      {
        value: String(selected.chatbotUserId),
        onChange: (value) => setSelectedId(Number(value)),
        options: bots.map((bot) => ({ value: String(bot.chatbotUserId), label: bot.displayName || s.botFallback })),
        label: s.scopedBotLabel,
        variant: "line"
      }
    ) }),
    tab === "conversations" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ConversationsView, { bot: selected }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(StatsView, { bot: selected })
  ] }) });
  const body = loadError !== null ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.ControlSurfaceState, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.ErrorState, { message: `${s.botsLoadError} \u2014 ${loadError}`, onRetry: load }) }) }) : answer === null ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.LoadingState, { variant: "list" }) }) }) : bots.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.EmptyState, { title: s.botsEmptyTitle, description: s.botsEmptyDescription, icon: Bot }) }) }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.ControlSurfaceDocument, { children: tab === "bots" ? register : scoped });
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
    C.WorkspaceShell,
    {
      variant: "register",
      hero,
      navigation: {
        sections: [
          { id: "bots", label: s.workspaceTabBots, icon: Bot },
          { id: "conversations", label: s.workspaceTabConversations, icon: MessagesSquare },
          { id: "statistics", label: s.workspaceTabStatistics, icon: Activity }
        ],
        value: tab,
        onChange: (next) => setTab(next),
        ariaLabel: s.title
      },
      toolbar: answer === null || bots.length === 0 || tab !== "bots" ? void 0 : {
        search: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
        creating && answer !== null ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          CreateBotDialog,
          {
            plugin,
            requiredTools: answer.requiredTools,
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
