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

// plugins/onedrive/web-src/OneDriveProjectPanel.tsx
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

// node_modules/lucide-react/dist/esm/icons/cloud-off.js
var CloudOff = createLucideIcon("CloudOff", [
  ["path", { d: "m2 2 20 20", key: "1ooewy" }],
  ["path", { d: "M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193", key: "yfwify" }],
  [
    "path",
    { d: "M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07", key: "jlfiyv" }
  ]
]);

// node_modules/lucide-react/dist/esm/icons/cloud.js
var Cloud = createLucideIcon("Cloud", [
  ["path", { d: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z", key: "p7xjir" }]
]);

// node_modules/lucide-react/dist/esm/icons/external-link.js
var ExternalLink = createLucideIcon("ExternalLink", [
  ["path", { d: "M15 3h6v6", key: "1q9fwt" }],
  ["path", { d: "M10 14 21 3", key: "gplh6r" }],
  ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", key: "a6xqqp" }]
]);

// node_modules/lucide-react/dist/esm/icons/refresh-cw.js
var RefreshCw = createLucideIcon("RefreshCw", [
  ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", key: "v9h5vc" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }],
  ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", key: "3uifl3" }],
  ["path", { d: "M8 16H3v5", key: "1cv678" }]
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

// plugins/onedrive/web-src/runtime.ts
function runtime() {
  const value = window.ElowenUiRuntime;
  if (!value) throw new Error("ElowenUiRuntime is not installed");
  return value;
}
function registerOneDriveUi(project) {
  window.__elowenRegisterPluginUi?.("onedrive", {
    requiresApiVersion: 6,
    project: { mirror: project }
  });
}
function jsonBody(value) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
}
function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "kB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

// plugins/onedrive/web-src/OneDriveProjectPanel.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var statusTone = (row) => {
  if (row.status === "error") return "danger";
  if (!row.enabled) return "muted";
  if (row.conflictCount > 0) return "warning";
  return row.status === "syncing" ? "accent" : "success";
};
function OneDriveProjectPanel({ project }) {
  const { components: C, hooks, api, utils } = runtime();
  const s = hooks.usePluginStrings("onedrive");
  const { toast } = hooks.useToast();
  const qc = hooks.useQueryClient();
  const key = ["plugin", "onedrive", "overview", String(project.id)];
  const overview = hooks.useQuery({
    queryKey: key,
    queryFn: () => api(`/plugins/onedrive/api/overview?projectId=${project.id}`),
    refetchInterval: 15e3
  });
  const [connectFor, setConnectFor] = (0, import_react3.useState)(null);
  const [conflictsFor, setConflictsFor] = (0, import_react3.useState)(null);
  const [disconnecting, setDisconnecting] = (0, import_react3.useState)(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
  };
  const fail = (error) => toast(utils.apiErrorMessage(error), "error");
  const connect = hooks.useMutation({
    mutationFn: (vars) => api("/plugins/onedrive/api/connect", jsonBody({ projectId: project.id, workspaceId: vars.workspaceId })),
    onSuccess: () => {
      setConnectFor(null);
      refresh();
    },
    onError: fail
  });
  const disconnect = hooks.useMutation({
    mutationFn: (vars) => api("/plugins/onedrive/api/disconnect", jsonBody(vars)),
    onSuccess: () => {
      setDisconnecting(null);
      refresh();
    },
    onError: fail
  });
  const pause = hooks.useMutation({
    mutationFn: (vars) => api("/plugins/onedrive/api/pause", jsonBody(vars)),
    onSuccess: refresh,
    onError: fail
  });
  const syncNow = hooks.useMutation({
    mutationFn: (vars) => api("/plugins/onedrive/api/sync-now", jsonBody(vars)),
    onSuccess: refresh,
    onError: fail
  });
  if (overview.isLoading) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.LoadingState, { variant: "list" });
  if (overview.isError) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ErrorState, { message: utils.apiErrorMessage(overview.error), onRetry: () => overview.refetch() });
  const data = overview.data;
  if (!data || data.identity.linked !== true) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.EmptyState, { icon: CloudOff, title: s.title, description: s.notLinked });
  }
  const projectLink = data.links.find((row) => row.workspaceId === null) ?? null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "space-y-4 py-3", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      C.PluginSection,
      {
        surface: "project",
        title: s.title,
        description: s.connectHint,
        icon: Cloud,
        action: projectLink ? void 0 : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { size: "sm", onClick: () => setConnectFor({ workspaceId: null, label: project.slug }), children: s.connectCta }),
        children: projectLink ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MirrorCard, { row: projectLink }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs text-text-muted", children: s.mirrorScopeHint })
      }
    ),
    data.workspaces.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.PluginSection, { surface: "project", title: s.workspaces, description: s.workspacesHint, icon: Cloud, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTable, { children: data.workspaces.map((workspace) => {
      const row = data.links.find((link) => link.workspaceId === workspace.workspaceId) ?? null;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.DataTableRow, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { children: workspace.label }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { children: row ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: statusTone(row), children: statusLabel(row) }) : null }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { align: "right", children: row ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "ghost", size: "sm", onClick: () => setDisconnecting(row), children: s.disconnect }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          C.Button,
          {
            variant: "secondary",
            size: "sm",
            onClick: () => setConnectFor({ workspaceId: workspace.workspaceId, label: workspace.label }),
            children: s.connectCta
          }
        ) })
      ] }, workspace.workspaceId);
    }) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      C.WorkspaceDetailRail,
      {
        open: connectFor !== null,
        onClose: () => setConnectFor(null),
        title: s.connectCta,
        subtitle: connectFor?.label,
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "space-y-3 text-sm", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-text-muted text-xs uppercase tracking-wide", children: s.folder }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "font-mono text-xs", children: `${data.rootFolder}/${connectFor?.workspaceId ? "workspaces" : "projects"}/${project.slug}` })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-text-muted text-xs uppercase tracking-wide", children: s.mirrorScope }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs", children: s.mirrorScopeHint })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            C.Button,
            {
              onClick: () => connect.mutate({ workspaceId: connectFor?.workspaceId ?? null }),
              disabled: connect.isPending,
              children: s.connectConfirm
            }
          )
        ] })
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ConflictsRail, { row: conflictsFor, onClose: () => {
      setConflictsFor(null);
      refresh();
    } }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      C.ConfirmDialog,
      {
        open: disconnecting !== null,
        title: s.disconnect,
        description: s.disconnectHint,
        confirmLabel: s.disconnect,
        tone: "danger",
        onCancel: () => setDisconnecting(null),
        onConfirm: () => disconnecting && disconnect.mutate({ id: disconnecting.id })
      }
    )
  ] });
  function statusLabel(row) {
    if (row.status === "error") return s.statusError;
    if (!row.enabled) return s.statusPaused;
    return row.status === "syncing" ? s.statusSyncing : s.statusIdle;
  }
  function MirrorCard({ row }) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "space-y-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-wrap items-center gap-4", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: s.statusIdle, value: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: statusTone(row), children: statusLabel(row) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: s.lastSync, value: row.lastSyncAt ? new Date(row.lastSyncAt).toLocaleString() : s.never }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: s.files, value: `${row.fileCount} \xB7 ${humanBytes(row.byteCount)}` })
      ] }),
      row.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ErrorState, { message: row.error }) : null,
      row.conflictCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          onClick: () => setConflictsFor(row),
          className: "flex w-full items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-left text-sm hover:bg-surface-2",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TriangleAlert, { size: 15, className: "text-warning", "aria-hidden": true }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: s.conflicts }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: "warning", children: row.conflictCount })
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-wrap gap-2", children: [
        row.webUrl && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.Button, { variant: "secondary", size: "sm", onClick: () => window.open(row.webUrl, "_blank", "noopener"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ExternalLink, { size: 14, "aria-hidden": true }),
          " ",
          s.openFolder
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.Button, { variant: "secondary", size: "sm", disabled: syncNow.isPending, onClick: () => syncNow.mutate({ id: row.id }), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RefreshCw, { size: 14, "aria-hidden": true }),
          " ",
          s.syncNow
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "ghost", size: "sm", onClick: () => pause.mutate({ id: row.id, enabled: !row.enabled }), children: row.enabled ? s.pause : s.resume }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "ghost", size: "sm", tone: "danger", onClick: () => setDisconnecting(row), children: s.disconnect })
      ] })
    ] });
  }
  function ConflictsRail({ row, onClose }) {
    const conflicts = hooks.useQuery({
      queryKey: ["plugin", "onedrive", "conflicts", String(row?.id ?? 0)],
      queryFn: () => api(`/plugins/onedrive/api/conflicts?id=${row.id}`),
      enabled: row !== null
    });
    const resolve = hooks.useMutation({
      mutationFn: (vars) => api("/plugins/onedrive/api/conflicts/resolve", jsonBody({ id: row.id, ...vars })),
      onSuccess: () => {
        conflicts.refetch();
        refresh();
      },
      onError: fail
    });
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceDetailRail, { open: row !== null, onClose, title: s.conflicts, subtitle: s.conflictsHint, children: conflicts.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.LoadingState, { variant: "list" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTable, { children: (conflicts.data?.conflicts ?? []).map((conflict) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.DataTableRow, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "font-mono text-xs", children: conflict.rel }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.DataTableCell, { align: "right", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex justify-end gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          C.Button,
          {
            size: "sm",
            variant: "secondary",
            disabled: resolve.isPending,
            onClick: () => resolve.mutate({ rel: conflict.rel, keep: "local" }),
            children: s.keepLocal
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          C.Button,
          {
            size: "sm",
            variant: "ghost",
            disabled: resolve.isPending,
            onClick: () => resolve.mutate({ rel: conflict.rel, keep: "remote" }),
            children: s.keepRemote
          }
        )
      ] }) })
    ] }, conflict.rel)) }) });
  }
}

// plugins/onedrive/web-src/index.tsx
registerOneDriveUi(OneDriveProjectPanel);
