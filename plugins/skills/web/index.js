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

// plugins/skills/web-src/runtime.ts
function runtime() {
  const rt = window.ElowenUiRuntime;
  if (!rt) throw new Error("ElowenUiRuntime is not installed");
  return rt;
}
function registerSkillsUi(registration) {
  window.__elowenRegisterPluginUi?.("skills", registration);
}

// plugins/skills/web-src/SkillsSettings.tsx
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

// node_modules/lucide-react/dist/esm/icons/book-open.js
var BookOpen = createLucideIcon("BookOpen", [
  ["path", { d: "M12 7v14", key: "1akyts" }],
  [
    "path",
    {
      d: "M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
      key: "ruj8y"
    }
  ]
]);

// node_modules/lucide-react/dist/esm/icons/boxes.js
var Boxes = createLucideIcon("Boxes", [
  [
    "path",
    {
      d: "M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z",
      key: "lc1i9w"
    }
  ],
  ["path", { d: "m7 16.5-4.74-2.85", key: "1o9zyk" }],
  ["path", { d: "m7 16.5 5-3", key: "va8pkn" }],
  ["path", { d: "M7 16.5v5.17", key: "jnp8gn" }],
  [
    "path",
    {
      d: "M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z",
      key: "8zsnat"
    }
  ],
  ["path", { d: "m17 16.5-5-3", key: "8arw3v" }],
  ["path", { d: "m17 16.5 4.74-2.85", key: "8rfmw" }],
  ["path", { d: "M17 16.5v5.17", key: "k6z78m" }],
  [
    "path",
    {
      d: "M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z",
      key: "1xygjf"
    }
  ],
  ["path", { d: "M12 8 7.26 5.15", key: "1vbdud" }],
  ["path", { d: "m12 8 4.74-2.85", key: "3rx089" }],
  ["path", { d: "M12 13.5V8", key: "1io7kd" }]
]);

// node_modules/lucide-react/dist/esm/icons/hand.js
var Hand = createLucideIcon("Hand", [
  ["path", { d: "M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2", key: "1fvzgz" }],
  ["path", { d: "M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2", key: "1kc0my" }],
  ["path", { d: "M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8", key: "10h0bg" }],
  [
    "path",
    {
      d: "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
      key: "1s1gnw"
    }
  ]
]);

// node_modules/lucide-react/dist/esm/icons/package.js
var Package = createLucideIcon("Package", [
  [
    "path",
    {
      d: "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z",
      key: "1a0edw"
    }
  ],
  ["path", { d: "M12 22V12", key: "d0xqtd" }],
  ["path", { d: "m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7", key: "yx3hmr" }],
  ["path", { d: "m7.5 4.27 9 5.15", key: "1c824w" }]
]);

// node_modules/lucide-react/dist/esm/icons/play.js
var Play = createLucideIcon("Play", [
  ["polygon", { points: "6 3 20 12 6 21 6 3", key: "1oa8hb" }]
]);

// node_modules/lucide-react/dist/esm/icons/plus.js
var Plus = createLucideIcon("Plus", [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "M12 5v14", key: "s699le" }]
]);

// node_modules/lucide-react/dist/esm/icons/puzzle.js
var Puzzle = createLucideIcon("Puzzle", [
  [
    "path",
    {
      d: "M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z",
      key: "w46dr5"
    }
  ]
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

// node_modules/lucide-react/dist/esm/icons/trash-2.js
var Trash2 = createLucideIcon("Trash2", [
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", key: "4alrt4" }],
  ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", key: "v07s0e" }],
  ["line", { x1: "10", x2: "10", y1: "11", y2: "17", key: "1uufr5" }],
  ["line", { x1: "14", x2: "14", y1: "11", y2: "17", key: "xtxkd" }]
]);

// node_modules/lucide-react/dist/esm/icons/user.js
var User = createLucideIcon("User", [
  ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", key: "975kel" }],
  ["circle", { cx: "12", cy: "7", r: "4", key: "17ys0d" }]
]);

// plugins/skills/web-src/SkillsSettings.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var BLANK_FORM = { editing: null, name: "", description: "", body: "", disableModelInvocation: false, owner: null, editingOwner: null };
var ownerParam = (owner) => owner === "instance" ? "instance" : owner === null ? "me" : String(owner);
function SkillsSettings({ surface }) {
  const { components: C, hooks, utils, api } = runtime();
  const s = hooks.usePluginStrings("skills");
  const { t } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const me = hooks.useMe();
  const myId = me.data?.user?.id ?? null;
  const isAdmin = me.data?.user?.is_admin === true;
  const create = hooks.useCreatePluginSkill();
  const update = hooks.useUpdatePluginSkill();
  const remove = hooks.useDeletePluginSkill();
  const [creating, setCreating] = (0, import_react3.useState)(false);
  const [submitting, setSubmitting] = (0, import_react3.useState)(false);
  const [skills, setSkills] = (0, import_react3.useState)();
  const [accounts, setAccounts] = (0, import_react3.useState)([]);
  const [selectedAccount, setSelectedAccount] = (0, import_react3.useState)(null);
  const [loadError, setLoadError] = (0, import_react3.useState)(false);
  const [availabilityKey, setAvailabilityKey] = (0, import_react3.useState)(null);
  const submitRef = (0, import_react3.useRef)(false);
  const skillRequestRef = (0, import_react3.useRef)(0);
  const selectedAccountRef = (0, import_react3.useRef)(null);
  (0, import_react3.useEffect)(() => {
    if (myId !== null && selectedAccount === null) {
      selectedAccountRef.current = myId;
      setSelectedAccount(myId);
    }
  }, [myId, selectedAccount]);
  const loadAccounts = (0, import_react3.useCallback)(async () => {
    if (!isAdmin) return;
    try {
      setAccounts(await api("/plugins/skills/accounts"));
    } catch (error) {
      toast(utils.apiErrorMessage(error), "error");
    }
  }, [api, isAdmin, toast, utils]);
  const loadSkills = (0, import_react3.useCallback)(async (account = selectedAccountRef.current) => {
    if (account === null || selectedAccountRef.current !== account) return;
    const requestId = ++skillRequestRef.current;
    try {
      setLoadError(false);
      const suffix = isAdmin ? `?account=${encodeURIComponent(String(account))}` : "";
      const rows = await api(`/plugins/skills/list${suffix}`);
      if (requestId !== skillRequestRef.current || selectedAccountRef.current !== account) return;
      setSkills(rows);
    } catch (error) {
      if (requestId !== skillRequestRef.current || selectedAccountRef.current !== account) return;
      setLoadError(true);
      toast(utils.apiErrorMessage(error), "error");
    }
  }, [api, isAdmin, toast, utils]);
  (0, import_react3.useEffect)(() => {
    void loadAccounts();
  }, [loadAccounts]);
  (0, import_react3.useEffect)(() => {
    if (selectedAccount === null) return;
    selectedAccountRef.current = selectedAccount;
    skillRequestRef.current += 1;
    setSkills(void 0);
    void loadSkills(selectedAccount);
  }, [loadSkills, selectedAccount]);
  const query = (0, import_react3.useMemo)(() => ({
    data: skills,
    isLoading: skills === void 0 && !loadError,
    isError: loadError,
    refetch: () => {
      void loadSkills();
    }
  }), [loadError, loadSkills, skills]);
  const targetOwner = (skill) => skill.owner === null ? "instance" : skill.owner;
  const selectedPersonalOwner = selectedAccount === myId ? null : selectedAccount;
  const toggleInvocation = (skill, enabled) => {
    const account = selectedAccountRef.current;
    const before = skills;
    setSkills((current) => current?.map((item) => item === skill ? { ...item, disableModelInvocation: !enabled } : item));
    update.mutate(
      { name: skill.name, owner: targetOwner(skill), patch: { disableModelInvocation: !enabled } },
      {
        onSuccess: () => {
          void loadSkills(account);
        },
        onError: (error) => {
          if (selectedAccountRef.current === account) setSkills(before);
          toast(utils.apiErrorMessage(error), "error");
        }
      }
    );
  };
  const togglePluginAvailability = async (skill, enabled) => {
    const account = selectedAccountRef.current;
    if (!isAdmin || account === null || !skill.pluginKey) return;
    const before = skills;
    const pendingKey = `${account}:${skill.pluginKey}`;
    setAvailabilityKey(pendingKey);
    setSkills((current) => current?.map((item) => item.pluginKey === skill.pluginKey ? { ...item, enabledForAccount: enabled, effective: enabled && !item.disableModelInvocation } : item));
    try {
      await api("/plugins/skills/plugin-availability", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: account, key: skill.pluginKey, enabled })
      });
      await loadSkills(account);
    } catch (error) {
      if (selectedAccountRef.current === account) {
        setSkills(before);
        await loadSkills(account);
      }
      toast(utils.apiErrorMessage(error), "error");
    } finally {
      setAvailabilityKey((current) => current === pendingKey ? null : current);
    }
  };
  const accountName = (id) => {
    if (id === null) return s.ownerInstance;
    if (id === myId) return s.ownerMine;
    const account = accounts.find((candidate) => candidate.id === id);
    return account?.name || account?.username || `#${id}`;
  };
  const ownerLabel = (skill) => {
    if (skill.catalogSource === "plugin") return skill.contributorPlugin || s.scopePlugin;
    if (skill.catalogSource === "bundled") return s.scopeBundled;
    if (skill.catalogSource === "instance") return s.ownerInstance;
    return accountName(skill.owner);
  };
  const editedSkill = (form) => form.editing === null ? void 0 : skills?.find((skill) => skill.name === form.editing && targetOwner(skill) === form.editingOwner);
  const scopeSwitchable = (form) => {
    if (form.editing === null) return true;
    const skill = editedSkill(form);
    return skill !== void 0 && skill.catalogSource !== "plugin" && (skill.owner === null || skill.owner === selectedAccount);
  };
  const userCount = skills?.filter((skill) => skill.catalogSource === "personal" || skill.catalogSource === "instance").length ?? 0;
  const pluginCount = skills?.filter((skill) => skill.catalogSource === "plugin").length ?? 0;
  const manualCount = skills?.filter((skill) => skill.disableModelInvocation).length ?? 0;
  const effectiveCount = skills?.filter((skill) => skill.effective).length ?? 0;
  const emptyForm = (0, import_react3.useMemo)(() => ({ ...BLANK_FORM, owner: selectedPersonalOwner }), [selectedPersonalOwner]);
  const addButton = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "accent", icon: Plus, onClick: () => setCreating(true), children: s.add });
  const chooseAccount = (account) => {
    setCreating(false);
    selectedAccountRef.current = account;
    skillRequestRef.current += 1;
    setSkills(void 0);
    setSelectedAccount(account);
  };
  const accountFieldBase = isAdmin && selectedAccount !== null ? {
    id: "skill-account",
    label: s.accountLabel,
    hint: s.accountHint,
    control: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      C.SelectMenu,
      {
        value: String(selectedAccount),
        onChange: (value) => chooseAccount(Number(value)),
        options: (accounts.length ? accounts : [{ id: selectedAccount, username: accountName(selectedAccount) }]).map((account) => ({
          value: String(account.id),
          label: account.name || account.username,
          icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(User, { size: 14 })
        })),
        label: s.accountLabel
      }
    )
  } : null;
  const accountFilter = accountFieldBase === null ? void 0 : myId !== null && selectedAccount !== myId ? {
    ...accountFieldBase,
    active: true,
    activeLabel: `${s.accountLabel}: ${accountName(selectedAccount)}`,
    onReset: () => chooseAccount(myId)
  } : { ...accountFieldBase, active: false };
  const surfaceDocument = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    C.MarkdownAssetEditor,
    {
      query,
      creating,
      onCreatingChange: setCreating,
      addAction: surface === "deck" ? addButton : void 0,
      labels: {
        empty: s.empty,
        badgeUser: s.badgeUser,
        badgeBuiltin: s.badgeProvided,
        addTitle: s.add,
        edit: s.edit,
        remove: s.remove,
        save: s.save,
        cancel: s.cancel,
        name: s.name,
        nameHint: s.helpName,
        namePlaceholder: "deploy-checklist",
        description: s.description,
        descriptionHint: s.helpDescription,
        body: s.content,
        bodyHint: s.helpContent,
        created: s.created,
        updated: s.updated,
        deleted: s.deleted,
        deleteTitle: s.deleteTitle,
        deleteDesc: s.deleteDesc
      },
      emptyForm,
      formFromItem: (skill) => ({
        editing: skill.name,
        name: skill.name,
        description: skill.description,
        body: skill.content ?? "",
        disableModelInvocation: skill.disableModelInvocation,
        owner: targetOwner(skill),
        editingOwner: targetOwner(skill),
        revision: skill.revision ?? skill.version ?? 0
      }),
      ownership: {
        header: s.ownerColumn,
        label: ownerLabel,
        scopes: [
          { value: "personal", label: s.scopeMine, icon: User, matches: (skill) => skill.catalogSource === "personal" && skill.owner === selectedAccount },
          { value: "instance", label: s.scopeInstance, icon: Boxes, matches: (skill) => skill.catalogSource === "instance" },
          // `Package` is the bundled catalogue and `Puzzle` the plugin-contributed one: the two were
          // both reading as a package, which is the collision the register's glyphs exist to avoid.
          { value: "bundled", label: s.scopeBundled, icon: Package, matches: (skill) => skill.catalogSource === "bundled" },
          { value: "plugin", label: s.scopePlugin, icon: Puzzle, matches: (skill) => skill.catalogSource === "plugin" }
        ]
      },
      extraFilters: accountFilter ? [accountFilter] : void 0,
      renderBadges: (skill) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        skill.unavailableReason === "plugin-unavailable" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: "warning", children: s.statusUnavailable }) : null,
        skill.unavailableReason === "shadowed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: "warning", children: s.statusShadowed }) : null
      ] }),
      renderRowControl: (skill) => skill.catalogSource === "plugin" ? isAdmin ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        C.Toggle,
        {
          checked: skill.enabledForAccount,
          onChange: (enabled) => {
            void togglePluginAvailability(skill, enabled);
          },
          label: `${s.pluginAvailability}: ${skill.name}`,
          disabled: availabilityKey === `${selectedAccount}:${skill.pluginKey}`
        }
      ) : null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        C.Toggle,
        {
          checked: !skill.disableModelInvocation,
          onChange: (enabled) => toggleInvocation(skill, enabled),
          label: `${s.disableModelInvocation}: ${skill.name}`,
          disabled: !skill.canDelete || update.isPending && update.variables?.name === skill.name && update.variables?.owner === targetOwner(skill)
        }
      ),
      renderFieldsAfterBody: (form, patch) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        isAdmin && scopeSwitchable(form) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.scopeFieldLabel, hint: form.editing === null ? s.scopeFieldHint : s.scopeMoveHint, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          C.Segmented,
          {
            value: form.owner === "instance" ? "instance" : "personal",
            onChange: (value) => patch({ owner: value === "instance" ? "instance" : selectedPersonalOwner }),
            options: [
              { value: "personal", label: s.scopeFieldPersonal },
              { value: "instance", label: s.scopeFieldInstance }
            ],
            "aria-label": s.scopeFieldLabel,
            nowrap: true
          }
        ) }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            C.Toggle,
            {
              checked: !form.disableModelInvocation,
              onChange: (enabled) => patch({ disableModelInvocation: !enabled }),
              label: s.disableModelInvocation
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "flex flex-col", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-sm text-foreground", children: s.disableModelInvocation }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "text-xs text-muted-foreground", children: s.disableModelInvocationHint })
          ] })
        ] })
      ] }),
      onSave: (form, callbacks) => {
        if (submitRef.current) return;
        submitRef.current = true;
        setSubmitting(true);
        const guarded = {
          onSuccess: () => {
            submitRef.current = false;
            setSubmitting(false);
            void loadSkills();
            callbacks.onSuccess();
          },
          onError: (error) => {
            submitRef.current = false;
            setSubmitting(false);
            void loadSkills();
            callbacks.onError(error);
          }
        };
        if (form.editing !== null) {
          const name = form.editing;
          const from = form.editingOwner;
          const patch = { description: form.description.trim(), content: form.body, disableModelInvocation: form.disableModelInvocation };
          const revision = form.revision ?? 0;
          void (async () => {
            const path = form.owner !== from ? `/plugins/skills/${encodeURIComponent(name)}/owner?owner=${encodeURIComponent(ownerParam(from))}` : `/plugins/skills/${encodeURIComponent(name)}?owner=${encodeURIComponent(ownerParam(from))}`;
            const body = form.owner !== from ? { owner: ownerParam(form.owner), expectedRevision: revision, patch } : { ...patch, expectedRevision: revision };
            try {
              await api(path, { method: form.owner !== from ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
              guarded.onSuccess();
            } catch (error) {
              guarded.onError(error);
            }
          })();
        } else {
          create.mutate(
            { name: form.name.trim(), description: form.description.trim(), content: form.body, disableModelInvocation: form.disableModelInvocation, owner: form.owner },
            guarded
          );
        }
      },
      saving: submitting || create.isPending || update.isPending,
      onDelete: (skill, callbacks) => remove.mutate({ name: skill.name, owner: targetOwner(skill) }, {
        onSuccess: () => {
          void loadSkills();
          callbacks.onSuccess();
        },
        onError: callbacks.onError
      })
    }
  ) });
  if (surface === "deck") return surfaceDocument;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    C.WorkspaceShell,
    {
      variant: "register",
      hero: {
        eyebrow: s.workspaceEyebrow,
        title: s.title,
        count: skills?.length ?? 0,
        description: s.sectionHint,
        mascot: query.isLoading ? "saving" : query.isError ? "error" : "idle",
        status: !query.isLoading && !query.isError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "workspace-status", children: s.workspaceReady }) : void 0,
        action: addButton,
        metrics: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: s.statusEffective, value: effectiveCount, icon: ShieldCheck }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: t.assetEditor.filterUser, value: userCount, icon: User }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: s.scopePlugin, value: pluginCount, icon: Puzzle }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: s.manualOnlyBadge, value: manualCount, icon: Hand })
        ] })
      },
      children: surfaceDocument
    }
  );
}

// plugins/skills/web-src/SkillsPicker.tsx
var import_react4 = __toESM(require_react(), 1);
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
function SkillsPicker({ send, close }) {
  const { components: C, hooks, utils } = runtime();
  const strings = hooks.usePluginStrings("skills");
  const skills = hooks.usePluginSkills();
  const remove = hooks.useDeletePluginSkill();
  const { toast } = hooks.useToast();
  const [filter, setFilter] = (0, import_react4.useState)("");
  const [pending, setPending] = (0, import_react4.useState)(null);
  const deleting = (0, import_react4.useRef)(false);
  const rows = (0, import_react4.useMemo)(() => {
    const needle = filter.trim().toLowerCase();
    const all = skills.data ?? [];
    return needle ? all.filter((skill) => skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle)) : all;
  }, [filter, skills.data]);
  const deleteSkill = async () => {
    if (!pending || deleting.current) return;
    deleting.current = true;
    try {
      await remove.mutateAsync({ name: pending.name, owner: pending.owner });
      setPending(null);
    } catch (error) {
      toast(utils.apiErrorMessage(error), "error");
    } finally {
      deleting.current = false;
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Modal, { title: strings.pickerTitle, onClose: close, size: "md", icon: BookOpen, intent: "inspect", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(C.ModalBody, { gap: 4, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.Input, { value: filter, onChange: (event) => setFilter(event.target.value), placeholder: strings.pickerFilter, "aria-label": strings.pickerFilter }),
      skills.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.LoadingState, { variant: "list" }) : skills.isError ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.ErrorState, { message: strings.unavailable, onRetry: () => skills.refetch() }) : rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.EmptyState, { title: strings.pickerEmpty, description: strings.pickerEmptyDesc, icon: BookOpen }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "flex flex-col gap-px overflow-hidden rounded-md border border-border bg-border/50", children: rows.map((skill) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex items-center gap-2 bg-card px-3 py-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex min-w-0 flex-1 flex-col", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "truncate font-mono text-xs text-foreground", children: [
            "/skill:",
            skill.name
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate text-xs text-muted-foreground", children: [skill.scope ?? skill.source, skill.description].filter(Boolean).join(" \xB7 ") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.IconButton, { icon: Play, label: strings.pickerLoad, disabled: skill.active === false, onClick: () => {
          send("/skill:" + skill.name);
          close();
        } }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.IconButton, { icon: Trash2, label: strings.pickerDelete, variant: "danger", disabled: !skill.canDelete, onClick: () => setPending(skill) })
      ] }, skill.name + ":" + String(skill.owner ?? "shared"))) })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      C.ConfirmDialog,
      {
        open: pending !== null,
        title: strings.pickerDeleteTitle,
        description: pending ? strings.pickerDeleteDesc.replace("{name}", "/skill:" + pending.name) : void 0,
        onConfirm: deleteSkill,
        pending: remove.isPending || deleting.current,
        onClose: () => {
          if (!deleting.current) setPending(null);
        }
      }
    )
  ] });
}

// plugins/skills/web-src/index.tsx
registerSkillsUi({
  requiresApiVersion: 8,
  settings: {
    "skills": SkillsSettings
  },
  chatPickers: {
    skills: SkillsPicker
  },
  ownsPageFrame: ["skills"]
});
