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

// node_modules/lucide-react/dist/esm/icons/link-2.js
var Link2 = createLucideIcon("Link2", [
  ["path", { d: "M9 17H7A5 5 0 0 1 7 7h2", key: "8i5ue5" }],
  ["path", { d: "M15 7h2a5 5 0 1 1 0 10h-2", key: "1b9ql8" }],
  ["line", { x1: "8", x2: "16", y1: "12", y2: "12", key: "1jonct" }]
]);

// node_modules/lucide-react/dist/esm/icons/search.js
var Search = createLucideIcon("Search", [
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ["path", { d: "m21 21-4.3-4.3", key: "1qie3q" }]
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

// plugins/github/web-src/runtime.ts
function runtime() {
  const value = window.ElowenUiRuntime;
  if (!value) throw new Error("ElowenUiRuntime is not installed");
  return value;
}
function registerGitHubUi(page, account) {
  window.__elowenRegisterPluginUi?.("github", { requiresApiVersion: 3, pages: { "": page }, account: { connection: account } });
}
function jsonBody(value) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
}
function localizedError(error, strings) {
  const code = runtime().utils.apiErrorMessage(error);
  return strings[`error_${code}`] || code || strings.errorFallback || "The GitHub operation failed.";
}

// plugins/github/web-src/GitHubConnectionPanel.tsx
var import_react3 = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var STATUS_KEY = ["plugin", "github", "status"];
function GitHubConnectionPanel({ onChanged }) {
  const { components: C, hooks, api } = runtime();
  const s = hooks.usePluginStrings("github");
  const { toast } = hooks.useToast();
  const qc = hooks.useQueryClient();
  const status = hooks.useQuery({ queryKey: STATUS_KEY, queryFn: () => api("/plugins/github/api/status") });
  const [pending, setPending] = (0, import_react3.useState)(null);
  const [connectionTest, setConnectionTest] = (0, import_react3.useState)(null);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: STATUS_KEY });
    await onChanged?.();
  };
  const connect = hooks.useMutation({
    mutationFn: (value) => api("/plugins/github/api/auth/start", jsonBody(value)),
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
    onSuccess: (value) => {
      setConnectionTest(value);
      toast(s.connectionHealthy);
    },
    onError: (error) => toast(localizedError(error, s), "error")
  });
  if (status.isError) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ErrorState, { message: s.loadError, onRetry: () => status.refetch() });
  if (status.isLoading) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.LoadingState, { variant: "detail" });
  const beginConnect = () => connect.mutate(status.data?.reconnectRequired ? { reconnect: true } : {}, { onSuccess: (value) => window.location.assign(value.authorizeUrl) });
  const completePending = () => {
    if (!pending) return;
    if (pending.action.type === "replace_identity") {
      connect.mutate({ replaceIdentity: true, confirmationToken: pending.preview.confirmationToken }, { onSuccess: (value) => window.location.assign(value.authorizeUrl) });
      return;
    }
    confirm.mutate({ action: pending.action, token: pending.preview.confirmationToken });
  };
  const account = status.data?.account;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    status.data?.connected && account ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-5", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center gap-4", children: [
        account.avatarUrl ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { src: account.avatarUrl, alt: "", className: "size-14 rounded-full border border-border" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Github, { className: "size-12" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "min-w-0 flex-1", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "truncate text-lg font-semibold text-text", children: account.name || account.login }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "text-sm text-text-muted", children: [
            "@",
            account.login
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: status.data.reconnectRequired ? "danger" : "success", children: status.data.reconnectRequired ? s.reconnectRequired : s.connected })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", { className: "grid gap-3 text-sm sm:grid-cols-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { className: "text-text-muted", children: s.tokenExpiry }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { className: "text-text", children: new Date(account.tokenExpiresAt).toLocaleString() })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { className: "text-text-muted", children: s.refreshExpiry }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { className: "text-text", children: new Date(account.refreshExpiresAt).toLocaleString() })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { className: "text-text-muted", children: s.mappings }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { className: "font-mono text-text", children: status.data.mappings })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { className: "text-text-muted", children: "GitHub ID" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { className: "font-mono text-text", children: account.githubUserId })
        ] }),
        connectionTest?.rateLimit ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { className: "text-text-muted", children: s.rateLimit }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dd", { className: "font-mono text-text", children: [
            connectionTest.rateLimit.remaining,
            " / ",
            connectionTest.rateLimit.limit
          ] })
        ] }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-wrap gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { onClick: () => test.mutate(), disabled: test.isPending, children: s.testConnection }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { onClick: () => preview.mutate({ type: "replace_identity" }), children: s.replaceIdentity }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "danger", onClick: () => preview.mutate({ type: "disconnect" }), children: s.disconnect })
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.EmptyState, { title: status.data?.reconnectRequired ? s.reconnectRequired : s.disconnected, description: status.data?.setup.configured ? s.intro : s.setupHint, icon: Github, action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "accent", onClick: beginConnect, disabled: !status.data?.setup.configured || connect.isPending, children: status.data?.reconnectRequired ? s.reconnect : s.connect }) }),
    pending ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ConfirmDialog, { open: true, title: pending.preview.title || s.confirmExternal, description: `${pending.preview.description}

${s.confirmationExpires}`, confirmLabel: s.confirm, onClose: () => setPending(null), onConfirm: completePending }) : null
  ] });
}

// plugins/github/web-src/GitHubAccountPanel.tsx
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
function GitHubAccountPanel({ surface }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("github");
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    C.PluginSection,
    {
      surface,
      title: s.accountTitle || s.title,
      description: s.accountHint || s.intro,
      icon: Github,
      children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(GitHubConnectionPanel, {})
    }
  );
}

// plugins/github/web-src/GitHubPage.tsx
var import_react4 = __toESM(require_react(), 1);
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
var REPOSITORIES_KEY = ["plugin", "github", "repositories"];
function GitHubPage() {
  const { components: C, hooks, api, utils } = runtime();
  const s = hooks.usePluginStrings("github");
  const { toast } = hooks.useToast();
  const qc = hooks.useQueryClient();
  const me = hooks.useMe();
  const status = hooks.useQuery({ queryKey: STATUS_KEY, queryFn: () => api("/plugins/github/api/status") });
  const connected = status.data?.connected === true;
  const [tab, setTab] = (0, import_react4.useState)("overview");
  const [secret, setSecret] = (0, import_react4.useState)("");
  const [mapping, setMapping] = (0, import_react4.useState)(null);
  const [projectFilter, setProjectFilter] = (0, import_react4.useState)("");
  const [prState, setPrState] = (0, import_react4.useState)("open");
  const [search, setSearch] = (0, import_react4.useState)("");
  const [selectedPr, setSelectedPr] = (0, import_react4.useState)(null);
  const [pending, setPending] = (0, import_react4.useState)(null);
  const [publishSession, setPublishSession] = (0, import_react4.useState)("");
  const [createForm, setCreateForm] = (0, import_react4.useState)({ title: "", body: "", base: "" });
  const [reviewForm, setReviewForm] = (0, import_react4.useState)({ event: "APPROVE", body: "" });
  const [mergeMethod, setMergeMethod] = (0, import_react4.useState)("squash");
  const repositories = hooks.useQuery({
    queryKey: REPOSITORIES_KEY,
    queryFn: () => api("/plugins/github/api/repositories"),
    enabled: connected
  });
  const rows = repositories.data?.repositories ?? [];
  const mapped = rows.filter((row) => row.mapping?.active);
  const activeProject = projectFilter || String(mapped[0]?.project.id ?? "");
  const pulls = hooks.useQuery({
    queryKey: ["plugin", "github", "pulls", activeProject, prState],
    queryFn: () => api(`/plugins/github/api/pull-requests?projectId=${encodeURIComponent(activeProject)}&state=${prState}`),
    enabled: connected && !!activeProject && tab === "pulls"
  });
  const detail = hooks.useQuery({
    queryKey: ["plugin", "github", "pull", activeProject, selectedPr],
    queryFn: () => api(`/plugins/github/api/pull-request?projectId=${encodeURIComponent(activeProject)}&number=${selectedPr}`),
    enabled: connected && !!activeProject && !!selectedPr && tab === "pulls"
  });
  const checks = hooks.useQuery({
    queryKey: ["plugin", "github", "checks", activeProject, selectedPr],
    queryFn: () => api(`/plugins/github/api/checks?projectId=${encodeURIComponent(activeProject)}&number=${selectedPr}`),
    enabled: connected && !!activeProject && !!selectedPr && tab === "pulls"
  });
  const sessions = hooks.useQuery({ queryKey: ["brain", "sessions", "github"], queryFn: () => api("/brain/sessions"), enabled: connected });
  const invalidate = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: STATUS_KEY }), qc.invalidateQueries({ queryKey: REPOSITORIES_KEY }), qc.invalidateQueries({ queryKey: ["plugin", "github", "pulls"] })]);
  };
  const mutation = (fn, success) => hooks.useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await invalidate();
      if (success) toast(success);
    },
    onError: (error) => toast(localizedError(error, s), "error")
  });
  const saveSecret = mutation((value) => api("/plugins/github/api/setup/secret", jsonBody(value)), s.secretSaved);
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
  const completePending = () => {
    if (pending) confirm.mutate({ action: pending.action, token: pending.preview.confirmationToken });
  };
  const filteredPulls = (0, import_react4.useMemo)(() => {
    const needle = search.trim().toLowerCase();
    return (pulls.data?.pullRequests ?? []).filter((pull) => !needle || [pull.title, pull.author, pull.headRef, String(pull.number)].some((value) => value.toLowerCase().includes(needle)));
  }, [pulls.data, search]);
  if (status.isError) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ErrorState, { message: s.loadError, onRetry: () => status.refetch() });
  if (status.isLoading) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.LoadingState, { variant: "page" });
  const overview = /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,.7fr)]", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("section", { className: "rounded-2xl border border-border bg-surface p-5", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GitHubConnectionPanel, { onChanged: invalidate }) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "rounded-2xl border border-border bg-surface p-5", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "mb-4 flex items-center gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ShieldCheck, { size: 18, className: "text-accent" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { className: "font-semibold text-text", children: "GitHub App" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "space-y-3 text-sm", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "text-text-muted", children: s.callbackUrl }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("code", { className: "block break-all rounded-lg bg-bg p-2 text-xs text-text", children: status.data?.setup.callbackUrl ?? s.setupIncomplete })
        ] }),
        me.data?.user?.is_admin ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.clientSecret, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { type: "password", value: secret, onChange: (event) => setSecret(event.target.value) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { onClick: () => saveSecret.mutate({ clientSecret: secret }, { onSuccess: () => setSecret("") }), disabled: saveSecret.isPending || secret.length < 20, children: s.saveSecret })
        ] }) : null
      ] })
    ] })
  ] });
  const repositoriesView = !connected ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.EmptyState, { title: s.disconnected, description: s.intro, icon: Link2 }) : repositories.isError ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ErrorState, { message: s.loadError, onRetry: () => repositories.refetch() }) : repositories.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.LoadingState, { variant: "list" }) : rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.EmptyState, { title: s.noRepositories, icon: FolderGit2 }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTable, { ariaLabel: s.repositories, columns: "minmax(12rem,1fr) minmax(15rem,1.2fr) minmax(15rem,1.2fr) minmax(10rem,.7fr)", compactColumns: "minmax(0,1fr)", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTableRow, { header: true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, children: s.columnProject }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, priority: "wide", children: s.baseRepository }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, priority: "wide", children: s.pushRepository }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, priority: "wide", children: s.mappingHealthy })
    ] }),
    rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTableRow, { interactive: true, tabIndex: 0, onClick: () => setMapping(mappingFrom(row)), onKeyDown: (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setMapping(mappingFrom(row));
      }
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTableCell, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "font-medium text-text", children: row.project.slug }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "mt-1 sm:hidden", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { tone: row.mapping ? "success" : "neutral", children: row.mapping ? s.mappingHealthy : s.mappingMissing }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { priority: "wide", className: "font-mono text-xs text-text-muted", children: row.mapping ? `${row.mapping.baseOwner}/${row.mapping.baseName}` : row.detected.base ? `${row.detected.base.owner}/${row.detected.base.name}` : "\u2014" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { priority: "wide", className: "font-mono text-xs text-text-muted", children: row.mapping ? `${row.mapping.pushOwner}/${row.mapping.pushName}` : row.detected.push ? `${row.detected.push.owner}/${row.detected.push.name}` : "\u2014" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { priority: "wide", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { tone: row.mapping ? "success" : row.detected.ambiguous ? "warning" : "neutral", children: row.mapping ? s.mappingHealthy : s.mappingMissing }) })
    ] }, row.project.id))
  ] });
  const pullsView = !connected ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.EmptyState, { title: s.disconnected, icon: GitPullRequest }) : mapped.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.EmptyState, { title: s.mappingMissing, description: s.setupHint, icon: Link2 }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex min-h-0 flex-1 flex-col gap-4", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-col gap-2 sm:flex-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.SelectMenu, { value: activeProject, onChange: (value) => {
        setProjectFilter(value);
        setSelectedPr(null);
      }, label: s.filterProject, options: mapped.map((row) => ({ value: String(row.project.id), label: row.project.slug })) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.SelectMenu, { value: prState, onChange: setPrState, label: s.filterState, options: [{ value: "open", label: s.stateOpen }, { value: "closed", label: s.stateClosed }, { value: "all", label: s.stateAll }] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "relative flex-1", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Search, { size: 14, className: "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { value: search, onChange: (event) => setSearch(event.target.value), placeholder: s.search, className: "pl-9" })
      ] })
    ] }),
    pulls.isError ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ErrorState, { message: s.loadError, onRetry: () => pulls.refetch() }) : pulls.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.LoadingState, { variant: "list" }) : filteredPulls.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.EmptyState, { title: s.noPullRequests, icon: GitPullRequest }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTable, { ariaLabel: s.tabPullRequests, columns: "minmax(18rem,1.4fr) minmax(14rem,1fr) minmax(8rem,.5fr) minmax(10rem,.7fr)", compactColumns: "minmax(0,1fr)", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTableRow, { header: true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, children: s.columnPullRequest }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, priority: "wide", children: s.columnBranch }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, priority: "wide", children: s.columnChecks }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { header: true, priority: "wide", children: s.columnUpdated })
      ] }),
      filteredPulls.map((pull) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTableRow, { interactive: true, selected: pull.number === selectedPr, tabIndex: 0, onClick: () => setSelectedPr(pull.number), onKeyDown: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setSelectedPr(pull.number);
        }
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTableCell, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "font-medium text-text", children: [
            "#",
            pull.number,
            " ",
            pull.title
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "text-xs text-text-muted", children: [
            "@",
            pull.author,
            pull.draft ? " \xB7 Draft" : ""
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.DataTableCell, { priority: "wide", className: "font-mono text-xs text-text-muted", children: [
          pull.headRef,
          " \u2192 ",
          pull.baseRef
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { priority: "wide", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-wrap gap-1", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { tone: pull.mergeable === false ? "danger" : "neutral", children: pull.mergeableState ?? "unknown" }),
          pull.reviewDecision ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { tone: pull.reviewDecision === "approved" ? "success" : pull.reviewDecision === "changes_requested" ? "danger" : "neutral", children: pull.reviewDecision.replace("_", " ") }) : null
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.DataTableCell, { priority: "wide", className: "text-xs text-text-muted", children: new Date(pull.updatedAt).toLocaleString() })
      ] }, pull.number))
    ] }),
    selectedPr ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.WorkspaceDetailRail, { label: `#${selectedPr}`, closeLabel: s.cancel, onClose: () => setSelectedPr(null), children: detail.isError ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ErrorState, { message: s.loadError, onRetry: () => detail.refetch() }) : detail.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.LoadingState, { variant: "detail" }) : detail.data ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-col gap-5 p-4", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { className: "text-lg font-semibold text-text", children: detail.data.title }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mt-2 whitespace-pre-wrap text-sm text-text-muted", children: detail.data.body })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-wrap gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { tone: checks.data?.state === "success" ? "success" : checks.data?.state === "failure" ? "danger" : "warning", children: checks.data?.state ?? "pending" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.Badge, { children: [
          detail.data.headRef,
          " \u2192 ",
          detail.data.baseRef
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { className: "mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted", children: s.checks }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "space-y-2", children: (checks.data?.items ?? []).map((item) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "font-medium text-text", children: item.name }),
            item.description ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "text-xs text-text-muted", children: item.description }) : null
          ] }),
          item.targetUrl ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("a", { href: item.targetUrl, target: "_blank", rel: "noreferrer", className: "text-accent hover:underline", children: item.state }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Badge, { children: item.state })
        ] }, item.name)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { className: "mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted", children: s.changedFiles }),
        (detail.data.files ?? []).map((file) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "mb-3 overflow-hidden rounded-lg border border-border", children: [
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
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { className: "mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted", children: s.reviews }),
        (detail.data.reviews ?? []).map((review) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "mb-2 rounded-lg border border-border p-3 text-sm", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: review.user }),
          " \xB7 ",
          review.state,
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mt-1 text-text-muted", children: review.body })
        ] }, review.id))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-wrap gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { onClick: () => preview.mutate({ type: "publish", projectId: Number(activeProject), sessionId: publishSession }), disabled: !publishSession, children: s.publish }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "accent", onClick: () => preview.mutate({ type: "create_pr", projectId: Number(activeProject), sessionId: publishSession, title: createForm.title || detail.data?.title, body: createForm.body, base: createForm.base || detail.data?.baseRef }), disabled: !publishSession, children: s.createPullRequest }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { onClick: () => preview.mutate({ type: "review", projectId: Number(activeProject), number: selectedPr, event: reviewForm.event, body: reviewForm.body }), children: s.submitReview }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "danger", onClick: () => preview.mutate({ type: "merge", projectId: Number(activeProject), number: selectedPr, expectedHeadSha: detail.data?.headSha, method: mergeMethod }), disabled: checks.data?.state !== "success", children: s.merge })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.conversation, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.SelectMenu, { value: publishSession, onChange: setPublishSession, label: s.conversation, options: (sessions.data ?? []).map((session) => ({ value: session.id, label: session.title })) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.pullRequestTitle, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { value: createForm.title, onChange: (event) => setCreateForm({ ...createForm, title: event.target.value }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.description, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { className: "min-h-24 w-full rounded-md border border-border bg-bg p-3 text-sm text-text", value: createForm.body, onChange: (event) => setCreateForm({ ...createForm, body: event.target.value }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.reviewEvent, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.SelectMenu, { value: reviewForm.event, onChange: (event) => setReviewForm({ ...reviewForm, event }), label: s.reviewEvent, options: [{ value: "APPROVE", label: s.approve }, { value: "REQUEST_CHANGES", label: s.requestChanges }, { value: "COMMENT", label: s.comment }] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.description, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { className: "min-h-20 w-full rounded-md border border-border bg-bg p-3 text-sm text-text", value: reviewForm.body, onChange: (event) => setReviewForm({ ...reviewForm, body: event.target.value }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.mergeMethod, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.SelectMenu, { value: mergeMethod, onChange: setMergeMethod, label: s.mergeMethod, options: [{ value: "squash", label: s.squash }, { value: "merge", label: s.mergeCommit }, { value: "rebase", label: s.rebase }] }) })
    ] }) : null }) : null
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.SpatialWorkspaceLayout, { hero: { eyebrow: s.eyebrow, title: s.title, description: s.intro, mascotState: status.data?.reconnectRequired ? "error" : connected ? "idle" : "sleeping", metrics: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.WorkspaceMetric, { label: s.connected, value: connected ? "1" : "0", icon: Github }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.WorkspaceMetric, { label: s.mappings, value: status.data?.mappings ?? 0, icon: Link2 }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.WorkspaceMetric, { label: s.tabPullRequests, value: pulls.data?.pullRequests.length ?? 0, icon: GitPullRequest })
    ] }) }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex min-h-0 flex-1 flex-col gap-4", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Segmented, { value: tab, onChange: setTab, options: [{ value: "overview", label: s.tabOverview }, { value: "repositories", label: s.tabRepositories }, { value: "pulls", label: s.tabPullRequests }] }),
      tab === "overview" ? overview : tab === "repositories" ? repositoriesView : pullsView
    ] }) }),
    mapping ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.Modal, { title: s.map, size: "md", onClose: () => setMapping(null), children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.ModalBody, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "grid gap-3 sm:grid-cols-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.owner, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { value: mapping.baseOwner, onChange: (event) => setMapping({ ...mapping, baseOwner: event.target.value }) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.name, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { value: mapping.baseName, onChange: (event) => setMapping({ ...mapping, baseName: event.target.value }) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.owner, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { value: mapping.pushOwner, onChange: (event) => setMapping({ ...mapping, pushOwner: event.target.value }) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Field, { label: s.name, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Input, { value: mapping.pushName, onChange: (event) => setMapping({ ...mapping, pushName: event.target.value }) }) })
        ] }),
        mapping.baseOwner && mapping.baseName ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("a", { href: `https://github.com/${encodeURIComponent(mapping.baseOwner)}/${encodeURIComponent(mapping.baseName)}`, target: "_blank", rel: "noreferrer", className: "mt-4 inline-flex text-sm text-accent hover:underline", children: s.openGitHub }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.ModalFooter, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "ghost", onClick: () => setMapping(null), children: s.cancel }),
        rows.find((row) => row.project.id === mapping.projectId)?.mapping ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "danger", onClick: () => preview.mutate({ type: "remove_mapping", projectId: mapping.projectId }), children: s.removeMapping }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "accent", onClick: () => saveMap.mutate(mapping, { onSuccess: () => setMapping(null) }), disabled: !mapping.baseOwner || !mapping.baseName || !mapping.pushOwner || !mapping.pushName, children: s.saveMapping })
      ] })
    ] }) : null,
    pending ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ConfirmDialog, { open: true, title: pending.preview.title || s.confirmExternal, description: `${pending.preview.description}

${s.confirmationExpires}`, confirmLabel: s.confirm, onClose: () => setPending(null), onConfirm: completePending }) : null
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
registerGitHubUi(GitHubPage, GitHubAccountPanel);
