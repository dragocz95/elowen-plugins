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

// plugins/sites/web-src/runtime.ts
function runtime() {
  const value = window.ElowenUiRuntime;
  if (!value) throw new Error("ElowenUiRuntime is not installed");
  return value;
}
function registerSitesUi(pages, project) {
  window.__elowenRegisterPluginUi?.("sites", {
    requiresApiVersion: 7,
    pages,
    project
  });
}
var jsonBody = (method, value) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value)
});
function relativeTime(iso) {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1e3));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} d ago`;
  return new Date(then).toISOString().slice(0, 10);
}
var formatBytes = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;

// plugins/sites/web-src/SitesPage.tsx
var import_react4 = __toESM(require_react(), 1);

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

// node_modules/lucide-react/dist/esm/icons/globe.js
var Globe = createLucideIcon("Globe", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", key: "13o1zl" }],
  ["path", { d: "M2 12h20", key: "9i4pu4" }]
]);

// plugins/sites/web-src/SiteDetail.tsx
var import_react3 = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var VISIBILITY_ORDER = ["private", "project", "authenticated", "public"];
var VISIBILITY_STRING = {
  private: "visibilityPrivate",
  project: "visibilityProject",
  authenticated: "visibilityAuthenticated",
  public: "visibilityPublic"
};
function SiteDetail({ siteId, strings, allowPublicSites, dedicatedHost, onClose }) {
  const { components, hooks, utils } = runtime();
  const { Modal, ModalBody, Button, Badge, Avatar, Segmented, ConfirmDialog, Input, LoadingState, ErrorState } = components;
  const { toast } = hooks.useToast();
  const queryClient = hooks.useQueryClient();
  const [tab, setTab] = (0, import_react3.useState)("overview");
  const [pendingPublic, setPendingPublic] = (0, import_react3.useState)(false);
  const [confirmDelete, setConfirmDelete] = (0, import_react3.useState)(false);
  const [guestFilter, setGuestFilter] = (0, import_react3.useState)("");
  const detail = hooks.useQuery({
    queryKey: ["sites", "detail", siteId],
    queryFn: () => runtime().api(`/plugins/sites/api/site/${siteId}`)
  });
  const directory = hooks.useQuery({
    queryKey: ["sites", "directory"],
    queryFn: () => runtime().api("/plugins/sites/api/directory")
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["sites", "detail", siteId] });
    void queryClient.invalidateQueries({ queryKey: ["sites", "list"] });
  };
  const call = hooks.useMutation({
    mutationFn: (vars) => runtime().api(vars.path, vars.init),
    onSuccess: (_data, vars) => {
      refresh();
      toast(vars.done ?? strings.saved ?? "Saved");
    },
    onError: (error) => toast(utils.apiErrorMessage(error), "error")
  });
  const site = detail.data?.site;
  const members = detail.data?.members ?? [];
  const memberIds = new Set(members.map((member) => member.id));
  const setVisibility = (next) => {
    if (next === "public") {
      setPendingPublic(true);
      return;
    }
    call.mutate({ path: `/plugins/sites/api/site/${siteId}`, init: jsonBody("PATCH", { visibility: next }) });
  };
  const candidates = (directory.data?.accounts ?? []).filter((account) => !memberIds.has(account.id) && account.id !== site?.ownerUserId).filter((account) => guestFilter.trim() === "" || account.name.toLowerCase().includes(guestFilter.trim().toLowerCase())).slice(0, 8);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    Modal,
    {
      title: site?.title ?? strings.title ?? "Site",
      description: site?.summary || void 0,
      icon: Globe,
      onClose,
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ModalBody, { children: [
        detail.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoadingState, {}) : null,
        detail.isError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ErrorState, { title: strings.title ?? "Sites" }) : null,
        site ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            Segmented,
            {
              variant: "line",
              value: tab,
              onChange: (value) => setTab(value),
              options: [
                { value: "overview", label: strings.tabOverview ?? "Overview" },
                { value: "access", label: strings.tabAccess ?? "Access" },
                ...site.canManage ? [{ value: "danger", label: strings.tabDanger ?? "Delete" }] : []
              ]
            }
          ),
          tab === "overview" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-4", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-1", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs uppercase tracking-wide text-text-muted", children: strings.address ?? "Address" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center gap-2", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "truncate font-mono text-xs text-text", children: site.url }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "ghost", onClick: () => {
                  utils.copyText(site.url);
                  toast(strings.copied ?? "Copied");
                }, children: strings.copyLink ?? "Copy address" })
              ] }),
              !dedicatedHost ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-[11px] text-warning", children: strings.passiveNotice }) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-1", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs uppercase tracking-wide text-text-muted", children: strings.lastPublish ?? "Last publish" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs text-text", children: site.lastPublishAt ? `${(strings.builtBy ?? "Built by {model}").replace("{model}", site.lastPublishModel || "\u2014")} \xB7 ${relativeTime(site.lastPublishAt)}` : strings.neverPublished ?? "Not published yet" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs uppercase tracking-wide text-text-muted", children: strings.releases ?? "Releases" }),
              (detail.data?.releases ?? []).map((release) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center justify-between gap-3 border border-border bg-elevated/40 px-3 py-2", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex min-w-0 flex-col", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "text-xs text-text", children: [
                    relativeTime(release.createdAt),
                    " \xB7 ",
                    release.fileCount,
                    " files \xB7 ",
                    formatBytes(release.sizeBytes)
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "truncate text-[11px] text-text-muted", children: release.note || release.model })
                ] }),
                site.canManage && release.id !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  Button,
                  {
                    variant: "ghost",
                    disabled: call.isPending,
                    onClick: () => call.mutate({
                      path: `/plugins/sites/api/site/${siteId}/rollback`,
                      init: jsonBody("POST", { releaseId: release.id }),
                      done: strings.rollbackDone
                    }),
                    children: strings.rollback ?? "Restore"
                  }
                ) : null
              ] }, release.id))
            ] }),
            (detail.data?.hits ?? []).length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-1", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs uppercase tracking-wide text-text-muted", children: strings.visits ?? "Visits" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs text-text", children: (detail.data?.hits ?? []).reduce((sum, entry) => sum + entry.count, 0) })
            ] }) : null
          ] }) : null,
          tab === "access" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-4", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs uppercase tracking-wide text-text-muted", children: strings.whoCanOpen ?? "Who can open this" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                Segmented,
                {
                  value: site.visibility,
                  onChange: (value) => setVisibility(value),
                  options: VISIBILITY_ORDER.map((visibility) => ({
                    value: visibility,
                    label: strings[VISIBILITY_STRING[visibility]] ?? visibility,
                    disabled: !site.canManage || visibility === "public" && !allowPublicSites
                  }))
                }
              ),
              !allowPublicSites ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-[11px] text-text-muted", children: strings.publicDisabled }) : null,
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-[11px] text-text-muted", children: strings.sourceNotice })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs uppercase tracking-wide text-text-muted", children: strings.guests ?? "Named guests" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-[11px] text-text-muted", children: strings.guestsHint }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-1", children: [
                members.map((member) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center justify-between gap-2", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center gap-2", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Avatar, { size: "sm", name: member.name, user: { id: member.id, username: member.name } }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs text-text", children: member.name })
                  ] }),
                  site.canManage ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    Button,
                    {
                      variant: "ghost-danger",
                      disabled: call.isPending,
                      onClick: () => call.mutate({
                        path: `/plugins/sites/api/site/${siteId}/members/${member.id}`,
                        init: { method: "DELETE" }
                      }),
                      children: strings.removeGuest ?? "Remove"
                    }
                  ) : null
                ] }, member.id)),
                members.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-[11px] text-text-muted", children: "\u2014" }) : null
              ] }),
              site.canManage ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-2", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  Input,
                  {
                    value: guestFilter,
                    onChange: (event) => setGuestFilter(event.target.value),
                    placeholder: strings.addGuest ?? "Add someone"
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex flex-wrap gap-2", children: candidates.map((account) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  Button,
                  {
                    variant: "ghost",
                    disabled: call.isPending,
                    onClick: () => call.mutate({
                      path: `/plugins/sites/api/site/${siteId}/members`,
                      init: jsonBody("POST", { userId: account.id })
                    }),
                    children: account.name
                  },
                  account.id
                )) })
              ] }) : null
            ] })
          ] }) : null,
          tab === "danger" && site.canManage ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs uppercase tracking-wide text-text-muted", children: strings.deleteTitle ?? "Delete this site" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-[11px] text-text-muted", children: strings.deleteHint }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "danger", onClick: () => setConfirmDelete(true), children: strings.delete ?? "Delete site" }) })
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            ConfirmDialog,
            {
              open: pendingPublic,
              title: strings.publicConfirm ?? "Make public",
              description: strings.publicWarning,
              confirmLabel: strings.publicConfirm ?? "Make public",
              onClose: () => setPendingPublic(false),
              onConfirm: () => {
                setPendingPublic(false);
                call.mutate({ path: `/plugins/sites/api/site/${siteId}`, init: jsonBody("PATCH", { visibility: "public" }) });
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            ConfirmDialog,
            {
              open: confirmDelete,
              title: strings.deleteTitle ?? "Delete this site",
              description: strings.deleteHint,
              confirmLabel: strings.delete ?? "Delete site",
              onClose: () => setConfirmDelete(false),
              onConfirm: () => {
                setConfirmDelete(false);
                call.mutate(
                  { path: `/plugins/sites/api/site/${siteId}`, init: { method: "DELETE" }, done: strings.deleted },
                  { onSuccess: () => onClose() }
                );
              }
            }
          ),
          site.status === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { tone: "danger", children: strings.statusFailed ?? "Needs attention" }) : null
        ] }) : null
      ] })
    }
  );
}

// plugins/sites/web-src/SitesPage.tsx
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
var VISIBILITY_STRING2 = {
  private: "visibilityPrivate",
  project: "visibilityProject",
  authenticated: "visibilityAuthenticated",
  public: "visibilityPublic"
};
var VISIBILITY_TONE = {
  private: "muted",
  project: "muted",
  authenticated: "accent",
  public: "warning"
};
var STATUS_STRING = {
  live: "statusLive",
  draft: "statusDraft",
  failed: "statusFailed"
};
var STATUS_DOT = {
  live: "bg-success",
  draft: "bg-text-muted/50",
  failed: "bg-danger"
};
function SiteCard({ site, strings, onOpen }) {
  const { components, utils, hooks } = runtime();
  const { EntityRow, Badge, Button } = components;
  const { toast } = hooks.useToast();
  const built = site.lastPublishModel || site.createdModel;
  const when = relativeTime(site.lastPublishAt ?? site.createdAt);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(EntityRow, { interactive: true, onClick: () => onOpen(site), className: "flex flex-col gap-2 p-4", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex items-start justify-between gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-col gap-1", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[site.status]}`, "aria-hidden": true }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate text-sm font-medium text-text", children: site.title })
        ] }),
        site.summary ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "line-clamp-2 text-xs text-text-muted", children: site.summary }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex shrink-0 items-center gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Badge, { tone: VISIBILITY_TONE[site.visibility], children: strings[VISIBILITY_STRING2[site.visibility]] ?? site.visibility }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Badge, { tone: site.status === "failed" ? "danger" : "default", children: strings[STATUS_STRING[site.status]] ?? site.status })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate font-mono text-[11px] text-text-muted", children: site.url }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "flex shrink-0 items-center gap-1", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Button,
        {
          variant: "ghost",
          onClick: () => {
            utils.copyText(site.url);
            toast(strings.copied ?? "Copied");
          },
          title: strings.copyLink ?? "Copy address",
          children: strings.copyLink ?? "Copy address"
        }
      ) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-[11px] text-text-muted", children: site.status === "live" && site.lastPublishAt ? `${(strings.builtBy ?? "Built by {model}").replace("{model}", built || "\u2014")}${when ? ` \xB7 ${when}` : ""}` : strings.neverPublished ?? "Not published yet" })
  ] });
}
function SitesPage() {
  const { components, hooks } = runtime();
  const { WorkspacePage, PluginPageHeader, EntityList, LoadingState, ErrorState, EmptyState } = components;
  const strings = hooks.usePluginStrings("sites");
  const [openSite, setOpenSite] = (0, import_react4.useState)(null);
  const list = hooks.useQuery({
    queryKey: ["sites", "list"],
    queryFn: () => runtime().api("/plugins/sites/api/sites")
  });
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(WorkspacePage, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      PluginPageHeader,
      {
        title: strings.title ?? "Sites",
        description: strings.subtitle,
        icon: Globe
      }
    ),
    list.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(LoadingState, {}) : null,
    list.isError ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ErrorState, { title: strings.title ?? "Sites" }) : null,
    list.data ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex flex-col gap-6", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "flex flex-col gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { className: "text-xs uppercase tracking-wide text-text-muted", children: strings.mine ?? "My sites" }),
        list.data.mine.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EmptyState, { title: strings.empty ?? "No sites yet.", icon: Globe }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EntityList, { className: "flex flex-col gap-2", children: list.data.mine.map((site) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SiteCard, { site, strings, onOpen: setOpenSite }, site.id)) })
      ] }),
      list.data.shared.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "flex flex-col gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { className: "text-xs uppercase tracking-wide text-text-muted", children: strings.shared ?? "Shared with me" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EntityList, { className: "flex flex-col gap-2", children: list.data.shared.map((site) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SiteCard, { site, strings, onOpen: setOpenSite }, site.id)) })
      ] }) : null
    ] }) : null,
    openSite ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      SiteDetail,
      {
        siteId: openSite.id,
        strings,
        allowPublicSites: list.data?.allowPublicSites ?? false,
        dedicatedHost: list.data?.dedicatedHost ?? false,
        onClose: () => setOpenSite(null)
      }
    ) : null
  ] });
}

// plugins/sites/web-src/EnterPage.tsx
var import_react5 = __toESM(require_react(), 1);
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
function EnterPage() {
  const { components, hooks } = runtime();
  const { WorkspacePage, PluginPageHeader, LoadingState, EmptyState } = components;
  const strings = hooks.usePluginStrings("sites");
  const [phase, setPhase] = (0, import_react5.useState)("working");
  const formRef = (0, import_react5.useRef)(null);
  const [handoff, setHandoff] = (0, import_react5.useState)(null);
  const started = (0, import_react5.useRef)(false);
  (0, import_react5.useEffect)(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("site") ?? "";
    const returnPath = params.get("r") ?? "";
    if (!slug) {
      setPhase("denied");
      return;
    }
    void runtime().api("/plugins/sites/api/ticket", jsonBody("POST", { slug, r: returnPath })).then((data) => {
      const ticket = data;
      if (!ticket?.token || !ticket?.action) {
        setPhase("denied");
        return;
      }
      setHandoff({ action: ticket.action, token: ticket.token });
    }).catch(() => setPhase("denied"));
  }, []);
  (0, import_react5.useEffect)(() => {
    if (handoff) formRef.current?.submit();
  }, [handoff]);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(WorkspacePage, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(PluginPageHeader, { title: strings.title ?? "Sites", icon: Globe }),
    phase === "working" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(LoadingState, {}) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      EmptyState,
      {
        title: strings.emptyShared ?? "You do not have access to this site.",
        description: strings.subtitle,
        icon: Globe
      }
    ),
    handoff ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("form", { ref: formRef, method: "POST", action: handoff.action, className: "hidden", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "hidden", name: "t", value: handoff.token }) }) : null
  ] });
}

// plugins/sites/web-src/SitesProjectPanel.tsx
var import_react6 = __toESM(require_react(), 1);
var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
function SitesProjectPanel({ project }) {
  const { components, hooks } = runtime();
  const { EntityList, LoadingState, EmptyState } = components;
  const strings = hooks.usePluginStrings("sites");
  const [openSite, setOpenSite] = (0, import_react6.useState)(null);
  const list = hooks.useQuery({
    queryKey: ["sites", "list"],
    queryFn: () => runtime().api("/plugins/sites/api/sites")
  });
  if (list.isLoading) return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(LoadingState, {});
  const sites = [...list.data?.mine ?? [], ...list.data?.shared ?? []].filter((site) => site.projectId === project.id);
  if (sites.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(EmptyState, { title: strings.empty ?? "No sites yet.", icon: Globe });
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex flex-col gap-2", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(EntityList, { className: "flex flex-col gap-2", children: sites.map((site) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(SiteCard, { site, strings, onOpen: setOpenSite }, site.id)) }),
    openSite ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      SiteDetail,
      {
        siteId: openSite.id,
        strings,
        allowPublicSites: list.data?.allowPublicSites ?? false,
        dedicatedHost: list.data?.dedicatedHost ?? false,
        onClose: () => setOpenSite(null)
      }
    ) : null
  ] });
}

// plugins/sites/web-src/index.tsx
registerSitesUi(
  {
    "": SitesPage,
    enter: EnterPage
  },
  { sites: SitesProjectPanel }
);
