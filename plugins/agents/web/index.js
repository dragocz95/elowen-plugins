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

// node_modules/elowen-plugin-ui-kit/shims/react-dom.cjs
var require_react_dom = __commonJS({
  "node_modules/elowen-plugin-ui-kit/shims/react-dom.cjs"(exports, module) {
    var runtime2 = typeof window !== "undefined" ? window.ElowenUiRuntime : void 0;
    if (!runtime2) throw new Error("elowen-plugin-ui-kit: window.ElowenUiRuntime is missing \u2014 plugin bundles only run inside the Elowen web app");
    module.exports = runtime2.reactDom;
  }
});

// plugins/agents/web-src/index.tsx
var import_react11 = __toESM(require_react(), 1);

// plugins/agents/web-src/runtime.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
function runtime() {
  const rt = window.ElowenUiRuntime;
  if (!rt) throw new Error("ElowenUiRuntime is not installed");
  return rt;
}
function registerAgentsUi(registration) {
  window.__elowenRegisterPluginUi?.("agents", registration);
}
function Link({ href, className, title, children }) {
  const onClick = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    runtime().navigate(href);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href, className, title, onClick, children });
}

// plugins/agents/web-src/sessions/SessionsView.tsx
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

// node_modules/lucide-react/dist/esm/icons/activity.js
var Activity = createLucideIcon("Activity", [
  [
    "path",
    {
      d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
      key: "169zse"
    }
  ]
]);

// node_modules/lucide-react/dist/esm/icons/arrow-right.js
var ArrowRight = createLucideIcon("ArrowRight", [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "m12 5 7 7-7 7", key: "xquz4c" }]
]);

// node_modules/lucide-react/dist/esm/icons/bell.js
var Bell = createLucideIcon("Bell", [
  ["path", { d: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", key: "1qo2s2" }],
  ["path", { d: "M10.3 21a1.94 1.94 0 0 0 3.4 0", key: "qgo35s" }]
]);

// node_modules/lucide-react/dist/esm/icons/bot.js
var Bot = createLucideIcon("Bot", [
  ["path", { d: "M12 8V4H8", key: "hb8ula" }],
  ["rect", { width: "16", height: "12", x: "4", y: "8", rx: "2", key: "enze0r" }],
  ["path", { d: "M2 14h2", key: "vft8re" }],
  ["path", { d: "M20 14h2", key: "4cs60a" }],
  ["path", { d: "M15 13v2", key: "1xurst" }],
  ["path", { d: "M9 13v2", key: "rq6x2g" }]
]);

// node_modules/lucide-react/dist/esm/icons/circle-check.js
var CircleCheck = createLucideIcon("CircleCheck", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "m9 12 2 2 4-4", key: "dzmm74" }]
]);

// node_modules/lucide-react/dist/esm/icons/clock.js
var Clock = createLucideIcon("Clock", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["polyline", { points: "12 6 12 12 16 14", key: "68esgv" }]
]);

// node_modules/lucide-react/dist/esm/icons/cpu.js
var Cpu = createLucideIcon("Cpu", [
  ["rect", { width: "16", height: "16", x: "4", y: "4", rx: "2", key: "14l7u7" }],
  ["rect", { width: "6", height: "6", x: "9", y: "9", rx: "1", key: "5aljv4" }],
  ["path", { d: "M15 2v2", key: "13l42r" }],
  ["path", { d: "M15 20v2", key: "15mkzm" }],
  ["path", { d: "M2 15h2", key: "1gxd5l" }],
  ["path", { d: "M2 9h2", key: "1bbxkp" }],
  ["path", { d: "M20 15h2", key: "19e6y8" }],
  ["path", { d: "M20 9h2", key: "19tzq7" }],
  ["path", { d: "M9 2v2", key: "165o2o" }],
  ["path", { d: "M9 20v2", key: "i2bqo8" }]
]);

// node_modules/lucide-react/dist/esm/icons/ellipsis.js
var Ellipsis = createLucideIcon("Ellipsis", [
  ["circle", { cx: "12", cy: "12", r: "1", key: "41hilf" }],
  ["circle", { cx: "19", cy: "12", r: "1", key: "1wjl8i" }],
  ["circle", { cx: "5", cy: "12", r: "1", key: "1pcz8c" }]
]);

// node_modules/lucide-react/dist/esm/icons/eye.js
var Eye = createLucideIcon("Eye", [
  [
    "path",
    {
      d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
      key: "1nclc0"
    }
  ],
  ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }]
]);

// node_modules/lucide-react/dist/esm/icons/file-text.js
var FileText = createLucideIcon("FileText", [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["path", { d: "M10 9H8", key: "b1mrlr" }],
  ["path", { d: "M16 13H8", key: "t4e002" }],
  ["path", { d: "M16 17H8", key: "z1uh3a" }]
]);

// node_modules/lucide-react/dist/esm/icons/flask-conical.js
var FlaskConical = createLucideIcon("FlaskConical", [
  [
    "path",
    {
      d: "M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2",
      key: "pzvekw"
    }
  ],
  ["path", { d: "M8.5 2h7", key: "csnxdl" }],
  ["path", { d: "M7 16h10", key: "wp8him" }]
]);

// node_modules/lucide-react/dist/esm/icons/gauge.js
var Gauge = createLucideIcon("Gauge", [
  ["path", { d: "m12 14 4-4", key: "9kzdfg" }],
  ["path", { d: "M3.34 19a10 10 0 1 1 17.32 0", key: "19p75a" }]
]);

// node_modules/lucide-react/dist/esm/icons/git-branch.js
var GitBranch = createLucideIcon("GitBranch", [
  ["line", { x1: "6", x2: "6", y1: "3", y2: "15", key: "17qcm7" }],
  ["circle", { cx: "18", cy: "6", r: "3", key: "1h7g24" }],
  ["circle", { cx: "6", cy: "18", r: "3", key: "fqmcym" }],
  ["path", { d: "M18 9a9 9 0 0 1-9 9", key: "n2h4wq" }]
]);

// node_modules/lucide-react/dist/esm/icons/git-pull-request.js
var GitPullRequest = createLucideIcon("GitPullRequest", [
  ["circle", { cx: "18", cy: "18", r: "3", key: "1xkwt0" }],
  ["circle", { cx: "6", cy: "6", r: "3", key: "1lh9wr" }],
  ["path", { d: "M13 6h3a2 2 0 0 1 2 2v7", key: "1yeb86" }],
  ["line", { x1: "6", x2: "6", y1: "9", y2: "21", key: "rroup" }]
]);

// node_modules/lucide-react/dist/esm/icons/inbox.js
var Inbox = createLucideIcon("Inbox", [
  ["polyline", { points: "22 12 16 12 14 15 10 15 8 12 2 12", key: "o97t9d" }],
  [
    "path",
    {
      d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
      key: "oot6mr"
    }
  ]
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

// node_modules/lucide-react/dist/esm/icons/link-2.js
var Link2 = createLucideIcon("Link2", [
  ["path", { d: "M9 17H7A5 5 0 0 1 7 7h2", key: "8i5ue5" }],
  ["path", { d: "M15 7h2a5 5 0 1 1 0 10h-2", key: "1b9ql8" }],
  ["line", { x1: "8", x2: "16", y1: "12", y2: "12", key: "1jonct" }]
]);

// node_modules/lucide-react/dist/esm/icons/list.js
var List = createLucideIcon("List", [
  ["path", { d: "M3 12h.01", key: "nlz23k" }],
  ["path", { d: "M3 18h.01", key: "1tta3j" }],
  ["path", { d: "M3 6h.01", key: "1rqtza" }],
  ["path", { d: "M8 12h13", key: "1za7za" }],
  ["path", { d: "M8 18h13", key: "1lx6n3" }],
  ["path", { d: "M8 6h13", key: "ik3vkj" }]
]);

// node_modules/lucide-react/dist/esm/icons/message-square.js
var MessageSquare = createLucideIcon("MessageSquare", [
  ["path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", key: "1lielz" }]
]);

// node_modules/lucide-react/dist/esm/icons/messages-square.js
var MessagesSquare = createLucideIcon("MessagesSquare", [
  ["path", { d: "M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z", key: "p1xzt8" }],
  ["path", { d: "M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1", key: "1cx29u" }]
]);

// node_modules/lucide-react/dist/esm/icons/play.js
var Play = createLucideIcon("Play", [
  ["polygon", { points: "6 3 20 12 6 21 6 3", key: "1oa8hb" }]
]);

// node_modules/lucide-react/dist/esm/icons/power.js
var Power = createLucideIcon("Power", [
  ["path", { d: "M12 2v10", key: "mnfbl" }],
  ["path", { d: "M18.4 6.6a9 9 0 1 1-12.77.04", key: "obofu9" }]
]);

// node_modules/lucide-react/dist/esm/icons/radio.js
var Radio = createLucideIcon("Radio", [
  ["path", { d: "M4.9 19.1C1 15.2 1 8.8 4.9 4.9", key: "1vaf9d" }],
  ["path", { d: "M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5", key: "u1ii0m" }],
  ["circle", { cx: "12", cy: "12", r: "2", key: "1c9p78" }],
  ["path", { d: "M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5", key: "1j5fej" }],
  ["path", { d: "M19.1 4.9C23 8.8 23 15.1 19.1 19", key: "10b0cb" }]
]);

// node_modules/lucide-react/dist/esm/icons/rocket.js
var Rocket = createLucideIcon("Rocket", [
  [
    "path",
    {
      d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z",
      key: "m3kijz"
    }
  ],
  [
    "path",
    {
      d: "m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",
      key: "1fmvmk"
    }
  ],
  ["path", { d: "M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0", key: "1f8sc4" }],
  ["path", { d: "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5", key: "qeys4" }]
]);

// node_modules/lucide-react/dist/esm/icons/rotate-ccw.js
var RotateCcw = createLucideIcon("RotateCcw", [
  ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", key: "1357e3" }],
  ["path", { d: "M3 3v5h5", key: "1xhq8a" }]
]);

// node_modules/lucide-react/dist/esm/icons/shield-alert.js
var ShieldAlert = createLucideIcon("ShieldAlert", [
  [
    "path",
    {
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      key: "oel41y"
    }
  ],
  ["path", { d: "M12 8v4", key: "1got3b" }],
  ["path", { d: "M12 16h.01", key: "1drbdi" }]
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

// node_modules/lucide-react/dist/esm/icons/sparkles.js
var Sparkles = createLucideIcon("Sparkles", [
  [
    "path",
    {
      d: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
      key: "4pj2yx"
    }
  ],
  ["path", { d: "M20 3v4", key: "1olli1" }],
  ["path", { d: "M22 5h-4", key: "1gvqau" }],
  ["path", { d: "M4 17v2", key: "vumght" }],
  ["path", { d: "M5 18H3", key: "zchphs" }]
]);

// node_modules/lucide-react/dist/esm/icons/square-slash.js
var SquareSlash = createLucideIcon("SquareSlash", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["line", { x1: "9", x2: "15", y1: "15", y2: "9", key: "1dfufj" }]
]);

// node_modules/lucide-react/dist/esm/icons/square-terminal.js
var SquareTerminal = createLucideIcon("SquareTerminal", [
  ["path", { d: "m7 11 2-2-2-2", key: "1lz0vl" }],
  ["path", { d: "M11 13h4", key: "1p7l4v" }],
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", ry: "2", key: "1m3agn" }]
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

// plugins/agents/web-src/sessions/SessionCard.tsx
var import_react3 = __toESM(require_react(), 1);
var import_react_dom = __toESM(require_react_dom(), 1);
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
var execsPromise = null;
function useAgentsExecs() {
  const { api } = runtime();
  const [v, setV] = (0, import_react3.useState)({});
  (0, import_react3.useEffect)(() => {
    execsPromise ??= api("/plugins/agents").then((d) => {
      const cfg = d.config ?? {};
      return {
        pilotExec: typeof cfg.pilotExec === "string" ? cfg.pilotExec : void 0,
        overseerExec: typeof cfg.overseerExec === "string" ? cfg.overseerExec : void 0
      };
    }).catch(() => ({}));
    let alive = true;
    void execsPromise.then((c) => {
      if (alive) setV(c);
    });
    return () => {
      alive = false;
    };
  }, [api]);
  return v;
}
function SessionCard({ info, onOpenTerminal, compact = false }) {
  const { components: C, hooks, utils } = runtime();
  const kill = hooks.useKillSession();
  const send = hooks.useSendInput();
  const { toast } = hooks.useToast();
  const { t } = hooks.useTranslation();
  const tasks = hooks.useTasks();
  const agentsExecs = useAgentsExecs();
  const name = info.name;
  const signal = hooks.useSessionSignal(name);
  const [ctxMenu, setCtxMenu] = (0, import_react3.useState)(null);
  const [confirmKill, setConfirmKill] = (0, import_react3.useState)(false);
  const task = utils.taskForSession(tasks.data ?? [], name);
  const exec = utils.taskExec(task?.labels);
  const roleExec = info.role === "overseer" ? agentsExecs.overseerExec : info.role === "pilot" ? agentsExecs.pilotExec : void 0;
  const modelExec = exec || roleExec || void 0;
  const epic = info.role === "overseer" && info.missionId ? (tasks.data ?? []).find((x) => x.id === utils.missionEpicId(info.missionId)) : void 0;
  const TypeIcon = task ? utils.taskTypeMeta(task.type).icon : SquareTerminal;
  const needsInput = signal?.type === "needs_input";
  const dot = needsInput ? "var(--color-warning)" : "var(--color-approve)";
  const finished = !!task && (task.status === "closed" || task.status === "cancelled");
  const handleTerminal = onOpenTerminal;
  const handleInterrupt = () => send.mutate({ name, keys: ["C-c"] }, { onSuccess: () => toast(t.sessions.interrupted.replace("{name}", utils.agentDisplayName(name))) });
  const handleKill = () => kill.mutate(name, { onSuccess: () => {
    setConfirmKill(false);
    toast(t.sessions.killed.replace("{name}", utils.agentDisplayName(name)));
  }, onError: (e) => toast(String(e), "error") });
  const ctxItems = [
    { label: t.sessions.ctxTerminal, icon: SquareTerminal, onClick: handleTerminal },
    { label: t.sessions.ctxInterrupt, icon: SquareSlash, onClick: handleInterrupt },
    utils.contextMenuDivider,
    { label: t.sessions.ctxKill, icon: Power, onClick: () => setConfirmKill(true), danger: true }
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    C.EntityRow,
    {
      role: "presentation",
      className: `group flex flex-col gap-3 ${needsInput ? "border-l-2 border-warning/60 pl-3" : ""}`,
      onContextMenu: (e) => {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, items: ctxItems });
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex items-center gap-2.5", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-elevated/70", children: info.role === "overseer" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Eye, { size: 18, className: "text-text-muted", "aria-hidden": true }) : info.role === "pilot" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Bot, { size: 18, className: "text-text-muted", "aria-hidden": true }) : exec ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.ModelIcon, { name: exec, size: 20 }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(TypeIcon, { size: 18, className: "text-text-muted", "aria-hidden": true }) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "flex min-w-0 flex-1 flex-col", children: info.role === "overseer" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "truncate text-xs font-semibold text-text", title: epic?.title, children: [
              t.sessions.roleOverseer,
              epic ? ` \xB7 ${epic.title}` : ""
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate font-mono text-[11px] text-text-muted", children: info.missionId })
          ] }) : info.role === "pilot" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate text-xs font-semibold text-text", children: t.sessions.rolePilot }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate text-[11px] text-text-muted", children: info.agent })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "truncate text-xs font-semibold text-text", title: task?.title, children: info.agent }),
            task ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Link, { href: `/p/work/tasks?select=${encodeURIComponent(task.id)}`, className: "truncate text-[11px] text-text-muted transition-colors hover:text-accent", title: task.title, children: task.title }) : null
          ] }) }),
          needsInput ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "shrink-0 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-tiny font-medium text-warning", title: signal?.type === "needs_input" ? signal.question : "", children: t.sessions.needsInput }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "live-dot h-2 w-2 shrink-0 rounded-full", style: { backgroundColor: dot, ["--live-ring"]: needsInput ? "color-mix(in srgb, var(--color-warning) 50%, transparent)" : "color-mix(in srgb, var(--color-approve) 50%, transparent)" }, "aria-label": needsInput ? t.sessions.needsInput : t.sessions.online, title: needsInput ? t.sessions.needsInput : t.sessions.online })
        ] }),
        task ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.TaskUsageBadge, { taskId: task.id, live: !finished }) : null,
        finished && task ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: `flex flex-col gap-1.5 rounded-md border border-border bg-bg p-2.5 ${compact ? "" : "min-h-32"}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.OutcomeBadge, { outcome: task.outcome }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-[11px] leading-snug text-text-muted", children: task.result_summary?.trim() || t.tasks.noSummary })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.LiveTail, { name, lines: compact ? 14 : 22, heightClass: compact ? "h-32" : "h-52", onExpand: onOpenTerminal }),
        !finished && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.ChangeStrip, {}),
        needsInput && signal?.type === "needs_input" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-xs text-text", children: signal.question }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "flex flex-wrap items-center gap-1.5", children: signal.options && signal.options.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            signal.options.map((o) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", title: o.label, onClick: () => send.mutate({ name, keys: utils.keysForOption(o.id) }, { onSuccess: () => toast(t.sessions.answered.replace("{name}", utils.agentDisplayName(name)).replace("{option}", o.label)), onError: (e) => toast(String(e), "error") }), className: "max-w-full truncate rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-bg active:scale-95", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "opacity-60", children: [
                o.id,
                "."
              ] }),
              " ",
              o.label
            ] }, o.id)),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: () => send.mutate({ name, keys: ["Escape"] }, { onSuccess: () => toast(t.sessions.rejected.replace("{name}", utils.agentDisplayName(name))), onError: (e) => toast(String(e), "error") }), className: "rounded-md border border-danger/50 bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger hover:text-bg active:scale-95", children: t.sessions.reject })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: () => send.mutate({ name, keys: ["Enter"] }, { onSuccess: () => toast(t.sessions.approved.replace("{name}", utils.agentDisplayName(name))), onError: (e) => toast(String(e), "error") }), className: "rounded-md border border-approve/50 bg-approve/10 px-2.5 py-1 text-xs font-medium text-approve transition-colors hover:bg-approve hover:text-bg active:scale-95", children: t.sessions.allow }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: () => send.mutate({ name, keys: ["Escape"] }, { onSuccess: () => toast(t.sessions.rejected.replace("{name}", utils.agentDisplayName(name))), onError: (e) => toast(String(e), "error") }), className: "rounded-md border border-danger/50 bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger hover:text-bg active:scale-95", children: t.sessions.reject })
          ] }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "flex items-center justify-end gap-2", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex items-center gap-1.5", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.ProjectPill, { projectId: info.projectId ?? task?.project_id, always: true }),
          modelExec ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-2 py-0.5 text-[11px] text-text-muted", title: modelExec, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.ModelIcon, { name: modelExec, size: 13 }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "max-w-28 truncate", children: utils.execModel(modelExec) })
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.IconButton, { icon: SquareTerminal, label: t.sessions.terminal, onClick: handleTerminal }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.IconButton, { icon: SquareSlash, label: t.sessions.interrupt, onClick: handleInterrupt }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              C.ActionMenu,
              {
                label: t.sessions.kill,
                trigger: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Ellipsis, { size: 15, "aria-hidden": true }),
                triggerClassName: "inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-elevated hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                items: [{ label: t.sessions.kill, icon: Power, tone: "danger", onSelect: () => setConfirmKill(true) }]
              }
            )
          ] })
        ] }) }),
        ctxMenu && (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime2.jsx)(C.ContextMenu, { state: ctxMenu, onClose: () => setCtxMenu(null) }), document.body),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          C.ConfirmDialog,
          {
            open: confirmKill,
            title: t.sessions.confirmKillTitle.replace("{name}", utils.agentDisplayName(name)),
            description: t.sessions.confirmKillDescription,
            confirmLabel: t.sessions.kill,
            onClose: () => setConfirmKill(false),
            onConfirm: handleKill
          }
        )
      ]
    }
  );
}

// plugins/agents/web-src/sessions/SessionsView.tsx
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
function initialFilter() {
  return new URLSearchParams(window.location.search).get("filter") === "needs_input" ? "needs_input" : "all";
}
function SessionsView() {
  const { components: C, hooks, utils, navigate } = runtime();
  const sessions = hooks.useSessionInfos();
  const signals = hooks.useSessionSignals();
  const { t } = hooks.useTranslation();
  const workPages = hooks.useWorkPlugin();
  const [openTerm, setOpenTerm] = (0, import_react4.useState)(null);
  const [filter, setFilterState] = (0, import_react4.useState)(initialFilter);
  const infos = sessions.data ?? [];
  const byName = new Map(infos.map((i) => [i.name, i]));
  const allNames = infos.map((i) => i.name);
  const rank = (name) => {
    const s = signals[name]?.type;
    if (s === "needs_input") return 0;
    if (s === "working") return 1;
    return 2;
  };
  const sortedAll = [...allNames].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });
  const names = filter === "needs_input" ? utils.needsInputSessions(sortedAll, signals) : sortedAll;
  const needsInputCount = utils.needsInputSessions(sortedAll, signals).length;
  const workerCount = infos.filter((info) => info.role !== "pilot" && info.role !== "overseer").length;
  const controlCount = infos.length - workerCount;
  const setFilter = (f) => {
    const next = f === "needs_input" ? "needs_input" : "all";
    setFilterState(next);
    window.history.replaceState(null, "", next === "needs_input" ? "/p/agents/sessions?filter=needs_input" : "/p/agents/sessions");
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      C.SpatialWorkspaceLayout,
      {
        hero: {
          eyebrow: t.sessions.workspaceEyebrow,
          title: t.page.sessions,
          count: infos.length,
          description: t.sessions.workspaceIntro,
          mascotState: sessions.isLoading ? "saving" : sessions.isError ? "error" : "idle",
          status: !sessions.isLoading && !sessions.isError ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "workspace-status", children: t.sessions.workspaceReady }) : void 0,
          // The conversation register moved to the Chat page (it is core data, reachable with this
          // plugin disabled); this page keeps a signpost instead of the old Conversations tab.
          action: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "ghost", icon: MessageSquare, onClick: () => navigate("/chat"), children: t.chat.openHistory }),
          metrics: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.WorkspaceMetric, { label: t.sessions.metricLive, value: infos.length, icon: Activity }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.WorkspaceMetric, { label: t.sessions.metricNeedsInput, value: needsInputCount, icon: Bell }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.WorkspaceMetric, { label: t.sessions.metricWorkers, value: workerCount, icon: Bot }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.WorkspaceMetric, { label: t.sessions.metricControl, value: controlCount, icon: Eye })
          ] })
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ControlSurfaceDocument, { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "min-w-0", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(C.ControlSurfaceToolbar, { className: "flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:justify-between", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex min-w-0 flex-col gap-1", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex items-baseline gap-2", children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { className: "text-base font-semibold text-text", children: t.sessions.liveTitle }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "font-mono text-xs text-text-muted", children: names.length })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "text-xs text-text-muted", children: t.sessions.liveHint })
            ] }),
            allNames.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Segmented, { size: "sm", value: filter, onChange: setFilter, options: [{ value: "all", label: t.sessions.filterAll, icon: List }, { value: "needs_input", label: t.sessions.filterNeedsInput, icon: Bell }], nowrap: true }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ControlSurfaceRegister, { children: sessions.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.LoadingState, { variant: "list" }) }) : sessions.isError ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ControlSurfaceState, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.ErrorState, { message: t.common.daemonUnreachable, onRetry: () => sessions.refetch() }) }) : names.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.EntityList, { "data-testid": "live-sessions-list", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.MotionPresence, { children: names.map((s) => {
            const info = byName.get(s);
            if (!info) return null;
            return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.MotionLayoutItem, { layoutId: `live-session-${s}`, role: "listitem", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SessionCard, { info, compact: true, onOpenTerminal: () => setOpenTerm(s) }) }, s);
          }) }) }) : filter === "needs_input" && allNames.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "border-b border-border/80 py-7 text-sm text-text-muted", children: t.sessions.noNeedsInput }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-col gap-4 border-b border-border/80 py-6 sm:flex-row sm:items-center sm:justify-between", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex items-center gap-3", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border text-text-muted", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SquareTerminal, { size: 17, "aria-hidden": true }) }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-col gap-0.5", children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "text-sm font-medium text-text", children: t.sessions.empty }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "text-xs text-text-muted", children: t.sessions.emptyDescription })
              ] })
            ] }),
            workPages ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.Button, { variant: "accent", icon: ArrowRight, onClick: () => navigate("/p/work/tasks"), children: t.sessions.emptyAction }) : null
          ] }) })
        ] }) })
      }
    ),
    openTerm && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(C.TerminalModal, { session: openTerm, onClose: () => setOpenTerm(null) })
  ] });
}

// plugins/agents/web-src/escalations/EscalationsView.tsx
var import_react5 = __toESM(require_react(), 1);
var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
function PendingAskCard({ ask }) {
  const { components: C, hooks, utils } = runtime();
  const { locale } = hooks.useTranslation();
  const s = hooks.usePluginStrings("agents");
  const reply = hooks.useReplyAsk();
  const { toast } = hooks.useToast();
  const [text, setText] = (0, import_react5.useState)("");
  const when = ask.since ? utils.formatTaskTime(new Date(ask.since).toISOString(), Date.now(), locale) : { label: "", title: "" };
  const send = () => {
    const v = text.trim();
    if (!v) return;
    reply.mutate({ taskId: ask.taskId, askId: ask.askId, text: v }, {
      onSuccess: () => {
        toast(s.escAskReplied);
        setText("");
      },
      onError: (e) => toast(utils.apiErrorMessage(e) || s.escAskReplyError, "error")
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("article", { className: "escalation-register-row flex flex-col gap-4 border-t border-accent/30 px-4 py-5", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex items-start gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent/10", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(MessagesSquare, { size: 20, className: "text-accent", "aria-hidden": true }) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "min-w-0 flex-1", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("h2", { className: "truncate text-sm font-semibold text-text", children: [
          s.escAskTitle,
          ask.title ? ` \xB7 ${ask.title}` : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-text-muted", children: [
          ask.epicId ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Rocket, { size: 11, className: "shrink-0", "aria-hidden": true }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "truncate", children: ask.epicId })
          ] }) : null,
          when.label ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { "aria-hidden": true, className: "opacity-50", children: "\xB7" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Clock, { size: 11, className: "shrink-0", "aria-hidden": true }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { title: when.title, children: when.label })
          ] }) : null
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "border-l border-accent/35 py-1 pl-4", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "whitespace-pre-wrap text-sm leading-relaxed text-text", children: ask.question }) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "text-xs text-text-muted", children: s.escAskDesc }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Input, { value: text, onChange: (e) => setText(e.target.value), onKeyDown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          send();
        }
      }, placeholder: s.escAskReplyPlaceholder, className: "flex-1" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Button, { variant: "accent", icon: Play, onClick: send, disabled: !text.trim() || reply.isPending, children: s.escAskSend })
    ] })
  ] });
}
function EscalationsView() {
  const { components: C, hooks, utils } = runtime();
  const { locale } = hooks.useTranslation();
  const s = hooks.usePluginStrings("agents");
  const escalations = hooks.useEscalations();
  const pendingAsks = hooks.usePendingAsks().data ?? [];
  const setStatus = hooks.useSetTaskStatus();
  const approveGate = hooks.useApproveGate();
  const resume = hooks.useResumeMission();
  const { toast } = hooks.useToast();
  const blockedCount = escalations.reduce((sum, escalation) => sum + escalation.blocked.length, 0);
  const total = escalations.length + pendingAsks.length;
  const approve = (e) => {
    if (e.blocked.length === 0) return;
    approveGate.mutate(e.taskId, {
      onSuccess: () => {
        if (e.epicId) resume.mutate(`m-${e.epicId}`, { onError: () => {
        } });
        toast(s.escApproved);
      },
      onError: (err) => toast(utils.apiErrorMessage(err) || s.escActionError, "error")
    });
  };
  const rerun = (e) => {
    setStatus.mutate({ id: e.taskId, status: "open" }, {
      onSuccess: () => {
        if (e.epicId) resume.mutate(`m-${e.epicId}`, { onError: () => {
        } });
        toast(s.escRerunning);
      },
      onError: (err) => toast(utils.apiErrorMessage(err) || s.escActionError, "error")
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
    C.SpatialWorkspaceLayout,
    {
      hero: {
        eyebrow: s.escWorkspaceEyebrow,
        title: s.escTitle,
        count: total,
        description: s.escWorkspaceIntro,
        status: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "workspace-status", children: total > 0 ? s.escWorkspaceWaiting : s.escWorkspaceReady }),
        metrics: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.WorkspaceMetric, { label: s.escMetricTotal, value: total, icon: Inbox }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.WorkspaceMetric, { label: s.escMetricQuestions, value: pendingAsks.length, icon: MessagesSquare }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.WorkspaceMetric, { label: s.escMetricReviews, value: escalations.length, icon: ShieldAlert }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.WorkspaceMetric, { label: s.escMetricBlocked, value: blockedCount, icon: GitBranch })
        ] })
      },
      children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.ControlSurfaceDocument, { children: total === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.EmptyState, { title: s.escEmpty, description: s.escEmptyDesc, icon: ShieldCheck }) }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(C.ControlSurfaceRegister, { children: [
        pendingAsks.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { className: "border-b border-border/80 px-4 pb-3 font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-accent", children: s.escQuestionsSection }) : null,
        pendingAsks.map((a) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PendingAskCard, { ask: a }, a.askId)),
        escalations.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { className: "border-b border-border/80 px-4 pb-3 pt-7 font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-warning", children: s.escReviewsSection }) : null,
        escalations.map((e) => {
          const when = utils.formatTaskTime(e.ts, Date.now(), locale);
          return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("article", { className: "escalation-register-row flex flex-col gap-4 border-t border-warning/30 px-4 py-5", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex items-start gap-3", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-warning/40 bg-warning/10", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ShieldAlert, { size: 20, className: "text-warning", "aria-hidden": true }) }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "min-w-0 flex-1", children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { className: "truncate text-sm font-semibold text-text", children: e.title }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-text-muted", children: [
                  e.epicId ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Rocket, { size: 11, className: "shrink-0", "aria-hidden": true }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "truncate", children: e.epicId })
                  ] }) : null,
                  when.label ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { "aria-hidden": true, className: "opacity-50", children: "\xB7" }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Clock, { size: 11, className: "shrink-0", "aria-hidden": true }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { title: when.title, children: when.label })
                  ] }) : null
                ] })
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "border-l border-warning/35 py-1 pl-4", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted", children: s.escRationale }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "whitespace-pre-wrap text-sm leading-relaxed text-text", children: e.rationale || s.escNoReason })
            ] }),
            e.blocked.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex flex-col gap-1", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "text-[11px] font-semibold uppercase tracking-wide text-text-muted", children: s.escBlockedBy }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("ul", { className: "flex flex-col gap-1", children: e.blocked.map((b) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { className: "flex items-center gap-2 text-xs text-text", children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Link2, { size: 12, className: "shrink-0 text-text-muted", "aria-hidden": true }),
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "min-w-0 flex-1 truncate", children: b.title })
              ] }, b.id)) })
            ] }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex flex-wrap items-center justify-end gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { type: "button", onClick: () => rerun(e), disabled: setStatus.isPending, className: "inline-flex items-center gap-1.5 px-1 py-2 text-xs text-text-muted transition-colors hover:text-warning disabled:opacity-40", children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(RotateCcw, { size: 13, "aria-hidden": true }),
                s.escRerun
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(C.Button, { variant: "accent", icon: Play, onClick: () => approve(e), disabled: e.blocked.length === 0 || approveGate.isPending, children: s.escApprove })
            ] })
          ] }, `${e.taskId}-${e.ts}`);
        })
      ] }) })
    }
  );
}

// plugins/agents/web-src/settings/AgentsSettings.tsx
var import_react7 = __toESM(require_react(), 1);

// plugins/agents/web-src/settings/AutopilotSection.tsx
var import_react6 = __toESM(require_react(), 1);
var import_jsx_runtime5 = __toESM(require_jsx_runtime(), 1);
var inputClass = "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors focus:border-accent";
function AutopilotSection() {
  const { components: C, hooks, utils, api } = runtime();
  const s = hooks.usePluginStrings("agents");
  const { toast } = hooks.useToast();
  const config = hooks.useConfig();
  const update = hooks.useUpdateConfig();
  const brainModels = hooks.useBrainModels();
  const [model, setModel] = (0, import_react6.useState)("");
  const [pilotExec, setPilotExec] = (0, import_react6.useState)("");
  const [overseerExec, setOverseerExec] = (0, import_react6.useState)("");
  const [reasoningMode, setReasoningMode] = (0, import_react6.useState)("relay");
  const [reviewOnDone, setReviewOnDone] = (0, import_react6.useState)(false);
  const [tddMode, setTddMode] = (0, import_react6.useState)(false);
  const [apiUrl, setApiUrl] = (0, import_react6.useState)("");
  const [apiKey, setApiKey] = (0, import_react6.useState)("");
  const [apProviderId, setApProviderId] = (0, import_react6.useState)("");
  const [notes, setNotes] = (0, import_react6.useState)("");
  const [defExec, setDefExec] = (0, import_react6.useState)("");
  const [defAutonomy, setDefAutonomy] = (0, import_react6.useState)("");
  const [defMaxSessions, setDefMaxSessions] = (0, import_react6.useState)(1);
  const [slice, setSlice] = (0, import_react6.useState)(null);
  (0, import_react6.useEffect)(() => {
    let alive = true;
    api("/plugins/agents").then((d) => {
      if (alive) setSlice(d.config ?? {});
    }).catch(() => {
      if (alive) setSlice({});
    });
    return () => {
      alive = false;
    };
  }, [api]);
  const seeded = (0, import_react6.useRef)(false);
  (0, import_react6.useEffect)(() => {
    if (config.data && slice && !seeded.current) {
      seeded.current = true;
      setModel(config.data.autopilot.model);
      const slicePilot = typeof slice.pilotExec === "string" ? slice.pilotExec : "";
      const sliceOverseer = typeof slice.overseerExec === "string" ? slice.overseerExec : "";
      setPilotExec(slicePilot);
      setOverseerExec(sliceOverseer);
      setReviewOnDone(slice.reviewOnDone === true);
      setTddMode(slice.tddMode === true);
      setReasoningMode(slicePilot || sliceOverseer ? "agents" : "relay");
      setApiUrl(config.data.autopilot.apiUrl);
      setApProviderId(config.data.autopilot.providerId ?? "");
      setNotes(config.data.autopilot.notes);
      setDefExec(config.data.defaults.exec);
      setDefAutonomy(config.data.defaults.autonomy);
      setDefMaxSessions(config.data.defaults.maxSessions);
    }
  }, [config.data, slice]);
  const saveAutopilot = async () => {
    try {
      const values = reasoningMode === "agents" ? { pilotExec, overseerExec, reviewOnDone, tddMode } : { pilotExec: "", overseerExec: "", tddMode };
      await api("/plugins/agents/config", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ values }) });
      await update.mutateAsync({ autopilot: reasoningMode === "agents" ? { notes } : { model, apiUrl, providerId: apProviderId, notes, ...apiKey ? { apiKey } : {} } });
      if (apiKey) setApiKey("");
    } catch (error) {
      toast(String(error), "error");
      throw error;
    }
  };
  const saveDefaults = async () => {
    try {
      await update.mutateAsync({ defaults: { exec: defExec, autonomy: defAutonomy, maxSessions: defMaxSessions } });
    } catch (error) {
      toast(String(error), "error");
      throw error;
    }
  };
  const ready = seeded.current;
  const autopilotSave = hooks.useAutoSaveStatus([reasoningMode, pilotExec, overseerExec, reviewOnDone, tddMode, notes, model, apiUrl, apiKey, apProviderId], saveAutopilot, { ready });
  const defaultsSave = hooks.useAutoSaveStatus([defExec, defAutonomy, defMaxSessions], saveDefaults, { ready });
  const status = autopilotSave.status === "error" || defaultsSave.status === "error" ? "error" : autopilotSave.status === "saving" || defaultsSave.status === "saving" ? "saving" : autopilotSave.status === "saved" || defaultsSave.status === "saved" ? "saved" : "idle";
  const retry = () => {
    if (autopilotSave.status === "error") autopilotSave.retry();
    if (defaultsSave.status === "error") defaultsSave.retry();
  };
  if (config.isLoading || !slice) return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.LoadingState, { variant: "list" });
  if (config.isError) return null;
  const models = utils.allModels(config.data?.customModels ?? [], config.data?.hiddenPresets ?? []);
  const switchReasoning = (m) => {
    setReasoningMode(m);
    if (m === "relay") {
      setPilotExec("");
      setOverseerExec("");
    } else {
      const def = models[0]?.exec ?? "";
      if (!pilotExec) setPilotExec(def);
      if (!overseerExec) setOverseerExec(def);
    }
  };
  const apProviders = (config.data?.brain?.providers ?? []).filter((p) => p.apiKeySet).map((p) => ({ id: p.id, label: p.label }));
  const apCatalog = Array.from(new Set((brainModels.data ?? []).filter((m) => m.provider === apProviderId).map((m) => m.model)));
  const relayHasCatalog = apProviderId !== "" && apCatalog.length > 0;
  const apiKeySet = config.data?.autopilot.apiKeySet;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(C.SettingsGroup, { title: s.autopilot, description: s.autopilotHint, icon: Bot, actions: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.AutoSaveStatus, { status, onRetry: retry }), children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.backendMode, description: s.backendModeHint, icon: Radio, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      C.Segmented,
      {
        value: reasoningMode,
        onChange: (v) => switchReasoning(v),
        options: [
          { value: "relay", label: s.modeRelay, icon: Radio },
          { value: "agents", label: s.modeAgents, icon: Bot }
        ]
      }
    ) }) }),
    reasoningMode === "relay" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.apProvider, description: s.apProviderHint, icon: KeyRound, children: apProviders.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.ChoiceField, { title: s.apProvider, options: apProviders.map((p) => ({ value: p.id, label: p.label })), value: apProviderId, onChange: setApProviderId, picker: "always" }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.ProviderPicker, { providers: apProviders, value: apProviderId, onChange: setApProviderId, label: s.apProvider, emptyText: s.apNoProviders }) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.plannerModel, description: s.plannerModelHint, icon: Bot, children: relayHasCatalog ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.ModelCatalogField, { value: model, onChange: setModel, catalog: apCatalog, title: s.plannerModel, subtitle: s.plannerModelHint }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg", "aria-hidden": true, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.ModelIcon, { name: model, size: 16 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("input", { value: model, onChange: (e) => setModel(e.target.value), className: inputClass, placeholder: s.plannerPlaceholder, "aria-label": s.plannerModel })
      ] }) }),
      apProviderId === "" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.apiUrl, description: s.apiUrlHint, icon: Link2, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("input", { value: apiUrl, onChange: (e) => setApiUrl(e.target.value), className: inputClass, "aria-label": s.apiUrl }) }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.apiKey, description: apiKeySet ? s.apiKeyHint : s.apiKeyNotSetHint, icon: KeyRound, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("input", { type: "password", value: apiKey, onChange: (e) => setApiKey(e.target.value), placeholder: apiKeySet ? s.apiKeySetPlaceholder : s.apiKeyPlaceholder, className: inputClass, "aria-label": s.apiKey }) })
      ] }) : null
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.plannerModel, description: s.plannerModelHint, icon: Bot, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.BackendPicker, { value: pilotExec, onChange: setPilotExec, models, relayLabel: s.relayOption, allowRelay: false }) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.overseerExec, description: s.overseerExecHint, icon: Eye, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.BackendPicker, { value: overseerExec, onChange: setOverseerExec, models, relayLabel: s.relayOption, allowRelay: false }) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.reviewOnDone, description: s.reviewOnDoneHint, icon: Eye, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.Toggle, { checked: reviewOnDone, onChange: setReviewOnDone, label: s.reviewOnDone }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.notes, description: s.notesHint, icon: FileText, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("textarea", { value: notes, onChange: (e) => setNotes(e.target.value), rows: 3, className: `${inputClass} resize-none`, "aria-label": s.notes }) }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.executor, description: s.executorHint, icon: Cpu, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.BackendPicker, { value: defExec, onChange: setDefExec, models, relayLabel: s.relayOption, allowRelay: false }) }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.autonomy, description: s.autonomyHint, icon: Gauge, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.Segmented, { options: ["L0", "L1", "L2", "L3"].map((l) => ({ value: l, label: l })), value: defAutonomy, onChange: setDefAutonomy }) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.maxSessions, description: s.maxSessionsHint, icon: Layers, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("input", { type: "number", min: 1, value: defMaxSessions, onChange: (e) => setDefMaxSessions(Number(e.target.value)), className: inputClass, "aria-label": s.maxSessions }) }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.SettingsRow, { label: s.tddMode, description: s.tddModeHint, icon: FlaskConical, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(C.Toggle, { checked: tddMode, onChange: setTddMode, label: s.tddMode }) })
  ] });
}

// plugins/agents/web-src/settings/AgentsSettings.tsx
var import_jsx_runtime6 = __toESM(require_jsx_runtime(), 1);
function AgentsSettings({ surface, plugin, params }) {
  const { components: C } = runtime();
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.PluginPageFrame, { surface, plugin, section: params.id, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "flex flex-col gap-6", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(AutopilotSection, {}),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(PluginConfigSection, {})
  ] }) });
}
function PluginConfigSection() {
  const { components: C, hooks, api } = runtime();
  const { t, locale } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const [detail, setDetail] = (0, import_react7.useState)(null);
  const [values, setValues] = (0, import_react7.useState)({});
  const [dirty, setDirty] = (0, import_react7.useState)(false);
  const [saving, setSaving] = (0, import_react7.useState)(false);
  const [failed, setFailed] = (0, import_react7.useState)(false);
  (0, import_react7.useEffect)(() => {
    let alive = true;
    api("/plugins/agents").then((d) => {
      if (alive) {
        const det = d;
        setDetail(det);
        setValues({ ...det.config });
      }
    }).catch(() => {
      if (alive) setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [api]);
  if (failed) return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.ErrorState, { message: t.common.daemonUnreachable });
  if (!detail) return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.LoadingState, { variant: "list" });
  const CUSTOM_EDITED = /* @__PURE__ */ new Set(["pilotExec", "overseerExec", "reviewOnDone", "tddMode", "prEnabled", "ghToken"]);
  const fields = (detail.configSchema ?? []).filter((f) => !CUSTOM_EDITED.has(f.key));
  const tr = detail.i18n?.[locale]?.fields;
  const label = (f) => tr?.[f.key]?.label ?? f.label;
  const hint = (f) => tr?.[f.key]?.hint ?? f.hint;
  const set = (key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      const payload = {};
      for (const f of fields) {
        if (f.type !== "section" && values[f.key] !== void 0) payload[f.key] = values[f.key];
      }
      await api("/plugins/agents/config", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ values: payload }) });
      setDirty(false);
      toast(t.common.saved);
    } catch {
      toast(t.common.error, "error");
    } finally {
      setSaving(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "flex flex-col gap-4", children: [
    fields.map((f) => {
      if (f.type === "section") {
        return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "flex flex-col gap-0.5 pt-2 first:pt-0", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h3", { className: "text-sm font-semibold text-text", children: label(f) }),
          hint(f) ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "text-xs text-text-muted", children: hint(f) }) : null
        ] }, f.key);
      }
      if (f.type === "boolean") {
        return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "flex items-center justify-between gap-3", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "flex min-w-0 flex-col", children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "text-sm text-text", children: label(f) }),
            hint(f) ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "text-xs text-text-muted", children: hint(f) }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.Toggle, { checked: values[f.key] === true, onChange: (next) => set(f.key, next), label: label(f) })
        ] }, f.key);
      }
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.Field, { label: label(f), hint: hint(f), children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        C.Input,
        {
          value: typeof values[f.key] === "string" ? values[f.key] : "",
          placeholder: f.placeholder,
          onChange: (e) => set(f.key, e.target.value)
        }
      ) }, f.key);
    }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "flex items-center justify-end", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(C.Button, { variant: "accent", disabled: !dirty || saving, onClick: () => {
      void save();
    }, children: t.common.save }) })
  ] });
}

// plugins/agents/web-src/settings/CliAgentsSettings.tsx
var import_react8 = __toESM(require_react(), 1);
var import_jsx_runtime7 = __toESM(require_jsx_runtime(), 1);
function CliAgentsSettings({ surface, plugin, params }) {
  const { components: C, hooks, utils } = runtime();
  const s = hooks.usePluginStrings("agents");
  const { t } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const config = hooks.useConfig();
  const update = hooks.useUpdateConfig();
  const systemSkills = hooks.useSystemSkills();
  const installSkills = hooks.useInstallSkills();
  const [providers, setProviders] = (0, import_react8.useState)({});
  const seeded = (0, import_react8.useRef)(false);
  (0, import_react8.useEffect)(() => {
    if (config.data && !seeded.current) {
      seeded.current = true;
      setProviders(config.data.providers ?? {});
    }
  }, [config.data]);
  const saveProviders = async () => {
    try {
      await update.mutateAsync({ providers });
    } catch (error) {
      toast(String(error), "error");
      throw error;
    }
  };
  const providersSave = hooks.useAutoSaveStatus([providers], saveProviders, { ready: seeded.current });
  if (config.isLoading) return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.LoadingState, { variant: "list" });
  if (config.isError) return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.ErrorState, { message: t.common.daemonUnreachable, onRetry: () => config.refetch() });
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.PluginPageFrame, { surface, plugin, section: params.id, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "flex flex-col gap-4", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
      C.SettingsGroup,
      {
        title: s.agentSkills,
        description: s.agentSkillsHint,
        icon: Sparkles,
        actions: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          C.Button,
          {
            variant: "accent",
            className: "h-8 shrink-0",
            disabled: installSkills.isPending || !(systemSkills.data?.skills ?? []).some((sk) => sk.present && !sk.upToDate),
            onClick: () => installSkills.mutate(void 0, {
              onSuccess: () => toast(s.skillsInstalled),
              onError: (e) => toast(String(e), "error")
            }),
            children: installSkills.isPending ? s.skillInstalling : s.skillInstall
          }
        ),
        children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "settings-skill-statuses", children: (systemSkills.data?.skills ?? []).map((sk) => {
          const tone = !sk.present ? "muted" : sk.upToDate ? "success" : sk.installed ? "warning" : "default";
          const label = !sk.present ? s.skillProviderAbsent : sk.upToDate ? s.skillUpToDate : sk.installed ? s.skillOutdated : s.skillMissing;
          return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "font-mono text-sm text-text", children: sk.provider }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Badge, { tone, children: label })
          ] }, sk.provider);
        }) })
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.SettingsGroup, { title: s.cliAgents, description: s.cliAgentsHint, icon: SquareTerminal, density: "compact", actions: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.AutoSaveStatus, { status: providersSave.status, onRetry: providersSave.retry }), children: utils.cliProviders.map((p) => {
      const cur = providers[p.id] ?? { bin: p.binHint, args: "", skipPermissions: true, resume: true };
      const set = (patch) => setProviders((prev) => ({ ...prev, [p.id]: { ...cur, ...patch } }));
      return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "settings-agent-row @container", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "flex flex-col gap-3 @sm:flex-row @sm:items-start", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "flex items-center gap-3 @sm:w-44 @sm:shrink-0 @sm:pt-1", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.ProviderLogo, { meta: p, alt: p.label, size: 56 }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "min-w-0", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "flex items-center gap-1.5 text-sm font-medium text-text", children: [
              p.label,
              p.embedded ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.HelpTip, { align: "left", children: s.embeddedProviderHint }) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "font-mono text-[11px] text-text-muted", children: p.id })
          ] })
        ] }),
        p.embedded ? null : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "flex flex-1 flex-col gap-3", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "grid grid-cols-1 gap-3 @sm:grid-cols-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.binary, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Input, { value: cur.bin, placeholder: p.binHint, onChange: (e) => set({ bin: e.target.value }), className: "font-mono text-xs" }) }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Field, { label: s.extraArgs, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Input, { value: cur.args, placeholder: p.argsHint, onChange: (e) => set({ args: e.target.value }), className: "font-mono text-xs" }) })
          ] }),
          p.noBypassFlag ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "border-t border-border/70 pt-2 text-[11px] leading-relaxed text-text-muted", children: s.skipPermissionsNoop }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { className: "flex items-center justify-between gap-3 border-t border-border/70 pt-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "flex min-w-0 items-center gap-1.5 text-xs font-medium text-text", children: [
              s.skipPermissions,
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.HelpTip, { align: "left", children: s.skipPermissionsHint })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Toggle, { checked: cur.skipPermissions !== false, onChange: (v) => set({ skipPermissions: v }), label: s.skipPermissions })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { className: "flex items-center justify-between gap-3 border-t border-border/70 pt-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "flex min-w-0 items-center gap-1.5 text-xs font-medium text-text", children: [
              s.resumeSessions,
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.HelpTip, { align: "left", children: s.resumeSessionsHint })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(C.Toggle, { checked: cur.resume !== false, onChange: (v) => set({ resume: v }), label: s.resumeSessions })
          ] })
        ] })
      ] }) }, p.id);
    }) })
  ] }) });
}

// plugins/agents/web-src/settings/GithubSettings.tsx
var import_react10 = __toESM(require_react(), 1);

// plugins/agents/web-src/settings/GithubStatusBanner.tsx
var import_react9 = __toESM(require_react(), 1);
var import_jsx_runtime8 = __toESM(require_jsx_runtime(), 1);
function GithubStatusBanner() {
  const { hooks, api } = runtime();
  const s = hooks.usePluginStrings("agents");
  const [data, setData] = (0, import_react9.useState)(null);
  const storedConfig = hooks.usePluginDetail("agents").data;
  (0, import_react9.useEffect)(() => {
    let alive = true;
    api("/integrations/github-status").then((d) => {
      if (alive) setData(d);
    }).catch(() => {
    });
    return () => {
      alive = false;
    };
  }, [api, storedConfig]);
  if (!data) return null;
  const ready = data.ready;
  const Icon2 = ready ? CircleCheck : TriangleAlert;
  const tone = ready ? "text-success" : "text-warning";
  const message = !ready ? s.ghStatusNone : data.method === "token" ? s.ghStatusToken : data.account ? s.ghStatusGh?.replace("{account}", data.account) : s.ghStatusGhNoAccount;
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: `settings-status-banner ${tone}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon2, { size: 16, className: "mt-0.5 shrink-0", "aria-hidden": true }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex flex-col gap-0.5 text-sm", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "font-medium", children: message }),
      !ready && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "text-text-muted", children: s.ghStatusNoneHint })
    ] })
  ] });
}

// plugins/agents/web-src/settings/GithubSettings.tsx
var import_jsx_runtime9 = __toESM(require_jsx_runtime(), 1);
var inputClass2 = "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors focus:border-accent";
function GithubSettings({ surface, plugin, params, onSaveState }) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings("agents");
  const { t } = hooks.useTranslation();
  const { toast } = hooks.useToast();
  const detail = hooks.usePluginDetail("agents");
  const saveConfig = hooks.useSavePluginConfig();
  const [ghToken, setGhToken] = (0, import_react10.useState)("");
  const [prEnabled, setPrEnabled] = (0, import_react10.useState)(false);
  const [githubOpen, setGithubOpen] = (0, import_react10.useState)(false);
  const [seeded, setSeeded] = (0, import_react10.useState)(false);
  (0, import_react10.useEffect)(() => {
    if (seeded) return;
    if (detail.data) {
      setPrEnabled(detail.data.config?.prEnabled === true);
      setSeeded(true);
    } else if (detail.isError) {
      setSeeded(true);
    }
  }, [detail.data, detail.isError, seeded]);
  const saveGithub = async () => {
    try {
      const values = { prEnabled, ...ghToken ? { ghToken } : {} };
      await saveConfig.mutateAsync({ name: "agents", values });
      if (ghToken) setGhToken("");
    } catch (error) {
      toast(String(error), "error");
      throw error;
    }
  };
  const { status, retry } = hooks.useAutoSaveStatus([prEnabled, ghToken], saveGithub, { ready: seeded });
  (0, import_react10.useEffect)(() => {
    onSaveState?.(status, retry);
  }, [onSaveState, retry, status]);
  const ghTokenSet = detail.data?.secretsSet?.includes("ghToken") ?? false;
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.PluginPageFrame, { surface, plugin, section: params.id, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(C.ConstellationScope, { core: s.github, children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.SettingsGroup, { variant: "classic", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(GithubStatusBanner, {}) }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(C.SettingsGroup, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(C.SettingsRow, { label: s.ghToken, description: ghTokenSet ? s.ghTokenHint : s.ghTokenNotSetHint, icon: KeyRound, children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "font-mono text-sm tracking-widest text-text-muted", children: ghTokenSet || ghToken ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "\u2014" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", "data-selection-manage": true, className: "hidden", "aria-label": s.ghToken, onClick: () => setGithubOpen(true) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.SettingsRow, { label: s.prEnabled, description: s.prEnabledHint, icon: GitPullRequest, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.Toggle, { checked: prEnabled, onChange: setPrEnabled, label: s.prEnabled }) })
    ] }),
    githubOpen ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(C.WorkspaceDetailRail, { label: s.github, closeLabel: t.common?.close, onClose: () => setGithubOpen(false), children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "flex flex-col gap-5 py-2", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "flex flex-col gap-1.5", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "text-tiny font-semibold uppercase tracking-wide text-text-muted", children: s.ghToken }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("input", { type: "password", value: ghToken, onChange: (e) => setGhToken(e.target.value), placeholder: ghTokenSet ? s.apiKeySetPlaceholder : s.ghTokenPlaceholder, className: inputClass2, "aria-label": s.ghToken })
    ] }) }) }) : null
  ] }) });
}

// plugins/agents/web-src/index.tsx
function RootRedirect() {
  (0, import_react11.useEffect)(() => {
    runtime().navigate("/p/agents/sessions");
  }, []);
  return null;
}
registerAgentsUi({
  requiresApiVersion: 1,
  pages: {
    "": RootRedirect,
    "sessions": SessionsView,
    "escalations": EscalationsView
  },
  settings: {
    "agents": AgentsSettings,
    "cli-agents": CliAgentsSettings,
    "github": GithubSettings
  }
});
