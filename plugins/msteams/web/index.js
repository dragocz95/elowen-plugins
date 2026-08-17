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

// plugins/msteams/web-src/runtime.ts
function runtime() {
  const value = window.ElowenUiRuntime;
  if (!value) throw new Error("ElowenUiRuntime is not installed");
  return value;
}
function registerTeamsUi(registration) {
  window.__elowenRegisterPluginUi?.("msteams", registration);
}
async function apiJson(path, init) {
  return await runtime().api(path, init);
}

// plugins/msteams/web-src/TeamsWorkspace.tsx
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

// node_modules/lucide-react/dist/esm/icons/download.js
var Download = createLucideIcon("Download", [
  ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", key: "ih7n3h" }],
  ["polyline", { points: "7 10 12 15 17 10", key: "2ggqvy" }],
  ["line", { x1: "12", x2: "12", y1: "15", y2: "3", key: "1vk2je" }]
]);

// node_modules/lucide-react/dist/esm/icons/key-round.js
var KeyRound = createLucideIcon("KeyRound", [
  [
    "path",
    {
      d: "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z",
      key: "1s6t7t"
    }
  ],
  ["circle", { cx: "16.5", cy: "7.5", r: ".5", fill: "currentColor", key: "w0ekpg" }]
]);

// node_modules/lucide-react/dist/esm/icons/message-circle.js
var MessageCircle = createLucideIcon("MessageCircle", [
  ["path", { d: "M7.9 20A9 9 0 1 0 4 16.1L2 22Z", key: "vv11sd" }]
]);

// node_modules/lucide-react/dist/esm/icons/search.js
var Search = createLucideIcon("Search", [
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ["path", { d: "m21 21-4.3-4.3", key: "1qie3q" }]
]);

// node_modules/lucide-react/dist/esm/icons/settings-2.js
var Settings2 = createLucideIcon("Settings2", [
  ["path", { d: "M20 7h-9", key: "3s1dr2" }],
  ["path", { d: "M14 17H5", key: "gfn3mx" }],
  ["circle", { cx: "17", cy: "17", r: "3", key: "18b49y" }],
  ["circle", { cx: "7", cy: "7", r: "3", key: "dfmy0x" }]
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

// node_modules/lucide-react/dist/esm/icons/user-check.js
var UserCheck = createLucideIcon("UserCheck", [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
  ["polyline", { points: "16 11 18 13 22 9", key: "1pwet4" }]
]);

// node_modules/lucide-react/dist/esm/icons/users.js
var Users = createLucideIcon("Users", [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
  ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87", key: "kshegd" }],
  ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75", key: "1da9ce" }]
]);

// plugins/msteams/web-src/TeamsWorkspace.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
function matchesPerson(policy, person) {
  const roleId = policy.roleId.trim();
  if (roleId === "" || roleId === "*") return false;
  if (person.upn && roleId.includes("@") && roleId.toLowerCase() === person.upn.toLowerCase()) return true;
  return [person.aadObjectId, person.teamsId].some((id) => id !== "" && roleId === id);
}
function directPolicyIndex(policies, person) {
  const direct = policies.findIndex((policy) => matchesPerson(policy, person));
  const wildcard = policies.findIndex((policy) => policy.roleId.trim() === "*");
  return direct >= 0 && (wildcard < 0 || direct < wildcard) ? direct : -1;
}
function primaryId(person) {
  return person.aadObjectId || person.upn || person.teamsId || person.key;
}
function policiesOf(values) {
  return Array.isArray(values.rolePolicies) ? values.rolePolicies : [];
}
function PeopleAccess({ draft, response }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("msteams");
  const users = hooks.useUsers().data ?? [];
  const projects = hooks.useProjects().data ?? [];
  const plugins = hooks.usePlugins().data ?? [];
  const [search, setSearch] = (0, import_react3.useState)("");
  const [filter, setFilter] = (0, import_react3.useState)("all");
  const [selectedKey, setSelectedKey] = (0, import_react3.useState)(response.people[0]?.key ?? null);
  const [toolsOpen, setToolsOpen] = (0, import_react3.useState)(false);
  const policies = policiesOf(draft.values);
  const visible = response.people.filter((person) => {
    const mapped = directPolicyIndex(policies, person) >= 0;
    if (filter === "mapped" && !mapped) return false;
    if (filter === "unmapped" && mapped) return false;
    const haystack = `${person.name} ${person.upn} ${person.aadObjectId}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });
  const selected = response.people.find((person) => person.key === selectedKey) ?? visible[0] ?? null;
  const policyIndex = selected === null ? -1 : directPolicyIndex(policies, selected);
  const policy = policyIndex >= 0 ? policies[policyIndex] : null;
  const replacePolicies = (next) => draft.setValue("rolePolicies", next);
  const createPolicy = () => {
    if (selected === null) return;
    const nextPolicy = { roleId: primaryId(selected), name: selected.name || selected.upn || s.personFallback, projectIds: [], prompt: "", tools: [] };
    const wildcard = policies.findIndex((item) => item.roleId.trim() === "*");
    const next = [...policies];
    next.splice(wildcard < 0 ? next.length : wildcard, 0, nextPolicy);
    replacePolicies(next);
  };
  const patchPolicy = (patch) => {
    if (policyIndex < 0) return;
    replacePolicies(policies.map((item, index) => index === policyIndex ? { ...item, ...patch } : item));
  };
  const removePolicy = () => {
    if (policyIndex < 0) return;
    replacePolicies(policies.filter((_, index) => index !== policyIndex));
  };
  const owners = /* @__PURE__ */ new Map();
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    for (const tool of plugin.provides.tools ?? []) if (!owners.has(tool)) owners.set(tool, plugin.name);
  }
  const selectedTools = policy?.tools ?? [];
  const knownTools = new Set(owners.keys());
  const toolItems = [
    ...selectedTools.filter((tool) => !knownTools.has(tool)).map((tool) => ({ id: tool, label: tool, group: s.unavailableTools })),
    ...[...owners.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tool, plugin]) => ({ id: tool, label: tool, group: plugin }))
  ];
  const accountOptions = [
    { value: "", label: s.accountNone },
    ...policy?.elowenUser && !users.some((user) => user.username === policy.elowenUser) ? [{ value: policy.elowenUser, label: policy.elowenUser }] : [],
    ...users.map((user) => ({ value: user.username, label: user.name ? `${user.name} \xB7 @${user.username}` : `@${user.username}` }))
  ];
  const inherited = policies.some((item) => item.roleId === "*");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.ControlSurfaceDocument, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceToolbar, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex w-full flex-wrap items-center gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "relative min-w-[15rem] flex-1", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Search, { size: 14, "aria-hidden": true, className: "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Input, { value: search, onChange: (event) => setSearch(event.target.value), placeholder: s.peopleSearch, className: "pl-9" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex rounded-lg border border-border bg-surface p-1", children: ["all", "mapped", "unmapped"].map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          onClick: () => setFilter(value),
          className: `rounded-md px-3 py-1.5 text-xs font-medium transition ${filter === value ? "bg-accent text-accent-foreground" : "text-text-muted hover:text-text"}`,
          children: value === "all" ? s.filterAll : value === "mapped" ? s.filterMapped : s.filterUnmapped
        },
        value
      )) })
    ] }) }),
    response.people.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.EmptyState, { title: s.peopleEmptyTitle, description: s.peopleEmptyDescription, icon: Users }) }) : visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.EmptyState, { title: s.peopleNoResults, description: s.peopleNoResultsDescription, icon: Search }) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.ControlSurfaceRegister, { className: "grid min-h-[31rem] grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(24rem,1.2fr)]", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex min-w-0 flex-col gap-2", children: visible.map((person) => {
        const mapped = directPolicyIndex(policies, person) >= 0;
        const active = selected?.key === person.key;
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            type: "button",
            onClick: () => setSelectedKey(person.key),
            className: `flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${active ? "border-accent/60 bg-accent/10" : "border-border bg-surface hover:border-border-strong hover:bg-elevated/50"}`,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Avatar, { name: person.name || person.upn || s.personFallback, size: "md" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "min-w-0 flex-1", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "block truncate text-sm font-semibold text-text", children: person.name || s.personFallback }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "block truncate text-xs text-text-muted", children: person.upn || person.aadObjectId })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "flex shrink-0 flex-col items-end gap-1", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: mapped ? "accent" : void 0, children: mapped ? s.badgeMapped : inherited ? s.badgeInherited : s.badgeUnmapped }),
                person.hasPersonalChat ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "inline-flex items-center gap-1 text-[11px] text-text-muted", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MessageCircle, { size: 11, "aria-hidden": true }),
                  s.chatOpen
                ] }) : null
              ] })
            ]
          },
          person.key
        );
      }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "min-w-0 rounded-xl border border-border bg-elevated/30 p-5", children: selected === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-start gap-3", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Avatar, { name: selected.name || selected.upn || s.personFallback, size: "lg" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "min-w-0 flex-1", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "truncate text-base font-semibold text-text", children: selected.name || s.personFallback }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "truncate text-sm text-text-muted", children: selected.upn || selected.aadObjectId }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-1 font-mono text-[11px] text-text-subtle", children: selected.aadObjectId || selected.teamsId })
          ] }),
          policy ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "ghost", onClick: removePolicy, children: s.removeAccess }) : null
        ] }),
        policy === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 text-center", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UserCheck, { size: 28, className: "text-text-muted", "aria-hidden": true }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-sm font-semibold text-text", children: inherited ? s.inheritedTitle : s.unmappedTitle }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-1 max-w-md text-xs leading-relaxed text-text-muted", children: inherited ? s.inheritedDescription : s.unmappedDescription })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "accent", icon: KeyRound, onClick: createPolicy, children: s.configureAccess })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.accountLabel, hint: s.accountHint, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            C.SelectMenu,
            {
              value: policy.elowenUser ?? "",
              onChange: (value) => patchPolicy({ elowenUser: value || void 0 }),
              options: accountOptions,
              label: s.accountLabel
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-3", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Toggle, { checked: policy.admin === true, onChange: (value) => patchPolicy({ admin: value }), label: s.adminLabel }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "block text-sm font-medium text-text", children: s.adminLabel }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "block text-xs leading-relaxed text-text-muted", children: s.adminHint })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.projectsLabel, hint: s.projectsHint, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-border bg-surface p-3", children: [
            projects.map((project) => {
              const checked = policy.projectIds.includes(project.id);
              return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "flex cursor-pointer items-center gap-2 text-sm text-text", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { onClick: () => patchPolicy({ projectIds: checked ? policy.projectIds.filter((id) => id !== project.id) : [...policy.projectIds, project.id] }), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Checkbox, { checked }) }),
                project.name || project.slug
              ] }, project.id);
            }),
            projects.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs text-text-muted", children: s.projectsEmpty }) : null
          ] }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.toolsLabel, hint: s.toolsHint, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            C.SelectionSummary,
            {
              countText: selectedTools.length === 0 ? s.toolsAll : s.toolsCount.replace("{n}", String(selectedTools.length)),
              samples: selectedTools.slice(0, 3).map((tool) => ({ label: tool })),
              moreCount: Math.max(0, selectedTools.length - 3),
              onManage: () => setToolsOpen(true),
              manageLabel: s.manageTools
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            C.ManageSelectionModal,
            {
              title: s.toolsLabel,
              open: toolsOpen,
              onClose: () => setToolsOpen(false),
              items: toolItems,
              selected: new Set(selectedTools),
              onSave: (next) => patchPolicy({ tools: [...next] }),
              emptySelectionHint: s.toolsAll,
              countLabel: (count) => s.toolsCount.replace("{n}", String(count))
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.promptLabel, hint: s.promptHint, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "textarea",
            {
              value: policy.prompt ?? "",
              onChange: (event) => patchPolicy({ prompt: event.target.value }),
              rows: 5,
              className: "w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition focus:border-accent",
              placeholder: s.promptPlaceholder
            }
          ) })
        ] })
      ] }) })
    ] })
  ] });
}
function LoadedWorkspace({ detail }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("msteams");
  const { locale } = hooks.useTranslation();
  const draft = hooks.usePluginConfigDraft("msteams", detail);
  const [tab, setTab] = (0, import_react3.useState)("people");
  const [people, setPeople] = (0, import_react3.useState)(null);
  const [peopleError, setPeopleError] = (0, import_react3.useState)(null);
  (0, import_react3.useEffect)(() => {
    let live = true;
    void apiJson("/plugins/msteams/people").then((value) => {
      if (live) setPeople(value);
    }).catch((error) => {
      if (live) setPeopleError(utils.apiErrorMessage(error));
    });
    return () => {
      live = false;
    };
  }, [utils]);
  const policies = policiesOf(draft.values);
  const mappedCount = people?.people.filter((person) => directPolicyIndex(policies, person) >= 0).length ?? 0;
  const openChats = people?.people.filter((person) => person.hasPersonalChat).length ?? 0;
  const adminCount = policies.filter((policy) => policy.admin === true).length;
  const configured = Boolean(String(draft.values.appId ?? "").trim() && String(draft.values.tenantId ?? "").trim() && detail.secretsSet.includes("appPassword"));
  const overlay = detail.i18n?.[locale]?.fields ?? {};
  const fieldLabel = (field) => overlay[field.key]?.label ?? field.label;
  const fieldHint = (field) => overlay[field.key]?.hint ?? field.hint;
  const fieldOptions = (field) => (field.options ?? []).map((option) => ({ value: option.value, label: overlay[field.key]?.options?.[option.value] ?? option.label }));
  const riskText = (risk) => risk === "high" ? s.riskHigh : risk === "medium" ? s.riskMedium : s.riskLow;
  const hero = {
    eyebrow: s.workspaceEyebrow,
    title: s.title,
    description: s.workspaceIntro,
    mascotState: peopleError !== null || !configured ? "error" : draft.status === "saving" ? "saving" : "idle",
    status: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "flex items-center gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "workspace-status", children: configured && people?.active ? s.workspaceReady : s.workspaceSetup }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.AutoSaveStatus, { status: draft.status, onRetry: draft.retry })
    ] }),
    action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "accent", icon: Download, disabled: !configured, onClick: () => {
      window.location.href = "/api/plugins/msteams/app-package";
    }, children: s.downloadPackage }),
    metrics: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: s.metricPeople, value: people?.people.length ?? "\u2014", icon: Users }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: s.metricMapped, value: people === null ? "\u2014" : mappedCount, icon: UserCheck }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: s.metricChats, value: people === null ? "\u2014" : openChats, icon: MessageCircle }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: s.metricAdmins, value: adminCount, icon: ShieldCheck })
    ] })
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    C.SpatialWorkspaceLayout,
    {
      hero,
      navigation: {
        sections: [
          { id: "people", label: s.peopleTab, icon: Users },
          { id: "settings", label: s.settingsTab, icon: Settings2 }
        ],
        value: tab,
        onChange: (value) => setTab(value),
        ariaLabel: s.title
      },
      children: tab === "people" ? peopleError !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceState, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ErrorState, { message: `${s.peopleLoadError} \u2014 ${peopleError}` }) }) }) : people === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.LoadingState, { variant: "list" }) }) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeopleAccess, { draft, response: people }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.SettingsDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        C.PluginConfigEditor,
        {
          name: "msteams",
          detail,
          draft,
          mode: "all",
          fieldLabel,
          fieldHint,
          fieldOptions,
          riskText
        }
      ) })
    }
  );
}
function TeamsWorkspace() {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("msteams");
  const detail = hooks.usePluginDetail("msteams");
  const hero = (0, import_react3.useMemo)(() => ({ eyebrow: s.workspaceEyebrow, title: s.title, description: s.workspaceIntro }), [s]);
  if (detail.isError) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.SpatialWorkspaceLayout, { hero, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceState, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ErrorState, { message: s.settingsLoadError, onRetry: () => detail.refetch() }) }) }) });
  }
  if (detail.isLoading || detail.data === void 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.SpatialWorkspaceLayout, { hero, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.LoadingState, { variant: "cards" }) }) }) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoadedWorkspace, { detail: detail.data });
}

// plugins/msteams/web-src/index.tsx
registerTeamsUi({
  requiresApiVersion: 2,
  pages: { "": TeamsWorkspace }
});
