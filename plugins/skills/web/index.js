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

// node_modules/lucide-react/dist/esm/icons/plus.js
var Plus = createLucideIcon("Plus", [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "M12 5v14", key: "s699le" }]
]);

// node_modules/lucide-react/dist/esm/icons/user.js
var User = createLucideIcon("User", [
  ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", key: "975kel" }],
  ["circle", { cx: "12", cy: "7", r: "4", key: "17ys0d" }]
]);

// plugins/skills/web-src/SkillsSettings.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var EMPTY_FORM = { editing: null, name: "", description: "", body: "", disableModelInvocation: false, owner: null, editingOwner: null };
var ownerParam = (owner) => owner === "instance" ? "instance" : owner === null ? "me" : String(owner);
function SkillsSettings({ surface }) {
  const { components: C, hooks, utils, api } = runtime();
  const s = hooks.usePluginStrings("skills");
  const { t } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const query = hooks.usePluginSkills();
  const me = hooks.useMe();
  const myId = me.data?.user?.id ?? null;
  const isAdmin = me.data?.user?.is_admin === true;
  const create = hooks.useCreatePluginSkill();
  const update = hooks.useUpdatePluginSkill();
  const remove = hooks.useDeletePluginSkill();
  const [creating, setCreating] = (0, import_react3.useState)(false);
  const [submitting, setSubmitting] = (0, import_react3.useState)(false);
  const submitRef = (0, import_react3.useRef)(false);
  const targetOwner = (skill) => skill.owner === null ? "instance" : skill.owner;
  const toggleInvocation = (skill, enabled) => {
    update.mutate(
      { name: skill.name, owner: targetOwner(skill), patch: { disableModelInvocation: !enabled } },
      { onError: (e) => toast(utils.apiErrorMessage(e), "error") }
    );
  };
  const ownerLabel = (skill) => {
    if (skill.owner === null) return s.ownerInstance;
    return skill.owner === myId ? s.ownerMine : `#${skill.owner}`;
  };
  const skills = query.data ?? [];
  const editedSkill = (form) => form.editing === null ? void 0 : skills.find((skill) => skill.name === form.editing && targetOwner(skill) === form.editingOwner);
  const scopeSwitchable = (form) => {
    if (form.editing === null) return true;
    const skill = editedSkill(form);
    return skill !== void 0 && (skill.owner === null || skill.owner === myId);
  };
  const userCount = skills.filter((skill) => skill.source === "user").length;
  const manualCount = skills.filter((skill) => skill.disableModelInvocation).length;
  const addButton = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Button, { variant: "accent", icon: Plus, onClick: () => setCreating(true), children: s.add });
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
        badgeBuiltin: s.badgeBundled,
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
      emptyForm: EMPTY_FORM,
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
          { value: "mine", label: s.scopeMine, matches: (skill) => skill.owner !== null && skill.owner === myId },
          { value: "instance", label: s.scopeInstance, matches: (skill) => skill.owner === null && skill.source === "user" },
          { value: "bundled", label: s.scopeBundled, matches: (skill) => skill.source === "bundled" }
        ]
      },
      renderBadges: (skill) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        skill.version != null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(C.Badge, { tone: "default", children: [
          "v",
          skill.version
        ] }) : null,
        skill.disableModelInvocation ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Badge, { tone: "default", children: s.manualOnlyBadge }) : null
      ] }),
      renderRowControl: (skill) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        C.Toggle,
        {
          checked: !skill.disableModelInvocation,
          onChange: (enabled) => toggleInvocation(skill, enabled),
          label: s.disableModelInvocation,
          disabled: update.isPending && update.variables?.name === skill.name && update.variables?.owner === targetOwner(skill)
        }
      ),
      renderFieldsAfterBody: (form, patch) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        isAdmin && scopeSwitchable(form) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.Field, { label: s.scopeFieldLabel, hint: form.editing === null ? s.scopeFieldHint : s.scopeMoveHint, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          C.Segmented,
          {
            value: form.owner === "instance" ? "instance" : "personal",
            onChange: (value) => patch({ owner: value === "instance" ? "instance" : null }),
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
            callbacks.onSuccess();
          },
          onError: (e) => {
            submitRef.current = false;
            setSubmitting(false);
            callbacks.onError(e);
          }
        };
        if (form.editing !== null) {
          const name = form.editing;
          const from = form.editingOwner;
          const patch = { description: form.description.trim(), content: form.body, disableModelInvocation: form.disableModelInvocation };
          const revision = form.revision ?? 0;
          const saveEdit = async () => {
            const path = form.owner !== from ? `/plugins/skills/${encodeURIComponent(name)}/owner?owner=${encodeURIComponent(ownerParam(from))}` : `/plugins/skills/${encodeURIComponent(name)}?owner=${encodeURIComponent(ownerParam(from))}`;
            const body = form.owner !== from ? { owner: ownerParam(form.owner), expectedRevision: revision, patch } : { ...patch, expectedRevision: revision };
            try {
              await api(path, { method: form.owner !== from ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
              guarded.onSuccess();
            } catch (error) {
              query.refetch();
              guarded.onError(error);
            }
          };
          void saveEdit();
        } else {
          create.mutate(
            { name: form.name.trim(), description: form.description.trim(), content: form.body, disableModelInvocation: form.disableModelInvocation, owner: form.owner },
            guarded
          );
        }
      },
      saving: submitting || create.isPending || update.isPending,
      onDelete: (skill, callbacks) => remove.mutate({ name: skill.name, owner: targetOwner(skill) }, callbacks)
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
        count: skills.length,
        description: s.sectionHint,
        mascot: query.isLoading ? "saving" : query.isError ? "error" : "idle",
        status: !query.isLoading && !query.isError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "workspace-status", children: s.workspaceReady }) : void 0,
        action: addButton,
        metrics: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: t.assetEditor.filterUser, value: userCount, icon: User }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: t.assetEditor.filterBuiltin, value: skills.length - userCount, icon: Package }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(C.WorkspaceMetric, { label: s.manualOnlyBadge, value: manualCount, icon: Hand })
        ] })
      },
      children: surfaceDocument
    }
  );
}

// plugins/skills/web-src/index.tsx
registerSkillsUi({
  requiresApiVersion: 8,
  settings: {
    "skills": SkillsSettings
  },
  ownsPageFrame: ["skills"]
});
