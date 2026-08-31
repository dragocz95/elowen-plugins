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

// ../elowen-plugins/node_modules/elowen-plugin-ui-kit/shims/react.cjs
var require_react = __commonJS({
  "../elowen-plugins/node_modules/elowen-plugin-ui-kit/shims/react.cjs"(exports, module) {
    var runtime2 = typeof window !== "undefined" ? window.ElowenUiRuntime : void 0;
    if (!runtime2) throw new Error("elowen-plugin-ui-kit: window.ElowenUiRuntime is missing \u2014 plugin bundles only run inside the Elowen web app");
    module.exports = runtime2.react;
  }
});

// ../elowen-plugins/node_modules/elowen-plugin-ui-kit/shims/jsx-runtime.cjs
var require_jsx_runtime = __commonJS({
  "../elowen-plugins/node_modules/elowen-plugin-ui-kit/shims/jsx-runtime.cjs"(exports, module) {
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

// ../elowen-plugins/node_modules/lucide-react/dist/esm/createLucideIcon.js
var import_react2 = __toESM(require_react());

// ../elowen-plugins/node_modules/lucide-react/dist/esm/shared/src/utils.js
var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
var mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();

// ../elowen-plugins/node_modules/lucide-react/dist/esm/Icon.js
var import_react = __toESM(require_react());

// ../elowen-plugins/node_modules/lucide-react/dist/esm/defaultAttributes.js
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

// ../elowen-plugins/node_modules/lucide-react/dist/esm/Icon.js
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

// ../elowen-plugins/node_modules/lucide-react/dist/esm/createLucideIcon.js
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

// ../elowen-plugins/node_modules/lucide-react/dist/esm/icons/download.js
var Download = createLucideIcon("Download", [
  ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", key: "ih7n3h" }],
  ["polyline", { points: "7 10 12 15 17 10", key: "2ggqvy" }],
  ["line", { x1: "12", x2: "12", y1: "15", y2: "3", key: "1vk2je" }]
]);

// ../elowen-plugins/node_modules/lucide-react/dist/esm/icons/key-round.js
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

// ../elowen-plugins/node_modules/lucide-react/dist/esm/icons/message-circle.js
var MessageCircle = createLucideIcon("MessageCircle", [
  ["path", { d: "M7.9 20A9 9 0 1 0 4 16.1L2 22Z", key: "vv11sd" }]
]);

// ../elowen-plugins/node_modules/lucide-react/dist/esm/icons/refresh-cw.js
var RefreshCw = createLucideIcon("RefreshCw", [
  ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", key: "v9h5vc" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }],
  ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", key: "3uifl3" }],
  ["path", { d: "M8 16H3v5", key: "1cv678" }]
]);

// ../elowen-plugins/node_modules/lucide-react/dist/esm/icons/search.js
var Search = createLucideIcon("Search", [
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ["path", { d: "m21 21-4.3-4.3", key: "1qie3q" }]
]);

// ../elowen-plugins/node_modules/lucide-react/dist/esm/icons/settings-2.js
var Settings2 = createLucideIcon("Settings2", [
  ["path", { d: "M20 7h-9", key: "3s1dr2" }],
  ["path", { d: "M14 17H5", key: "gfn3mx" }],
  ["circle", { cx: "17", cy: "17", r: "3", key: "18b49y" }],
  ["circle", { cx: "7", cy: "7", r: "3", key: "dfmy0x" }]
]);

// ../elowen-plugins/node_modules/lucide-react/dist/esm/icons/shield-check.js
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

// ../elowen-plugins/node_modules/lucide-react/dist/esm/icons/user-check.js
var UserCheck = createLucideIcon("UserCheck", [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
  ["polyline", { points: "16 11 18 13 22 9", key: "1pwet4" }]
]);

// ../elowen-plugins/node_modules/lucide-react/dist/esm/icons/users.js
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
function isBroadPolicy(policy) {
  const roleId = policy.roleId.trim();
  return roleId === "*" || roleId.startsWith("a:") || roleId.startsWith("19:");
}
function directPolicyIndex(policies, person) {
  const direct = policies.findIndex((policy) => matchesPerson(policy, person));
  if (direct < 0) return -1;
  const broad = policies.findIndex(isBroadPolicy);
  return broad < 0 || direct < broad ? direct : -1;
}
function effectivePersonPolicy(policies, person) {
  return policies.find((policy) => policy.roleId.trim() === "*" || matchesPerson(policy, person));
}
function upsertDirectPolicy(policies, person, nextPolicy) {
  const existing = policies.find((policy) => matchesPerson(policy, person));
  const next = policies.filter((policy) => !matchesPerson(policy, person));
  const broad = next.findIndex(isBroadPolicy);
  next.splice(broad < 0 ? next.length : broad, 0, existing ?? nextPolicy);
  return next;
}
function primaryId(person) {
  return person.aadObjectId || person.upn || person.teamsId || person.key;
}
function policiesOf(values) {
  return Array.isArray(values.rolePolicies) ? values.rolePolicies : [];
}
function globalSettingsDetail(detail) {
  return {
    ...detail,
    configSchema: detail.configSchema.filter((field) => field.key !== "sec_roles" && field.key !== "rolePolicies")
  };
}
function linkedUserFor(person, users) {
  const identityUser = person.identity?.user;
  if (!identityUser) return void 0;
  return users.find((user) => user.id === identityUser.id || user.username.toLowerCase() === identityUser.username.toLowerCase());
}
function accountDetailPath(aadObjectId) {
  return `/plugins/msteams/people/${encodeURIComponent(aadObjectId)}/account`;
}
function accountIdentityFromDetail(detail) {
  return {
    linked: detail.linked,
    ...detail.user ? { user: { id: detail.user.id, username: detail.user.username, isAdmin: detail.user.isAdmin } } : {},
    ...detail.linkedAt ? { linkedAt: detail.linkedAt } : {}
  };
}
function bindAccountRequest(userId, replace = false) {
  return {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, ...replace ? { replace: true } : {} })
  };
}
function peopleWithAccountDetail(response, aadObjectId, detail) {
  return {
    ...response,
    people: response.people.map((person) => person.aadObjectId === aadObjectId ? { ...person, identity: accountIdentityFromDetail(detail) } : person)
  };
}
function accountLinkOptions(linkedUserId, users, noneLabel) {
  return [
    ...linkedUserId === void 0 ? [{ value: "", label: noneLabel }] : [],
    ...users.map((user) => ({
      value: String(user.id),
      label: user.name ? `${user.name} \xB7 @${user.username}` : `@${user.username}`,
      user
    }))
  ];
}
function formatTimestamp(value) {
  if (value === null || value === void 0 || value === "") return "\u2014";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "\u2014" : new Intl.DateTimeFormat(void 0, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function IdentityCard({ person, users, onDetail }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("msteams");
  const [detail, setDetail] = (0, import_react3.useState)(null);
  const [loading, setLoading] = (0, import_react3.useState)(false);
  const [pending, setPending] = (0, import_react3.useState)(false);
  const [error, setError] = (0, import_react3.useState)(null);
  const [replacement, setReplacement] = (0, import_react3.useState)(null);
  (0, import_react3.useEffect)(() => {
    let live = true;
    setDetail(null);
    setError(null);
    setReplacement(null);
    if (!person.aadObjectId) {
      setLoading(false);
      return () => {
        live = false;
      };
    }
    setLoading(true);
    void apiJson(accountDetailPath(person.aadObjectId)).then((value) => {
      if (!live) return;
      setDetail(value);
      onDetail(person.aadObjectId, value);
    }).catch((reason) => {
      if (live) setError(utils.apiErrorMessage(reason));
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [onDetail, person.aadObjectId, utils]);
  const applyDetail = (value) => {
    setDetail(value);
    setError(null);
    onDetail(person.aadObjectId, value);
  };
  const bind = async (user, replace) => {
    setPending(true);
    setError(null);
    try {
      applyDetail(await apiJson(accountDetailPath(person.aadObjectId), bindAccountRequest(user.id, replace)));
      setReplacement(null);
    } catch (reason) {
      setError(utils.apiErrorMessage(reason));
    } finally {
      setPending(false);
    }
  };
  const signOut = async () => {
    setPending(true);
    setError(null);
    try {
      applyDetail(await apiJson(`${accountDetailPath(person.aadObjectId).replace(/\/account$/, "")}/signout`, { method: "POST" }));
    } catch (reason) {
      setError(utils.apiErrorMessage(reason));
    } finally {
      setPending(false);
    }
  };
  const identity = detail ?? { linked: person.identity?.linked === true, user: person.identity?.user, linkedAt: person.identity?.linkedAt, signedIn: false };
  const linkedHostUser = identity.user ? users.find((user) => user.id === identity.user?.id || user.username.toLowerCase() === identity.user?.username.toLowerCase()) : void 0;
  const accountOptions = accountLinkOptions(identity.user?.id, users, s.accountNone).map((option) => ({
    value: option.value,
    label: option.label,
    icon: option.user ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Avatar, { name: option.user.name || option.user.username, user: option.user, size: "sm" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UserCheck, { size: 15 })
  }));
  const statusLabel = identity.linked ? identity.signedIn ? s.identityConnected : s.identityNeedsSignIn : s.identityNotLinked;
  const profile = detail?.profile;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "rounded-xl border border-border bg-card p-4", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-wrap items-start justify-between gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs font-medium uppercase tracking-wide text-muted-foreground", children: s.identityTitle }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mt-2 flex items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: identity.signedIn ? "success" : identity.linked ? "warning" : void 0, children: statusLabel }),
          loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs text-muted-foreground", children: s.identityLoading }) : null
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "ghost", icon: RefreshCw, disabled: pending || !person.aadObjectId, onClick: () => void signOut(), children: s.identityForceSignIn })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mt-4 grid gap-4 sm:grid-cols-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "space-y-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs font-semibold text-foreground", children: s.identityMicrosoftProfile }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-sm text-foreground", children: profile?.displayName || person.name || s.personFallback }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "break-all text-xs text-muted-foreground", children: profile?.userPrincipalName || person.upn || "\u2014" }),
        profile?.mail && profile.mail !== profile.userPrincipalName ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "break-all text-xs text-muted-foreground", children: profile.mail }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "break-all font-mono text-[11px] text-subtle-foreground", children: profile?.id || person.aadObjectId || "\u2014" }),
        profile ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "text-xs text-muted-foreground", children: [
          profile.userType,
          " \xB7 ",
          profile.accountEnabled ? s.identityAccountEnabled : s.identityAccountDisabled
        ] }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "space-y-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs font-semibold text-foreground", children: s.identityElowenAccount }),
        identity.user ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Avatar, { name: linkedHostUser?.name || identity.user.username, user: linkedHostUser, size: "md" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "min-w-0 flex-1", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "truncate text-sm font-medium text-foreground", children: linkedHostUser?.name || `@${identity.user.username}` }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "truncate text-xs text-muted-foreground", children: [
              "@",
              identity.user.username
            ] })
          ] }),
          identity.user.isAdmin ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: "accent", children: s.identityAdmin }) : null
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-xs text-muted-foreground", children: s.identityNoElowenAccount }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: identity.user ? s.identityChangeAccount : s.identityLinkAccount, hint: s.identityLinkAccountHint, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          C.SelectMenu,
          {
            value: identity.user ? String(identity.user.id) : "",
            onChange: (value) => {
              const user = users.find((candidate) => String(candidate.id) === value);
              if (!user || user.id === identity.user?.id) return;
              if (identity.linked) setReplacement(user);
              else void bind(user, false);
            },
            options: accountOptions,
            label: identity.user ? s.identityChangeAccount : s.identityLinkAccount,
            disabled: pending
          }
        ) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: person.hasPersonalChat ? s.identityPersonalChatOpen : s.identityPersonalChatMissing }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: s.identityLastSeen.replace("{value}", formatTimestamp(person.lastSeenAt)) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: identity.signedIn ? s.identitySessionActive : s.identitySessionSignedOut }),
      identity.linkedAt ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: s.identityLinkedAt.replace("{value}", formatTimestamp(identity.linkedAt)) }) : null,
      detail?.verifiedAt ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: s.identityVerifiedAt.replace("{value}", formatTimestamp(detail.verifiedAt)) }) : null
    ] }),
    pending ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-3 text-xs text-muted-foreground", "aria-live": "polite", children: s.identitySaving }) : null,
    error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-3 text-xs text-destructive", role: "alert", children: error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      C.ConfirmDialog,
      {
        open: replacement !== null,
        title: s.identityReplaceTitle,
        description: replacement ? s.identityReplaceDescription.replace("{username}", replacement.username) : "",
        confirmLabel: s.identityReplaceConfirm,
        onConfirm: () => {
          if (replacement) void bind(replacement, true);
        },
        onClose: () => setReplacement(null)
      }
    )
  ] });
}
function PeopleAccess({ draft, response, search, filter, onIdentityDetail }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("msteams");
  const users = hooks.useUsers().data ?? [];
  const [selectedKey, setSelectedKey] = (0, import_react3.useState)(response.people[0]?.key ?? null);
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
  const accountLinking = draft.values.accountLinking === true;
  const selectedUser = selected === null ? void 0 : linkedUserFor(selected, users);
  const replacePolicies = (next) => draft.setValue("rolePolicies", next);
  const createPolicy = () => {
    if (selected === null) return;
    const nextPolicy = { roleId: primaryId(selected), name: selected.name || selected.upn || s.personFallback, prompt: "" };
    replacePolicies(upsertDirectPolicy(policies, selected, nextPolicy));
  };
  const patchPolicy = (patch) => {
    if (policyIndex < 0) return;
    replacePolicies(policies.map((item, index) => index === policyIndex ? { ...item, ...patch } : item));
  };
  const removePolicy = () => {
    if (policyIndex < 0) return;
    replacePolicies(policies.filter((_, index) => index !== policyIndex));
  };
  const inherited = policies.some((item) => item.roleId === "*");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceDocument, { children: response.people.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.EmptyState, { title: s.peopleEmptyTitle, description: s.peopleEmptyDescription, icon: Users }) }) : visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.EmptyState, { title: s.peopleNoResults, description: s.peopleNoResultsDescription, icon: Search }) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.ControlSurfaceRegister, { className: "grid min-h-[31rem] grid-cols-1 gap-4 p-4 lg:!grid-cols-[19rem_minmax(0,1fr)] lg:items-start", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex min-w-0 flex-col gap-1 lg:max-h-[calc(100dvh-15rem)] lg:overflow-y-auto lg:pr-1", children: visible.map((person) => {
      const mapped = directPolicyIndex(policies, person) >= 0;
      const linkedUser = linkedUserFor(person, users);
      const active = selected?.key === person.key;
      const accessLabel = mapped ? s.badgeMapped : inherited ? s.badgeInherited : s.badgeUnmapped;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          "aria-pressed": active,
          onClick: () => setSelectedKey(person.key),
          className: `group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${active ? "border-primary/50 bg-accent text-accent-foreground" : "border-transparent bg-transparent text-foreground hover:border-border hover:bg-accent hover:text-accent-foreground"}`,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Avatar, { name: person.name || person.upn || s.personFallback, src: person.teamsAvatarUrl, user: linkedUser, size: "md" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "min-w-0 flex-1", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "block truncate text-sm font-semibold", children: person.name || s.personFallback }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `block truncate text-xs ${active ? "text-accent-foreground opacity-70" : "text-muted-foreground group-hover:text-accent-foreground"}`, children: person.upn || person.aadObjectId })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "inline-flex shrink-0 items-center", title: accessLabel, "aria-label": accessLabel, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `size-2 rounded-full ${mapped ? "bg-primary" : "bg-border-strong"}`, "aria-hidden": true }) })
          ]
        },
        person.key
      );
    }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "min-w-0 rounded-xl border border-border bg-muted/30 p-5 lg:sticky lg:top-4 lg:self-start", children: selected === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-5", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Avatar, { name: selected.name || selected.upn || s.personFallback, src: selected.teamsAvatarUrl, user: selectedUser, size: "lg" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "min-w-0", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "truncate text-base font-semibold text-foreground", children: selected.name || s.personFallback }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "truncate text-sm text-muted-foreground", children: selected.upn || selected.aadObjectId }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-1 break-all font-mono text-[11px] text-subtle-foreground", children: selected.aadObjectId || selected.teamsId }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mt-2 flex flex-wrap items-center gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: policy ? "accent" : void 0, children: policy ? s.badgeMapped : inherited ? s.badgeInherited : s.badgeUnmapped }),
            selected.hasPersonalChat ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "inline-flex items-center gap-1 text-xs text-muted-foreground", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MessageCircle, { size: 12, "aria-hidden": true }),
              s.chatOpen
            ] }) : null
          ] })
        ] }),
        policy ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "col-span-2 sm:col-span-1", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "ghost", onClick: removePolicy, children: s.removeAccess }) }) : null
      ] }),
      accountLinking ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdentityCard, { person: selected, users, onDetail: onIdentityDetail }, selected.key) : null,
      policy === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 text-center", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UserCheck, { size: 28, className: "text-muted-foreground", "aria-hidden": true }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-sm font-semibold text-foreground", children: inherited ? s.inheritedTitle : s.unmappedTitle }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "mt-1 max-w-md text-xs leading-relaxed text-muted-foreground", children: inherited ? s.inheritedDescription : s.unmappedDescription })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "accent", icon: KeyRound, onClick: createPolicy, children: s.configureAccess })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Toggle, { checked: policy.admin === true, onChange: (value) => patchPolicy({ admin: value }), label: s.adminLabel }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "block text-sm font-medium text-foreground", children: s.adminLabel }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "block text-xs leading-relaxed text-muted-foreground", children: s.adminHint })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.promptLabel, hint: s.promptHint, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "textarea",
          {
            value: policy.prompt ?? "",
            onChange: (event) => patchPolicy({ prompt: event.target.value }),
            rows: 5,
            className: "w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary",
            placeholder: s.promptPlaceholder
          }
        ) })
      ] })
    ] }) })
  ] }) });
}
function LoadedWorkspace({ detail }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("msteams");
  const { locale } = hooks.useTranslation();
  const draft = hooks.usePluginConfigDraft("msteams", detail);
  const [tab, setTab] = (0, import_react3.useState)("people");
  const [search, setSearch] = (0, import_react3.useState)("");
  const [filter, setFilter] = (0, import_react3.useState)("all");
  const [people, setPeople] = (0, import_react3.useState)(null);
  const [peopleError, setPeopleError] = (0, import_react3.useState)(null);
  const updateIdentityDetail = (0, import_react3.useCallback)((aadObjectId, account) => {
    setPeople((current) => current ? peopleWithAccountDetail(current, aadObjectId, account) : current);
  }, []);
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
  const adminCount = people === null ? "\u2014" : people.people.filter((person) => effectivePersonPolicy(policies, person)?.admin === true).length;
  const configured = Boolean(String(draft.values.appId ?? "").trim() && String(draft.values.tenantId ?? "").trim() && detail.secretsSet.includes("appPassword"));
  const overlay = detail.i18n?.[locale]?.fields ?? {};
  const fieldLabel = (field) => overlay[field.key]?.label ?? field.label;
  const fieldHint = (field) => overlay[field.key]?.hint ?? field.hint;
  const fieldOptions = (field) => (field.options ?? []).map((option) => ({ value: option.value, label: overlay[field.key]?.options?.[option.value] ?? option.label }));
  const riskText = (risk) => risk === "high" ? s.riskHigh : risk === "medium" ? s.riskMedium : s.riskLow;
  const toolbarFilters = [{
    id: "mapping",
    label: s.peopleFilter,
    control: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      C.Segmented,
      {
        "aria-label": s.peopleFilter,
        value: filter,
        onChange: (value) => setFilter(value),
        options: [
          { value: "all", label: s.filterAll },
          { value: "mapped", label: s.filterMapped },
          { value: "unmapped", label: s.filterUnmapped }
        ]
      }
    ),
    ...filter === "all" ? { active: false } : { active: true, activeLabel: `${s.peopleFilter}: ${filter === "mapped" ? s.filterMapped : s.filterUnmapped}`, onReset: () => setFilter("all") }
  }];
  const hero = {
    eyebrow: s.workspaceEyebrow,
    title: s.title,
    description: s.workspaceIntro,
    mascot: peopleError !== null || !configured ? "error" : draft.status === "saving" ? "saving" : "idle",
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
    C.WorkspaceShell,
    {
      variant: "register",
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
      toolbar: tab === "people" ? {
        search: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          C.RegisterSearch,
          {
            value: search,
            onChange: setSearch,
            placeholder: s.peopleSearch,
            label: s.peopleSearch,
            onClear: () => setSearch(""),
            clearLabel: s.peopleSearchClear
          }
        ),
        filters: toolbarFilters
      } : void 0,
      children: tab === "people" ? peopleError !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceState, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ErrorState, { message: `${s.peopleLoadError} \u2014 ${peopleError}` }) }) }) : people === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.LoadingState, { variant: "list" }) }) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeopleAccess, { draft, response: people, search, filter, onIdentityDetail: updateIdentityDetail }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.SettingsDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        C.PluginConfigEditor,
        {
          name: "msteams",
          detail: globalSettingsDetail(detail),
          draft,
          mode: "all",
          showAppPackage: false,
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
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceShell, { variant: "register", hero, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceState, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ErrorState, { message: s.settingsLoadError, onRetry: () => detail.refetch() }) }) }) });
  }
  if (detail.isLoading || detail.data === void 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceShell, { variant: "register", hero, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.LoadingState, { variant: "cards" }) }) }) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoadedWorkspace, { detail: detail.data });
}

// plugins/msteams/web-src/index.tsx
registerTeamsUi({
  requiresApiVersion: 12,
  pages: { "": TeamsWorkspace }
});
