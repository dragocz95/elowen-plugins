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

// plugins/work/web-src/index.tsx
var import_react22 = __toESM(require_react(), 1);

// plugins/work/web-src/runtime.tsx
var import_react = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
function runtime() {
  const rt = window.ElowenUiRuntime;
  if (!rt) throw new Error("ElowenUiRuntime is not installed");
  return rt;
}
function registerWorkUi(registration) {
  window.__elowenRegisterPluginUi?.("work", registration);
}
function Link({ href, className, title, children }) {
  const onClick = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    runtime().navigate(href);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href, className, title, onClick, children });
}
var searchListeners = /* @__PURE__ */ new Set();
var popstateBound = false;
var readSearch = () => typeof window === "undefined" ? "" : window.location.search;
function publishSearch() {
  for (const listener of searchListeners) listener();
}
function subscribeSearch(listener) {
  searchListeners.add(listener);
  if (!popstateBound) {
    window.addEventListener("popstate", publishSearch);
    popstateBound = true;
  }
  return () => {
    searchListeners.delete(listener);
  };
}
function useSearchParams() {
  const search = (0, import_react.useSyncExternalStore)(subscribeSearch, readSearch, () => "");
  return (0, import_react.useMemo)(() => new URLSearchParams(search), [search]);
}
function useRouter() {
  return {
    replace: (href) => {
      window.history.replaceState(window.history.state, "", href);
      publishSearch();
    },
    push: (href) => {
      runtime().navigate(href);
    }
  };
}

// plugins/work/web-src/tasks/TasksView.tsx
var import_react15 = __toESM(require_react(), 1);

// node_modules/lucide-react/dist/esm/createLucideIcon.js
var import_react3 = __toESM(require_react());

// node_modules/lucide-react/dist/esm/shared/src/utils.js
var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
var mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();

// node_modules/lucide-react/dist/esm/Icon.js
var import_react2 = __toESM(require_react());

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
var Icon = (0, import_react2.forwardRef)(
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
    return (0, import_react2.createElement)(
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
        ...iconNode.map(([tag, attrs]) => (0, import_react2.createElement)(tag, attrs)),
        ...Array.isArray(children) ? children : [children]
      ]
    );
  }
);

// node_modules/lucide-react/dist/esm/createLucideIcon.js
var createLucideIcon = (iconName, iconNode) => {
  const Component = (0, import_react3.forwardRef)(
    ({ className, ...props }, ref) => (0, import_react3.createElement)(Icon, {
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

// node_modules/lucide-react/dist/esm/icons/archive.js
var Archive = createLucideIcon("Archive", [
  ["rect", { width: "20", height: "5", x: "2", y: "3", rx: "1", key: "1wp1u1" }],
  ["path", { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8", key: "1s80jp" }],
  ["path", { d: "M10 12h4", key: "a56b0p" }]
]);

// node_modules/lucide-react/dist/esm/icons/arrow-up-right.js
var ArrowUpRight = createLucideIcon("ArrowUpRight", [
  ["path", { d: "M7 7h10v10", key: "1tivn9" }],
  ["path", { d: "M7 17 17 7", key: "1vkiza" }]
]);

// node_modules/lucide-react/dist/esm/icons/ban.js
var Ban = createLucideIcon("Ban", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "m4.9 4.9 14.2 14.2", key: "1m5liu" }]
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

// node_modules/lucide-react/dist/esm/icons/calendar-check.js
var CalendarCheck = createLucideIcon("CalendarCheck", [
  ["path", { d: "M8 2v4", key: "1cmpym" }],
  ["path", { d: "M16 2v4", key: "4m81vk" }],
  ["rect", { width: "18", height: "18", x: "3", y: "4", rx: "2", key: "1hopcy" }],
  ["path", { d: "M3 10h18", key: "8toen8" }],
  ["path", { d: "m9 16 2 2 4-4", key: "19s6y9" }]
]);

// node_modules/lucide-react/dist/esm/icons/calendar-days.js
var CalendarDays = createLucideIcon("CalendarDays", [
  ["path", { d: "M8 2v4", key: "1cmpym" }],
  ["path", { d: "M16 2v4", key: "4m81vk" }],
  ["rect", { width: "18", height: "18", x: "3", y: "4", rx: "2", key: "1hopcy" }],
  ["path", { d: "M3 10h18", key: "8toen8" }],
  ["path", { d: "M8 14h.01", key: "6423bh" }],
  ["path", { d: "M12 14h.01", key: "1etili" }],
  ["path", { d: "M16 14h.01", key: "1gbofw" }],
  ["path", { d: "M8 18h.01", key: "lrp35t" }],
  ["path", { d: "M12 18h.01", key: "mhygvu" }],
  ["path", { d: "M16 18h.01", key: "kzsmim" }]
]);

// node_modules/lucide-react/dist/esm/icons/calendar-plus.js
var CalendarPlus = createLucideIcon("CalendarPlus", [
  ["path", { d: "M8 2v4", key: "1cmpym" }],
  ["path", { d: "M16 2v4", key: "4m81vk" }],
  ["path", { d: "M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8", key: "3spt84" }],
  ["path", { d: "M3 10h18", key: "8toen8" }],
  ["path", { d: "M16 19h6", key: "xwg31i" }],
  ["path", { d: "M19 16v6", key: "tddt3s" }]
]);

// node_modules/lucide-react/dist/esm/icons/calendar-range.js
var CalendarRange = createLucideIcon("CalendarRange", [
  ["rect", { width: "18", height: "18", x: "3", y: "4", rx: "2", key: "1hopcy" }],
  ["path", { d: "M16 2v4", key: "4m81vk" }],
  ["path", { d: "M3 10h18", key: "8toen8" }],
  ["path", { d: "M8 2v4", key: "1cmpym" }],
  ["path", { d: "M17 14h-6", key: "bkmgh3" }],
  ["path", { d: "M13 18H7", key: "bb0bb7" }],
  ["path", { d: "M7 14h.01", key: "1qa3f1" }],
  ["path", { d: "M17 18h.01", key: "1bdyru" }]
]);

// node_modules/lucide-react/dist/esm/icons/calendar.js
var Calendar = createLucideIcon("Calendar", [
  ["path", { d: "M8 2v4", key: "1cmpym" }],
  ["path", { d: "M16 2v4", key: "4m81vk" }],
  ["rect", { width: "18", height: "18", x: "3", y: "4", rx: "2", key: "1hopcy" }],
  ["path", { d: "M3 10h18", key: "8toen8" }]
]);

// node_modules/lucide-react/dist/esm/icons/check.js
var Check = createLucideIcon("Check", [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]]);

// node_modules/lucide-react/dist/esm/icons/chevron-left.js
var ChevronLeft = createLucideIcon("ChevronLeft", [
  ["path", { d: "m15 18-6-6 6-6", key: "1wnfg3" }]
]);

// node_modules/lucide-react/dist/esm/icons/chevron-right.js
var ChevronRight = createLucideIcon("ChevronRight", [
  ["path", { d: "m9 18 6-6-6-6", key: "mthhwq" }]
]);

// node_modules/lucide-react/dist/esm/icons/circle-check.js
var CircleCheck = createLucideIcon("CircleCheck", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "m9 12 2 2 4-4", key: "dzmm74" }]
]);

// node_modules/lucide-react/dist/esm/icons/circle-x.js
var CircleX = createLucideIcon("CircleX", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "m15 9-6 6", key: "1uzhvr" }],
  ["path", { d: "m9 9 6 6", key: "z0biqf" }]
]);

// node_modules/lucide-react/dist/esm/icons/circle.js
var Circle = createLucideIcon("Circle", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }]
]);

// node_modules/lucide-react/dist/esm/icons/clock.js
var Clock = createLucideIcon("Clock", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["polyline", { points: "12 6 12 12 16 14", key: "68esgv" }]
]);

// node_modules/lucide-react/dist/esm/icons/coins.js
var Coins = createLucideIcon("Coins", [
  ["circle", { cx: "8", cy: "8", r: "6", key: "3yglwk" }],
  ["path", { d: "M18.09 10.37A6 6 0 1 1 10.34 18", key: "t5s6rm" }],
  ["path", { d: "M7 6h1v4", key: "1obek4" }],
  ["path", { d: "m16.71 13.88.7.71-2.82 2.82", key: "1rbuyh" }]
]);

// node_modules/lucide-react/dist/esm/icons/columns-3.js
var Columns3 = createLucideIcon("Columns3", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M9 3v18", key: "fh3hqa" }],
  ["path", { d: "M15 3v18", key: "14nvp0" }]
]);

// node_modules/lucide-react/dist/esm/icons/copy.js
var Copy = createLucideIcon("Copy", [
  ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2", key: "17jyea" }],
  ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2", key: "zix9uf" }]
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

// node_modules/lucide-react/dist/esm/icons/file-diff.js
var FileDiff = createLucideIcon("FileDiff", [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M9 10h6", key: "9gxzsh" }],
  ["path", { d: "M12 13V7", key: "h0r20n" }],
  ["path", { d: "M9 17h6", key: "r8uit2" }]
]);

// node_modules/lucide-react/dist/esm/icons/flag.js
var Flag = createLucideIcon("Flag", [
  ["path", { d: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z", key: "i9b6wo" }],
  ["line", { x1: "4", x2: "4", y1: "22", y2: "15", key: "1cm3nv" }]
]);

// node_modules/lucide-react/dist/esm/icons/git-commit-horizontal.js
var GitCommitHorizontal = createLucideIcon("GitCommitHorizontal", [
  ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }],
  ["line", { x1: "3", x2: "9", y1: "12", y2: "12", key: "1dyftd" }],
  ["line", { x1: "15", x2: "21", y1: "12", y2: "12", key: "oup4p8" }]
]);

// node_modules/lucide-react/dist/esm/icons/git-merge.js
var GitMerge = createLucideIcon("GitMerge", [
  ["circle", { cx: "18", cy: "18", r: "3", key: "1xkwt0" }],
  ["circle", { cx: "6", cy: "6", r: "3", key: "1lh9wr" }],
  ["path", { d: "M6 21V9a9 9 0 0 0 9 9", key: "7kw0sc" }]
]);

// node_modules/lucide-react/dist/esm/icons/git-pull-request.js
var GitPullRequest = createLucideIcon("GitPullRequest", [
  ["circle", { cx: "18", cy: "18", r: "3", key: "1xkwt0" }],
  ["circle", { cx: "6", cy: "6", r: "3", key: "1lh9wr" }],
  ["path", { d: "M13 6h3a2 2 0 0 1 2 2v7", key: "1yeb86" }],
  ["line", { x1: "6", x2: "6", y1: "9", y2: "21", key: "rroup" }]
]);

// node_modules/lucide-react/dist/esm/icons/image.js
var Image = createLucideIcon("Image", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", ry: "2", key: "1m3agn" }],
  ["circle", { cx: "9", cy: "9", r: "2", key: "af1f0g" }],
  ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21", key: "1xmnt7" }]
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

// node_modules/lucide-react/dist/esm/icons/list-checks.js
var ListChecks = createLucideIcon("ListChecks", [
  ["path", { d: "m3 17 2 2 4-4", key: "1jhpwq" }],
  ["path", { d: "m3 7 2 2 4-4", key: "1obspn" }],
  ["path", { d: "M13 6h8", key: "15sg57" }],
  ["path", { d: "M13 12h8", key: "h98zly" }],
  ["path", { d: "M13 18h8", key: "oe0vm4" }]
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

// node_modules/lucide-react/dist/esm/icons/loader-circle.js
var LoaderCircle = createLucideIcon("LoaderCircle", [
  ["path", { d: "M21 12a9 9 0 1 1-6.219-8.56", key: "13zald" }]
]);

// node_modules/lucide-react/dist/esm/icons/minus.js
var Minus = createLucideIcon("Minus", [["path", { d: "M5 12h14", key: "1ays0h" }]]);

// node_modules/lucide-react/dist/esm/icons/pause.js
var Pause = createLucideIcon("Pause", [
  ["rect", { x: "14", y: "4", width: "4", height: "16", rx: "1", key: "zuxfzm" }],
  ["rect", { x: "6", y: "4", width: "4", height: "16", rx: "1", key: "1okwgv" }]
]);

// node_modules/lucide-react/dist/esm/icons/pencil.js
var Pencil = createLucideIcon("Pencil", [
  [
    "path",
    {
      d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      key: "1a8usu"
    }
  ],
  ["path", { d: "m15 5 4 4", key: "1mk7zo" }]
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

// node_modules/lucide-react/dist/esm/icons/power.js
var Power = createLucideIcon("Power", [
  ["path", { d: "M12 2v10", key: "mnfbl" }],
  ["path", { d: "M18.4 6.6a9 9 0 1 1-12.77.04", key: "obofu9" }]
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

// node_modules/lucide-react/dist/esm/icons/scan-search.js
var ScanSearch = createLucideIcon("ScanSearch", [
  ["path", { d: "M3 7V5a2 2 0 0 1 2-2h2", key: "aa7l1z" }],
  ["path", { d: "M17 3h2a2 2 0 0 1 2 2v2", key: "4qcy5o" }],
  ["path", { d: "M21 17v2a2 2 0 0 1-2 2h-2", key: "6vwrx8" }],
  ["path", { d: "M7 21H5a2 2 0 0 1-2-2v-2", key: "ioqczr" }],
  ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }],
  ["path", { d: "m16 16-1.9-1.9", key: "1dq9hf" }]
]);

// node_modules/lucide-react/dist/esm/icons/scroll-text.js
var ScrollText = createLucideIcon("ScrollText", [
  ["path", { d: "M15 12h-5", key: "r7krc0" }],
  ["path", { d: "M15 8h-5", key: "1khuty" }],
  ["path", { d: "M19 17V5a2 2 0 0 0-2-2H4", key: "zz82l3" }],
  [
    "path",
    {
      d: "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3",
      key: "1ph1d7"
    }
  ]
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

// node_modules/lucide-react/dist/esm/icons/square-kanban.js
var SquareKanban = createLucideIcon("SquareKanban", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M8 7v7", key: "1x2jlm" }],
  ["path", { d: "M12 7v4", key: "xawao1" }],
  ["path", { d: "M16 7v9", key: "1hp2iy" }]
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

// node_modules/lucide-react/dist/esm/icons/square.js
var Square = createLucideIcon("Square", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }]
]);

// node_modules/lucide-react/dist/esm/icons/timer.js
var Timer = createLucideIcon("Timer", [
  ["line", { x1: "10", x2: "14", y1: "2", y2: "2", key: "14vaq8" }],
  ["line", { x1: "12", x2: "15", y1: "14", y2: "11", key: "17fdiu" }],
  ["circle", { cx: "12", cy: "14", r: "8", key: "1e1u0o" }]
]);

// node_modules/lucide-react/dist/esm/icons/trash-2.js
var Trash2 = createLucideIcon("Trash2", [
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", key: "4alrt4" }],
  ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", key: "v07s0e" }],
  ["line", { x1: "10", x2: "10", y1: "11", y2: "17", key: "1uufr5" }],
  ["line", { x1: "14", x2: "14", y1: "11", y2: "17", key: "xtxkd" }]
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

// node_modules/lucide-react/dist/esm/icons/user.js
var User = createLucideIcon("User", [
  ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", key: "975kel" }],
  ["circle", { cx: "12", cy: "7", r: "4", key: "17ys0d" }]
]);

// node_modules/lucide-react/dist/esm/icons/wrench.js
var Wrench = createLucideIcon("Wrench", [
  [
    "path",
    {
      d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
      key: "cbrjhi"
    }
  ]
]);

// node_modules/lucide-react/dist/esm/icons/x.js
var X = createLucideIcon("X", [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
]);

// node_modules/lucide-react/dist/esm/icons/zap.js
var Zap = createLucideIcon("Zap", [
  [
    "path",
    {
      d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
      key: "1xq2db"
    }
  ]
]);

// plugins/work/web-src/tasks/TaskDetailPane.tsx
var import_react5 = __toESM(require_react(), 1);

// plugins/work/web-src/tasks/ResultSummary.tsx
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
var { useTranslation } = runtime().hooks;
function ResultSummary({ task, className = "" }) {
  const { t } = useTranslation();
  const isClosed = task.status === "closed" || task.status === "cancelled";
  if (!isClosed || !(task.result_summary || task.outcome)) return null;
  const label = task.type === "epic" ? t.tasks.missionSummaryTitle : t.tasks.resultTitle;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: `flex flex-col gap-1.5 ${className}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "text-[11px] font-semibold uppercase tracking-wide text-text-muted", children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "flex items-start gap-2.5 rounded-lg border border-border bg-elevated p-3.5", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ScrollText, { size: 15, className: "mt-0.5 shrink-0 text-text-muted", "aria-hidden": true }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "whitespace-pre-wrap text-sm leading-relaxed text-text", children: task.result_summary?.trim() || t.tasks.noSummary })
    ] })
  ] });
}

// plugins/work/web-src/tasks/TaskConversation.tsx
var import_react4 = __toESM(require_react(), 1);
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
var { Modal, ModelIcon, PatchView } = runtime().components;
var { useConfig, useTaskBrainConversation, useTaskCommitFileDiff, useTaskCommits, useTaskConversation, useTasks, useTranslation: useTranslation2 } = runtime().hooks;
var { baseName, dirName, fileIcon, formatTaskTime, parseTs, taskExec } = runtime().utils;
function parseDecision(detail) {
  try {
    const p = JSON.parse(detail);
    if (p && typeof p.outcome === "string" && typeof p.question === "string") return p;
  } catch {
  }
  return null;
}
function parseMessage(detail) {
  try {
    const p = JSON.parse(detail);
    if (p && typeof p.text === "string" && (p.role === "agent" || p.role === "autopilot" || p.role === "human")) return p;
  } catch {
  }
  return null;
}
function MessageAvatar({ role, workerExec, overseerExec }) {
  if (role === "human") return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(User, { size: 14, className: "shrink-0 text-text-muted", "aria-hidden": true });
  const exec = role === "agent" ? workerExec : overseerExec;
  if (!exec) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Bot, { size: 14, className: "shrink-0 text-text-muted", "aria-hidden": true });
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ModelIcon, { name: exec, size: 14 });
}
function outcomeTone(outcome) {
  if (outcome === "escalated") return { Icon: TriangleAlert, cls: "text-warning" };
  return { Icon: Check, cls: "text-success" };
}
function TaskConversation({ task }) {
  const { t, locale } = useTranslation2();
  const conversation = useTaskConversation(task.id);
  const commits = useTaskCommits(task.id);
  const tasks = useTasks();
  const config = useConfig();
  const workerExec = taskExec(tasks.data?.find((x) => x.id === task.id)?.labels);
  const overseerExec = config.data?.autopilot.overseerExec ?? "";
  const [openFile, setOpenFile] = (0, import_react4.useState)(null);
  const fileDiff = useTaskCommitFileDiff(task.id, openFile?.hash ?? null, openFile?.path ?? null);
  const isBrainWorker = workerExec.startsWith("elowen:");
  const brainChat = useTaskBrainConversation(task.id, isBrainWorker);
  const items = (0, import_react4.useMemo)(() => {
    const out = [];
    for (const e of conversation.data ?? []) {
      const ts = parseTs(e.ts) ?? 0;
      if (e.type === "decision") {
        const payload = parseDecision(e.detail);
        if (payload) out.push({ kind: "decision", ts, key: `d${e.id}`, payload });
      } else if (e.type === "review") {
        const approved = e.detail.startsWith("approved");
        out.push({ kind: "review", ts, key: `r${e.id}`, approved, rationale: e.detail.replace(/^[^:]*:\s*/, "") });
      } else if (e.type === "message") {
        const payload = parseMessage(e.detail);
        if (payload) out.push({ kind: "message", ts, key: `m${e.id}`, payload });
      }
    }
    for (const c of commits.data?.commits ?? []) out.push({ kind: "commit", ts: c.timestamp, key: `c${c.hash}`, commit: c });
    return out.sort((a, b) => a.ts - b.ts);
  }, [conversation.data, commits.data]);
  const brainTurns = isBrainWorker ? brainChat.data ?? [] : [];
  if (items.length === 0 && brainTurns.length === 0) return null;
  const outcomeLabel = (o) => o === "approved" ? t.tasks.decisionApproved : o === "chose" ? t.tasks.decisionChose : t.tasks.decisionEscalated;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex flex-col gap-1.5", children: [
    brainTurns.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "text-[11px] font-semibold uppercase tracking-wide text-text-muted", children: t.tasks.brainTranscript }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: "flex flex-col gap-1.5", children: brainTurns.map((m, i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("li", { className: "rounded-lg border border-border bg-surface p-2.5 text-xs", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex items-start gap-2", children: [
        m.role === "user" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(User, { size: 14, className: "mt-0.5 shrink-0 text-text-muted", "aria-hidden": true }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mt-0.5 shrink-0", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ModelIcon, { name: workerExec.slice(workerExec.indexOf("/") + 1), size: 14 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "flex min-w-0 flex-1 flex-col gap-1.5", children: (m.segments ?? [{ kind: "text", text: m.text }]).map((seg, j) => seg.kind === "text" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "whitespace-pre-wrap break-words leading-relaxed text-text", children: seg.text }, j) : seg.kind === "image" ? (
          // This panel is a dense activity log, not the chat surface — a shared image reads
          // as one line naming it, the same way the CLI transcript renders it.
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "inline-flex max-w-full items-center gap-1.5 self-start rounded-md border border-border bg-elevated/60 px-2 py-0.5 text-[11px] text-text-muted", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Image, { size: 10, "aria-hidden": true }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "truncate", children: seg.caption?.trim() || baseName(seg.image.url) })
          ] }, j)
        ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "inline-flex max-w-full items-center gap-1.5 self-start rounded-md border border-border bg-elevated/60 px-2 py-0.5 font-mono text-[11px] text-text-muted", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Wrench, { size: 10, "aria-hidden": true }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "truncate", children: [
            seg.name,
            seg.detail ? ` ${seg.detail}` : ""
          ] })
        ] }, j)) })
      ] }) }, i)) })
    ] }) : null,
    items.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "text-[11px] font-semibold uppercase tracking-wide text-text-muted", children: t.tasks.activityLog }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: "flex flex-col gap-1.5", children: items.map((it) => {
        const when = formatTaskTime(new Date(it.ts).toISOString(), Date.now(), locale);
        if (it.kind === "commit") {
          const c = it.commit;
          const added = c.files.reduce((s, f) => s + f.added, 0);
          const deleted = c.files.reduce((s, f) => s + f.deleted, 0);
          return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { className: "rounded-lg border border-border bg-surface p-2.5 text-xs", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GitCommitHorizontal, { size: 14, className: "shrink-0 text-text-muted", "aria-hidden": true }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "min-w-0 flex-1 truncate text-text", title: c.subject, children: c.subject }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px]", children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "text-success", children: [
                  "+",
                  added
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "text-danger", children: [
                  "\u2212",
                  deleted
                ] })
              ] }),
              when.label ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "shrink-0 text-text-muted", title: when.title, children: when.label }) : null
            ] }),
            c.files.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: "mt-1.5 flex flex-col gap-0.5 pl-6", children: c.files.map((f) => {
              const Icon2 = fileIcon(f.path);
              return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { type: "button", onClick: () => setOpenFile({ hash: c.hash, path: f.path }), className: "flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-elevated", children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon2, { size: 13, className: "shrink-0 text-text-muted", "aria-hidden": true }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "min-w-0 flex-1 truncate", title: f.path, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "text-text-muted", children: dirName(f.path) }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "text-text", children: baseName(f.path) })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px]", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "text-success", children: [
                    "+",
                    f.added
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "text-danger", children: [
                    "\u2212",
                    f.deleted
                  ] })
                ] })
              ] }) }, f.path);
            }) }) : null
          ] }, it.key);
        }
        if (it.kind === "message") {
          const roleLabel = it.payload.role === "agent" ? t.tasks.msgRoleAgent : it.payload.role === "human" ? t.tasks.msgRoleHuman : t.tasks.msgRoleAutopilot;
          return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { className: "rounded-lg border border-border bg-surface p-2.5 text-xs", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(MessageAvatar, { role: it.payload.role, workerExec, overseerExec }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "min-w-0 flex-1 truncate font-medium text-text", children: roleLabel }),
              when.label ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "shrink-0 text-text-muted", title: when.title, children: when.label }) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mt-1 whitespace-pre-wrap pl-6 text-text-muted", children: it.payload.text })
          ] }, it.key);
        }
        const tone = it.kind === "decision" ? outcomeTone(it.payload.outcome) : outcomeTone(it.approved ? "approved" : "escalated");
        const question = it.kind === "decision" ? it.payload.question : t.tasks.reviewVerdict;
        const rationale = it.kind === "decision" ? it.payload.rationale : it.rationale;
        const label = it.kind === "decision" ? outcomeLabel(it.payload.outcome) : it.approved ? t.tasks.decisionApproved : t.tasks.decisionEscalated;
        return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { className: "rounded-lg border border-border bg-surface p-2.5 text-xs", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Bot, { size: 14, className: "shrink-0 text-text-muted", "aria-hidden": true }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "min-w-0 flex-1 truncate font-medium text-text", title: question, children: question }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: `inline-flex shrink-0 items-center gap-1 font-medium ${tone.cls}`, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(tone.Icon, { size: 12, "aria-hidden": true }),
              label
            ] }),
            it.kind === "decision" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "shrink-0 font-mono text-[10px] text-text-muted", children: [
              Math.round(it.payload.confidence * 100),
              " %"
            ] }) : null,
            when.label ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "shrink-0 text-text-muted", title: when.title, children: when.label }) : null
          ] }),
          it.kind === "decision" && it.payload.optionLabel ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mt-1 pl-6 text-text", children: it.payload.optionLabel }) : null,
          rationale ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mt-1 whitespace-pre-wrap pl-6 text-text-muted", children: rationale }) : null
        ] }, it.key);
      }) })
    ] }) : null,
    openFile ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Modal, { title: baseName(openFile.path), description: openFile.path, icon: fileIcon(openFile.path), size: "lg", onClose: () => setOpenFile(null), children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "flex h-full min-h-0 flex-col p-5", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "min-h-0 flex-1 overflow-hidden rounded-lg border border-border", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(PatchView, { diff: fileDiff.data?.diff ?? "", loading: fileDiff.isLoading, empty: t.projects.noChanges }) }) }) }) : null
  ] });
}

// plugins/work/web-src/tasks/taskMeta.ts
var { taskTypeMeta } = runtime().utils;
var TASK_TYPES = ["task", "feature", "bug", "chore", "epic"];
var PRIORITIES = ["P0", "P1", "P2", "P3"];
function statusLabel(t, status) {
  const map = {
    open: t.tasks.statusOpen,
    in_progress: t.tasks.statusInProgress,
    blocked: t.tasks.statusBlocked,
    closed: t.tasks.statusClosed,
    cancelled: t.tasks.statusCancelled
  };
  return map[status] ?? status;
}
function taskTypeLabel(t, type) {
  const map = {
    task: t.tasks.typeTask,
    bug: t.tasks.typeBug,
    feature: t.tasks.typeFeature,
    epic: t.tasks.typeEpic,
    chore: t.tasks.typeChore
  };
  return map[type] ?? taskTypeMeta(type).label;
}

// plugins/work/web-src/tasks/TaskDetailPane.tsx
var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
var { AgentStatusDot, Badge, EmptyState, IconButton, LiveTail, ModelIcon: ModelIcon2, OutcomeBadge, TaskUsageBadge, TerminalModal } = runtime().components;
var { useAgentsPlugin, useAllDeps, useCloseTask, useConfig: useConfig2, useMissionNotes, useResumeMission, useSessionSignal, useSetTaskStatus, useTaskControls, useTasks: useTasks2, useToast, useTranslation: useTranslation3 } = runtime().hooks;
var { agentDisplayName, apiErrorMessage, copyText, formatTaskTime: formatTaskTime2, phaseDetails, statusTone, taskAgentName, taskElapsed, taskExec: taskExec2, taskSessionName } = runtime().utils;
function TaskDetailPane({ taskId, onEdit, onBack }) {
  const { t, locale } = useTranslation3();
  const tasks = useTasks2();
  const deps = useAllDeps();
  const { data: config } = useConfig2();
  const close = useCloseTask();
  const setStatus = useSetTaskStatus();
  const resume = useResumeMission();
  const { toast } = useToast();
  const [openTerm, setOpenTerm] = (0, import_react5.useState)(false);
  const task = tasks.data?.find((x) => x.id === taskId);
  const { session, running, start, stop, pause } = useTaskControls(task ?? { id: taskId, title: "", status: "open" });
  const signal = useSessionSignal(session ?? "");
  const agentsUi = useAgentsPlugin();
  const notesTarget = agentsUi && task ? task.parent_id ?? (task.type === "epic" ? task.id : null) : null;
  const notes = useMissionNotes(notesTarget);
  if (!task) return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(EmptyState, { title: t.tasks.selectHint, icon: SquareTerminal });
  const Icon2 = taskTypeMeta(task.type).icon;
  const exec = taskExec2(task.labels);
  const iconExec = exec || config?.defaults?.exec || "";
  const agentName = taskAgentName(task);
  const isClosed = task.status === "closed" || task.status === "cancelled";
  const whenIso = task.closed_at || task.created_at;
  const when = formatTaskTime2(whenIso, Date.now(), locale);
  const ran = taskElapsed(task, Date.now());
  const details = phaseDetails(task.description);
  const byId = new Map((tasks.data ?? []).map((x) => [x.id, x]));
  const depTasks = (deps.data ?? []).filter((d) => d.task_id === taskId).map((d) => byId.get(d.depends_on_id)).filter((x) => !!x);
  const copyId = async () => {
    const ok = await copyText(task.id);
    if (ok) toast(t.tasks.idCopied.replace("{id}", task.id));
    else toast(t.tasks.idCopyFailed, "error");
  };
  const isPhase = !!task.parent_id;
  const reopenResume = (doneMsg) => {
    setStatus.mutate({ id: task.id, status: "open" }, {
      onSuccess: () => {
        if (isPhase) resume.mutate(`m-${task.parent_id}`, { onError: () => {
        } });
        toast(doneMsg.replace("{id}", task.id));
      },
      onError: (e) => toast(apiErrorMessage(e), "error")
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex flex-col gap-4", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "-mx-4 flex flex-col gap-2 border-b border-border bg-transparent px-4 pb-3 pt-1", children: [
      onBack ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { type: "button", onClick: onBack, className: "-ml-1 inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-xs text-text-muted transition-colors hover:bg-elevated hover:text-text", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ChevronLeft, { size: 14, "aria-hidden": true }),
        t.tasks.backToFlow
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex items-start gap-3", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-elevated", children: iconExec ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ModelIcon2, { name: iconExec, size: 26 }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon2, { size: 22, className: "text-text-muted", "aria-hidden": true }) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "min-w-0 flex-1", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { className: "min-w-0 flex-1 text-base font-semibold text-text", children: task.title }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(AgentStatusDot, { signal, live: running })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-text-muted", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: task.id }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconButton, { icon: Copy, label: t.tasks.copyId, onClick: copyId }),
            agentName ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { "aria-hidden": true, className: "opacity-50", children: "\xB7" }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: agentDisplayName(taskSessionName(task)) })
            ] }) : null,
            when.label ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { "aria-hidden": true, className: "opacity-50", children: "\xB7" }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { title: when.title, children: when.label })
            ] }) : null,
            ran ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { "aria-hidden": true, className: "opacity-50", children: "\xB7" }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "inline-flex items-center gap-1", title: t.tasks.flowElapsed, children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Timer, { size: 11, "aria-hidden": true }),
                ran
              ] })
            ] }) : null
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex flex-wrap items-center gap-1.5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Badge, { tone: statusTone(task.status), children: statusLabel(t, task.status) }),
        isClosed ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(OutcomeBadge, { outcome: task.outcome }) : null,
        exec ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Badge, { children: exec }) : null,
        agentName ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(TaskUsageBadge, { taskId: task.id, live: running }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex flex-wrap items-center gap-1", children: [
        running ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconButton, { icon: Square, label: t.tasks.stop, variant: "danger", onClick: stop }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconButton, { icon: SquareSlash, label: t.sessions.interrupt, onClick: pause })
        ] }) : task.status === "blocked" && isPhase ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconButton, { icon: ShieldCheck, label: t.tasks.approveContinue, onClick: () => reopenResume(t.tasks.approved) }) : isClosed && isPhase ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconButton, { icon: RotateCcw, label: t.tasks.rerun, onClick: () => reopenResume(t.tasks.rerunning) }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconButton, { icon: Play, label: t.tasks.start, onClick: start }),
        session ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconButton, { icon: SquareTerminal, label: t.tasks.openTerminal, onClick: () => setOpenTerm(true) }) : null,
        onEdit ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconButton, { icon: Pencil, label: t.common.edit, onClick: () => onEdit(task) }) : null,
        !isClosed ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(IconButton, { icon: Archive, label: t.tasks.closeArchive, onClick: () => close.mutate(task.id, { onSuccess: () => toast(t.tasks.closed.replace("{id}", task.id)), onError: (e) => toast(String(e), "error") }) }) : null
      ] })
    ] }),
    details ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: t.tasks.fieldDetails, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "whitespace-pre-wrap text-sm leading-relaxed text-text-muted", children: details }) }) : null,
    task.resume_note ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: t.tasks.resumeNote, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "whitespace-pre-wrap text-sm leading-relaxed text-text-muted", children: task.resume_note }) }) : null,
    depTasks.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: t.tasks.dependencies, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("ul", { className: "flex flex-col gap-1", children: depTasks.map((d) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { className: "flex items-center gap-2 text-xs", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Link2, { size: 12, className: "shrink-0 text-text-muted", "aria-hidden": true }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "min-w-0 flex-1 truncate text-text", children: d.title }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Badge, { tone: statusTone(d.status), children: statusLabel(t, d.status) })
    ] }, d.id)) }) }) : null,
    running && session ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: t.tasks.liveOutput, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(LiveTail, { name: session, lines: 28, heightClass: "max-h-96", onExpand: () => setOpenTerm(true) }) }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ResultSummary, { task }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(TaskConversation, { task }),
    notes.data && notes.data.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: t.tasks.handoffNotes, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("ul", { className: "flex flex-col gap-1.5", children: notes.data.map((n) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { className: "rounded-md border border-border bg-surface p-2 text-xs", children: [
      n.author ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "mr-1.5 font-medium text-text", children: n.author }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "whitespace-pre-wrap text-text-muted", children: n.body })
    ] }, n.id)) }) }) : null,
    openTerm && session && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(TerminalModal, { session, onClose: () => setOpenTerm(false) })
  ] });
}
function Field({ label, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "flex flex-col gap-1.5", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "text-[11px] font-semibold uppercase tracking-wide text-text-muted", children: label }),
    children
  ] });
}

// plugins/work/web-src/tasks/MissionFlow.tsx
var import_react7 = __toESM(require_react(), 1);

// plugins/work/web-src/tasks/PhaseLogRow.tsx
var import_react6 = __toESM(require_react(), 1);
var import_jsx_runtime5 = __toESM(require_jsx_runtime(), 1);
var { AgentStatusDot: AgentStatusDot2, ModelIcon: ModelIcon3 } = runtime().components;
var { taskAgentName: taskAgentName2, taskElapsed: taskElapsed2 } = runtime().utils;
function phaseState(task, running) {
  if (running || task.status === "in_progress") return "running";
  if (task.status === "blocked") return "blocked";
  if (task.status === "cancelled") return "failed";
  if (task.status === "closed") return task.outcome === "fail" ? "failed" : "done";
  return "pending";
}
function StateGlyph({ state, isActive }) {
  if (state === "done") return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Check, { size: 10, className: "text-bg", strokeWidth: 3, "aria-hidden": true }) });
  if (state === "failed") return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-danger", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(X, { size: 10, className: "text-bg", strokeWidth: 3, "aria-hidden": true }) });
  if (state === "running") return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: `flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent ${isActive ? "flow-active" : ""}`, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "h-1.5 w-1.5 rounded-full bg-bg", "aria-hidden": true }) });
  if (state === "blocked") return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "h-4 w-4 shrink-0 rounded-full bg-warning", "aria-hidden": true });
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Circle, { size: 16, className: "shrink-0 text-border-strong", "aria-hidden": true });
}
function PhaseLogRow({ phase, index, running, signal, isActive, exec, isSelected, onSelect, onContextMenu }) {
  const state = phaseState(phase, running);
  const agent = taskAgentName2(phase);
  const elapsed = taskElapsed2(phase, Date.now());
  const note = phase.result_summary?.trim();
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
    "button",
    {
      type: "button",
      onClick: () => onSelect(phase.id),
      onContextMenu: (e) => onContextMenu?.(e, phase),
      className: `group flex w-full flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors ${isSelected ? "border-accent/50 bg-accent/[0.06]" : "border-transparent hover:border-border hover:bg-elevated"}`,
      style: { transitionDuration: "var(--motion-fast)" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "flex items-center gap-2.5", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "font-mono text-[11px] tabular-nums text-text-muted", children: String(index + 1).padStart(2, "0") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(StateGlyph, { state, isActive }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "min-w-0 flex-1 truncate text-sm font-medium text-text", children: phase.title }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-text-muted", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ModelIcon3, { name: exec, size: 13 }),
            agent ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(AgentStatusDot2, { signal, live: running, size: "sm" }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "hidden @sm:inline", children: agent })
            ] }) : null,
            elapsed ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Timer, { size: 11, "aria-hidden": true }),
              elapsed
            ] }) : null
          ] })
        ] }),
        note ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "line-clamp-2 pl-[3.25rem] text-xs leading-relaxed text-text-muted", children: note }) : null
      ]
    }
  );
}

// plugins/work/web-src/tasks/MissionFlow.tsx
var import_jsx_runtime6 = __toESM(require_jsx_runtime(), 1);
var { Badge: Badge2, ModelIcon: ModelIcon4 } = runtime().components;
var { useConfig: useConfig3, useQueries, useSessions, useSessionSignals, useTranslation: useTranslation4 } = runtime().hooks;
var { elowenClient, formatCost, formatDuration, statusTone: statusTone2, taskElapsedMs, taskExec: taskExec3, taskSessionName: taskSessionName2 } = runtime().utils;
function Pill({ children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "inline-flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs text-text-muted", children });
}
function MissionFlow({ epic, phases, activeId, onSelectPhase, onContextMenu }) {
  const { t } = useTranslation4();
  const sessions = useSessions();
  const signals = useSessionSignals();
  const { data: config } = useConfig3();
  const live = new Set(sessions.data ?? []);
  const usage = useQueries({
    queries: phases.map((p) => ({
      queryKey: ["task-usage", p.id],
      queryFn: () => elowenClient.taskUsage(p.id),
      staleTime: 5 * 60 * 1e3
    }))
  });
  const totalCost = usage.reduce((sum, u) => sum + (u.data?.costUsd ?? 0), 0);
  const now = Date.now();
  const totalMs = phases.reduce((sum, p) => sum + (taskElapsedMs(p, now) ?? 0), 0);
  const execs = [...new Set(phases.map((p) => taskExec3(p.labels) || config?.defaults?.exec || "").filter(Boolean))];
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "flex flex-col gap-4", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "flex items-start gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-elevated", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Rocket, { size: 22, className: "text-accent", "aria-hidden": true }) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "min-w-0 flex-1", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h2", { className: "whitespace-pre-wrap break-words text-base font-semibold leading-snug text-text", children: epic.title }),
        epic.description?.trim() && epic.description.trim() !== epic.title.trim() ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-muted", children: epic.description }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Badge2, { tone: statusTone2(epic.status), children: statusLabel(t, epic.status) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ResultSummary, { task: epic }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [
      totalCost > 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(Pill, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Coins, { size: 13, className: "text-approve", "aria-hidden": true }),
        formatCost(totalCost)
      ] }) : null,
      totalMs > 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(Pill, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Clock, { size: 13, "aria-hidden": true }),
        formatDuration(totalMs)
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(Pill, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Layers, { size: 13, "aria-hidden": true }),
        phases.length,
        " ",
        t.tasks.phasesLabel
      ] }),
      execs.length === 1 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(Pill, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ModelIcon4, { name: execs[0], size: 14 }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "font-mono", children: execs[0] })
      ] }) : execs.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { title: execs.join(", "), children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Pill, { children: execs.map((e) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ModelIcon4, { name: e, size: 14 }, e)) }) }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "flex flex-col gap-0.5", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted", children: t.tasks.missionProgress }),
      phases.map((phase, i) => {
        const session = taskSessionName2(phase);
        const running = phase.status === "in_progress" && !!session && live.has(session);
        const signal = session ? signals[session] : void 0;
        return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          PhaseLogRow,
          {
            phase,
            index: i,
            running,
            signal,
            isActive: running || signal?.type === "needs_input",
            exec: taskExec3(phase.labels) || config?.defaults?.exec || "",
            isSelected: activeId === phase.id,
            onSelect: onSelectPhase,
            onContextMenu
          },
          phase.id
        );
      })
    ] })
  ] });
}

// plugins/work/web-src/tasks/EpicGroup.tsx
var import_react11 = __toESM(require_react(), 1);

// plugins/work/web-src/tasks/TaskCard.tsx
var import_react9 = __toESM(require_react(), 1);

// plugins/work/web-src/tasks/useTaskDrop.tsx
var import_react8 = __toESM(require_react(), 1);
var import_jsx_runtime7 = __toESM(require_jsx_runtime(), 1);
var { ContextMenu } = runtime().components;
var { useToast: useToast2, useTranslation: useTranslation5, useUpdateTask } = runtime().hooks;
var { apiErrorMessage: apiErrorMessage2 } = runtime().utils;
function canDropOnTask(dragged, target, phaseIds4) {
  if (dragged.id === target.id) return false;
  if (dragged.project_id !== target.project_id) return false;
  if (phaseIds4.has(dragged.id) || dragged.parent_id) return false;
  if (phaseIds4.has(target.id) || target.parent_id) return false;
  if (dragged.status === "closed" || dragged.status === "cancelled" || dragged.status === "in_progress") return false;
  return true;
}
function useDropTarget(onDropTask, dropTargetValid) {
  const [hover, setHover] = (0, import_react8.useState)(false);
  return {
    dragOver: hover,
    onDragOver: (e) => {
      if (onDropTask && dropTargetValid) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    onDragEnter: () => {
      if (onDropTask) setHover(true);
    },
    onDragLeave: () => {
      if (onDropTask) setHover(false);
    },
    onDrop: (e) => {
      if (!onDropTask) return;
      if (dropTargetValid) {
        e.stopPropagation();
        setHover(false);
        onDropTask(e);
      } else setHover(false);
    }
  };
}
function canReparent(dragged, childMap) {
  return (childMap.get(dragged.id)?.length ?? 0) === 0;
}
function useTaskDrop(allTasks, childMap, phaseIds4) {
  const update = useUpdateTask();
  const { toast } = useToast2();
  const { t } = useTranslation5();
  const [choice, setChoice] = (0, import_react8.useState)(null);
  const byId = new Map(allTasks.map((x) => [x.id, x]));
  const fail = (e) => toast(apiErrorMessage2(e), "error");
  const doReparent = (draggedId, targetId, targetTitle) => update.mutate({ id: draggedId, patch: { parent_id: targetId } }, {
    onSuccess: () => toast(t.tasks.dropMadeSubtask.replace("{title}", targetTitle)),
    onError: fail
  });
  const doAddDep = (draggedId, targetId) => update.mutate({ id: draggedId, patch: { addDep: targetId } }, {
    onSuccess: () => toast(t.tasks.dropDepAdded),
    onError: fail
  });
  function isValidTarget(draggedId, target) {
    if (!draggedId) return false;
    const dragged = byId.get(draggedId);
    return !!dragged && canDropOnTask(dragged, target, phaseIds4);
  }
  function handleDrop(e, target) {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.getData("text/plain");
    const dragged = byId.get(draggedId);
    if (!dragged || !canDropOnTask(dragged, target, phaseIds4)) return;
    if (target.type === "epic") {
      if (canReparent(dragged, childMap)) doReparent(dragged.id, target.id, target.title);
      return;
    }
    setChoice({ x: e.clientX, y: e.clientY, draggedTask: dragged, targetTask: target });
  }
  let menuState = null;
  if (choice) {
    menuState = {
      x: choice.x,
      y: choice.y,
      items: [
        {
          label: t.tasks.dropMakeSubtaskOf.replace("{title}", choice.targetTask.title),
          icon: Layers,
          disabled: !canReparent(choice.draggedTask, childMap),
          onClick: () => doReparent(choice.draggedTask.id, choice.targetTask.id, choice.targetTask.title)
        },
        {
          label: t.tasks.dropAddDependencyOn.replace("{title}", choice.targetTask.title),
          icon: Link2,
          onClick: () => doAddDep(choice.draggedTask.id, choice.targetTask.id)
        }
      ]
    };
  }
  const popup = menuState ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ContextMenu, { state: menuState, onClose: () => setChoice(null) }) : null;
  return { handleDrop, isValidTarget, popup };
}

// plugins/work/web-src/tasks/TaskCard.tsx
var import_jsx_runtime8 = __toESM(require_jsx_runtime(), 1);
var { ActionMenu, AgentStatusDot: AgentStatusDot3, Badge: Badge3, Checkbox, ConfirmDialog, IconButton: IconButton2, ModelIcon: ModelIcon5, OutcomeBadge: OutcomeBadge2, ProjectPill } = runtime().components;
var { useCloseTask: useCloseTask2, useConfig: useConfig4, useDeleteTask, useSessionSignal: useSessionSignal2, useSessionStall, useTaskControls: useTaskControls2, useToast: useToast3, useTranslation: useTranslation6 } = runtime().hooks;
var { execModel, formatTaskTime: formatTaskTime3, statusTone: statusTone3, taskExec: taskExec4 } = runtime().utils;
function TaskCard({ task, onEdit, onSelect, onContextMenu, active = false, blockers, selected = false, onToggleSelect, selecting = false, isPhase = false, dragging = false, onDragStart, onDragEnd, onDropTask, dropTargetValid }) {
  const close = useCloseTask2();
  const del = useDeleteTask();
  const { toast } = useToast3();
  const { t, locale } = useTranslation6();
  const [confirmDelete, setConfirmDelete] = (0, import_react9.useState)(false);
  const drop = useDropTarget(isPhase ? void 0 : onDropTask, dropTargetValid);
  const { data: config } = useConfig4();
  const meta = taskTypeMeta(task.type);
  const Icon2 = meta.icon;
  const exec = taskExec4(task.labels);
  const iconExec = exec || config?.defaults?.exec || "";
  const isClosed = task.status === "closed";
  const { session, running, start, stop, pause } = useTaskControls2(task);
  const signal = useSessionSignal2(session ?? "");
  const stall = useSessionStall(session ?? "", running && !!session);
  const stallProps = session ? { stall: stall.state, silenceSec: stall.silenceSec } : {};
  const blocked = (blockers?.length ?? 0) > 0;
  const open = () => (onSelect ?? onEdit)(task);
  const when = task.scheduled_at || task.closed_at || task.created_at;
  const whenFmt = when ? formatTaskTime3(when, Date.now(), locale) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
    "div",
    {
      role: "button",
      tabIndex: 0,
      draggable: !isPhase && !!onDragStart,
      onDragStart,
      onDragEnd,
      onDragOver: drop.onDragOver,
      onDragEnter: drop.onDragEnter,
      onDragLeave: drop.onDragLeave,
      onDrop: drop.onDrop,
      onClick: open,
      onContextMenu: onContextMenu ? (e) => onContextMenu(e, task) : void 0,
      onKeyDown: (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      },
      className: `task-register-row group relative flex items-center gap-3 border-b border-border/70 px-4 py-3.5 transition-colors ${onDragStart && !isPhase ? "cursor-grab" : "cursor-pointer"} ${selected || active ? "bg-accent/[0.055]" : "hover:bg-elevated/35"} ${dragging ? "translate-x-1 opacity-50" : ""} ${drop.dragOver && dropTargetValid ? "ring-1 ring-inset ring-accent/60" : ""} ${drop.dragOver && dropTargetValid === false ? "ring-1 ring-inset ring-danger/40 opacity-60" : ""}`,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: `flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-elevated/70 ${running ? "border-accent shadow-[var(--glow-soft)]" : "border-border"}`, children: iconExec ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(ModelIcon5, { name: iconExec, size: 21 }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon2, { size: 18, className: "text-text-muted", "aria-hidden": true }) }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex min-w-0 flex-1 flex-col gap-1", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex items-center gap-1.5", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "truncate text-sm font-medium text-text", children: task.title }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(AgentStatusDot3, { signal, live: running, size: "sm", ...stallProps })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "flex min-w-0 items-center gap-1.5", children: iconExec ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "inline-flex min-w-0 items-center gap-1 rounded-md border border-border bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-muted", title: iconExec, children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(ModelIcon5, { name: iconExec, size: 11 }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "truncate", children: execModel(iconExec) })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "inline-flex min-w-0 items-center gap-1.5", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Icon2, { size: 11, className: "shrink-0 text-text-muted", "aria-hidden": true }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "truncate font-mono text-[11px] text-text-muted", children: task.id })
          ] }) }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex flex-wrap items-center gap-1.5", children: [
            whenFmt ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { title: whenFmt.title, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(Badge3, { tone: "muted", children: [
              task.scheduled_at ? task.autostart ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Zap, { size: 11, className: "mr-1 inline", "aria-hidden": true }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Clock, { size: 11, className: "mr-1 inline", "aria-hidden": true }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Clock, { size: 11, className: "mr-1 inline", "aria-hidden": true }),
              whenFmt.label
            ] }) }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(ProjectPill, { projectId: task.project_id }),
            isClosed ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(OutcomeBadge2, { outcome: task.outcome }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Badge3, { tone: statusTone3(task.status), children: statusLabel(t, task.status) }),
            blocked ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "shrink-0 text-[11px] text-warning", title: blockers.map((b) => b.title).join(", "), children: [
              "\xB7 ",
              t.tasks.dependencies,
              " ",
              blockers.length
            ] }) : null
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex shrink-0 items-center gap-1 self-start", onClick: (e) => e.stopPropagation(), children: [
          running ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(IconButton2, { icon: Square, label: t.tasks.stop, variant: "danger", onClick: stop }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(IconButton2, { icon: Play, label: t.tasks.start, onClick: start }),
          running ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(IconButton2, { icon: Pause, label: t.tasks.pause, onClick: pause }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(IconButton2, { icon: Pencil, label: t.common.edit, onClick: () => onEdit(task) }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              ActionMenu,
              {
                label: t.tasks.deleteOrClose,
                trigger: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Ellipsis, { size: 15, "aria-hidden": true }),
                triggerClassName: "inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-elevated hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                items: [
                  { label: t.tasks.closeArchive, icon: Archive, onSelect: () => close.mutate(task.id, { onSuccess: () => toast(t.tasks.closed.replace("{id}", task.id)), onError: (e) => toast(String(e), "error") }) },
                  { label: t.tasks.deletePermanently, icon: Trash2, tone: "danger", onSelect: () => setConfirmDelete(true) }
                ]
              }
            )
          ] })
        ] }),
        onToggleSelect ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          "button",
          {
            type: "button",
            role: "checkbox",
            "aria-checked": selected,
            "aria-label": t.sessions.selectLabel.replace("{id}", task.id),
            onClick: (e) => {
              e.stopPropagation();
              onToggleSelect(task.id);
            },
            className: `shrink-0 transition-opacity ${selecting || selected ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"}`,
            children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Checkbox, { checked: selected })
          }
        ) : null,
        confirmDelete && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { onClick: (e) => e.stopPropagation(), children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          ConfirmDialog,
          {
            open: confirmDelete,
            title: t.tasks.confirmDeleteTitle.replace("{id}", task.id),
            description: t.tasks.confirmDeleteDescription,
            onClose: () => setConfirmDelete(false),
            onConfirm: () => {
              setConfirmDelete(false);
              del.mutate(task.id, { onSuccess: () => toast(t.tasks.deleted.replace("{id}", task.id)), onError: (e) => toast(String(e), "error") });
            }
          }
        ) })
      ]
    }
  );
}

// plugins/work/web-src/tasks/AddPhaseModal.tsx
var import_react10 = __toESM(require_react(), 1);
var import_jsx_runtime9 = __toESM(require_jsx_runtime(), 1);
var { Button, ExecutorPicker, Field: Field2, IconButton: IconButton3, Input, Modal: Modal2, ModalBody, ModalFooter, Segmented } = runtime().components;
var { useConfig: useConfig5, useInsertPhases, useToast: useToast4, useTranslation: useTranslation7 } = runtime().hooks;
var { allModels, ElowenApiError } = runtime().utils;
function AddPhaseModal({ epicId, onClose }) {
  const { data: config } = useConfig5();
  const insert = useInsertPhases();
  const { toast } = useToast4();
  const { t } = useTranslation7();
  const models = allModels(config?.customModels, config?.hiddenPresets).filter((m) => !config?.allowedExecs || config.allowedExecs.includes(m.exec));
  const [mode, setMode] = (0, import_react10.useState)("manual");
  const [exec, setExec] = (0, import_react10.useState)("");
  const [goal, setGoal] = (0, import_react10.useState)("");
  const [rows, setRows] = (0, import_react10.useState)([{ title: "", type: "task", details: "" }]);
  const busy = insert.isPending;
  async function submit() {
    const body = mode === "manual" ? { phases: rows.map((r) => ({ title: r.title.trim(), type: r.type, details: r.details.trim() || void 0 })).filter((r) => r.title) } : { goal: goal.trim() };
    if (mode === "manual" && (!body.phases || body.phases.length === 0)) {
      toast(t.missions.addPhaseAtLeastOne, "error");
      return;
    }
    if (mode === "replan" && !body.goal) {
      toast(t.missions.addPhaseGoalRequired, "error");
      return;
    }
    const payload = { ...body, exec: exec || void 0 };
    try {
      const r = await insert.mutateAsync({ epicId, body: payload });
      toast(t.missions.addPhaseInserted.replace("{count}", String(r.phases.length)).replace("{s}", r.phases.length === 1 ? "" : "s").replace("{epicId}", epicId));
      onClose();
    } catch (e) {
      if (e instanceof ElowenApiError && e.code === "autopilot_key_missing") toast(t.tasks.autopilotKeyMissing, "error");
      else toast(String(e), "error");
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(Modal2, { title: t.missions.addPhaseModalTitle.replace("{epic}", epicId), description: epicId, onClose, size: "md", icon: Layers, children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(ModalBody, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "text-xs text-text-muted", children: t.missions.addPhaseModalDesc }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "flex flex-col gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
          Segmented,
          {
            value: mode,
            onChange: (v) => setMode(v),
            options: [
              { value: "manual", label: t.missions.addPhaseModeManual, icon: ListChecks },
              { value: "replan", label: t.missions.addPhaseModeReplan, icon: Sparkles }
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "text-xs text-text-muted", children: mode === "manual" ? t.missions.addPhaseManualDesc : t.missions.addPhaseReplanDesc })
      ] }),
      mode === "manual" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "flex flex-col gap-2", children: [
        rows.map((row, i) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "flex flex-col gap-2 rounded-md border border-border bg-elevated/40 p-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              Input,
              {
                value: row.title,
                placeholder: t.tasks.phasePlaceholder.replace("{n}", String(i + 1)),
                onChange: (e) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, title: e.target.value } : r)),
                className: "min-w-[12rem] flex-1"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              Segmented,
              {
                size: "sm",
                value: row.type,
                onChange: (v) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, type: v } : r)),
                options: TASK_TYPES.filter((taskType) => taskType !== "epic").map((taskType) => ({ value: taskType, label: taskTypeLabel(t, taskType), icon: taskTypeMeta(taskType).icon }))
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(IconButton3, { icon: X, label: t.tasks.removePhase, onClick: () => setRows((rs) => rs.length > 1 ? rs.filter((_, j) => j !== i) : rs) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
            "textarea",
            {
              value: row.details,
              onChange: (e) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, details: e.target.value } : r)),
              placeholder: t.tasks.detailsPlaceholder,
              rows: 2,
              className: "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
            }
          )
        ] }, i)),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("button", { type: "button", onClick: () => setRows((rs) => [...rs, { title: "", type: "task", details: "" }]), className: "inline-flex items-center gap-1 self-start text-xs text-accent hover:underline", children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Plus, { size: 13, "aria-hidden": true }),
          " ",
          t.tasks.addPhase
        ] })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Field2, { label: t.missions.addPhaseFieldGoal, hint: t.help.addPhaseGoal, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        "textarea",
        {
          value: goal,
          onChange: (e) => setGoal(e.target.value),
          placeholder: t.missions.addPhaseGoalPlaceholder,
          rows: 4,
          className: "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Field2, { label: t.tasks.fieldExecutor, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(ExecutorPicker, { value: exec, onChange: setExec, models, defaultLabel: t.tasks.defaultExecutor, moreLabel: t.tasks.moreModels }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(ModalFooter, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Button, { variant: "ghost", onClick: onClose, children: t.common.cancel }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Button, { variant: "accent", disabled: busy, onClick: submit, children: t.missions.addPhaseInsert })
    ] })
  ] });
}

// plugins/work/web-src/tasks/EpicGroup.tsx
var import_jsx_runtime10 = __toESM(require_jsx_runtime(), 1);
var { ActionMenu: ActionMenu2, Badge: Badge4, ConfirmDialog: ConfirmDialog2, ProgressRibbon, ProjectPill: ProjectPill2 } = runtime().components;
var { useAgentsPlugin: useAgentsPlugin2, useConfig: useConfig6, useDeleteMission, useDisengage, useEngage, useMergeMissionPr, useMissions, useOpenMissionPr, usePauseMission, useQueries: useQueries2, useResumeMission: useResumeMission2, useSessions: useSessions2, useSessionSignals: useSessionSignals2, useToast: useToast5, useTranslation: useTranslation8 } = runtime().hooks;
var { elowenClient: elowenClient2, epicLive, epicProgress, formatCost: formatCost2, statusTone: statusTone4 } = runtime().utils;
function EpicGroup({ epic, phases, effectiveStatus, expanded, onToggle, onEdit, onSelect, onContextMenu, activeId, blockedBy, onDropTask, dropTargetValid }) {
  const { t } = useTranslation8();
  const drop = useDropTarget(onDropTask, dropTargetValid);
  const sessions = useSessions2();
  const signals = useSessionSignals2();
  const missions = useMissions();
  const { data: config } = useConfig6();
  const { toast } = useToast5();
  const deleteMission = useDeleteMission();
  const engage = useEngage();
  const pause = usePauseMission();
  const resume = useResumeMission2();
  const disengage = useDisengage();
  const openPr = useOpenMissionPr();
  const mergePr = useMergeMissionPr();
  const [confirmDelete, setConfirmDelete] = (0, import_react11.useState)(false);
  const [confirmMerge, setConfirmMerge] = (0, import_react11.useState)(false);
  const [addingPhase, setAddingPhase] = (0, import_react11.useState)(false);
  const { done, total } = epicProgress(phases);
  const { running, needsInput } = epicLive(phases, sessions.data ?? [], signals);
  const Icon2 = taskTypeMeta("epic").icon;
  const active = needsInput > 0 || running > 0;
  const dotColor = needsInput > 0 ? "var(--color-warning)" : "var(--color-success)";
  const dotRing = needsInput > 0 ? "color-mix(in srgb, var(--color-warning) 50%, transparent)" : "color-mix(in srgb, var(--color-success) 50%, transparent)";
  const usage = useQueries2({
    queries: phases.map((p) => ({
      queryKey: ["task-usage", p.id],
      queryFn: () => elowenClient2.taskUsage(p.id),
      staleTime: 5 * 60 * 1e3
    }))
  });
  const totalCost = usage.reduce((sum, q) => sum + (q.data?.costUsd ?? 0), 0);
  const mission = missions.data?.find((m) => m.epic_id === epic.id) ?? null;
  const epicClosed = (effectiveStatus ?? epic.status) === "closed" || (effectiveStatus ?? epic.status) === "cancelled";
  const live = mission != null && mission.state !== "disengaged";
  const paused = mission?.state === "paused";
  const onEngage = () => engage.mutate(
    { epicId: epic.id, autonomy: config?.defaults?.autonomy ?? "L3", maxSessions: config?.defaults?.maxSessions ?? 1 },
    { onSuccess: () => toast(t.missions.engaged.replace("{epicId}", epic.id)), onError: (e) => toast(String(e), "error") }
  );
  const onPause = () => pause.mutate(mission.id, { onSuccess: () => toast(t.missions.pausedMsg), onError: (e) => toast(String(e), "error") });
  const onResume = () => resume.mutate(mission.id, { onSuccess: () => toast(t.missions.resumed), onError: (e) => toast(String(e), "error") });
  const onDisengage = () => disengage.mutate(mission.id, { onSuccess: () => toast(t.missions.disengaged), onError: (e) => toast(String(e), "error") });
  const onOpenPr = () => openPr.mutate(mission.id, { onSuccess: (r) => toast(t.missions.prOpened.replace("{n}", String(r.number))), onError: (e) => toast(String(e), "error") });
  const onContinue = () => engage.mutate(
    { epicId: epic.id, autonomy: config?.defaults?.autonomy ?? "L3", maxSessions: config?.defaults?.maxSessions ?? 1 },
    { onSuccess: () => toast(t.missions.continued), onError: (e) => toast(String(e), "error") }
  );
  const onMerge = () => mergePr.mutate(mission.id, { onSuccess: () => toast(t.missions.mergePrDone), onError: (e) => toast(String(e), "error") });
  const pr = mission?.pr ?? null;
  const agentsUi = useAgentsPlugin2();
  const hasActions = agentsUi && (!!pr?.prUrl || pr?.prState === "ready" || pr?.prState === "open" || live || !epicClosed);
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
    "div",
    {
      onDragOver: drop.onDragOver,
      onDragEnter: drop.onDragEnter,
      onDragLeave: drop.onDragLeave,
      onDrop: drop.onDrop,
      className: `group/epic border-b border-border/70 transition-colors ${activeId === epic.id ? "bg-accent/[0.065]" : "hover:bg-accent/[0.025]"} ${drop.dragOver && dropTargetValid ? "ring-1 ring-inset ring-accent/60" : ""} ${drop.dragOver && dropTargetValid === false ? "ring-1 ring-inset ring-danger/40 opacity-60" : ""}`,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "flex items-center", onContextMenu: onContextMenu ? (e) => onContextMenu(e, epic) : void 0, children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
            "button",
            {
              type: "button",
              onClick: () => {
                onToggle();
                onSelect(epic);
              },
              "aria-expanded": expanded,
              className: "flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left",
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ChevronRight, { size: 16, className: `shrink-0 text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`, "aria-hidden": true }),
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/[0.035]", children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Icon2, { size: 18, className: "text-accent", "aria-hidden": true }) }),
                /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "flex min-w-0 flex-1 flex-col gap-1.5", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "flex items-center gap-2", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "min-w-0 flex-1 truncate text-sm font-semibold text-text", children: epic.title }),
                    active ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "live-dot h-2 w-2 shrink-0 rounded-full", style: { backgroundColor: dotColor, ["--live-ring"]: dotRing }, "aria-hidden": true }) : null
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "flex items-center gap-2", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ProgressRibbon, { phases, active: activeId === epic.id, className: "max-w-[12rem] flex-1" }),
                    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("span", { className: "shrink-0 font-mono text-[11px] text-text-muted", children: [
                      done,
                      "/",
                      total,
                      " ",
                      t.tasks.phasesLabel
                    ] }),
                    totalCost > 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("span", { className: "inline-flex shrink-0 items-center gap-0.5 rounded border border-approve/30 px-1.5 py-0.5 font-mono text-[11px] text-approve", title: `${t.usage.cost}: ${formatCost2(totalCost)}`, children: [
                      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Coins, { size: 10, className: "shrink-0", "aria-hidden": true }),
                      formatCost2(totalCost)
                    ] }) : null,
                    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ProjectPill2, { projectId: epic.project_id })
                  ] })
                ] })
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "flex shrink-0 items-center gap-2 pr-1", children: [
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Badge4, { tone: statusTone4(effectiveStatus ?? epic.status), children: statusLabel(t, effectiveStatus ?? epic.status) }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "opacity-0 transition-opacity group-hover/epic:opacity-100", children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
              ActionMenu2,
              {
                label: t.tasks.epicActions,
                items: [
                  { label: t.missions.addPhase, icon: Plus, onSelect: () => setAddingPhase(true) },
                  { label: t.tasks.deleteMission, icon: Trash2, tone: "danger", onSelect: () => setConfirmDelete(true) }
                ]
              }
            ) })
          ] })
        ] }),
        hasActions ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "flex flex-wrap items-center gap-1.5 pb-3 pl-[5.35rem] pr-1", children: [
          pr?.prUrl ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
            "a",
            {
              href: pr.prUrl,
              target: "_blank",
              rel: "noopener noreferrer",
              className: "inline-flex shrink-0 items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20",
              title: t.missions.viewPr,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(GitPullRequest, { size: 13, className: "shrink-0", "aria-hidden": true }),
                "#",
                pr.prNumber
              ]
            }
          ) : pr?.prState === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionPill, { icon: GitPullRequest, label: t.missions.openPr, tone: "accent", onClick: onOpenPr, disabled: openPr.isPending }) : null,
          pr && pr.fixRounds > 0 && pr.prState === "open" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
            "span",
            {
              title: pr.lastFeedback ?? void 0,
              className: "inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning",
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Wrench, { size: 12, className: "shrink-0", "aria-hidden": true }),
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "hidden @sm:inline", children: t.missions.prFixBadge.replace("{n}", String(pr.fixRounds)) })
              ]
            }
          ) : null,
          pr?.prState === "open" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionPill, { icon: GitMerge, label: t.missions.mergePr, tone: "accent", onClick: () => setConfirmMerge(true), disabled: mergePr.isPending }) : null,
          !live && !epicClosed && !mission ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionPill, { icon: Rocket, label: t.missions.engage, tone: "accent", onClick: onEngage, disabled: engage.isPending }) : null,
          !live && !epicClosed && mission ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionPill, { icon: Play, label: t.missions.continueMission, tone: "accent", onClick: onContinue, disabled: engage.isPending }) : null,
          live ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
            paused ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionPill, { icon: Play, label: t.missions.resume, tone: "accent", onClick: onResume, disabled: resume.isPending }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionPill, { icon: Pause, label: t.missions.pause, onClick: onPause, disabled: pause.isPending }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionPill, { icon: Power, label: t.missions.disengage, tone: "danger", onClick: onDisengage, disabled: disengage.isPending })
          ] }) : null
        ] }) : null,
        expanded ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "flex flex-col border-t border-accent/15 bg-bg/20 pl-5", children: phases.map((p) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(TaskCard, { task: p, onEdit, onSelect, onContextMenu, active: activeId === p.id, blockers: blockedBy.get(p.id), isPhase: true }, p.id)) }) : null,
        addingPhase && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(AddPhaseModal, { epicId: epic.id, onClose: () => setAddingPhase(false) }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
          ConfirmDialog2,
          {
            open: confirmDelete,
            title: t.tasks.confirmDeleteMissionTitle.replace("{id}", epic.id),
            description: t.tasks.confirmDeleteMissionDescription,
            confirmLabel: t.tasks.deleteMission,
            onClose: () => setConfirmDelete(false),
            onConfirm: () => {
              setConfirmDelete(false);
              deleteMission.mutate(epic.id, { onSuccess: () => toast(t.tasks.missionDeleted.replace("{id}", epic.id)), onError: (e) => toast(String(e), "error") });
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
          ConfirmDialog2,
          {
            open: confirmMerge,
            title: t.missions.mergePrConfirmTitle,
            description: t.missions.mergePrConfirmDesc,
            confirmLabel: t.missions.mergePr,
            onClose: () => setConfirmMerge(false),
            onConfirm: () => {
              setConfirmMerge(false);
              onMerge();
            }
          }
        )
      ]
    }
  );
}
function ActionPill({ icon: Icon2, label, onClick, tone = "default", disabled }) {
  const toneClass = tone === "accent" ? "border-accent/40 text-accent hover:bg-accent/10" : tone === "danger" ? "border-danger/40 text-danger hover:bg-danger/10" : "border-border text-text-muted hover:border-border-strong hover:text-text";
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
    "button",
    {
      type: "button",
      onClick,
      disabled,
      title: label,
      className: `inline-flex items-center gap-1 rounded-full border bg-elevated px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${toneClass}`,
      style: { transitionDuration: "var(--motion-fast)" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Icon2, { size: 12, className: "shrink-0", "aria-hidden": true }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "hidden @sm:inline", children: label })
      ]
    }
  );
}

// plugins/work/web-src/tasks/TaskModal.tsx
var import_react12 = __toESM(require_react(), 1);

// plugins/work/web-src/tasks/DepPicker.tsx
var import_jsx_runtime11 = __toESM(require_jsx_runtime(), 1);
var { Checkbox: Checkbox2 } = runtime().components;
function DepPicker({ candidates, selected, onToggle, maxHeightClass = "max-h-32" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: `${maxHeightClass} overflow-y-auto rounded-md border border-border bg-surface p-1`, children: candidates.map((dep) => /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("button", { type: "button", onClick: () => onToggle(dep.id), className: "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-elevated", children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Checkbox2, { checked: selected.includes(dep.id) }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "min-w-0 flex-1 truncate text-text", children: dep.title }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "shrink-0 font-mono text-[11px] text-text-muted", children: dep.id })
  ] }, dep.id)) });
}

// plugins/work/web-src/tasks/TaskModal.tsx
var import_jsx_runtime12 = __toESM(require_jsx_runtime(), 1);
var { BackendPicker, Badge: Badge5, Button: Button2, Checkbox: Checkbox3, ExecutorPicker: ExecutorPicker2, Field: Field3, IconButton: IconButton4, Input: Input2, LiveTail: LiveTail2, Modal: Modal3, ModalBody: ModalBody2, ModalFooter: ModalFooter2, ProjectIcon, Segmented: Segmented2, Spinner, TerminalModal: TerminalModal2, Toggle } = runtime().components;
var { useAgentsPlugin: useAgentsPlugin3, useConfig: useConfig7, useCreateTask, usePlanJob, usePlanTask, useProjects, useSetTaskExec, useSpawn, useTasks: useTasks3, useToast: useToast6, useTranslation: useTranslation9, useUpdateTask: useUpdateTask2 } = runtime().hooks;
var { allModels: allModels2, ElowenApiError: ElowenApiError2, elowenClient: elowenClient3, taskExec: taskExec5 } = runtime().utils;
function phasesFromTasks(tasks) {
  return tasks.map((p) => ({ title: p.title, type: p.type ?? "task", agent: p.labels?.find((l) => l.startsWith("agent:"))?.slice("agent:".length) }));
}
function isoToLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
var localInputToIso = (v) => v ? new Date(v).toISOString() : null;
function TaskModal({ task, onClose, initialSchedule, initialMode, initialGoal, defaultProjectId }) {
  const editing = !!task;
  const { data: config } = useConfig7();
  const models = allModels2(config?.customModels, config?.hiddenPresets).filter((m) => !config?.allowedExecs || config.allowedExecs.includes(m.exec));
  const { toast } = useToast6();
  const { t } = useTranslation9();
  const create = useCreateTask();
  const update = useUpdateTask2();
  const setExecM = useSetTaskExec();
  const spawn = useSpawn();
  const plan = usePlanTask();
  const [mode, setMode] = (0, import_react12.useState)(initialMode ?? "single");
  const { data: projects } = useProjects();
  const [pickedProject, setPickedProject] = (0, import_react12.useState)(void 0);
  const projectId = pickedProject ?? defaultProjectId ?? projects?.[0]?.id;
  const [title, setTitle] = (0, import_react12.useState)(task?.title ?? "");
  const [description, setDescription] = (0, import_react12.useState)(task?.description ?? "");
  const [type, setType] = (0, import_react12.useState)(task?.type ?? "task");
  const [priority, setPriority] = (0, import_react12.useState)(task?.priority ?? "P2");
  const [exec, setExec] = (0, import_react12.useState)(task ? taskExec5(task.labels) : "");
  const [schedule, setSchedule] = (0, import_react12.useState)(isoToLocalInput(task?.scheduled_at) || isoToLocalInput(initialSchedule));
  const [autostart, setAutostart] = (0, import_react12.useState)(!!task?.autostart);
  const [deps, setDeps] = (0, import_react12.useState)([]);
  const [launchNow, setLaunchNow] = (0, import_react12.useState)(false);
  const allTasks = useTasks3();
  const depCandidates = (allTasks.data ?? []).filter((t2) => t2.id !== task?.id && t2.type !== "epic" && t2.status !== "closed" && t2.status !== "cancelled");
  (0, import_react12.useEffect)(() => {
    if (!task) return;
    let alive = true;
    elowenClient3.taskDeps(task.id).then((d) => {
      if (alive) setDeps(d);
    }).catch(() => {
    });
    return () => {
      alive = false;
    };
  }, [task]);
  const toggleDep = (id) => setDeps((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  const scheduleConflict = (() => {
    const iso = localInputToIso(schedule);
    if (!iso) return void 0;
    const ts = new Date(iso).getTime();
    return (allTasks.data ?? []).find((t2) => t2.id !== task?.id && t2.scheduled_at && Math.abs(new Date(t2.scheduled_at).getTime() - ts) < 10 * 60 * 1e3);
  })();
  const [missionName, setMissionName] = (0, import_react12.useState)("");
  const [goal, setGoal] = (0, import_react12.useState)(initialGoal ?? "");
  const [autonomyPick, setAutonomy] = (0, import_react12.useState)(null);
  const [maxSessionsPick, setMaxSessions] = (0, import_react12.useState)(null);
  const autonomy = autonomyPick ?? config?.defaults?.autonomy ?? "L3";
  const maxSessions = maxSessionsPick ?? config?.defaults?.maxSessions ?? 1;
  const agentsUi = useAgentsPlugin3();
  const [engage, setEngage] = (0, import_react12.useState)(false);
  const [prMode, setPrMode] = (0, import_react12.useState)("default");
  const prEnabled = prMode === "on" ? true : prMode === "off" ? false : null;
  const [autoModel, setAutoModel] = (0, import_react12.useState)(false);
  const [pilotExec, setPilotExec] = (0, import_react12.useState)("");
  const [overseerExec, setOverseerExec] = (0, import_react12.useState)("");
  const [result, setResult] = (0, import_react12.useState)(null);
  const [planJobId, setPlanJobId] = (0, import_react12.useState)(null);
  const [planError, setPlanError] = (0, import_react12.useState)(null);
  const planJob = usePlanJob(planJobId);
  const [openPlanTerm, setOpenPlanTerm] = (0, import_react12.useState)(false);
  const [manual, setManual] = (0, import_react12.useState)(false);
  const [manualPhases, setManualPhases] = (0, import_react12.useState)([{ title: "", type: "task" }]);
  const planning = plan.isPending || planJobId !== null;
  const busy = create.isPending || update.isPending || spawn.isPending || setExecM.isPending || planning;
  (0, import_react12.useEffect)(() => {
    const job = planJob.data;
    if (!job || !planJobId) return;
    if (job.status === "done") {
      setResult({ epicId: job.epicId ?? "", phases: job.phases, engaged: engage });
      toast(t.tasks.planCreated.replace("{count}", String(job.phases.length)).replace("{m}", engage ? t.tasks.autopilotStarted : "."));
      setPlanJobId(null);
    } else if (job.status === "failed") {
      setPlanError(job.error ?? t.tasks.planFailed);
      toast(t.tasks.planFailed, "error");
      setPlanJobId(null);
    }
  }, [planJob.data, planJobId]);
  async function submitSingle() {
    if (!title.trim()) return;
    try {
      if (editing) {
        await update.mutateAsync({ id: task.id, patch: { title: title.trim(), type, priority, description: description.trim(), scheduled_at: localInputToIso(schedule), autostart: autostart ? 1 : 0, deps } });
        if (exec !== taskExec5(task.labels)) await setExecM.mutateAsync({ id: task.id, exec });
        toast(t.tasks.updated.replace("{id}", task.id));
      } else {
        const created = await create.mutateAsync({ title: title.trim(), type, priority, description: description.trim(), scheduled_at: localInputToIso(schedule), autostart: autostart ? 1 : 0, deps, project_id: projectId });
        if (exec) await setExecM.mutateAsync({ id: created.id, exec });
        if (launchNow) await spawn.mutateAsync({ taskId: created.id, exec: exec || void 0 });
        toast(launchNow ? t.tasks.createdAndLaunched.replace("{title}", created.title) : t.tasks.created.replace("{title}", created.title));
      }
      onClose();
    } catch (e) {
      toast(String(e), "error");
    }
  }
  async function generate() {
    if (!goal.trim()) return;
    setPlanError(null);
    try {
      const r = await plan.mutateAsync({ goal: goal.trim(), name: missionName.trim() || void 0, exec: autoModel ? void 0 : exec || void 0, autoModel, pilotExec: pilotExec || void 0, overseerExec: overseerExec || void 0, autonomy, maxSessions, engage, project_id: projectId, prEnabled });
      if ("jobId" in r) setPlanJobId(r.jobId);
      else finishSync(r);
    } catch (e) {
      if (e instanceof ElowenApiError2 && e.code === "autopilot_key_missing") {
        setManual(true);
        toast(t.tasks.autopilotKeyMissing, "error");
      } else {
        toast(String(e), "error");
      }
    }
  }
  async function createManual() {
    const phases = manualPhases.map((p) => ({ title: p.title.trim(), type: p.type })).filter((p) => p.title);
    if (phases.length === 0) {
      toast(t.tasks.addAtLeastOnePhase, "error");
      return;
    }
    try {
      const r = await plan.mutateAsync({ goal: goal.trim(), name: missionName.trim() || void 0, phases, exec: exec || void 0, pilotExec: pilotExec || void 0, overseerExec: overseerExec || void 0, autonomy, maxSessions, engage, project_id: projectId, prEnabled });
      if ("jobId" in r) setPlanJobId(r.jobId);
      else finishSync(r);
    } catch (e) {
      toast(String(e), "error");
    }
  }
  function finishSync(r) {
    setResult({ epicId: r.epic.id, phases: phasesFromTasks(r.phases), engaged: !!r.mission });
    toast(t.tasks.planCreated.replace("{count}", String(r.phases.length)).replace("{m}", r.mission ? t.tasks.autopilotStarted : "."));
  }
  const execSelect = /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.fieldExecutor, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ExecutorPicker2, { value: exec, onChange: setExec, models, defaultLabel: t.tasks.defaultExecutor, moreLabel: t.tasks.moreModels }) });
  const titleText = editing ? t.tasks.editTitle.replace("{id}", task.id) : t.tasks.newTitle;
  const headerIcon = editing ? Pencil : mode === "planning" ? Sparkles : ListChecks;
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(Modal3, { title: titleText, description: editing ? task.id : void 0, onClose, size: "xl", icon: headerIcon, children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(ModalBody2, { children: [
      !editing && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
        Segmented2,
        {
          value: mode,
          onChange: (v) => setMode(v),
          options: [
            { value: "single", label: t.tasks.singleTask, icon: ListChecks },
            { value: "planning", label: t.tasks.autopilotPlanning, icon: Sparkles }
          ]
        }
      ),
      !editing && projects && projects.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.fieldProject, hint: t.help.taskProject, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "flex flex-wrap gap-1.5", children: projects.map((p) => {
        const on = projectId === p.id;
        return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
          "button",
          {
            type: "button",
            onClick: () => setPickedProject(p.id),
            title: p.path,
            className: `inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${on ? "border-accent/50 bg-accent/15 text-accent" : "border-border bg-elevated text-text-muted hover:border-border-strong hover:text-text"}`,
            style: { transitionDuration: "var(--motion-fast)" },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ProjectIcon, { project: p, size: p.icon ? 18 : 13 }),
              p.slug
            ]
          },
          p.id
        );
      }) }) }),
      (editing || mode === "single") && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.fieldTitle, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Input2, { value: title, onChange: (e) => setTitle(e.target.value), placeholder: t.tasks.titlePlaceholder, autoFocus: true }) }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.fieldDetails, hint: t.help.taskDetails, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
          "textarea",
          {
            value: description,
            onChange: (e) => setDescription(e.target.value),
            placeholder: t.tasks.detailsPlaceholder,
            rows: 4,
            className: "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.fieldType, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
          Segmented2,
          {
            value: type,
            onChange: setType,
            options: TASK_TYPES.map((taskType) => ({ value: taskType, label: taskTypeLabel(t, taskType), icon: taskTypeMeta(taskType).icon }))
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "grid grid-cols-2 gap-4", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.fieldPriority, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Segmented2, { value: priority, onChange: setPriority, options: PRIORITIES.map((p) => ({ value: p, label: p })) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.fieldSchedule, hint: t.help.taskSchedule, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Input2, { type: "datetime-local", value: schedule, onChange: (e) => setSchedule(e.target.value) }) })
        ] }),
        execSelect,
        scheduleConflict && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("p", { className: "-mt-2 flex items-center gap-1.5 text-xs text-warning", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(TriangleAlert, { size: 13, "aria-hidden": true }),
          t.tasks.scheduleConflict.replace("{title}", scheduleConflict.title)
        ] }),
        schedule && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("button", { type: "button", onClick: () => setAutostart((v) => !v), className: "-mt-1 flex w-fit items-start gap-2 text-left text-sm text-text", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Checkbox3, { checked: autostart, className: "mt-0.5" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { children: [
            t.tasks.autostart,
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "mt-0.5 block text-xs text-text-muted", children: t.tasks.autostartHint })
          ] })
        ] }),
        depCandidates.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.fieldDependsOn, hint: t.help.taskDependsOn, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(DepPicker, { candidates: depCandidates, selected: deps, onToggle: toggleDep }) }),
        !editing && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("button", { type: "button", onClick: () => setLaunchNow((v) => !v), className: "flex w-fit items-center gap-2 text-sm text-text", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Checkbox3, { checked: launchNow }),
          t.tasks.launchImmediately
        ] })
      ] }),
      !editing && mode === "planning" && !result && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.fieldMissionName, hint: t.help.taskMissionName, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Input2, { value: missionName, onChange: (e) => setMissionName(e.target.value), placeholder: t.tasks.missionNamePlaceholder }) }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.fieldGoal, hint: t.help.taskGoal, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
          "textarea",
          {
            value: goal,
            onChange: (e) => setGoal(e.target.value),
            placeholder: t.tasks.goalPlaceholder,
            rows: 4,
            className: "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "grid grid-cols-2 gap-4", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.fieldAutonomy, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Segmented2, { value: autonomy, onChange: setAutonomy, options: ["L0", "L1", "L2", "L3"].map((l) => ({ value: l, label: l })) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.fieldMaxSessions, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Input2, { type: "number", min: 1, value: maxSessions, onChange: (e) => setMaxSessions(Number(e.target.value)) }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.autoModelLabel, hint: t.help.taskAutoModel, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Toggle, { checked: autoModel, onChange: setAutoModel, label: t.tasks.autoModelLabel }) }),
        agentsUi ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "grid gap-4 md:grid-cols-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.plannerExecutor, hint: t.help.taskPlannerExecutor, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(BackendPicker, { value: pilotExec, onChange: setPilotExec, models, relayLabel: t.tasks.fromSettings, title: t.tasks.plannerExecutor, manageAriaLabel: t.tasks.plannerExecutor }) }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.overseerExecutor, hint: t.help.taskOverseerExecutor, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(BackendPicker, { value: overseerExec, onChange: setOverseerExec, models, relayLabel: t.tasks.fromSettings, title: t.tasks.overseerExecutor, manageAriaLabel: t.tasks.overseerExecutor }) })
        ] }) : null,
        agentsUi ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field3, { label: t.tasks.fieldPrMode, hint: t.help.taskPrMode, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
          Segmented2,
          {
            value: prMode,
            onChange: (v) => setPrMode(v),
            options: [
              { value: "default", label: t.tasks.prModeDefault },
              { value: "on", label: t.tasks.prModeOn },
              { value: "off", label: t.tasks.prModeOff }
            ]
          }
        ) }) : null,
        !autoModel && execSelect,
        agentsUi ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("button", { type: "button", onClick: () => setEngage((v) => !v), className: "flex w-fit items-center gap-2 text-sm text-text", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Checkbox3, { checked: engage }),
          t.tasks.startAutopilot
        ] }) : null,
        manual && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "flex flex-col gap-2 rounded-md border border-border bg-elevated/40 p-3", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "text-xs font-medium uppercase tracking-wide text-text-muted", children: t.tasks.manualPhases }),
          manualPhases.map((phase, i) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Input2, { value: phase.title, placeholder: t.tasks.phasePlaceholder.replace("{n}", String(i + 1)), onChange: (e) => setManualPhases((rows) => rows.map((r, j) => j === i ? { ...r, title: e.target.value } : r)), className: "min-w-[12rem] flex-1" }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
              Segmented2,
              {
                size: "sm",
                value: phase.type,
                onChange: (v) => setManualPhases((rows) => rows.map((r, j) => j === i ? { ...r, type: v } : r)),
                options: TASK_TYPES.filter((taskType) => taskType !== "epic").map((taskType) => ({ value: taskType, label: taskTypeLabel(t, taskType), icon: taskTypeMeta(taskType).icon }))
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(IconButton4, { icon: X, label: t.tasks.removePhase, onClick: () => setManualPhases((rows) => rows.length > 1 ? rows.filter((_, j) => j !== i) : rows) })
          ] }, i)),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("button", { type: "button", onClick: () => setManualPhases((rows) => [...rows, { title: "", type: "task" }]), className: "inline-flex items-center gap-1 self-start text-xs text-accent hover:underline", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Plus, { size: 13, "aria-hidden": true }),
            " ",
            t.tasks.addPhase
          ] })
        ] }),
        planning && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "flex flex-col gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "flex items-center gap-2 rounded-md border border-border bg-elevated/40 px-3 py-2.5 text-sm text-text-muted", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Spinner, { size: "md", tone: "text-accent" }),
            t.tasks.planning
          ] }),
          planJob.data?.sessionName && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "flex flex-col gap-1.5", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "text-xs font-medium uppercase tracking-wide text-text-muted", children: t.tasks.plannerPreview }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(LiveTail2, { name: planJob.data.sessionName, lines: 16, heightClass: "max-h-56", onExpand: () => setOpenPlanTerm(true) })
          ] })
        ] }),
        openPlanTerm && planJob.data?.sessionName && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(TerminalModal2, { session: planJob.data.sessionName, onClose: () => setOpenPlanTerm(false) }),
        planError && !planning && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(TriangleAlert, { size: 15, className: "mt-0.5 shrink-0", "aria-hidden": true }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { className: "min-w-0 break-words", children: [
            t.tasks.planFailed,
            ": ",
            planError
          ] })
        ] })
      ] }),
      result && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "flex flex-col gap-3", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "text-sm text-text-muted", children: t.tasks.createdEpic.replace("{id}", result.epicId).replace("{count}", String(result.phases.length)).replace("{m}", result.engaged ? t.tasks.autopilotEngaged : ".") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("ul", { className: "flex flex-col divide-y divide-border rounded-md border border-border", children: result.phases.map((p, i) => {
          const meta = taskTypeMeta(p.type);
          const Icon2 = meta.icon;
          return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("li", { className: "flex items-center gap-3 px-3 py-2 text-sm", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "w-4 shrink-0 font-mono text-xs text-text-muted", children: i + 1 }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Icon2, { size: 15, className: "shrink-0 text-text-muted", "aria-hidden": true }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "min-w-0 flex-1 truncate text-text", children: p.title }),
            p.agent ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Badge5, { tone: "accent", children: p.agent }) : null
          ] }, i);
        }) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ModalFooter2, { children: result ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Button2, { variant: "accent", onClick: onClose, children: t.tasks.done }) : editing || mode === "single" ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Button2, { variant: "ghost", onClick: onClose, children: t.common.cancel }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Button2, { variant: "accent", icon: editing ? void 0 : launchNow ? Play : void 0, disabled: busy || !title.trim(), onClick: submitSingle, children: editing ? t.common.save : launchNow ? t.tasks.createAndLaunch : t.tasks.create })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Button2, { variant: "ghost", onClick: onClose, children: t.common.cancel }),
      manual ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Button2, { variant: "accent", disabled: busy, onClick: createManual, children: t.tasks.createPlan }) : /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Button2, { variant: "accent", icon: Sparkles, disabled: busy || !goal.trim(), onClick: generate, children: planning ? t.tasks.planning : t.tasks.generatePlan })
    ] }) })
  ] });
}

// plugins/work/web-src/tasks/useTaskContextMenu.tsx
var import_react14 = __toESM(require_react(), 1);

// plugins/work/web-src/tasks/taskContextMenu.ts
var SPEC_DIVIDER = "divider";
var PRIORITIES2 = ["P0", "P1", "P2", "P3"];
var MANUAL_STATUSES = ["open", "blocked", "closed", "cancelled"];
function compact(entries) {
  const out = [];
  for (const e of entries) {
    if (e === SPEC_DIVIDER) {
      if (out.length === 0 || out[out.length - 1] === SPEC_DIVIDER) continue;
    }
    out.push(e);
  }
  while (out.length && out[out.length - 1] === SPEC_DIVIDER) out.pop();
  return out;
}
function buildTaskMenu(ctx) {
  const { task, kind, running, hasSession, hasBlockers, isGated, canMutate, models, currentExec } = ctx;
  const closed = task.status === "closed" || task.status === "cancelled";
  const mut = canMutate;
  const entries = [];
  const item = (id, enabled) => entries.push({ kind: "item", id, enabled });
  item("open", true);
  item("edit", mut);
  if (kind === "epic") {
    entries.push(SPEC_DIVIDER);
    item("runReview", mut);
    item("addPhase", mut);
    entries.push(SPEC_DIVIDER);
    item("copyId", true);
    item("deleteMission", mut);
    return compact(entries);
  }
  entries.push(SPEC_DIVIDER);
  if (!running && !closed) item("start", mut && !hasBlockers);
  if (running) item("stop", mut);
  if (running && hasSession) item("pause", mut);
  if (hasSession) item("terminal", true);
  entries.push(SPEC_DIVIDER);
  entries.push({
    kind: "submenu",
    id: "setModel",
    enabled: mut && !running,
    options: [{ value: "", current: currentExec === "" }, ...models.map((m) => ({ value: m.exec, current: m.exec === currentExec }))]
  });
  entries.push({
    kind: "submenu",
    id: "setPriority",
    enabled: mut,
    options: PRIORITIES2.map((p) => ({ value: p, current: (task.priority ?? "P2") === p }))
  });
  entries.push({
    kind: "submenu",
    id: "setStatus",
    enabled: mut,
    options: MANUAL_STATUSES.map((s) => ({ value: s, current: task.status === s }))
  });
  item("dependencies", mut);
  entries.push(SPEC_DIVIDER);
  if (closed) item("reopen", mut);
  if (kind === "phase" && isGated) item("approveGate", mut);
  if (kind === "standalone") item("planMission", mut);
  if (!closed) item("close", mut);
  entries.push(SPEC_DIVIDER);
  item("copyId", true);
  item("delete", mut);
  return compact(entries);
}

// plugins/work/web-src/tasks/DepPickerModal.tsx
var import_react13 = __toESM(require_react(), 1);
var import_jsx_runtime13 = __toESM(require_jsx_runtime(), 1);
var { AutoSaveStatus, Button: Button3, Field: Field4, Modal: Modal4, ModalBody: ModalBody3, ModalFooter: ModalFooter3 } = runtime().components;
var { useAutoSaveStatus, useTasks: useTasks4, useTranslation: useTranslation10, useUpdateTask: useUpdateTask3 } = runtime().hooks;
var { elowenClient: elowenClient4 } = runtime().utils;
function DepPickerModal({ task, onClose }) {
  const { t } = useTranslation10();
  const update = useUpdateTask3();
  const allTasks = useTasks4();
  const [deps, setDeps] = (0, import_react13.useState)([]);
  const [loaded, setLoaded] = (0, import_react13.useState)(false);
  (0, import_react13.useEffect)(() => {
    let alive = true;
    elowenClient4.taskDeps(task.id).then((d) => {
      if (alive) {
        setDeps(d);
        setLoaded(true);
      }
    }).catch(() => {
      if (alive) setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [task.id]);
  const { status, retry, flush } = useAutoSaveStatus([deps], async () => {
    await update.mutateAsync({ id: task.id, patch: { deps } });
  }, { ready: loaded });
  const close = () => {
    flush();
    onClose();
  };
  const candidates = (allTasks.data ?? []).filter((x) => x.id !== task.id && x.type !== "epic" && x.status !== "closed" && x.status !== "cancelled");
  const toggle = (id) => setDeps((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(Modal4, { title: t.tasks.depsTitle, description: task.id, onClose: close, size: "md", icon: Link2, children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(ModalBody3, { children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(Field4, { label: t.tasks.fieldDependsOn, hint: t.help.taskDependsOn, children: candidates.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(DepPicker, { candidates, selected: deps, onToggle: toggle, maxHeightClass: "max-h-72" }) : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "text-sm text-text-muted", children: t.tasks.noMatches }) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(ModalFooter3, { status: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(AutoSaveStatus, { status, onRetry: retry }), children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(Button3, { variant: "accent", onClick: close, children: t.common.done }) })
  ] });
}

// plugins/work/web-src/tasks/useTaskContextMenu.tsx
var import_jsx_runtime14 = __toESM(require_jsx_runtime(), 1);
var { ConfirmDialog: ConfirmDialog3, ContextMenu: ContextMenu2 } = runtime().components;
var { useApproveGate, useCloseTask: useCloseTask3, useConfig: useConfig8, useDeleteMission: useDeleteMission2, useDeleteTask: useDeleteTask2, useInsertPhases: useInsertPhases2, useKillSession, useSendInput, useSessions: useSessions3, useSetTaskExec: useSetTaskExec2, useSetTaskStatus: useSetTaskStatus2, useSpawn: useSpawn2, useToast: useToast7, useTranslation: useTranslation11, useUpdateTask: useUpdateTask4 } = runtime().hooks;
var { agentDisplayName: agentDisplayName2, allModels: allModels3, apiErrorMessage: apiErrorMessage3, contextMenuDivider: DIVIDER, copyText: copyText2, openTerminalWindow, taskExec: taskExec6, taskSessionName: taskSessionName3 } = runtime().utils;
function useTaskContextMenu({ onSelect, onEdit, childMap, blockedBy }) {
  const { t } = useTranslation11();
  const { toast } = useToast7();
  const { data: config } = useConfig8();
  const sessions = useSessions3();
  const spawn = useSpawn2();
  const kill = useKillSession();
  const setStatus = useSetTaskStatus2();
  const send = useSendInput();
  const update = useUpdateTask4();
  const setExec = useSetTaskExec2();
  const close = useCloseTask3();
  const del = useDeleteTask2();
  const deleteMission = useDeleteMission2();
  const approve = useApproveGate();
  const insert = useInsertPhases2();
  const [menuState, setMenuState] = (0, import_react14.useState)(null);
  const [depTask, setDepTask] = (0, import_react14.useState)(null);
  const [planTask, setPlanTask] = (0, import_react14.useState)(null);
  const [addPhaseEpic, setAddPhaseEpic] = (0, import_react14.useState)(null);
  const [confirm, setConfirm] = (0, import_react14.useState)(null);
  const fail = (e) => toast(apiErrorMessage3(e), "error");
  function open(e, task) {
    e.preventDefault();
    const exec = taskExec6(task.labels);
    const session = taskSessionName3(task);
    const live = sessions.data ?? [];
    const hasSession = !!session && live.includes(session);
    const running = task.status === "in_progress" && hasSession;
    const kind = task.type === "epic" && (childMap.get(task.id)?.length ?? 0) > 0 ? "epic" : task.parent_id ? "phase" : "standalone";
    const hasBlockers = (blockedBy.get(task.id)?.length ?? 0) > 0;
    const isGated = task.labels?.some((l) => l.startsWith("gatedby:")) ?? false;
    const models = allModels3(config?.customModels, config?.hiddenPresets).filter((m) => !config?.allowedExecs || config.allowedExecs.includes(m.exec));
    const start = () => spawn.mutate({ taskId: task.id, exec: exec || void 0 }, { onSuccess: (r) => toast(t.tasks.launched.replace("{session}", agentDisplayName2(r.session))), onError: fail });
    const stop = () => {
      if (session) kill.mutate(session);
      setStatus.mutate({ id: task.id, status: "open" }, { onSuccess: () => toast(t.tasks.stopped.replace("{id}", task.id)), onError: fail });
    };
    const pause = () => {
      if (session) send.mutate({ name: session, keys: ["C-c"] }, { onSuccess: () => toast(t.sessions.interrupted.replace("{name}", agentDisplayName2(session))), onError: fail });
    };
    const reopen = () => setStatus.mutate({ id: task.id, status: "open" }, { onSuccess: () => toast(t.tasks.updated.replace("{id}", task.id)), onError: fail });
    const copyId = () => void copyText2(task.id).then((ok) => {
      if (ok) toast(t.tasks.idCopied.replace("{id}", task.id));
      else toast(t.tasks.idCopyFailed, "error");
    });
    const runReview = () => insert.mutate({ epicId: task.id, body: { phases: [{ title: t.tasks.reviewPhaseTitle.replace("{title}", task.title), type: "chore" }] } }, { onSuccess: () => toast(t.tasks.reviewQueued), onError: fail });
    const approveGate = () => approve.mutate(task.id, { onSuccess: (r) => toast(t.tasks.gateApproved.replace("{n}", String(r.released.length))), onError: fail });
    const closeTask = () => close.mutate(task.id, { onSuccess: () => toast(t.tasks.closed.replace("{id}", task.id)), onError: fail });
    const setExecTo = (v) => setExec.mutate({ id: task.id, exec: v }, { onSuccess: () => toast(t.tasks.updated.replace("{id}", task.id)), onError: fail });
    const setPriorityTo = (v) => update.mutate({ id: task.id, patch: { priority: v } }, { onSuccess: () => toast(t.tasks.updated.replace("{id}", task.id)), onError: fail });
    const setStatusTo = (v) => setStatus.mutate({ id: task.id, status: v }, { onSuccess: () => toast(t.tasks.updated.replace("{id}", task.id)), onError: fail });
    const ACTIONS = {
      open: { label: t.tasks.ctxOpenDetail, icon: Eye, onClick: () => onSelect(task) },
      edit: { label: t.common.edit, icon: Pencil, onClick: () => onEdit(task) },
      start: { label: t.tasks.start, icon: Play, onClick: start },
      stop: { label: t.tasks.stop, icon: Square, onClick: stop },
      pause: { label: t.tasks.pause, icon: Pause, onClick: pause },
      terminal: { label: t.tasks.openTerminal, icon: SquareTerminal, onClick: () => {
        if (session) openTerminalWindow(session);
      } },
      dependencies: { label: t.tasks.dependencies, icon: Link2, onClick: () => setDepTask(task) },
      reopen: { label: t.tasks.ctxReopen, icon: RotateCcw, onClick: reopen },
      approveGate: { label: t.tasks.ctxApproveGate, icon: ShieldCheck, onClick: approveGate },
      runReview: { label: t.tasks.ctxRunReview, icon: ScanSearch, onClick: runReview },
      addPhase: { label: t.missions.addPhase, icon: Plus, onClick: () => setAddPhaseEpic(task.id) },
      planMission: { label: t.tasks.ctxPlanMission, icon: Sparkles, onClick: () => setPlanTask(task) },
      close: { label: t.tasks.closeArchive, icon: Archive, onClick: closeTask },
      copyId: { label: t.tasks.copyId, icon: Copy, onClick: copyId },
      delete: { label: t.tasks.deletePermanently, icon: Trash2, danger: true, onClick: () => setConfirm({ kind: "delete", task }) },
      deleteMission: { label: t.tasks.deleteMission, icon: Trash2, danger: true, onClick: () => setConfirm({ kind: "deleteMission", task }) }
    };
    const SUBMENUS = {
      setModel: { label: t.tasks.ctxSetModel, icon: Cpu, optLabel: (v) => v === "" ? t.tasks.ctxDefaultModel : models.find((m) => m.exec === v)?.label ?? v, onPick: setExecTo },
      setPriority: { label: t.tasks.ctxPriority, icon: Flag, optLabel: (v) => v, onPick: setPriorityTo },
      setStatus: { label: t.tasks.ctxStatus, icon: Activity, optLabel: (v) => statusLabel(t, v), onPick: setStatusTo }
    };
    const spec = buildTaskMenu({ task, kind, running, hasSession, hasBlockers, isGated, canMutate: true, models, currentExec: exec });
    const items = spec.map((entry) => {
      if (entry === SPEC_DIVIDER) return DIVIDER;
      if (entry.kind === "item") {
        const a = ACTIONS[entry.id];
        return { label: a.label, icon: a.icon, onClick: a.onClick, danger: a.danger, disabled: !entry.enabled };
      }
      const s = SUBMENUS[entry.id];
      return {
        label: s.label,
        icon: s.icon,
        disabled: !entry.enabled,
        items: entry.options.map((o) => ({ label: s.optLabel(o.value), onClick: () => s.onPick(o.value), disabled: o.current }))
      };
    });
    setMenuState({ x: e.clientX, y: e.clientY, items });
  }
  const menu = menuState ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(ContextMenu2, { state: menuState, onClose: () => setMenuState(null) }) : null;
  const modals = /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(import_jsx_runtime14.Fragment, { children: [
    depTask ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(DepPickerModal, { task: depTask, onClose: () => setDepTask(null) }) : null,
    planTask ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TaskModal, { initialMode: "planning", initialGoal: planTask.description ? `${planTask.title}

${planTask.description}` : planTask.title, onClose: () => setPlanTask(null) }) : null,
    addPhaseEpic ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(AddPhaseModal, { epicId: addPhaseEpic, onClose: () => setAddPhaseEpic(null) }) : null,
    confirm?.kind === "delete" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
      ConfirmDialog3,
      {
        open: true,
        title: t.tasks.confirmDeleteTitle.replace("{id}", confirm.task.id),
        description: t.tasks.confirmDeleteDescription,
        onClose: () => setConfirm(null),
        onConfirm: () => {
          const tk = confirm.task;
          setConfirm(null);
          del.mutate(tk.id, { onSuccess: () => toast(t.tasks.deleted.replace("{id}", tk.id)), onError: fail });
        }
      }
    ) : null,
    confirm?.kind === "deleteMission" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
      ConfirmDialog3,
      {
        open: true,
        title: t.tasks.confirmDeleteMissionTitle.replace("{id}", confirm.task.id),
        description: t.tasks.confirmDeleteMissionDescription,
        confirmLabel: t.tasks.deleteMission,
        onClose: () => setConfirm(null),
        onConfirm: () => {
          const tk = confirm.task;
          setConfirm(null);
          deleteMission.mutate(tk.id, { onSuccess: () => toast(t.tasks.missionDeleted.replace("{id}", tk.id)), onError: fail });
        }
      }
    ) : null
  ] });
  return { open, menu, modals };
}

// plugins/work/web-src/tasks/dateRange.ts
function taskDayMs(task) {
  const iso = task.scheduled_at || task.closed_at || task.created_at;
  const ms = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}
function isUnscheduled(task) {
  return !task.scheduled_at && !task.closed_at;
}

// plugins/work/web-src/kanban/calendar.ts
var pad = (n) => String(n).padStart(2, "0");
function dayKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function sameDay(a, b) {
  return dayKey(a) === dayKey(b);
}
function taskCalDate(t) {
  return t.scheduled_at || t.closed_at || null;
}
function tasksByDay(tasks) {
  const map = /* @__PURE__ */ new Map();
  for (const t of tasks) {
    const iso = taskCalDate(t);
    if (!iso) continue;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const k = dayKey(d);
    (map.get(k) ?? map.set(k, []).get(k)).push(t);
  }
  for (const list of map.values()) list.sort((a, b) => (taskCalDate(a) ?? "").localeCompare(taskCalDate(b) ?? ""));
  return map;
}
function countUnscheduled(tasks) {
  return tasks.filter((t) => !taskCalDate(t)).length;
}
function startOfWeek(ref) {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d;
}
function weekDays(ref) {
  const start = startOfWeek(ref);
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}
function monthMatrix(ref) {
  const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const weeks = [];
  const cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (week[6].getMonth() !== ref.getMonth() && week[0].getMonth() !== ref.getMonth()) break;
  }
  return weeks;
}
function shift(ref, range, dir) {
  const d = new Date(ref);
  if (range === "day") d.setDate(d.getDate() + dir);
  else if (range === "week") d.setDate(d.getDate() + 7 * dir);
  else d.setMonth(d.getMonth() + dir);
  return d;
}

// plugins/work/web-src/tasks/taskFilters.ts
var { epicChildren, epicEffectiveStatus, phaseIds } = runtime().utils;
function taskFilterCounts(tasks, missions) {
  const children = epicChildren(tasks);
  const phases = phaseIds(tasks);
  const counts = { in_progress: 0, open: 0, blocked: 0, closed: 0, autopilot: 0, all: 0 };
  for (const task of tasks) {
    if (phases.has(task.id)) continue;
    counts.all += 1;
    const kids = task.type === "epic" ? children.get(task.id) ?? [] : [];
    if (task.type === "epic" && kids.length > 0) counts.autopilot += 1;
    const status = task.type === "epic" ? epicEffectiveStatus(task, missions, kids) : task.status;
    if (status === "in_progress" || status === "open" || status === "blocked" || status === "closed") counts[status] += 1;
  }
  return counts;
}

// plugins/work/web-src/tasks/TasksView.tsx
var import_jsx_runtime15 = __toESM(require_jsx_runtime(), 1);
var { Button: Button4, ConfirmDialog: ConfirmDialog4, ControlSurfaceDocument, ControlSurfaceRegister, ControlSurfaceState, ControlSurfaceToolbar, DateRangeFilter, EmptyState: EmptyState2, ErrorState, Input: Input3, LoadingState, ModuleHeader, MotionLayout, MotionLayoutItem, MotionPresence, ProjectFilterPills, SpatialWorkspaceLayout, WorkspaceDetailRail, WorkspaceMetric } = runtime().components;
var { useAllDeps: useAllDeps2, useCloseTask: useCloseTask4, useDeleteTask: useDeleteTask3, useMissions: useMissions2, usePersistentState, useProjectFilter, useSessions: useSessions4, useSessionSignals: useSessionSignals3, useTasks: useTasks5, useToast: useToast8, useTranslation: useTranslation12 } = runtime().hooks;
var { DEFAULT_RANGE, epicChildren: epicChildren2, epicEffectiveStatus: epicEffectiveStatus2, epicLive: epicLive2, inRange, isStoredRange, parseRange, phaseIds: phaseIds2, serializeRange, taskBlockers, taskSessionName: taskSessionName4 } = runtime().utils;
var FILTER_VALUES = ["in_progress", "open", "blocked", "closed", "autopilot", "all"];
var PAGE_SIZE = 12;
var dayKeyMs = (ms) => dayKey(new Date(ms));
function TasksView() {
  const deps = useAllDeps2();
  const sessions = useSessions4();
  const signals = useSessionSignals3();
  const missions = useMissions2();
  const close = useCloseTask4();
  const del = useDeleteTask3();
  const { toast } = useToast8();
  const { t, locale } = useTranslation12();
  const [creating, setCreating] = (0, import_react15.useState)(false);
  const [editing, setEditing] = (0, import_react15.useState)(null);
  const [query, setQuery] = (0, import_react15.useState)("");
  const deferredQuery = (0, import_react15.useDeferredValue)(query);
  const [filter, setFilter] = usePersistentState("elowen.tasks.filter", "in_progress", FILTER_VALUES);
  const [rangeRaw, setRangeRaw] = usePersistentState("elowen.tasks.range", serializeRange(DEFAULT_RANGE), isStoredRange);
  const range = (0, import_react15.useMemo)(() => parseRange(rangeRaw) ?? DEFAULT_RANGE, [rangeRaw]);
  const { selectedProject, setProject } = useProjectFilter("elowen.tasks.project");
  const tasks = useTasks5(selectedProject === "all" ? void 0 : selectedProject);
  const [page, setPage] = (0, import_react15.useState)(0);
  const [selected, setSelected] = (0, import_react15.useState)(/* @__PURE__ */ new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = (0, import_react15.useState)(false);
  const [selectedId, setSelectedId] = (0, import_react15.useState)(null);
  const childMap = (0, import_react15.useMemo)(() => epicChildren2(tasks.data ?? []), [tasks.data]);
  const phaseSet = (0, import_react15.useMemo)(() => phaseIds2(tasks.data ?? []), [tasks.data]);
  const [expandedEpics, setExpandedEpics] = (0, import_react15.useState)(/* @__PURE__ */ new Set());
  const toggleEpic = (id) => setExpandedEpics((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const router = useRouter();
  const params = useSearchParams();
  (0, import_react15.useEffect)(() => {
    if (params.get("new") === "1") {
      setCreating(true);
      router.replace("/p/work/tasks");
    }
  }, [params, router]);
  (0, import_react15.useEffect)(() => {
    const s = params.get("select");
    if (s) setSelectedId(s);
  }, [params]);
  (0, import_react15.useEffect)(() => {
    if (!selectedId) return;
    const task = tasks.data?.find((x) => x.id === selectedId);
    if (task?.parent_id && phaseSet.has(selectedId)) setExpandedEpics((s) => new Set(s).add(task.parent_id));
  }, [selectedId, tasks.data, phaseSet]);
  (0, import_react15.useEffect)(() => {
    if (filter !== "autopilot") return;
    const toExpand = /* @__PURE__ */ new Set();
    for (const epic of tasks.data ?? []) {
      if (epic.type !== "epic") continue;
      const kids = childMap.get(epic.id) ?? [];
      if (kids.length === 0) continue;
      const { running } = epicLive2(kids, sessions.data ?? [], signals);
      const needs = kids.some((k) => {
        const s = taskSessionName4(k);
        return s ? signals[s]?.type === "needs_input" : false;
      });
      if (running > 0 || needs) toExpand.add(epic.id);
    }
    if (toExpand.size) setExpandedEpics((s) => {
      const n = new Set(s);
      for (const id of toExpand) n.add(id);
      return n;
    });
  }, [filter, tasks.data, childMap, sessions.data, signals]);
  const blockedBy = (0, import_react15.useMemo)(() => {
    const byId = new Map((tasks.data ?? []).map((x) => [x.id, x]));
    const out = /* @__PURE__ */ new Map();
    for (const task of tasks.data ?? []) {
      const b = taskBlockers(task.id, deps.data ?? [], byId);
      if (b.length > 0) out.set(task.id, b);
    }
    return out;
  }, [tasks.data, deps.data]);
  const ctxMenu = useTaskContextMenu({ onSelect: (x) => setSelectedId(x.id), onEdit: setEditing, childMap, blockedBy, missions: missions.data ?? [] });
  const taskDrop = useTaskDrop(tasks.data ?? [], childMap, phaseSet);
  const [draggingId, setDraggingId] = (0, import_react15.useState)(null);
  const toggleSelect = (id) => setSelected((cur) => {
    const next = new Set(cur);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const clearSelection = () => setSelected(/* @__PURE__ */ new Set());
  const bulkClose = () => {
    selected.forEach((id) => close.mutate(id));
    toast(t.tasks.nClosed.replace("{count}", String(selected.size)));
    clearSelection();
  };
  const bulkDelete = () => {
    selected.forEach((id) => del.mutate(id));
    toast(t.tasks.nDeleted.replace("{count}", String(selected.size)));
    clearSelection();
    setConfirmBulkDelete(false);
  };
  const filtered = (0, import_react15.useMemo)(() => {
    const q = deferredQuery.trim().toLowerCase();
    const now = Date.now();
    const matchText = (t2) => `${t2.title} ${t2.id} ${t2.description ?? ""}`.toLowerCase().includes(q);
    const isEpicActive = (epic) => {
      const kids = childMap.get(epic.id) ?? [];
      return epicLive2(kids, sessions.data ?? [], signals).running > 0 || kids.some((k) => {
        const s = taskSessionName4(k);
        return s ? signals[s]?.type === "needs_input" : false;
      });
    };
    return (tasks.data ?? []).filter((t2) => !phaseSet.has(t2.id)).filter((t2) => {
      if (filter === "autopilot") {
        if (t2.type !== "epic") return false;
        const kids2 = childMap.get(t2.id) ?? [];
        if (kids2.length === 0) return false;
        return true;
      }
      const kids = t2.type === "epic" ? childMap.get(t2.id) ?? [] : [];
      const effStatus = t2.type === "epic" ? epicEffectiveStatus2(t2, missions.data ?? [], kids) : t2.status;
      if (filter !== "all" && effStatus !== filter) return false;
      if (!q) return true;
      return matchText(t2) || kids.some(matchText);
    }).filter((t2) => {
      const ms = taskDayMs(t2);
      return ms === 0 || inRange(ms, range, now);
    }).sort((a, b) => {
      if (filter === "autopilot") {
        const aActive = isEpicActive(a);
        const bActive = isEpicActive(b);
        if (aActive !== bActive) return aActive ? -1 : 1;
      }
      return taskDayMs(b) - taskDayMs(a);
    });
  }, [tasks.data, deferredQuery, filter, range, childMap, phaseSet, sessions.data, signals, missions.data]);
  (0, import_react15.useEffect)(() => {
    setPage(0);
  }, [query, filter, range, selectedProject]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);
  const dayLabel = (0, import_react15.useCallback)((ms) => {
    const now = /* @__PURE__ */ new Date();
    const todayKey = dayKeyMs(now.getTime());
    const yesterdayKey = dayKeyMs(now.getTime() - 864e5);
    const k = dayKeyMs(ms);
    if (k === todayKey) return t.tasks.dayToday;
    if (k === yesterdayKey) return t.tasks.dayYesterday;
    return new Date(ms).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  }, [t, locale]);
  const groups = (0, import_react15.useMemo)(() => {
    const out = [];
    for (const task of pageItems) {
      const ms = taskDayMs(task);
      const k = dayKeyMs(ms);
      const last = out[out.length - 1];
      if (last && last.key === k) last.items.push(task);
      else out.push({ key: k, label: dayLabel(ms), items: [task] });
    }
    return out;
  }, [pageItems, dayLabel]);
  const counts = (0, import_react15.useMemo)(() => taskFilterCounts(tasks.data ?? [], missions.data ?? []), [tasks.data, missions.data]);
  const filterSections = [
    { id: "in_progress", label: t.tasks.filterActive, icon: Activity, count: counts.in_progress },
    { id: "open", label: t.tasks.filterOpen, icon: Circle, count: counts.open },
    { id: "blocked", label: t.tasks.filterBlocked, icon: Ban, count: counts.blocked },
    { id: "closed", label: t.tasks.filterClosed, icon: Archive, count: counts.closed },
    { id: "autopilot", label: t.tasks.filterAutopilot, icon: Rocket, count: counts.autopilot },
    { id: "all", label: t.tasks.filterAll, icon: List, count: counts.all }
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ModuleHeader, { title: t.page.tasks, count: filtered.length, icon: ListChecks }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
      SpatialWorkspaceLayout,
      {
        hero: {
          eyebrow: t.tasks.workspaceEyebrow,
          title: t.page.tasks,
          count: counts.all,
          description: t.tasks.workspaceIntro,
          mascotState: tasks.isLoading ? "saving" : tasks.isError ? "error" : "idle",
          status: !tasks.isLoading && !tasks.isError ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "workspace-status", children: t.tasks.workspaceReady }) : void 0,
          action: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Button4, { variant: "accent", icon: Plus, onClick: () => setCreating(true), children: t.tasks.newTask }),
          metrics: /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(WorkspaceMetric, { label: t.tasks.metricActive, value: counts.in_progress, icon: Activity }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(WorkspaceMetric, { label: t.tasks.metricBlocked, value: counts.blocked, icon: Ban }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(WorkspaceMetric, { label: t.tasks.metricAutopilot, value: counts.autopilot, icon: Rocket }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(WorkspaceMetric, { label: t.tasks.metricClosed, value: counts.closed, icon: Archive })
          ] })
        },
        navigation: { sections: filterSections, value: filter, onChange: (value) => setFilter(value), ariaLabel: t.tasks.filterLabel },
        children: /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(ControlSurfaceDocument, { className: "tasks-control-surface", children: [
          /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(ControlSurfaceToolbar, { className: "flex-wrap", children: [
            /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "relative min-w-[15rem] flex-1", children: [
              /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Search, { size: 14, "aria-hidden": true, className: "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" }),
              /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Input3, { value: query, onChange: (e) => setQuery(e.target.value), placeholder: t.tasks.searchPlaceholder, className: "pl-9" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ProjectFilterPills, { value: selectedProject, onChange: setProject, variant: "dropdown" }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(DateRangeFilter, { value: range, onChange: (r) => setRangeRaw(serializeRange(r)), compact: true })
          ] }),
          tasks.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(LoadingState, { variant: "list" }) }) : tasks.isError ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ControlSurfaceState, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ErrorState, { message: t.common.daemonUnreachable, onRetry: () => tasks.refetch() }) }) : !tasks.data || tasks.data.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(EmptyState2, { title: t.tasks.empty, description: t.tasks.emptyDescription, icon: ListChecks, action: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Button4, { variant: "accent", icon: Plus, onClick: () => setCreating(true), children: t.tasks.newTask }) }) }) : filtered.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ControlSurfaceState, { children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(EmptyState2, { title: t.tasks.noMatches, description: t.tasks.noMatchesDescription, icon: Search }) }) : /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(ControlSurfaceRegister, { className: "workspace-master-detail tasks-workspace-grid", "data-detail": selectedId != null, children: [
            /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "min-w-0", children: [
              /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(MotionLayout, { className: "flex flex-col gap-5", children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(MotionPresence, { children: groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(MotionLayoutItem, { layoutId: `task-day-${group.key}`, className: "task-day-section", children: [
                /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "flex items-center gap-3 border-b border-border/70 py-2.5", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(CalendarDays, { size: 12, className: "shrink-0 text-text-muted", "aria-hidden": true }),
                  /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "text-[11px] font-semibold uppercase tracking-wider text-text-muted", children: group.label }),
                  /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "h-px flex-1 bg-border" }),
                  /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("span", { className: "inline-flex items-center gap-1 font-mono text-tiny text-text-muted", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(List, { size: 11, className: "shrink-0", "aria-hidden": true }),
                    group.items.length
                  ] })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(MotionLayout, { className: "flex flex-col", children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(MotionPresence, { children: group.items.map((task) => {
                  const kids = childMap.get(task.id);
                  if (task.type === "epic" && kids && kids.length > 0) {
                    return /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(MotionLayoutItem, { layoutId: `task-${task.id}`, children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(EpicGroup, { epic: task, phases: kids, effectiveStatus: epicEffectiveStatus2(task, missions.data ?? [], kids), expanded: expandedEpics.has(task.id), onToggle: () => toggleEpic(task.id), onEdit: setEditing, onSelect: (item) => setSelectedId(item.id), onContextMenu: ctxMenu.open, activeId: selectedId, blockedBy, onDropTask: (event) => taskDrop.handleDrop(event, task), dropTargetValid: draggingId ? taskDrop.isValidTarget(draggingId, task) : void 0 }) }, task.id);
                  }
                  return /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(MotionLayoutItem, { layoutId: `task-${task.id}`, children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TaskCard, { task, onEdit: setEditing, onSelect: (item) => setSelectedId(item.id), onContextMenu: ctxMenu.open, active: selectedId === task.id, blockers: blockedBy.get(task.id), selected: selected.has(task.id), onToggleSelect: toggleSelect, selecting: selected.size > 0, dragging: draggingId === task.id, onDragStart: (event) => {
                    event.dataTransfer.setData("text/plain", task.id);
                    setDraggingId(task.id);
                  }, onDragEnd: () => setDraggingId(null), onDropTask: (event) => taskDrop.handleDrop(event, task), dropTargetValid: draggingId ? taskDrop.isValidTarget(draggingId, task) : void 0 }) }, task.id);
                }) }) })
              ] }, group.key)) }) }),
              filtered.length > PAGE_SIZE ? /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "flex items-center justify-between border-t border-border py-3", children: [
                /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "font-mono text-xs text-text-muted", children: t.tasks.pageRange.replace("{from}", String(clampedPage * PAGE_SIZE + 1)).replace("{to}", String(clampedPage * PAGE_SIZE + pageItems.length)).replace("{total}", String(filtered.length)) }),
                /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "flex items-center gap-2", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Button4, { variant: "ghost", icon: ChevronLeft, disabled: clampedPage === 0, onClick: () => setPage(clampedPage - 1), children: t.tasks.prevPage }),
                  /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(Button4, { variant: "ghost", disabled: clampedPage >= pageCount - 1, onClick: () => setPage(clampedPage + 1), children: [
                    t.tasks.nextPage,
                    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ChevronRight, { size: 15, className: "ml-1" })
                  ] })
                ] })
              ] }) : null
            ] }),
            selectedId ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(WorkspaceDetailRail, { label: t.tasks.detailTitle, closeLabel: t.common.close, onClose: () => setSelectedId(null), children: (() => {
              const selectedTask = tasks.data?.find((item) => item.id === selectedId);
              const selectedPhases = selectedTask?.type === "epic" ? childMap.get(selectedTask.id) ?? [] : [];
              if (selectedTask?.type === "epic" && selectedPhases.length > 0) {
                return /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(MissionFlow, { epic: selectedTask, phases: selectedPhases, activeId: selectedId, onSelectPhase: setSelectedId, onContextMenu: ctxMenu.open });
              }
              const backToEpic = selectedTask?.parent_id && tasks.data?.some((item) => item.id === selectedTask.parent_id && item.type === "epic") ? selectedTask.parent_id : null;
              return /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TaskDetailPane, { taskId: selectedId, onEdit: setEditing, onBack: backToEpic ? () => setSelectedId(backToEpic) : void 0 });
            })() }) : null
          ] })
        ] })
      }
    ),
    selected.size > 0 && /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-elevated px-3 py-2 shadow-[var(--shadow-raised)] animate-fade-up", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "px-1 text-sm text-text", children: t.tasks.nSelected.replace("{count}", String(selected.size)) }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Button4, { variant: "default", icon: Archive, onClick: bulkClose, children: t.common.close }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Button4, { variant: "danger", icon: Trash2, onClick: () => setConfirmBulkDelete(true), children: t.common.delete }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("button", { type: "button", "aria-label": t.tasks.clearSelection, onClick: clearSelection, className: "flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface hover:text-text", children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(X, { size: 15 }) })
    ] }),
    creating && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TaskModal, { onClose: () => setCreating(false), defaultProjectId: selectedProject === "all" ? void 0 : selectedProject }),
    editing && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TaskModal, { task: editing, onClose: () => setEditing(null) }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ConfirmDialog4, { open: confirmBulkDelete, title: t.tasks.confirmBulkDeleteTitle.replace("{count}", String(selected.size)), description: t.tasks.confirmBulkDeleteDescription, onClose: () => setConfirmBulkDelete(false), onConfirm: bulkDelete }),
    ctxMenu.menu,
    ctxMenu.modals,
    taskDrop.popup
  ] });
}

// plugins/work/web-src/kanban/KanbanPage.tsx
var import_react19 = __toESM(require_react(), 1);

// plugins/work/web-src/kanban/KanbanBoard.tsx
var import_react17 = __toESM(require_react(), 1);

// plugins/work/web-src/kanban/groupByStatus.ts
var STATUSES = ["open", "in_progress", "blocked", "closed", "cancelled"];
function groupByStatus(tasks, statusOf = (t) => t.status) {
  const groups = Object.fromEntries(STATUSES.map((s) => [s, []]));
  for (const task of tasks) {
    (groups[statusOf(task)] ??= []).push(task);
  }
  return groups;
}

// plugins/work/web-src/kanban/KanbanCard.tsx
var import_jsx_runtime16 = __toESM(require_jsx_runtime(), 1);
var { AgentIdentityStrip, AgentStatusDot: AgentStatusDot4, Badge: Badge6, ModelIcon: ModelIcon6, OutcomeBadge: OutcomeBadge3, ProjectPill: ProjectPill3, TaskContextLine } = runtime().components;
var { useConfig: useConfig9, usePluginStrings, useSessions: useSessions5, useSessionSignal: useSessionSignal3, useSessionStall: useSessionStall2, useTranslation: useTranslation13 } = runtime().hooks;
var { formatTaskTime: formatTaskTime4, statusTone: statusTone5, taskExec: taskExec7, taskSessionName: taskSessionName5 } = runtime().utils;
function KanbanCard({ task, blocked, blockers, dragging, statusLabel: statusLabel2, isPhase = false, onSelect, onContextMenu, onDragStart, onDragEnd, onDropTask, dropTargetValid }) {
  const { locale } = useTranslation13();
  const s = usePluginStrings("work");
  const drop = useDropTarget(onDropTask, dropTargetValid);
  const { data: config } = useConfig9();
  const sessions = useSessions5();
  const sessionName = taskSessionName5(task);
  const live = task.status === "in_progress" && !!sessionName && (sessions.data ?? []).includes(sessionName);
  const signal = useSessionSignal3(sessionName ?? "");
  const stall = useSessionStall2(sessionName ?? "", live && !!sessionName);
  const exec = taskExec7(task.labels) || config?.defaults?.exec || "";
  const TypeIcon = taskTypeMeta(task.type).icon;
  const isClosed = task.status === "closed" || task.status === "cancelled";
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
    "div",
    {
      role: "button",
      tabIndex: 0,
      draggable: !blocked && !isPhase,
      onDragStart,
      onDragEnd,
      onDragOver: drop.onDragOver,
      onDragEnter: drop.onDragEnter,
      onDragLeave: drop.onDragLeave,
      onDrop: drop.onDrop,
      onClick: () => onSelect?.(task),
      onKeyDown: (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(task);
        }
      },
      onContextMenu: onContextMenu ? (e) => onContextMenu(e, task) : void 0,
      className: `flex gap-2.5 rounded-md border bg-bg p-2.5 transition-all ${blocked ? "cursor-pointer border-danger/40" : "cursor-grab border-border hover:border-border-strong"} ${isPhase ? "ml-2 border-l-2 border-l-accent/40" : ""} ${dragging ? "rotate-[1deg] opacity-50" : ""} ${drop.dragOver && dropTargetValid ? "ring-2 ring-accent/60" : ""} ${drop.dragOver && dropTargetValid === false ? "ring-2 ring-danger/40 opacity-60" : ""}`,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-elevated", children: exec ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ModelIcon6, { name: exec, size: 19 }) : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(TypeIcon, { size: 16, className: "text-text-muted", "aria-hidden": true }) }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "flex min-w-0 flex-1 flex-col gap-1", children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "flex items-start gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "min-w-0 flex-1 text-sm text-text", children: task.title }),
            blocked ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "live-dot shrink-0 text-danger", style: { ["--live-ring"]: "color-mix(in srgb, var(--color-error) 50%, transparent)" }, title: s.kbBlockedDeps, children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(Link2, { size: 13, "aria-hidden": true }) }) : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "mt-1.5", children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(AgentStatusDot4, { signal, live, stall: stall.state, silenceSec: stall.silenceSec }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(AgentIdentityStrip, { task }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(TaskContextLine, { task, sessionName: live ? sessionName : null, blockers }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "flex items-center justify-between gap-2 pt-0.5", children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "truncate font-mono text-[11px] text-text-muted", children: task.id }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "flex shrink-0 items-center gap-1.5", children: [
              (() => {
                const w = formatTaskTime4(task.closed_at || task.created_at, Date.now(), locale);
                return w.label ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { title: w.title, children: /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(Badge6, { tone: "muted", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(Clock, { size: 11, className: "mr-1 inline", "aria-hidden": true }),
                  w.label
                ] }) }) : null;
              })(),
              isClosed ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(OutcomeBadge3, { outcome: task.outcome }) : null,
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(Badge6, { tone: statusTone5(task.status), children: statusLabel2 })
            ] })
          ] }),
          task.project_id != null ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "flex", children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ProjectPill3, { projectId: task.project_id }) }) : null
        ] })
      ]
    }
  );
}

// plugins/work/web-src/kanban/KanbanEpicCard.tsx
var import_react16 = __toESM(require_react(), 1);
var import_jsx_runtime17 = __toESM(require_jsx_runtime(), 1);
var { ActionMenu: ActionMenu3, ConfirmDialog: ConfirmDialog5, ContextMenu: ContextMenu3, ProgressRibbon: ProgressRibbon2, ProjectPill: ProjectPill4 } = runtime().components;
var { useDeleteMission: useDeleteMission3, usePluginStrings: usePluginStrings2, useSessions: useSessions6, useSessionSignals: useSessionSignals4, useToast: useToast9, useTranslation: useTranslation14 } = runtime().hooks;
var { epicLive: epicLive3, epicProgress: epicProgress2 } = runtime().utils;
function KanbanEpicCard({ epic, phases, expanded, onToggle, effectiveStatus, trueStatusLabel, onDropTask, dropTargetValid }) {
  const { t } = useTranslation14();
  const s = usePluginStrings2("work");
  const drop = useDropTarget(onDropTask, dropTargetValid);
  const sessions = useSessions6();
  const signals = useSessionSignals4();
  const { toast } = useToast9();
  const deleteMission = useDeleteMission3();
  const [confirmDelete, setConfirmDelete] = (0, import_react16.useState)(false);
  const [contextMenu, setContextMenu] = (0, import_react16.useState)(null);
  const { done, total } = epicProgress2(phases);
  const { running, needsInput } = epicLive3(phases, sessions.data ?? [], signals);
  const Icon2 = taskTypeMeta("epic").icon;
  const active = needsInput > 0 || running > 0;
  const dotColor = needsInput > 0 ? "var(--color-warning)" : running > 0 ? "var(--color-success)" : "var(--color-border-strong)";
  const dotRing = needsInput > 0 ? "color-mix(in srgb, var(--color-warning) 50%, transparent)" : "color-mix(in srgb, var(--color-success) 50%, transparent)";
  const virtual = effectiveStatus === "in_progress" && epic.status !== "in_progress";
  const titleText = virtual && trueStatusLabel ? s.kbTrueStatusTooltip.replace("{status}", trueStatusLabel) : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)(
    "div",
    {
      role: "button",
      tabIndex: 0,
      "aria-expanded": expanded,
      "aria-label": `${epic.title} \u2014 ${expanded ? t.tasks.collapsePhases : t.tasks.expandPhases}`,
      title: titleText,
      onClick: onToggle,
      onContextMenu: (event) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          items: [{ label: t.tasks.deleteMission, icon: Trash2, danger: true, onClick: () => setConfirmDelete(true) }]
        });
      },
      onKeyDown: (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      },
      onDragOver: drop.onDragOver,
      onDragEnter: drop.onDragEnter,
      onDragLeave: drop.onDragLeave,
      onDrop: drop.onDrop,
      className: `group flex cursor-pointer flex-col gap-2 rounded-md border border-accent/30 bg-accent/[0.04] p-2.5 transition-colors hover:border-accent/50 ${drop.dragOver && dropTargetValid ? "ring-2 ring-accent/60" : ""} ${drop.dragOver && dropTargetValid === false ? "ring-2 ring-danger/40 opacity-60" : ""}`,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(ChevronRight, { size: 14, className: `shrink-0 text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`, "aria-hidden": true }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-elevated", children: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(Icon2, { size: 15, className: "text-accent", "aria-hidden": true }) }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "min-w-0 flex-1 truncate text-sm font-semibold text-text", children: epic.title }),
          virtual ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "shrink-0 rounded border border-accent/40 px-1 font-mono text-[10px] uppercase tracking-wide text-accent", "aria-hidden": true, children: trueStatusLabel }) : null,
          active ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: `h-2 w-2 shrink-0 rounded-full ${active ? "live-dot" : ""}`, style: { backgroundColor: dotColor, ["--live-ring"]: dotRing }, "aria-hidden": true }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { className: "shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100", onClick: (e) => e.stopPropagation(), children: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
            ActionMenu3,
            {
              label: t.tasks.deleteMission,
              items: [{ label: t.tasks.deleteMission, icon: Trash2, tone: "danger", onSelect: () => setConfirmDelete(true) }]
            }
          ) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "flex items-center gap-2 pl-6", children: [
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(ProgressRibbon2, { phases, className: "flex-1" }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("span", { className: "shrink-0 font-mono text-[11px] text-text-muted", children: [
            done,
            "/",
            total
          ] })
        ] }),
        epic.project_id != null ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { className: "flex pl-6", children: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(ProjectPill4, { projectId: epic.project_id }) }) : null,
        confirmDelete && /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { onClick: (e) => e.stopPropagation(), children: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
          ConfirmDialog5,
          {
            open: confirmDelete,
            title: t.tasks.confirmDeleteMissionTitle.replace("{id}", epic.id),
            description: t.tasks.confirmDeleteMissionDescription,
            confirmLabel: t.tasks.deleteMission,
            onClose: () => setConfirmDelete(false),
            onConfirm: () => {
              setConfirmDelete(false);
              deleteMission.mutate(epic.id, { onSuccess: () => toast(t.tasks.missionDeleted.replace("{id}", epic.id)), onError: (e) => toast(String(e), "error") });
            }
          }
        ) }),
        contextMenu ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(ContextMenu3, { state: contextMenu, onClose: () => setContextMenu(null) }) : null
      ]
    }
  );
}

// plugins/work/web-src/kanban/KanbanBoard.tsx
var import_jsx_runtime18 = __toESM(require_jsx_runtime(), 1);
var { MotionLayout: MotionLayout2, MotionLayoutItem: MotionLayoutItem2 } = runtime().components;
var { usePluginStrings: usePluginStrings3, useTranslation: useTranslation15 } = runtime().hooks;
var { epicChildren: epicChildren3, epicEffectiveStatus: epicEffectiveStatus3, phaseIds: phaseIds3 } = runtime().utils;
var COLUMNS = [
  { status: "open", labelKey: "kbColumnOpen", icon: Circle, color: "var(--color-success)" },
  { status: "in_progress", labelKey: "kbColumnInProgress", icon: LoaderCircle, color: "var(--color-warning)" },
  { status: "blocked", labelKey: "kbColumnBlocked", icon: Ban, color: "var(--color-error)" },
  { status: "closed", labelKey: "kbColumnClosed", icon: CircleCheck, color: "var(--color-error)" },
  { status: "cancelled", labelKey: "kbColumnCancelled", icon: CircleX, color: "var(--color-cancelled)" }
];
function KanbanBoard({ tasks, allTasks, onMove, onSelect, onEdit, blockedBy, missions }) {
  const { t } = useTranslation15();
  const s = usePluginStrings3("work");
  const activeMissions = missions ?? [];
  const fullTasks = allTasks ?? tasks;
  const childMap = epicChildren3(fullTasks);
  const ctxMenu = useTaskContextMenu({ onSelect: (x) => onSelect?.(x), onEdit: (x) => onEdit?.(x), childMap, blockedBy: blockedBy ?? /* @__PURE__ */ new Map(), missions: activeMissions });
  const phaseSet = phaseIds3(fullTasks);
  const taskDrop = useTaskDrop(fullTasks, childMap, phaseSet);
  const effStatus = (task) => task.type === "epic" ? epicEffectiveStatus3(task, activeMissions, childMap.get(task.id) ?? []) : task.status;
  const groups = groupByStatus(tasks, effStatus);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const [dragOver, setDragOver] = (0, import_react17.useState)(null);
  const [draggingId, setDraggingId] = (0, import_react17.useState)(null);
  const [expanded, setExpanded] = (0, import_react17.useState)(/* @__PURE__ */ new Set());
  const toggleEpic = (id) => setExpanded((s2) => {
    const n = new Set(s2);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const renderCard = (task, isPhase) => {
    const blockers = blockedBy?.get(task.id) ?? [];
    return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(MotionLayoutItem2, { layoutId: `kanban-task-${task.id}`, children: /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
      KanbanCard,
      {
        task,
        isPhase,
        blocked: blockers.length > 0,
        blockers,
        dragging: draggingId === task.id,
        statusLabel: statusLabel(t, task.status),
        onSelect,
        onContextMenu: ctxMenu.open,
        onDragStart: (e) => {
          e.dataTransfer.setData("text/plain", task.id);
          setDraggingId(task.id);
        },
        onDragEnd: () => {
          setDraggingId(null);
          setDragOver(null);
        },
        onDropTask: (e) => taskDrop.handleDrop(e, task),
        dropTargetValid: draggingId ? taskDrop.isValidTarget(draggingId, task) : void 0
      },
      task.id
    ) }, task.id);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: "@container flex gap-3 overflow-x-auto", children: COLUMNS.map((col) => {
      const colLabel = s[col.labelKey];
      const isDropTarget = dragOver === col.status;
      return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
        "div",
        {
          "data-testid": `column-${col.status}`,
          className: `flex w-[80cqw] shrink-0 flex-col gap-2 border-y border-r bg-surface/25 px-2 py-3 transition-colors first:border-l @sm:w-auto @sm:min-w-[14rem] @sm:shrink @sm:flex-1 ${isDropTarget ? "border-accent/60 bg-elevated/40" : "border-border"}`,
          onDragOver: (e) => {
            e.preventDefault();
            if (dragOver !== col.status) setDragOver(col.status);
          },
          onDragLeave: (e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setDragOver((s2) => s2 === col.status ? null : s2);
          },
          onDrop: (e) => {
            e.preventDefault();
            setDragOver(null);
            setDraggingId(null);
            const id = e.dataTransfer.getData("text/plain");
            if (id && byId.get(id)?.status !== col.status) onMove(id, col.status);
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("header", { className: "flex items-center justify-between px-1 font-mono uppercase tracking-widest text-text-muted", style: { fontSize: "var(--text-caption)" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { className: "flex items-center gap-1.5", children: [
                /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(col.icon, { size: 12, style: { color: col.color }, "aria-hidden": true }),
                colLabel
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { className: "inline-flex items-center gap-1", children: [
                /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(List, { size: 11, className: "text-text-muted", "aria-hidden": true }),
                groups[col.status].filter((task) => !phaseSet.has(task.id)).length
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(MotionLayout2, { className: "flex flex-col gap-2", children: groups[col.status].map((task) => {
              if (task.type === "epic" && childMap.has(task.id)) {
                const phases = childMap.get(task.id) ?? [];
                return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(MotionLayoutItem2, { layoutId: `kanban-task-${task.id}`, className: "flex flex-col gap-2", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(KanbanEpicCard, { epic: task, phases, expanded: expanded.has(task.id), onToggle: () => toggleEpic(task.id), effectiveStatus: effStatus(task), trueStatusLabel: statusLabel(t, task.status), onDropTask: (e) => taskDrop.handleDrop(e, task), dropTargetValid: draggingId ? taskDrop.isValidTarget(draggingId, task) : void 0 }),
                  expanded.has(task.id) ? phases.map((ph) => renderCard(ph, true)) : null
                ] }, task.id);
              }
              if (phaseSet.has(task.id)) return null;
              return renderCard(task, false);
            }) })
          ]
        },
        col.status
      );
    }) }),
    ctxMenu.menu,
    ctxMenu.modals,
    taskDrop.popup
  ] });
}

// plugins/work/web-src/kanban/CalendarView.tsx
var import_react18 = __toESM(require_react(), 1);
var import_jsx_runtime19 = __toESM(require_jsx_runtime(), 1);
var { Badge: Badge7, Button: Button5, Segmented: Segmented3 } = runtime().components;
var { usePersistentState: usePersistentState2, useTranslation: useTranslation16 } = runtime().hooks;
var { statusTone: statusTone6 } = runtime().utils;
var fmtTime = (iso, locale) => iso ? new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "";
function TaskChip({ task, onSelect, locale, draggable }) {
  const Icon2 = taskTypeMeta(task.type).icon;
  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)(
    "button",
    {
      type: "button",
      draggable,
      onDragStart: draggable ? (e) => {
        e.dataTransfer.setData("application/x-task", task.id);
        e.dataTransfer.effectAllowed = "move";
      } : void 0,
      onClick: () => onSelect(task),
      className: `flex w-full items-center gap-1.5 rounded-md border border-border bg-bg px-1.5 py-1 text-left transition-colors hover:border-border-strong ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`,
      title: task.title,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Icon2, { size: 12, className: "shrink-0 text-text-muted", "aria-hidden": true }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: "font-mono text-tiny text-text-muted", children: fmtTime(taskCalDate(task), locale) }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: "min-w-0 flex-1 truncate text-[11px] text-text", children: task.title })
      ]
    }
  );
}
function CalendarView({ tasks, onSelect, onCreateDay, onReschedule }) {
  const { t, locale } = useTranslation16();
  const [dragDay, setDragDay] = (0, import_react18.useState)(null);
  const dropProps = (d) => onReschedule ? {
    onDragOver: (e) => {
      e.preventDefault();
      const k = dayKey(d);
      if (dragDay !== k) setDragDay(k);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDragDay((s) => s === dayKey(d) ? null : s);
    },
    onDrop: (e) => {
      e.preventDefault();
      setDragDay(null);
      const id = e.dataTransfer.getData("application/x-task");
      if (id) onReschedule(id, d);
    }
  } : {};
  const WD = [t.calendar.shortMon, t.calendar.shortTue, t.calendar.shortWed, t.calendar.shortThu, t.calendar.shortFri, t.calendar.shortSat, t.calendar.shortSun];
  const [range, setRange] = usePersistentState2("elowen.calendar.range", "week", ["day", "week", "month"]);
  const [ref, setRef] = (0, import_react18.useState)(() => /* @__PURE__ */ new Date());
  const byDay = tasksByDay(tasks);
  const unscheduled = countUnscheduled(tasks);
  const today = /* @__PURE__ */ new Date();
  const dayTasks = (d) => byDay.get(dayKey(d)) ?? [];
  const label = range === "month" ? ref.toLocaleDateString(locale, { month: "long", year: "numeric" }) : range === "day" ? ref.toLocaleDateString(locale, { weekday: "long", month: "short", day: "numeric" }) : (() => {
    const w = weekDays(ref);
    return `${w[0].toLocaleDateString(locale, { month: "short", day: "numeric" })} \u2013 ${w[6].toLocaleDateString(locale, { month: "short", day: "numeric" })}`;
  })();
  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "flex flex-col gap-4", children: [
    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
        Segmented3,
        {
          value: range,
          onChange: (v) => setRange(v),
          options: [
            { value: "day", label: t.calendar.day, icon: Calendar },
            { value: "week", label: t.calendar.week, icon: CalendarRange },
            { value: "month", label: t.calendar.month, icon: CalendarDays }
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: "text-sm font-medium text-text", children: label }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Button5, { variant: "ghost", onClick: () => setRef(/* @__PURE__ */ new Date()), children: t.calendar.today }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", "aria-label": t.calendar.previous, onClick: () => setRef((r) => shift(r, range, -1)), className: "flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted transition-colors hover:text-text", children: /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(ChevronLeft, { size: 16 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", "aria-label": t.calendar.next, onClick: () => setRef((r) => shift(r, range, 1)), className: "flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted transition-colors hover:text-text", children: /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(ChevronRight, { size: 16 }) })
      ] })
    ] }),
    range === "day" && /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "flex flex-col gap-2 rounded-lg border border-border bg-surface p-3", children: [
      dayTasks(ref).length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { className: "px-1 py-6 text-center text-sm text-text-muted", children: t.calendar.noTasks }) : dayTasks(ref).map((task) => /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("button", { type: "button", onClick: () => onSelect(task), className: "flex items-center gap-3 rounded-md border border-border bg-bg px-3 py-2 text-left transition-colors hover:border-border-strong", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: "font-mono text-xs text-text-muted", children: fmtTime(taskCalDate(task), locale) }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: "min-w-0 flex-1 truncate text-sm text-text", children: task.title }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Badge7, { tone: statusTone6(task.status), children: statusLabel(t, task.status) })
      ] }, task.id)),
      onCreateDay ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("button", { type: "button", onClick: () => onCreateDay(ref), className: "flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-sm text-text-muted transition-colors hover:border-accent hover:text-accent", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Plus, { size: 14, "aria-hidden": true }),
        " ",
        t.tasks.newTask
      ] }) : null
    ] }),
    range === "week" && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { className: "@container", children: /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { className: "grid grid-cols-1 gap-2 @sm:grid-cols-7", children: weekDays(ref).map((d) => /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { ...dropProps(d), className: `group flex min-h-[8rem] flex-col gap-1.5 rounded-lg border bg-surface p-2 transition-shadow ${dragDay === dayKey(d) ? "border-accent" : sameDay(d, today) ? "border-accent" : "border-border"}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "flex items-center justify-between px-0.5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: "text-[11px] font-medium uppercase tracking-wide text-text-muted", children: WD[(d.getDay() + 6) % 7] }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "flex items-center gap-1", children: [
          onCreateDay ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", onClick: () => onCreateDay(d), "aria-label": t.tasks.newTask, className: "text-text-muted opacity-0 transition-opacity hover:text-accent focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100", children: /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Plus, { size: 13 }) }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: `text-xs ${sameDay(d, today) ? "text-accent" : "text-text-muted"}`, children: d.getDate() })
        ] })
      ] }),
      dayTasks(d).map((t2) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(TaskChip, { task: t2, onSelect, locale, draggable: !!onReschedule }, t2.id))
    ] }, dayKey(d))) }) }),
    range === "month" && /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "overflow-hidden rounded-lg border border-border", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { className: "grid grid-cols-7 border-b border-border bg-surface", children: WD.map((w) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { className: "px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-text-muted", children: w }, w)) }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { className: "grid grid-cols-7", children: monthMatrix(ref).flat().map((d) => {
        const inMonth = d.getMonth() === ref.getMonth();
        const list = dayTasks(d);
        return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { ...dropProps(d), className: `group min-h-[6.5rem] border-b border-r p-1.5 transition-shadow ${dragDay === dayKey(d) ? "border-accent" : "border-border"} ${inMonth ? "bg-surface" : "bg-bg"}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "mb-1 flex items-center justify-between", children: [
            onCreateDay ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", onClick: () => onCreateDay(d), "aria-label": t.tasks.newTask, className: "text-text-muted opacity-0 transition-opacity hover:text-accent focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100", children: /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Plus, { size: 12 }) }) : /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", {}),
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: `text-[11px] ${sameDay(d, today) ? "font-bold text-accent" : inMonth ? "text-text-muted" : "text-text-muted/40"}`, children: d.getDate() })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "flex flex-col gap-1", children: [
            list.slice(0, 3).map((t2) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(TaskChip, { task: t2, onSelect, locale, draggable: !!onReschedule }, t2.id)),
            list.length > 3 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: "px-1 text-tiny text-text-muted", children: t.calendar.nMore.replace("{count}", String(list.length - 3)) }) : null
          ] })
        ] }, dayKey(d));
      }) })
    ] }),
    unscheduled > 0 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("p", { className: "flex items-center gap-1.5 text-xs text-text-muted", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(CalendarPlus, { size: 12, className: "shrink-0 text-text-muted", "aria-hidden": true }),
      t.calendar.unscheduled.replace("{count}", String(unscheduled)).replace("{s}", unscheduled === 1 ? "" : "s")
    ] }) : null
  ] });
}

// plugins/work/web-src/tasks/TaskResultsModal.tsx
var import_jsx_runtime20 = __toESM(require_jsx_runtime(), 1);
var { Badge: Badge8, Button: Button6, Modal: Modal5, ModalBody: ModalBody4, ModalFooter: ModalFooter4, ModelIcon: ModelIcon7, OutcomeBadge: OutcomeBadge4, TaskUsageBadge: TaskUsageBadge2 } = runtime().components;
var { useConfig: useConfig10, useTranslation: useTranslation17 } = runtime().hooks;
var { formatDuration: formatDuration2, formatTaskTime: formatTaskTime5, parseTs: parseTs2, statusTone: statusTone7, taskExec: taskExec8, taskSessionName: taskSessionName6, taskStartedMs } = runtime().utils;
function TaskResultsModal({ task, onClose }) {
  const { t, locale } = useTranslation17();
  const { data: config } = useConfig10();
  const exec = taskExec8(task.labels);
  const iconExec = exec || config?.defaults?.exec || "";
  const session = taskSessionName6(task);
  const fail = task.outcome === "fail";
  const HeaderIcon = task.outcome ? fail ? CircleX : CircleCheck : Archive;
  const finishedIso = task.closed_at || task.created_at;
  const finished = formatTaskTime5(finishedIso, Date.now(), locale);
  const startMs = taskStartedMs(task);
  const endMs = parseTs2(task.closed_at);
  const duration = startMs != null && endMs != null && endMs >= startMs ? formatDuration2(endMs - startMs) : null;
  const meta = [];
  if (exec || iconExec) meta.push({ icon: Bot, label: t.tasks.resultExecutor, value: exec || iconExec, modelIcon: iconExec });
  if (session) meta.push({ icon: Bot, label: t.tasks.resultAgent, value: session });
  if (finished.label) meta.push({ icon: CalendarCheck, label: t.tasks.resultFinished, value: finished.label });
  if (duration) meta.push({ icon: Clock, label: t.tasks.resultDuration, value: duration });
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)(Modal5, { title: task.title, description: task.id, onClose, size: "md", icon: HeaderIcon, children: [
    /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)(ModalBody4, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "flex flex-wrap items-center gap-1.5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Badge8, { tone: statusTone7(task.status), children: statusLabel(t, task.status) }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(OutcomeBadge4, { outcome: task.outcome }),
        exec ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Badge8, { children: exec }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(TaskUsageBadge2, { taskId: task.id })
      ] }),
      meta.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("dl", { className: "grid grid-cols-2 gap-2", children: meta.map((m) => /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "flex flex-col gap-1 rounded-md border border-border bg-elevated/40 p-2.5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("dt", { className: "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted", children: [
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(m.icon, { size: 12, "aria-hidden": true }),
          " ",
          m.label
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("dd", { className: "flex min-w-0 items-center gap-1.5 text-sm text-text", children: [
          m.modelIcon ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(ModelIcon7, { name: m.modelIcon, size: 16 }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "min-w-0 truncate font-mono text-xs", title: finished.title || m.value, children: m.value })
        ] })
      ] }, m.label)) }) : null,
      task.description?.trim() ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Section, { label: t.tasks.fieldDetails, children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: "whitespace-pre-wrap text-sm leading-relaxed text-text-muted", children: task.description }) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Section, { label: t.tasks.resultTitle, children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: "whitespace-pre-wrap text-sm leading-relaxed text-text-muted", children: task.result_summary?.trim() || t.tasks.noSummary }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(ModalFooter4, { children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Button6, { variant: "accent", onClick: onClose, children: t.tasks.done }) })
  ] });
}
function Section({ label, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "flex flex-col gap-1.5", children: [
    /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "text-[11px] font-semibold uppercase tracking-wide text-text-muted", children: label }),
    children
  ] });
}

// plugins/work/web-src/kanban/KanbanPage.tsx
var import_jsx_runtime21 = __toESM(require_jsx_runtime(), 1);
var { Button: Button7, ControlSurfaceDocument: ControlSurfaceDocument2, ControlSurfaceRegister: ControlSurfaceRegister2, ControlSurfaceState: ControlSurfaceState2, ControlSurfaceToolbar: ControlSurfaceToolbar2, DateRangeFilter: DateRangeFilter2, ErrorState: ErrorState2, LoadingState: LoadingState2, ModuleHeader: ModuleHeader2, MotionLayoutItem: MotionLayoutItem3, MotionPresence: MotionPresence2, ProjectFilterPills: ProjectFilterPills2, SpatialWorkspaceLayout: SpatialWorkspaceLayout2, WorkspaceMetric: WorkspaceMetric2 } = runtime().components;
var { useAllDeps: useAllDeps3, useMissions: useMissions3, usePersistentState: usePersistentState3, usePluginStrings: usePluginStrings4, useProjectFilter: useProjectFilter2, useSetTaskStatus: useSetTaskStatus3, useTasks: useTasks6, useToast: useToast10, useTranslation: useTranslation18, useUpdateTask: useUpdateTask5 } = runtime().hooks;
var { inRange: inRange2, isStoredRange: isStoredRange2, parseRange: parseRange2, serializeRange: serializeRange2, taskBlockers: taskBlockers2 } = runtime().utils;
var KANBAN_DEFAULT_RANGE = { preset: "today", from: null, to: null };
function KanbanPage() {
  const { selectedProject, setProject } = useProjectFilter2("elowen.kanban.project");
  const tasks = useTasks6(selectedProject === "all" ? void 0 : selectedProject);
  const deps = useAllDeps3();
  const missions = useMissions3();
  const setStatus = useSetTaskStatus3();
  const updateTask = useUpdateTask5();
  const { toast } = useToast10();
  const { t } = useTranslation18();
  const s = usePluginStrings4("work");
  const [view, setView] = usePersistentState3("elowen.kanban.view", "board", ["board", "calendar"]);
  const [rangeRaw, setRangeRaw] = usePersistentState3("elowen.kanban.range", serializeRange2(KANBAN_DEFAULT_RANGE), isStoredRange2);
  const range = (0, import_react19.useMemo)(() => parseRange2(rangeRaw) ?? KANBAN_DEFAULT_RANGE, [rangeRaw]);
  const [editing, setEditing] = (0, import_react19.useState)(null);
  const [viewing, setViewing] = (0, import_react19.useState)(null);
  const [createSchedule, setCreateSchedule] = (0, import_react19.useState)(null);
  const [creating, setCreating] = (0, import_react19.useState)(false);
  const openTask = (task) => (task.status === "closed" || task.status === "cancelled" ? setViewing : setEditing)(task);
  const byId = new Map((tasks.data ?? []).map((t2) => [t2.id, t2]));
  const blockedBy = /* @__PURE__ */ new Map();
  for (const task of tasks.data ?? []) {
    const blockers = taskBlockers2(task.id, deps.data ?? [], byId);
    if (blockers.length > 0) blockedBy.set(task.id, blockers);
  }
  const filteredTasks = (0, import_react19.useMemo)(() => {
    const now = Date.now();
    const passes = (t2) => {
      if (isUnscheduled(t2)) return true;
      const ms = taskDayMs(t2);
      return ms === 0 || inRange2(ms, range, now);
    };
    const base = (tasks.data ?? []).filter(passes);
    const baseIds = new Set(base.map((t2) => t2.id));
    const missingEpics = (tasks.data ?? []).filter(
      (t2) => t2.type === "epic" && !baseIds.has(t2.id) && base.some((p) => p.parent_id === t2.id)
    );
    return [...base, ...missingEpics];
  }, [tasks.data, range]);
  const summary = (0, import_react19.useMemo)(() => ({
    open: filteredTasks.filter((task) => task.status === "open").length,
    active: filteredTasks.filter((task) => task.status === "in_progress").length,
    blocked: filteredTasks.filter((task) => task.status === "blocked").length,
    closed: filteredTasks.filter((task) => task.status === "closed").length
  }), [filteredTasks]);
  return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(import_jsx_runtime21.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(ModuleHeader2, { title: t.page.kanban, count: filteredTasks.length, icon: SquareKanban }),
    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
      SpatialWorkspaceLayout2,
      {
        hero: {
          eyebrow: s.kbWorkspaceEyebrow,
          title: t.page.kanban,
          count: filteredTasks.length,
          description: s.kbWorkspaceIntro,
          mascotState: tasks.isLoading ? "saving" : tasks.isError ? "error" : "idle",
          status: !tasks.isLoading && !tasks.isError ? /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { className: "workspace-status", children: s.kbWorkspaceReady }) : void 0,
          action: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(Button7, { variant: "accent", icon: Plus, onClick: () => setCreating(true), children: t.tasks.newTask }),
          metrics: /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(import_jsx_runtime21.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(WorkspaceMetric2, { label: t.tasks.filterOpen, value: summary.open, icon: Columns3 }),
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(WorkspaceMetric2, { label: t.tasks.filterActive, value: summary.active, icon: Activity }),
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(WorkspaceMetric2, { label: t.tasks.filterBlocked, value: summary.blocked, icon: Ban }),
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(WorkspaceMetric2, { label: t.tasks.filterClosed, value: summary.closed, icon: CircleCheck })
          ] })
        },
        navigation: { sections: [{ id: "board", label: s.kbBoard, icon: Columns3 }, { id: "calendar", label: s.kbCalendar, icon: CalendarRange }], value: view, onChange: (id) => setView(id), ariaLabel: t.page.kanban },
        children: /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(ControlSurfaceDocument2, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(ControlSurfaceToolbar2, { className: "flex-wrap justify-end", children: [
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(ProjectFilterPills2, { value: selectedProject, onChange: setProject, variant: "dropdown" }),
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(DateRangeFilter2, { value: range, onChange: (r) => setRangeRaw(serializeRange2(r)), compact: true })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(ControlSurfaceRegister2, { children: tasks.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(ControlSurfaceState2, { children: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(LoadingState2, { variant: view === "board" ? "kanban" : "cards" }) }) : tasks.isError ? /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(ControlSurfaceState2, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(ErrorState2, { message: t.common.daemonUnreachable, onRetry: () => tasks.refetch() }) }) : /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(MotionPresence2, { mode: "wait", children: view === "board" ? /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(MotionLayoutItem3, { children: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
            KanbanBoard,
            {
              tasks: filteredTasks,
              allTasks: tasks.data ?? [],
              blockedBy,
              missions: missions.data ?? [],
              onMove: (id, status) => setStatus.mutate({ id, status }, { onError: (e) => toast(String(e), "error") }),
              onSelect: openTask,
              onEdit: setEditing
            }
          ) }, "board") : /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(MotionLayoutItem3, { children: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
            CalendarView,
            {
              tasks: filteredTasks,
              onSelect: openTask,
              onCreateDay: (d) => {
                const dt = new Date(d);
                dt.setHours(9, 0, 0, 0);
                setCreateSchedule(dt.toISOString());
              },
              onReschedule: (id, day) => {
                const task = (tasks.data ?? []).find((x) => x.id === id);
                const prev = task?.scheduled_at ? new Date(task.scheduled_at) : null;
                const dt = new Date(day);
                dt.setHours(prev ? prev.getHours() : 9, prev ? prev.getMinutes() : 0, 0, 0);
                updateTask.mutate({ id, patch: { scheduled_at: dt.toISOString() } }, { onError: (e) => toast(String(e), "error") });
              }
            }
          ) }, "calendar") }) })
        ] })
      }
    ),
    editing && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(TaskModal, { task: editing, onClose: () => setEditing(null) }),
    viewing && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(TaskResultsModal, { task: viewing, onClose: () => setViewing(null) }),
    creating && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(TaskModal, { onClose: () => setCreating(false), defaultProjectId: selectedProject === "all" ? void 0 : selectedProject }),
    createSchedule && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(TaskModal, { initialSchedule: createSchedule, onClose: () => setCreateSchedule(null) })
  ] });
}

// plugins/work/web-src/timeline/TimelineView.tsx
var import_react21 = __toESM(require_react(), 1);

// plugins/work/web-src/timeline/ChangesOverTime.tsx
var import_react20 = __toESM(require_react(), 1);
var import_jsx_runtime22 = __toESM(require_jsx_runtime(), 1);
var { Badge: Badge9, Modal: Modal6, PatchView: PatchView2, ProjectPill: ProjectPill5 } = runtime().components;
var { usePluginStrings: usePluginStrings5, useProjectCommit, useProjectCommitFileDiff, useTranslation: useTranslation19 } = runtime().hooks;
var { baseName: baseName2, dirName: dirName2, fileIcon: fileIcon2 } = runtime().utils;
var hhmm = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
var sumAdded = (c) => c.files.reduce((n, f) => n + f.added, 0);
var sumDeleted = (c) => c.files.reduce((n, f) => n + f.deleted, 0);
function typeBreakdown(files) {
  const by = /* @__PURE__ */ new Map();
  for (const f of files) {
    const Icon2 = fileIcon2(f.path);
    const key = Icon2.displayName ?? Icon2.name ?? f.path;
    const e = by.get(key);
    if (e) e.count++;
    else by.set(key, { Icon: Icon2, count: 1 });
  }
  return [...by.entries()].map(([key, v]) => ({ key, Icon: v.Icon, count: v.count })).slice(0, 5);
}
function Spark({ stamps, start, end }) {
  const BINS = 12;
  const bins = (0, import_react20.useMemo)(() => {
    const b = new Array(BINS).fill(0);
    const span = end - start || 1;
    for (const t of stamps) {
      const i = Math.min(BINS - 1, Math.max(0, Math.floor((t - start) / span * BINS)));
      b[i]++;
    }
    return b;
  }, [stamps, start, end]);
  const max = Math.max(1, ...bins);
  return /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "inline-flex h-4 items-end gap-px", "aria-hidden": true, children: bins.map((b, i) => /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "w-[3px] rounded-sm bg-accent/55", style: { height: `${b ? Math.max(14, b / max * 100) : 6}%`, opacity: b ? 1 : 0.3 } }, i)) });
}
function CommitRow({ c, multiProject, onOpen }) {
  const added = sumAdded(c);
  const deleted = sumDeleted(c);
  return /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)(
    "button",
    {
      type: "button",
      onClick: () => onOpen(c),
      className: "card-interactive group flex w-full flex-col gap-1.5 rounded-lg border border-border bg-surface p-2.5 text-left",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(GitCommitHorizontal, { size: 13, className: "shrink-0 text-text-muted group-hover:text-accent", "aria-hidden": true }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "font-mono text-[11px] text-text-muted", children: hhmm(c.timestamp) }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-muted", children: c.hash }),
          multiProject ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(ProjectPill5, { projectId: c.projectId }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("span", { className: "ml-auto inline-flex items-center gap-2 font-mono text-[11px]", children: [
            added ? /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("span", { className: "inline-flex items-center text-success", children: [
              /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(Plus, { size: 10, "aria-hidden": true }),
              added
            ] }) : null,
            deleted ? /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("span", { className: "inline-flex items-center text-danger", children: [
              /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(Minus, { size: 10, "aria-hidden": true }),
              deleted
            ] }) : null
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "truncate text-sm text-text", children: c.subject }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "flex flex-wrap items-center gap-1.5", children: [
          typeBreakdown(c.files).map(({ key, Icon: Icon2, count }) => /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("span", { className: "inline-flex items-center gap-1 rounded-md border border-border bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-muted", children: [
            /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(Icon2, { size: 12, className: "shrink-0", "aria-hidden": true }),
            count
          ] }, key)),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "font-mono text-[11px] text-text-muted", children: c.files.length === 1 ? baseName2(c.files[0].path) : `${c.files.length}` })
        ] })
      ]
    }
  );
}
function ChangesOverTime({ commits, windowStart, now, multiProject }) {
  const { t } = useTranslation19();
  const s = usePluginStrings5("work");
  const [open, setOpen] = (0, import_react20.useState)(null);
  const [openFile, setOpenFile] = (0, import_react20.useState)(null);
  const detail = useProjectCommit(open ? open.projectId : null, open ? open.hash : null);
  const fileDiff = useProjectCommitFileDiff(openFile ? openFile.projectId : null, openFile ? openFile.hash : null, openFile ? openFile.path : null);
  const topFiles = (0, import_react20.useMemo)(() => {
    const by = /* @__PURE__ */ new Map();
    for (const c of commits) {
      for (const f of c.files) {
        const e = by.get(f.path) ?? { path: f.path, count: 0, added: 0, deleted: 0, stamps: [], hash: c.hash, projectId: c.projectId };
        e.count++;
        e.added += f.added;
        e.deleted += f.deleted;
        e.stamps.push(c.timestamp);
        by.set(f.path, e);
      }
    }
    return [...by.values()].sort((a, b) => b.count - a.count || b.added + b.deleted - (a.added + a.deleted)).slice(0, 8);
  }, [commits]);
  if (!commits.length) {
    return /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "rounded-lg border border-border bg-surface p-6 text-center text-sm text-text-muted", children: s.tlNoChangesInWindow });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "@container", children: /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "grid gap-5 @3xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]", children: [
    /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { className: "flex min-w-0 flex-col gap-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("h3", { className: "font-mono text-[11px] uppercase tracking-widest text-text-muted", children: s.tlChangesOverTime }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "flex flex-col gap-2", children: commits.map((c) => /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(CommitRow, { c, multiProject, onOpen: setOpen }, `${c.projectId}-${c.hash}`)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { className: "flex min-w-0 flex-col gap-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("h3", { className: "font-mono text-[11px] uppercase tracking-widest text-text-muted", children: s.tlMostActiveFiles }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "flex flex-col gap-1.5", children: topFiles.map((f) => {
        const Icon2 = fileIcon2(f.path);
        return /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)(
          "button",
          {
            type: "button",
            onClick: () => setOpenFile({ path: f.path, hash: f.hash, projectId: f.projectId }),
            className: "card-interactive flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface p-2.5 text-left",
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(Icon2, { size: 15, className: "shrink-0 text-text-muted", "aria-hidden": true }),
              /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("span", { className: "min-w-0 flex-1 truncate text-sm", title: f.path, children: [
                /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "text-text-muted", children: dirName2(f.path) }),
                /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "text-text", children: baseName2(f.path) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(Spark, { stamps: f.stamps, start: windowStart, end: now }),
              /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)(Badge9, { tone: "muted", children: [
                f.count,
                "\xD7"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("span", { className: "inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px]", children: [
                /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("span", { className: "text-success", children: [
                  "+",
                  f.added
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("span", { className: "text-danger", children: [
                  "\u2212",
                  f.deleted
                ] })
              ] })
            ]
          },
          f.path
        );
      }) })
    ] }),
    open ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(Modal6, { title: open.subject, description: `${open.hash} \xB7 ${hhmm(open.timestamp)}`, icon: GitCommitHorizontal, size: "lg", onClose: () => setOpen(null), children: /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "flex h-full min-h-0 flex-col p-5", children: /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "min-h-0 flex-1 overflow-hidden rounded-lg border border-border", children: /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(PatchView2, { diff: detail.data?.diff ?? "", loading: detail.isLoading, empty: t.projects.noChanges }) }) }) }) : null,
    openFile ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(Modal6, { title: baseName2(openFile.path), description: `${openFile.path} \xB7 ${openFile.hash}`, icon: fileIcon2(openFile.path), size: "lg", onClose: () => setOpenFile(null), children: /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "flex h-full min-h-0 flex-col p-5", children: /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "min-h-0 flex-1 overflow-hidden rounded-lg border border-border", children: /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(PatchView2, { diff: fileDiff.data?.diff ?? "", loading: fileDiff.isLoading, empty: t.projects.noChanges }) }) }) }) : null
  ] }) });
}

// plugins/work/web-src/timeline/axis.ts
var HOUR_MS = 36e5;
var GROUP_GAP_MS = 5 * 60 * 1e3;
function groupEvents(events) {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const groups = [];
  for (const e of sorted) {
    const last = groups[groups.length - 1];
    const sameKind = last !== void 0 && last.type === e.type && last.target === e.target && last.detail === e.detail && e.timestamp - last.timestamp <= GROUP_GAP_MS;
    if (sameKind) {
      last.count += 1;
      last.id = e.id;
      last.timestamp = e.timestamp;
    } else {
      groups.push({ ...e, count: 1, firstTimestamp: e.timestamp });
    }
  }
  return groups;
}
function plotAxis(events, now, hours) {
  const windowStart = now - hours * HOUR_MS;
  const span = now - windowStart;
  const tickCount = hours <= 24 ? hours : Math.max(6, Math.min(12, Math.round(hours / 24)));
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const tickMs = windowStart + (i + 1) * span / tickCount;
    const d = new Date(tickMs);
    const label = hours <= 24 ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : `${d.getDate()}.${d.getMonth() + 1}.`;
    const frac = (tickMs - windowStart) / span;
    return { label, frac };
  });
  const points = groupEvents(events).filter((e) => e.timestamp >= windowStart && e.timestamp <= now).map((e) => ({
    ...e,
    frac: (e.timestamp - windowStart) / (now - windowStart)
  }));
  return { ticks, points };
}

// plugins/work/web-src/timeline/eventMeta.ts
var { eventIcon } = runtime().utils;
function eventTone(type) {
  switch (type) {
    case "task":
      return "accent";
    case "mission":
      return "accent";
    case "signal":
      return "muted";
    case "review":
      return "warning";
    default:
      return "default";
  }
}
function markerTone(type, detail) {
  if (detail.startsWith("escalated")) return "danger";
  if (detail.startsWith("approved")) return "success";
  switch (detail) {
    case "complete":
    case "open":
      return "success";
    case "working":
    case "in_progress":
    case "needs_input":
      return "warning";
    case "closed":
    case "blocked":
    case "cancelled":
      return "danger";
    case "active":
      return "accent";
    default:
      return eventTone(type);
  }
}

// plugins/work/web-src/timeline/TimelineView.tsx
var import_jsx_runtime23 = __toESM(require_jsx_runtime(), 1);
var { Badge: Badge10, ControlSurfaceDocument: ControlSurfaceDocument3, ControlSurfaceRegister: ControlSurfaceRegister3, ControlSurfaceState: ControlSurfaceState3, ControlSurfaceToolbar: ControlSurfaceToolbar3, DateRangeFilter: DateRangeFilter3, EmptyState: EmptyState3, ErrorState: ErrorState3, LoadingState: LoadingState3, ModuleHeader: ModuleHeader3, MotionLayoutItem: MotionLayoutItem4, MotionPresence: MotionPresence3, PatchView: PatchView3, ProjectFilterPills: ProjectFilterPills3, ProjectPill: ProjectPill6, Segmented: Segmented4, SpatialWorkspaceLayout: SpatialWorkspaceLayout3, WorkspaceDetailRail: WorkspaceDetailRail2, WorkspaceMetric: WorkspaceMetric3 } = runtime().components;
var { useActivity, useEditorPlugin, usePersistentState: usePersistentState4, usePluginStrings: usePluginStrings6, useProjectChanged, useProjectChanges, useProjectFilter: useProjectFilter3, useProjects: useProjects2, useProjectsCommits, useTasks: useTasks7, useTranslation: useTranslation20 } = runtime().hooks;
var { DEFAULT_RANGE: DEFAULT_RANGE2, inRange: inRange3, isStoredRange: isStoredRange3, parseRange: parseRange3, parseTs: parseTs3, rangeWindowCapHours, serializeRange: serializeRange3, TONE_TEXT } = runtime().utils;
var TIMELINE_PRESETS = ["7d", "30d", "all"];
var TONE_DOT = {
  accent: "bg-accent",
  danger: "bg-danger",
  success: "bg-success",
  warning: "bg-warning",
  muted: "bg-text-muted",
  default: "bg-text-muted"
};
var TONE_BUBBLE = {
  accent: "border-accent/40 bg-accent/10 text-accent",
  danger: "border-danger/40 bg-danger/10 text-danger",
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  muted: "border-border bg-elevated text-text-muted",
  default: "border-border bg-elevated text-text-muted"
};
function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function taskIdOf(p) {
  return p.type === "task" || p.type === "review" ? p.target : null;
}
function resolveDisplay(p, byId, byAgent, byLabel) {
  if (p.target.startsWith("m-")) {
    const epic = byId.get(p.target.slice(2));
    return { label: epic?.title ?? byLabel.get(p.target) ?? p.target, projectId: epic?.project_id ?? p.projectId ?? null };
  }
  if (p.type === "task" || p.type === "review") {
    const t = byId.get(p.target);
    return { label: t?.title ?? byLabel.get(p.target) ?? p.target, projectId: p.projectId ?? t?.project_id ?? null };
  }
  if (p.target.startsWith("elowen-")) {
    const name = p.target.slice("elowen-".length);
    const t = byAgent.get(name);
    return { label: name, projectId: t?.project_id ?? p.projectId ?? null };
  }
  return { label: p.target, projectId: p.projectId ?? null };
}
function AxisMarker({ point, label, onPick }) {
  const tone = markerTone(point.type, point.detail);
  const size = Math.min(20, 11 + Math.floor(Math.log2(point.count + 1)) * 2);
  const tip = `${label} \xB7 ${point.detail} \xB7 ${clock(point.timestamp)}${point.count > 1 ? ` \xB7 \xD7${point.count}` : ""}`;
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)(
    "div",
    {
      className: "group absolute top-1/2 -translate-x-1/2 -translate-y-1/2",
      style: { left: `${point.frac * 100}%` },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
          "button",
          {
            type: "button",
            "data-testid": "axis-dot",
            onClick: () => onPick(point),
            className: `block animate-pop-in cursor-pointer rounded-full border-2 border-surface shadow-sm transition-transform hover:scale-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${TONE_DOT[tone]}`,
            style: { width: size, height: size, transitionDuration: "var(--motion-fast)" },
            "aria-label": tip
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)(
          "div",
          {
            role: "tooltip",
            className: `pointer-events-none absolute bottom-full z-10 mb-2 hidden w-max max-w-[18rem] whitespace-normal break-words rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs text-text group-hover:block ${point.frac < 0.12 ? "left-0" : point.frac > 0.88 ? "right-0" : "left-1/2 -translate-x-1/2"}`,
            style: { boxShadow: "var(--shadow-raised)" },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "text-text", children: label }),
              /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("span", { className: "text-text-muted", children: [
                " \xB7 ",
                point.detail,
                " \xB7 ",
                clock(point.timestamp)
              ] }),
              point.count > 1 ? /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("span", { className: "text-text-muted", children: [
                " \xB7 \xD7",
                point.count
              ] }) : null
            ]
          }
        )
      ]
    }
  );
}
function TimelineTrack({ points, ticks, resolve, onPick }) {
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { "data-testid": "timeline-track", className: "relative min-w-0 w-full select-none", children: [
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "relative h-16", children: [
      ticks.map((t) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "absolute inset-y-0 w-px bg-border/50", style: { left: `${t.frac * 100}%` }, "aria-hidden": true }, t.label)),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border", "aria-hidden": true }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "absolute inset-y-0 right-0 w-px bg-accent/40", "aria-hidden": true, children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "live-dot absolute -top-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-accent", style: { ["--live-ring"]: "color-mix(in srgb, var(--color-info) 50%, transparent)" } }) }),
      points.map((p) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(AxisMarker, { point: p, label: resolve(p).label, onPick }, p.id))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "relative mt-1.5 h-4", children: ticks.map((t, index) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { "data-testid": "axis-tick", className: `absolute -translate-x-1/2 font-mono text-text-muted ${index % 2 === 1 ? "hidden @sm:block" : ""}`, style: { left: `${t.frac * 100}%`, fontSize: "var(--text-caption)" }, children: t.label }, t.label)) })
  ] });
}
function Lane({ points, ticks, resolve, onPick }) {
  const latest = points.reduce((a, b) => b.timestamp > a.timestamp ? b : a, points[0]);
  const Icon2 = eventIcon(latest.type);
  const tone = markerTone(latest.type, latest.detail);
  const { label, projectId } = resolve(latest);
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { "data-testid": "timeline-lane", className: "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-b border-border/70 px-4 py-3 @3xl:grid-cols-[auto_11rem_minmax(0,1fr)]", children: [
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: `flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 @3xl:h-12 @3xl:w-12 ${TONE_BUBBLE[tone]}`, children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(Icon2, { size: 22, "aria-hidden": true }) }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "min-w-0 @3xl:w-44 @3xl:shrink-0", children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "flex items-center gap-1.5", children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "truncate text-sm font-medium text-text", title: label, children: label }) }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: `shrink-0 text-[11px] ${TONE_TEXT[tone]}`, children: latest.detail }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ProjectPill6, { projectId: projectId ?? void 0 })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "relative col-span-2 h-9 min-w-0 @3xl:col-span-1 @3xl:col-start-3 @3xl:row-start-1", children: [
      ticks.map((t) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "absolute inset-y-0 w-px bg-border/40", style: { left: `${t.frac * 100}%` }, "aria-hidden": true }, t.label)),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/60", "aria-hidden": true }),
      points.map((p) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(AxisMarker, { point: p, label: resolve(p).label, onPick }, p.id))
    ] })
  ] });
}
function EventDetail({ point, display }) {
  const s = usePluginStrings6("work");
  const Icon2 = eventIcon(point.type);
  const tone = markerTone(point.type, point.detail);
  const projectId = display.projectId;
  const taskId = taskIdOf(point);
  const editorEnabled = useEditorPlugin();
  const changed = useProjectChanged(projectId, editorEnabled);
  const changes = useProjectChanges(projectId, editorEnabled);
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "@container flex min-h-0 flex-col gap-4 overflow-hidden", children: [
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "flex flex-wrap items-start gap-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: `flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${TONE_BUBBLE[tone]}`, children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(Icon2, { size: 22, "aria-hidden": true }) }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "min-w-0 flex-1", children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(Badge10, { tone, children: point.detail }),
          point.count > 1 ? /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("span", { className: "text-xs text-text-muted", children: [
            "\xD7",
            point.count
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ProjectPill6, { projectId: projectId ?? void 0 })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "mt-1 text-sm font-medium text-text", children: display.label })
      ] }),
      taskId ? /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)(Link, { href: `/p/work/tasks?select=${encodeURIComponent(taskId)}`, className: "inline-flex w-full shrink-0 items-center justify-center gap-1 rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs text-text transition-colors hover:text-accent @sm:w-auto @sm:justify-start", children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ArrowUpRight, { size: 14, "aria-hidden": true }),
        s.tlOpenTask
      ] }) : null
    ] }),
    editorEnabled && changed.data?.changed?.length ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "flex flex-wrap gap-1.5", children: changed.data.changed.slice(0, 12).map((f) => /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("span", { className: "inline-flex items-center gap-1 rounded-md border border-border bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-muted", children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(FileDiff, { size: 11, "aria-hidden": true }),
      f
    ] }, f)) }) : null,
    editorEnabled && projectId ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "min-h-48 flex-1 overflow-hidden border-y border-border", children: changes.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(LoadingState3, {}) : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(PatchView3, { diff: changes.data?.diff ?? "", empty: s.tlNoChanges }) }) : null
  ] });
}
function TimelineView() {
  const { t } = useTranslation20();
  const s = usePluginStrings6("work");
  const { selectedProject, setProject } = useProjectFilter3("elowen.timeline.project");
  const [filter, setFilter] = usePersistentState4("elowen.timeline.filter", "all", ["all", "task", "mission", "signal", "review"]);
  const [view, setView] = usePersistentState4("elowen.timeline.view", "axis", ["axis", "lanes"]);
  const [rangeRaw, setRangeRaw] = usePersistentState4("elowen.timeline.range", serializeRange3(DEFAULT_RANGE2), isStoredRange3);
  const range = (0, import_react21.useMemo)(() => parseRange3(rangeRaw) ?? DEFAULT_RANGE2, [rangeRaw]);
  const [picked, setPicked] = (0, import_react21.useState)(null);
  const type = filter === "all" ? void 0 : filter;
  const q = useActivity(type);
  const tasks = useTasks7();
  const { byId, byAgent } = (0, import_react21.useMemo)(() => {
    const byId2 = /* @__PURE__ */ new Map();
    const byAgent2 = /* @__PURE__ */ new Map();
    for (const task of tasks.data ?? []) {
      byId2.set(task.id, task);
      const agent = task.labels?.find((l) => l.startsWith("agent:"))?.slice("agent:".length);
      if (agent) byAgent2.set(agent, task);
    }
    return { byId: byId2, byAgent: byAgent2 };
  }, [tasks.data]);
  const byLabel = (0, import_react21.useMemo)(() => {
    const m = /* @__PURE__ */ new Map();
    for (const e of q.data ?? []) if (e.label) m.set(e.target, e.label);
    return m;
  }, [q.data]);
  const resolve = (0, import_react21.useMemo)(() => (p) => resolveDisplay(p, byId, byAgent, byLabel), [byId, byAgent, byLabel]);
  const FILTER_OPTIONS = [
    { label: s.tlFilterAll, value: "all" },
    { label: s.tlFilterTasks, value: "task" },
    { label: s.tlFilterMissions, value: "mission" },
    { label: s.tlFilterSignals, value: "signal" },
    { label: s.tlFilterReviews, value: "review" }
  ];
  const rawEvents = (0, import_react21.useMemo)(
    () => (q.data ?? []).flatMap((e) => {
      const ts = parseTs3(e.ts);
      if (ts == null) return [];
      return [{ id: String(e.id), type: e.type, target: e.target, detail: e.detail, timestamp: ts, projectId: e.project_id }];
    }),
    [q.data]
  );
  const filteredEvents = (0, import_react21.useMemo)(
    () => {
      const now = Date.now();
      return rawEvents.filter((e) => inRange3(e.timestamp, range, now) && (selectedProject === "all" || e.projectId === selectedProject));
    },
    [rawEvents, range, selectedProject]
  );
  const windowHours = (0, import_react21.useMemo)(() => {
    if (filteredEvents.length === 0) return 12;
    const earliest = Math.min(...filteredEvents.map((e) => e.timestamp));
    const spanH = (Date.now() - earliest) / 36e5;
    return Math.min(rangeWindowCapHours(range, Date.now()), Math.max(1, Math.ceil(spanH)));
  }, [filteredEvents, range]);
  const windowLabel = windowHours < 36 ? s.tlActivityHours.replace("{n}", String(Math.round(windowHours))) : range.preset === "7d" ? s.tlActivityWeek : s.tlActivityDays.replace("{n}", String(Math.round(windowHours / 24)));
  const { points, ticks } = (0, import_react21.useMemo)(() => plotAxis(filteredEvents, Date.now(), windowHours), [filteredEvents, windowHours]);
  const totals = (0, import_react21.useMemo)(() => {
    const counts = { task: 0, mission: 0, signal: 0, approved: 0, escalated: 0 };
    for (const p of points) {
      if (p.type === "review") p.detail.startsWith("escalated") ? counts.escalated++ : counts.approved++;
      else if (p.type === "task") counts.task++;
      else if (p.type === "mission") counts.mission++;
      else if (p.type === "signal") counts.signal++;
    }
    return counts;
  }, [points]);
  const lanes = (0, import_react21.useMemo)(() => {
    const now = Date.now();
    const byTarget = /* @__PURE__ */ new Map();
    for (const e of filteredEvents) {
      const list = byTarget.get(e.target) ?? [];
      list.push(e);
      byTarget.set(e.target, list);
    }
    return Array.from(byTarget.entries()).map(([target, evs]) => ({ target, points: plotAxis(evs, now, windowHours).points, last: Math.max(...evs.map((e) => e.timestamp)) })).filter((l) => l.points.length > 0).sort((a, b) => b.last - a.last).slice(0, 10);
  }, [filteredEvents, windowHours]);
  const hasData = !q.isLoading && !q.isError && filteredEvents.length > 0;
  const projects = useProjects2();
  const editorEnabled = useEditorPlugin();
  const projectIds = (0, import_react21.useMemo)(() => {
    const all = (projects.data ?? []).map((p) => p.id);
    return selectedProject === "all" ? all : all.filter((id) => id === selectedProject);
  }, [projects.data, selectedProject]);
  const commitsQ = useProjectsCommits(projectIds, windowHours, editorEnabled);
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "@container", children: [
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ModuleHeader3, { title: t.page.timeline, count: filteredEvents.length, icon: Activity }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
      SpatialWorkspaceLayout3,
      {
        hero: {
          eyebrow: s.tlWorkspaceEyebrow,
          title: t.page.timeline,
          count: filteredEvents.length,
          description: s.tlWorkspaceIntro,
          mascotState: q.isLoading ? "saving" : q.isError ? "error" : "idle",
          status: !q.isLoading && !q.isError ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "workspace-status", children: s.tlWorkspaceReady }) : void 0,
          metrics: /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "contents", "data-testid": "timeline-summary", children: [
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(WorkspaceMetric3, { label: s.tlFilterTasks, value: totals.task, icon: Activity }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(WorkspaceMetric3, { label: s.tlFilterMissions, value: totals.mission, icon: Columns3 }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(WorkspaceMetric3, { label: s.tlApproved, value: totals.approved, icon: CircleCheck }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(WorkspaceMetric3, { label: s.tlEscalated, value: totals.escalated, icon: TriangleAlert })
          ] })
        },
        navigation: { sections: [{ id: "axis", label: s.tlAxis, icon: Activity }, { id: "lanes", label: s.tlLanes, icon: Columns3 }], value: view, onChange: setView, ariaLabel: t.page.timeline },
        children: /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)(ControlSurfaceDocument3, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)(ControlSurfaceToolbar3, { className: "flex-wrap", children: [
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "min-w-0 flex-1", children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(Segmented4, { size: "sm", options: FILTER_OPTIONS, value: filter, onChange: setFilter }) }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ProjectFilterPills3, { value: selectedProject, onChange: setProject, variant: "dropdown" }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(DateRangeFilter3, { value: range, onChange: (next) => setRangeRaw(serializeRange3(next)), presets: TIMELINE_PRESETS })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)(ControlSurfaceRegister3, { className: "workspace-master-detail timeline-workspace-grid", "data-detail": picked != null, children: [
            /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "min-w-0", children: [
              /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("section", { className: "min-w-0 rounded-lg border border-border/80 px-4 py-4", children: [
                /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "mb-4 flex items-center justify-between gap-2", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-text-muted", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(Clock, { size: 12, className: "shrink-0", "aria-hidden": true }),
                    windowLabel
                  ] }),
                  hasData ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "hidden text-[11px] text-text-muted @sm:inline", children: s.tlMarkerHint }) : null
                ] }),
                q.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ControlSurfaceState3, { children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(LoadingState3, {}) }) : q.isError ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ControlSurfaceState3, { tone: "danger", children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ErrorState3, { message: s.tlLoadError, onRetry: () => q.refetch() }) }) : !hasData ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ControlSurfaceState3, { children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(EmptyState3, { title: s.tlEmpty, description: s.tlEmptyDescription, icon: Activity }) }) : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(MotionPresence3, { mode: "wait", children: view === "lanes" ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(MotionLayoutItem4, { children: /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "flex min-w-0 flex-col", children: [
                  lanes.map((lane) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(Lane, { points: lane.points, ticks, resolve, onPick: setPicked }, lane.target)),
                  /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "relative mt-2 mr-3 ml-[16.25rem] hidden h-4 @3xl:block", children: ticks.map((tick) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "absolute -translate-x-1/2 font-mono text-text-muted", style: { left: `${tick.frac * 100}%`, fontSize: "var(--text-caption)" }, children: tick.label }, tick.label)) })
                ] }) }, "lanes") : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(MotionLayoutItem4, { children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(TimelineTrack, { points, ticks, resolve, onPick: setPicked }) }, "axis") })
              ] }),
              editorEnabled && hasData ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "mt-5", children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ChangesOverTime, { commits: commitsQ.commits, windowStart: Date.now() - windowHours * 36e5, now: Date.now(), multiProject: projectIds.length > 1 }) }) : null
            ] }),
            picked ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(WorkspaceDetailRail2, { label: s.tlDetailTitle, closeLabel: t.common.close, onClose: () => setPicked(null), children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(EventDetail, { point: picked, display: resolve(picked) }) }) : null
          ] })
        ] })
      }
    )
  ] });
}

// plugins/work/web-src/index.tsx
function RootRedirect() {
  (0, import_react22.useEffect)(() => {
    runtime().navigate("/p/work/tasks");
  }, []);
  return null;
}
registerWorkUi({
  requiresApiVersion: 1,
  pages: {
    "": RootRedirect,
    "tasks": TasksView,
    "kanban": KanbanPage,
    "timeline": TimelineView
  }
});
