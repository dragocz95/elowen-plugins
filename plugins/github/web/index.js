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

// plugins/github/web-src/GitHubConnectionPanel.tsx
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

// node_modules/lucide-react/dist/esm/icons/git-fork.js
var GitFork = createLucideIcon("GitFork", [
  ["circle", { cx: "12", cy: "18", r: "3", key: "1mpf1b" }],
  ["circle", { cx: "6", cy: "6", r: "3", key: "1lh9wr" }],
  ["circle", { cx: "18", cy: "6", r: "3", key: "1h7g24" }],
  ["path", { d: "M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9", key: "1uq4wg" }],
  ["path", { d: "M12 12v3", key: "158kv8" }]
]);

// node_modules/lucide-react/dist/esm/icons/git-pull-request.js
var GitPullRequest = createLucideIcon("GitPullRequest", [
  ["circle", { cx: "18", cy: "18", r: "3", key: "1xkwt0" }],
  ["circle", { cx: "6", cy: "6", r: "3", key: "1lh9wr" }],
  ["path", { d: "M13 6h3a2 2 0 0 1 2 2v7", key: "1yeb86" }],
  ["line", { x1: "6", x2: "6", y1: "9", y2: "21", key: "rroup" }]
]);

// node_modules/lucide-react/dist/esm/icons/github.js
var Github = createLucideIcon("Github", [
  [
    "path",
    {
      d: "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4",
      key: "tonef"
    }
  ],
  ["path", { d: "M9 18c-4.51 2-5-2-7-2", key: "9comsn" }]
]);

// node_modules/lucide-react/dist/esm/icons/hash.js
var Hash = createLucideIcon("Hash", [
  ["line", { x1: "4", x2: "20", y1: "9", y2: "9", key: "4lhtct" }],
  ["line", { x1: "4", x2: "20", y1: "15", y2: "15", key: "vyu0kd" }],
  ["line", { x1: "10", x2: "8", y1: "3", y2: "21", key: "1ggp8o" }],
  ["line", { x1: "16", x2: "14", y1: "3", y2: "21", key: "weycgp" }]
]);

// node_modules/lucide-react/dist/esm/icons/link-2.js
var Link2 = createLucideIcon("Link2", [
  ["path", { d: "M9 17H7A5 5 0 0 1 7 7h2", key: "8i5ue5" }],
  ["path", { d: "M15 7h2a5 5 0 1 1 0 10h-2", key: "1b9ql8" }],
  ["line", { x1: "8", x2: "16", y1: "12", y2: "12", key: "1jonct" }]
]);

// plugins/github/web-src/runtime.ts
function runtime() {
  const value = window.ElowenUiRuntime;
  if (!value) throw new Error("ElowenUiRuntime is not installed");
  return value;
}
function registerGitHubUi(account, project) {
  window.__elowenRegisterPluginUi?.("github", {
    requiresApiVersion: 6,
    account: { connection: account },
    project: { repository: project }
  });
}
function jsonBody(value) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
}
function localizedError(error, strings) {
  const code = runtime().utils.apiErrorMessage(error);
  return strings[`error_${code}`] || code || strings.errorFallback || "The GitHub operation failed.";
}

// plugins/github/web-src/GitHubConnectionPanel.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var STATUS_KEY = ["plugin", "github", "status"];
function GitHubConnectionPanel({ onChanged, surface }) {
  const { components: C, hooks, api, utils } = runtime();
  const s = hooks.usePluginStrings("github");
  const { toast } = hooks.useToast();
  const qc = hooks.useQueryClient();
  const status = hooks.useQuery({ queryKey: STATUS_KEY, queryFn: () => api("/plugins/github/api/status") });
  const [pending, setPending] = (0, import_react3.useState)(null);
  const [flow, setFlow] = (0, import_react3.useState)(null);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: STATUS_KEY });
    await onChanged?.();
  };
  const connect = hooks.useMutation({
    mutationFn: (value) => api("/plugins/github/api/auth/start", jsonBody(value)),
    onSuccess: (value) => setFlow(value),
    onError: (error) => toast(localizedError(error, s), "error")
  });
  const flowStatus = hooks.useQuery({
    queryKey: ["plugin", "github", "auth", flow?.flowId],
    queryFn: () => api(`/plugins/github/api/auth/status?flowId=${encodeURIComponent(flow.flowId)}`),
    enabled: !!flow,
    refetchInterval: flow ? 2e3 : false
  });
  const cancel = hooks.useMutation({
    mutationFn: (flowId) => api("/plugins/github/api/auth/cancel", jsonBody({ flowId })),
    onSuccess: async (value) => {
      setFlow(null);
      await refresh();
      toast(value.status === "connected" ? s.connectionComplete : s.connectionCancelled);
    },
    onError: (error) => toast(localizedError(error, s), "error")
  });
  const preview = hooks.useMutation({
    mutationFn: (action) => api("/plugins/github/api/actions/preview", jsonBody(action)),
    onSuccess: (value, action) => setPending({ action, preview: value }),
    onError: (error) => toast(localizedError(error, s), "error")
  });
  const confirm = hooks.useMutation({
    mutationFn: (value) => api("/plugins/github/api/actions/confirm", jsonBody({ ...value.action, confirmationToken: value.token })),
    onSuccess: async () => {
      setPending(null);
      await refresh();
      toast(s.actionComplete);
    },
    onError: (error) => toast(localizedError(error, s), "error")
  });
  const test = hooks.useMutation({
    mutationFn: () => api("/plugins/github/api/test", jsonBody({})),
    onSuccess: () => toast(s.connectionHealthy),
    onError: (error) => toast(localizedError(error, s), "error")
  });
  (0, import_react3.useEffect)(() => {
    const persisted = status.data?.flow;
    if (!flow && persisted?.flowId && persisted.verificationUrl && persisted.userCode && (persisted.status === "pending" || persisted.status === "completing")) {
      setFlow({ flowId: persisted.flowId, verificationUrl: persisted.verificationUrl, userCode: persisted.userCode, expiresAt: persisted.expiresAt });
    }
  }, [flow, status.data?.flow]);
  (0, import_react3.useEffect)(() => {
    const state = flowStatus.data?.status;
    if (!state || state === "pending" || state === "completing") return;
    setFlow(null);
    void refresh();
    if (state === "connected") toast(s.connectionComplete);
    else if (state === "cancelled") toast(s.connectionCancelled);
    else if (state === "expired") toast(s.connectionExpired, "error");
    else toast(s.connectionFailed, "error");
  }, [flowStatus.data?.status]);
  (0, import_react3.useEffect)(() => {
    if (!flow || !flowStatus.isError) return;
    const statusCode = flowStatus.error && typeof flowStatus.error === "object" && "status" in flowStatus.error ? Number(flowStatus.error.status) : 0;
    if (statusCode !== 404 && utils.apiErrorMessage(flowStatus.error) !== "flow_not_found") return;
    setFlow(null);
    void refresh();
    toast(s.connectionFailed, "error");
  }, [flow, flowStatus.isError, flowStatus.error]);
  if (status.isError) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ErrorState, { message: s.loadError, onRetry: () => status.refetch() });
  if (status.isLoading) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.LoadingState, { variant: "detail" });
  const account = status.data?.account;
  const beginConnect = () => connect.mutate(status.data?.reconnectRequired ? { reconnect: true } : {});
  const completePending = () => {
    if (!pending) return;
    if (pending.action.type === "replace_identity") {
      connect.mutate({ replaceIdentity: true, confirmationToken: pending.preview.confirmationToken });
      setPending(null);
      return;
    }
    confirm.mutate({ action: pending.action, token: pending.preview.confirmationToken });
  };
  if (flow) {
    const state = flowStatus.data?.status;
    const terminal = state === "cancelled" || state === "expired" || state === "failed" || state === "interrupted";
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "space-y-4", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rounded-xl border border-border bg-surface p-4", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "text-sm font-semibold text-text", children: s.waitingForGitHub }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mt-3 text-xs text-text-muted", children: s.deviceCode }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { className: "mt-1 block rounded-lg bg-bg px-3 py-2 text-center text-lg font-semibold tracking-[0.2em] text-text", children: flow.userCode }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { className: "mt-3 inline-flex text-sm font-medium text-accent hover:underline", href: flow.verificationUrl, target: "_blank", rel: "noreferrer", children: s.verifyOnGitHub }),
        state === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-3 text-sm text-danger", children: s.connectionFailed }) : null,
        state === "expired" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-3 text-sm text-danger", children: s.connectionExpired }) : null,
        state === "cancelled" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-3 text-sm text-text-muted", children: s.connectionCancelled }) : null,
        state === "interrupted" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-3 text-sm text-danger", children: s.connectionFailed }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex flex-wrap gap-2", children: !terminal ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "ghost", onClick: () => cancel.mutate(flow.flowId), disabled: cancel.isPending, children: s.cancelConnection }) : null })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    status.data?.connected && account ? (
      /* Shaped exactly like the Account profile section: the connected identity leads, above a card of
         plain rows. The avatar is GitHub's, so it is an <img> rather than the host Avatar, which renders
         an Elowen account. */
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.SpatialIdentity, { actions: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "spatial-inline-action", onClick: () => test.mutate(), disabled: test.isPending, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Github, { size: 14, "aria-hidden": true }),
            s.testConnection
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "spatial-inline-action", onClick: () => preview.mutate({ type: "replace_identity" }), children: s.replaceIdentity }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "spatial-inline-action text-danger", onClick: () => preview.mutate({ type: "disconnect" }), children: s.disconnect })
        ] }), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center gap-4", children: [
          account.avatarUrl ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { src: account.avatarUrl, alt: "", className: "size-[72px] shrink-0 rounded-full border border-border object-cover" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Github, { className: "size-[72px] shrink-0 rounded-full border border-border p-4 text-text-muted" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex min-w-0 flex-1 flex-col gap-1", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "truncate text-lg font-semibold text-text", children: account.name || account.login }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: status.data.reconnectRequired ? "danger" : "success", children: status.data.reconnectRequired ? s.reconnectRequired : s.connected })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "truncate font-mono text-xs text-text-muted", children: [
              "@",
              account.login
            ] })
          ] })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.PluginSection, { surface: surface ?? "deck", title: s.accountTitle || s.title, description: s.accountHint || s.intro, icon: Github, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.SettingsRow, { label: s.mappings, icon: GitFork, status: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "font-mono", children: status.data.mappings }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            C.SettingsRow,
            {
              label: "GitHub ID",
              icon: Hash,
              status: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "font-mono", children: account.githubUserId })
            }
          )
        ] })
      ] })
    ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.EmptyState, { title: status.data?.reconnectRequired ? s.reconnectRequired : s.disconnected, description: s.intro, icon: Github, action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "accent", onClick: beginConnect, disabled: connect.isPending, children: status.data?.reconnectRequired ? s.reconnect : s.connect }) }),
    pending ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ConfirmDialog, { open: true, title: pending.preview.title || s.confirmExternal, description: `${pending.preview.description}

${s.confirmationExpires}`, confirmLabel: s.confirm, onClose: () => setPending(null), onConfirm: completePending }) : null
  ] });
}

// plugins/github/web-src/GitHubAccountPanel.tsx
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
function GitHubAccountPanel({ surface }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "flex min-w-0 flex-col gap-6", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(GitHubConnectionPanel, { surface }) });
}

// plugins/github/web-src/GitHubProjectPanel.tsx
var import_react4 = __toESM(require_react(), 1);
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
var REPOSITORIES_KEY = ["plugin", "github", "repositories"];
function GitHubProjectPanel({ project }) {
  const { components: C, hooks, api, utils, navigate } = runtime();
  const s = hooks.usePluginStrings("github");
  const { toast } = hooks.useToast();
  const qc = hooks.useQueryClient();
  const status = hooks.useQuery({ queryKey: STATUS_KEY, queryFn: () => api("/plugins/github/api/status") });
  const connected = status.data?.connected === true;
  const repositories = hooks.useQuery({
    queryKey: REPOSITORIES_KEY,
    queryFn: () => api("/plugins/github/api/repositories"),
    enabled: connected
  });
  const row = repositories.data?.repositories.find((candidate) => candidate.project.id === project.id) ?? null;
  const mapped = row?.mapping?.active === true;
  const pulls = hooks.useQuery({
    queryKey: ["plugin", "github", "pulls", String(project.id), "open"],
    queryFn: () => api(`/plugins/github/api/pull-requests?projectId=${project.id}&state=open`),
    enabled: connected && mapped
  });
  const sessions = hooks.useQuery({
    queryKey: ["brain", "sessions", "github"],
    queryFn: () => api("/brain/sessions"),
    enabled: connected && mapped
  });
  const [mapping, setMapping] = (0, import_react4.useState)(null);
  const [selectedPr, setSelectedPr] = (0, import_react4.useState)(null);
  const [pending, setPending] = (0, import_react4.useState)(null);
  const [sessionId, setSessionId] = (0, import_react4.useState)("");
  const [createOpen, setCreateOpen] = (0, import_react4.useState)(false);
  const [createForm, setCreateForm] = (0, import_react4.useState)({ title: "", body: "", base: "main" });
  const [reviewForm, setReviewForm] = (0, import_react4.useState)({ event: "APPROVE", body: "" });
  const [mergeMethod, setMergeMethod] = (0, import_react4.useState)("squash");
  const selected = (0, import_react4.useMemo)(() => (pulls.data?.pullRequests ?? []).find((pull) => pull.number === selectedPr) ?? null, [pulls.data, selectedPr]);
  const pullDetail = hooks.useQuery({
    queryKey: ["plugin", "github", "pull", String(project.id), selectedPr],
    queryFn: () => api(`/plugins/github/api/pull-request?projectId=${project.id}&number=${selectedPr}`),
    enabled: connected && mapped && selectedPr !== null
  });
  const checks = hooks.useQuery({
    queryKey: ["plugin", "github", "checks", String(project.id), selectedPr],
    queryFn: () => api(`/plugins/github/api/checks?projectId=${project.id}&number=${selectedPr}`),
    enabled: connected && mapped && selectedPr !== null
  });
  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: STATUS_KEY }),
      qc.invalidateQueries({ queryKey: REPOSITORIES_KEY }),
      qc.invalidateQueries({ queryKey: ["plugin", "github", "pulls"] })
    ]);
  };
  const mutation = (fn, success) => hooks.useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await invalidate();
      if (success) toast(success);
    },
    onError: (error) => toast(localizedError(error, s), "error")
  });
  const saveMap = mutation((value) => api("/plugins/github/api/repositories/map", jsonBody(value)), s.mappingSaved);
  const preview = hooks.useMutation({
    mutationFn: (action) => api("/plugins/github/api/actions/preview", jsonBody(action)),
    onSuccess: (value, action) => setPending({ action, preview: value }),
    onError: (error) => toast(localizedError(error, s), "error")
  });
  const confirm = hooks.useMutation({
    mutationFn: (value) => api("/plugins/github/api/actions/confirm", jsonBody({ ...value.action, confirmationToken: value.token })),
    onSuccess: async () => {
      setPending(null);
      setCreateOpen(false);
      await invalidate();
      toast(s.actionComplete);
    },
    onError: async (error) => {
      const code = utils.apiErrorMessage(error);
      const statusCode = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
      if (code === "state_changed" || code === "head_changed" || statusCode === 409) {
        setPending(null);
        await Promise.all([
          qc.invalidateQueries({ queryKey: REPOSITORIES_KEY }),
          qc.invalidateQueries({ queryKey: ["plugin", "github", "pulls"] }),
          qc.invalidateQueries({ queryKey: ["plugin", "github", "pull"] }),
          qc.invalidateQueries({ queryKey: ["plugin", "github", "checks"] })
        ]);
      }
      toast(localizedError(error, s), "error");
    }
  });
  if (status.isError) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ErrorState, { message: s.loadError, onRetry: () => status.refetch() });
  if (status.isLoading) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.LoadingState, { variant: "list" });
  if (!connected) {
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "py-4", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.EmptyState, { title: s.disconnected, description: s.accountHint, icon: Github, action: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "accent", icon: Github, onClick: () => navigate("/account"), children: s.manageInAccount }) }) });
  }
  if (repositories.isError) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ErrorState, { message: s.loadError, onRetry: () => repositories.refetch() });
  if (repositories.isLoading || !row) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.LoadingState, { variant: "list" });
  const mappingLabel = row.mapping ? `${row.mapping.baseOwner}/${row.mapping.baseName}` : row.detected.base ? `${row.detected.base.owner}/${row.detected.base.name}` : "\u2014";
  const pushLabel = row.mapping ? `${row.mapping.pushOwner}/${row.mapping.pushName}` : row.detected.push ? `${row.detected.push.owner}/${row.detected.push.name}` : "\u2014";
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "space-y-4 py-4", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "rounded-xl border border-border bg-surface p-4", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex items-start justify-between gap-3", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "min-w-0", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { className: "text-sm font-semibold text-text", children: s.projectRepository }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mt-1 truncate font-mono text-xs text-text-muted", children: mappingLabel }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "mt-1 truncate font-mono text-[11px] text-text-muted", children: [
              s.pushRepository,
              ": ",
              pushLabel
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { tone: mapped ? "success" : row.detected.ambiguous ? "warning" : "neutral", children: mapped ? s.mappingHealthy : s.mappingMissing })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "mt-4 flex flex-wrap gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { icon: Link2, onClick: () => setMapping(mappingFrom(row)), children: s.map }),
          row.mapping ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("a", { href: `https://github.com/${encodeURIComponent(row.mapping.baseOwner)}/${encodeURIComponent(row.mapping.baseName)}`, target: "_blank", rel: "noreferrer", className: "inline-flex h-9 items-center text-xs font-medium text-accent hover:underline", children: s.openGitHub }) : null
        ] })
      ] }),
      mapped ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-col gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.SelectMenu, { value: sessionId, onChange: setSessionId, label: s.conversation, options: (sessions.data ?? []).map((session) => ({ value: session.id, label: session.title })) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-wrap gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { onClick: () => preview.mutate({ type: "publish", projectId: project.id, sessionId }), disabled: !sessionId, children: s.publish }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "accent", onClick: () => setCreateOpen(true), disabled: !sessionId, children: s.createPullRequest })
          ] })
        ] }),
        pulls.isError ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ErrorState, { message: s.loadError, onRetry: () => pulls.refetch() }) : pulls.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.LoadingState, { variant: "list" }) : (pulls.data?.pullRequests ?? []).length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.EmptyState, { title: s.noPullRequests, icon: GitPullRequest }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTable, { ariaLabel: s.tabPullRequests, columns: "minmax(0,1fr) minmax(8rem,.5fr)", compactColumns: "minmax(0,1fr)", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTableRow, { header: true, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, children: s.columnPullRequest }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, priority: "wide", children: s.columnChecks })
          ] }),
          (pulls.data?.pullRequests ?? []).map((pull) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTableRow, { interactive: true, tabIndex: 0, onClick: () => setSelectedPr(pull.number), onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setSelectedPr(pull.number);
            }
          }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTableCell, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "truncate text-sm font-medium text-text", children: [
                "#",
                pull.number,
                " ",
                pull.title
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "truncate font-mono text-[11px] text-text-muted", children: [
                pull.headRef,
                " \u2192 ",
                pull.baseRef
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { priority: "wide", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { tone: pull.mergeable === false ? "danger" : "neutral", children: pull.reviewDecision?.replace("_", " ") ?? pull.mergeableState ?? "unknown" }) })
          ] }, pull.number))
        ] })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.EmptyState, { title: s.mappingMissing, description: s.detectedRemotes, icon: Link2, action: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { icon: Link2, onClick: () => setMapping(mappingFrom(row)), children: s.map }) })
    ] }),
    mapping ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.Modal, { title: s.map, size: "md", onClose: () => setMapping(null), children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ModalBody, { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "grid gap-3 sm:grid-cols-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: `${s.baseRepository} \xB7 ${s.owner}`, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { value: mapping.baseOwner, onChange: (event) => setMapping({ ...mapping, baseOwner: event.target.value }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: `${s.baseRepository} \xB7 ${s.name}`, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { value: mapping.baseName, onChange: (event) => setMapping({ ...mapping, baseName: event.target.value }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: `${s.pushRepository} \xB7 ${s.owner}`, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { value: mapping.pushOwner, onChange: (event) => setMapping({ ...mapping, pushOwner: event.target.value }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: `${s.pushRepository} \xB7 ${s.name}`, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { value: mapping.pushName, onChange: (event) => setMapping({ ...mapping, pushName: event.target.value }) }) })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.ModalFooter, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "ghost", onClick: () => setMapping(null), children: s.cancel }),
        row.mapping ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "danger", onClick: () => preview.mutate({ type: "remove_mapping", projectId: project.id }), children: s.removeMapping }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "accent", onClick: () => saveMap.mutate(mapping, { onSuccess: () => setMapping(null) }), disabled: !mapping.baseOwner || !mapping.baseName || !mapping.pushOwner || !mapping.pushName, children: s.saveMapping })
      ] })
    ] }) : null,
    createOpen ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.Modal, { title: s.createPullRequest, size: "md", onClose: () => setCreateOpen(false), children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.ModalBody, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.pullRequestTitle, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { autoFocus: true, value: createForm.title, onChange: (event) => setCreateForm({ ...createForm, title: event.target.value }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.description, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { className: "min-h-28 w-full rounded-md border border-border bg-bg p-3 text-sm text-text", value: createForm.body, onChange: (event) => setCreateForm({ ...createForm, body: event.target.value }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.baseBranch, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { value: createForm.base, onChange: (event) => setCreateForm({ ...createForm, base: event.target.value }) }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.ModalFooter, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "ghost", onClick: () => setCreateOpen(false), children: s.cancel }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "accent", disabled: !sessionId || !createForm.title.trim(), onClick: () => preview.mutate({ type: "create_pr", projectId: project.id, sessionId, title: createForm.title, body: createForm.body, base: createForm.base }), children: s.createPullRequest })
      ] })
    ] }) : null,
    selectedPr ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.Modal, { title: `#${selectedPr} ${selected?.title ?? ""}`, size: "xl", onClose: () => setSelectedPr(null), children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ModalBody, { children: pullDetail.isError ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ErrorState, { message: s.loadError, onRetry: () => pullDetail.refetch() }) : pullDetail.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.LoadingState, { variant: "list" }) : pullDetail.data ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "space-y-5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "whitespace-pre-wrap text-sm text-text-muted", children: pullDetail.data.body }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-wrap gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { tone: checks.data?.state === "success" ? "success" : checks.data?.state === "failure" ? "danger" : "warning", children: checks.data?.state ?? "pending" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.Badge, { children: [
            pullDetail.data.headRef,
            " \u2192 ",
            pullDetail.data.baseRef
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { className: "mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted", children: s.checks }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "space-y-2", children: (checks.data?.items ?? []).map((item) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "font-medium text-text", children: item.name }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { children: item.state })
          ] }, item.name)) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { className: "mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted", children: s.changedFiles }),
          (pullDetail.data.files ?? []).map((file) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "mb-3 overflow-hidden rounded-lg border border-border", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "border-b border-border px-3 py-2 font-mono text-xs text-text", children: [
              file.status,
              " ",
              file.path,
              " ",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "text-success", children: [
                "+",
                file.additions
              ] }),
              " ",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "text-danger", children: [
                "-",
                file.deletions
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.PatchView, { diff: file.patch ?? "", empty: "No patch available." })
          ] }, file.path))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.reviewEvent, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.SelectMenu, { value: reviewForm.event, onChange: (event) => setReviewForm({ ...reviewForm, event }), label: s.reviewEvent, options: [{ value: "APPROVE", label: s.approve }, { value: "REQUEST_CHANGES", label: s.requestChanges }, { value: "COMMENT", label: s.comment }] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.description, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { className: "min-h-20 w-full rounded-md border border-border bg-bg p-3 text-sm text-text", value: reviewForm.body, onChange: (event) => setReviewForm({ ...reviewForm, body: event.target.value }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.mergeMethod, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.SelectMenu, { value: mergeMethod, onChange: setMergeMethod, label: s.mergeMethod, options: [{ value: "squash", label: s.squash }, { value: "merge", label: s.mergeCommit }, { value: "rebase", label: s.rebase }] }) })
      ] }) : null }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.ModalFooter, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "ghost", onClick: () => setSelectedPr(null), children: s.cancel }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { onClick: () => preview.mutate({ type: "review", projectId: project.id, number: selectedPr, event: reviewForm.event, body: reviewForm.body }), children: s.submitReview }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "danger", onClick: () => preview.mutate({ type: "merge", projectId: project.id, number: selectedPr, expectedHeadSha: pullDetail.data?.headSha, method: mergeMethod }), disabled: checks.data?.state !== "success", children: s.merge })
      ] })
    ] }) : null,
    pending ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ConfirmDialog, { open: true, title: pending.preview.title || s.confirmExternal, description: `${pending.preview.description}

${s.confirmationExpires}`, confirmLabel: s.confirm, onClose: () => setPending(null), onConfirm: () => confirm.mutate({ action: pending.action, token: pending.preview.confirmationToken }) }) : null
  ] });
}
function mappingFrom(row) {
  return {
    projectId: row.project.id,
    baseOwner: row.mapping?.baseOwner ?? row.detected.base?.owner ?? "",
    baseName: row.mapping?.baseName ?? row.detected.base?.name ?? "",
    pushOwner: row.mapping?.pushOwner ?? row.detected.push?.owner ?? "",
    pushName: row.mapping?.pushName ?? row.detected.push?.name ?? "",
    baseRemote: row.detected.base?.remote ?? "",
    pushRemote: row.detected.push?.remote ?? ""
  };
}

// plugins/github/web-src/index.tsx
registerGitHubUi(GitHubAccountPanel, GitHubProjectPanel);
