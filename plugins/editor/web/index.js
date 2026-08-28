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

// node_modules/papaparse/papaparse.min.js
var require_papaparse_min = __commonJS({
  "node_modules/papaparse/papaparse.min.js"(exports, module) {
    ((e, t) => {
      "function" == typeof define && define.amd ? define([], t) : "object" == typeof module && "undefined" != typeof exports ? module.exports = t() : e.Papa = t();
    })(exports, function r() {
      var n = "undefined" != typeof self ? self : "undefined" != typeof window ? window : void 0 !== n ? n : {};
      var s = !n.document && !!n.postMessage, a = n.IS_PAPA_WORKER || false, o = {}, h2 = 0, w = {};
      function P2(e) {
        return 65279 === e.charCodeAt(0) ? e.slice(1) : e;
      }
      function u(e) {
        this._handle = null, this._finished = false, this._completed = false, this._halted = false, this._input = null, this._baseIndex = 0, this._partialLine = "", this._rowCount = 0, this._start = 0, this._nextChunk = null, this.isFirstChunk = true, this._completeResults = { data: [], errors: [], meta: {} }, function(e2) {
          var t = b2(e2);
          t.chunkSize = parseInt(t.chunkSize), e2.step || e2.chunk || (t.chunkSize = null);
          this._handle = new i(t), (this._handle.streamer = this)._config = t;
        }.call(this, e), this.parseChunk = function(t, e2) {
          var i2 = parseInt(this._config.skipFirstNLines) || 0;
          if (this.isFirstChunk && 0 < i2) {
            let e3 = this._config.newline;
            e3 || (r2 = this._config.quoteChar || '"', e3 = this._handle.guessLineEndings(t, r2)), t = [...t.split(e3).slice(i2)].join(e3);
          }
          this.isFirstChunk && U2(this._config.beforeFirstChunk) && void 0 !== (r2 = this._config.beforeFirstChunk(t)) && (t = r2), this.isFirstChunk = false, this._halted = false;
          var i2 = this._partialLine + t, r2 = (this._partialLine = "", this._handle.parse(i2, this._baseIndex, !this._finished));
          if (!this._handle.paused() && !this._handle.aborted()) {
            t = r2.meta.cursor, i2 = (this._finished || (this._partialLine = i2.substring(t - this._baseIndex), this._baseIndex = t), r2 && r2.data && (this._rowCount += r2.data.length), this._finished || this._config.preview && this._rowCount >= this._config.preview);
            if (a) n.postMessage({ results: r2, workerId: w.WORKER_ID, finished: i2 });
            else if (U2(this._config.chunk) && !e2) {
              if (this._config.chunk(r2, this._handle), this._handle.paused() || this._handle.aborted()) return void (this._halted = true);
              this._completeResults = r2 = void 0;
            }
            return this._config.step || this._config.chunk || (this._completeResults.data = this._completeResults.data.concat(r2.data), this._completeResults.errors = this._completeResults.errors.concat(r2.errors), this._completeResults.meta = r2.meta), this._completed || !i2 || !U2(this._config.complete) || r2 && r2.meta.aborted || (this._config.complete(this._completeResults, this._input), this._completed = true), i2 || r2 && r2.meta.paused || this._nextChunk(), r2;
          }
          this._halted = true;
        }, this._sendError = function(e2) {
          U2(this._config.error) ? this._config.error(e2) : a && this._config.error && n.postMessage({ workerId: w.WORKER_ID, error: e2, finished: false });
        };
      }
      function d(e) {
        var r2;
        (e = e || {}).chunkSize || (e.chunkSize = w.RemoteChunkSize), u.call(this, e), this._nextChunk = s ? function() {
          this._readChunk(), this._chunkLoaded();
        } : function() {
          this._readChunk();
        }, this.stream = function(e2) {
          this._input = e2, this._nextChunk();
        }, this._readChunk = function() {
          if (this._finished) this._chunkLoaded();
          else {
            if (r2 = new XMLHttpRequest(), this._config.withCredentials && (r2.withCredentials = this._config.withCredentials), s || (r2.onload = m2(this._chunkLoaded, this), r2.onerror = m2(this._chunkError, this)), r2.open(this._config.downloadRequestBody ? "POST" : "GET", this._input, !s), this._config.downloadRequestHeaders) {
              var e2, t = this._config.downloadRequestHeaders;
              for (e2 in t) r2.setRequestHeader(e2, t[e2]);
            }
            var i2;
            this._config.chunkSize && (i2 = this._start + this._config.chunkSize - 1, r2.setRequestHeader("Range", "bytes=" + this._start + "-" + i2));
            try {
              r2.send(this._config.downloadRequestBody);
            } catch (e3) {
              this._chunkError(e3.message);
            }
            s && 0 === r2.status && this._chunkError();
          }
        }, this._chunkLoaded = function() {
          4 === r2.readyState && (r2.status < 200 || 400 <= r2.status ? this._chunkError() : (this._start += this._config.chunkSize || r2.responseText.length, this._finished = !this._config.chunkSize || this._start >= ((e2) => null !== (e2 = e2.getResponseHeader("Content-Range")) ? parseInt(e2.substring(e2.lastIndexOf("/") + 1)) : -1)(r2), this.parseChunk(r2.responseText)));
        }, this._chunkError = function(e2) {
          e2 = r2.statusText || e2;
          this._sendError(new Error(e2));
        };
      }
      function l4(e) {
        (e = e || {}).chunkSize || (e.chunkSize = w.LocalChunkSize), u.call(this, e);
        var i2, r2, n2 = "undefined" != typeof FileReader;
        this.stream = function(e2) {
          this._input = e2, r2 = e2.slice || e2.webkitSlice || e2.mozSlice, n2 ? ((i2 = new FileReader()).onload = m2(this._chunkLoaded, this), i2.onerror = m2(this._chunkError, this)) : i2 = new FileReaderSync(), this._nextChunk();
        }, this._nextChunk = function() {
          this._finished || this._config.preview && !(this._rowCount < this._config.preview) || this._readChunk();
        }, this._readChunk = function() {
          var e2 = this._input, t = (this._config.chunkSize && (t = Math.min(this._start + this._config.chunkSize, this._input.size), e2 = r2.call(e2, this._start, t)), i2.readAsText(e2, this._config.encoding));
          n2 || this._chunkLoaded({ target: { result: t } });
        }, this._chunkLoaded = function(e2) {
          this._start += this._config.chunkSize, this._finished = !this._config.chunkSize || this._start >= this._input.size, this.parseChunk(e2.target.result);
        }, this._chunkError = function() {
          this._sendError(i2.error);
        };
      }
      function f2(e) {
        var i2;
        u.call(this, e = e || {}), this.stream = function(e2) {
          return i2 = e2, this._nextChunk();
        }, this._nextChunk = function() {
          var e2, t;
          if (!this._finished) return e2 = this._config.chunkSize, i2 = e2 ? (t = i2.substring(0, e2), i2.substring(e2)) : (t = i2, ""), this._finished = !i2, this.parseChunk(t);
        };
      }
      function c(e) {
        u.call(this, e = e || {});
        var t = [], i2 = true, r2 = false;
        this.pause = function() {
          u.prototype.pause.apply(this, arguments), this._input.pause();
        }, this.resume = function() {
          u.prototype.resume.apply(this, arguments), this._input.resume();
        }, this.stream = function(e2) {
          this._input = e2, this._input.on("data", this._streamData), this._input.on("end", this._streamEnd), this._input.on("error", this._streamError);
        }, this._checkIsFinished = function() {
          r2 && 1 === t.length && (this._finished = true);
        }, this._nextChunk = function() {
          this._checkIsFinished(), t.length ? this.parseChunk(t.shift()) : i2 = true;
        }, this._streamData = m2(function(e2) {
          try {
            t.push("string" == typeof e2 ? e2 : e2.toString(this._config.encoding)), i2 && (i2 = false, this._checkIsFinished(), this.parseChunk(t.shift()));
          } catch (e3) {
            this._streamError(e3);
          }
        }, this), this._streamError = m2(function(e2) {
          this._streamCleanUp(), this._sendError(e2);
        }, this), this._streamEnd = m2(function() {
          this._streamCleanUp(), r2 = true, this._streamData("");
        }, this), this._streamCleanUp = m2(function() {
          this._input.removeListener("data", this._streamData), this._input.removeListener("end", this._streamEnd), this._input.removeListener("error", this._streamError);
        }, this);
      }
      function i(m3) {
        var n2, s2, a2, t, o2 = Math.pow(2, 53), h3 = -o2, u2 = /^\s*-?(\d+\.?|\.\d+|\d+\.\d+)([eE][-+]?\d+)?\s*$/, d2 = /^((\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z)))$/, i2 = this, r2 = 0, l5 = 0, f3 = false, e = false, c2 = [], p2 = { data: [], errors: [], meta: {} };
        function y2(e2) {
          return "greedy" === m3.skipEmptyLines ? "" === e2.join("").trim() : 1 === e2.length && 0 === e2[0].length;
        }
        function _4() {
          if (p2 && a2 && (k3("Delimiter", "UndetectableDelimiter", "Unable to auto-detect delimiting character; defaulted to '" + w.DefaultDelimiter + "'"), a2 = false), m3.skipEmptyLines && (p2.data = p2.data.filter(function(e3) {
            return !y2(e3);
          })), g2()) {
            let t3 = function(e3, t4) {
              e3 = P2(e3), U2(m3.transformHeader) && (e3 = m3.transformHeader(e3, t4)), c2.push(e3);
            };
            var t2 = t3;
            if (p2) if (Array.isArray(p2.data[0])) {
              for (var e2 = 0; g2() && e2 < p2.data.length; e2++) p2.data[e2].forEach(t3);
              p2.data.splice(0, 1);
            } else p2.data.forEach(t3);
          }
          function i3(e3, t3) {
            for (var i4 = m3.header ? {} : [], r4 = 0; r4 < e3.length; r4++) {
              var n3 = r4, s3 = e3[r4], s3 = ((e4, t4) => ((e5) => (m3.dynamicTypingFunction && void 0 === m3.dynamicTyping[e5] && (m3.dynamicTyping[e5] = m3.dynamicTypingFunction(e5)), true === (m3.dynamicTyping[e5] || m3.dynamicTyping)))(e4) ? "true" === t4 || "TRUE" === t4 || "false" !== t4 && "FALSE" !== t4 && (((e5) => {
                if (u2.test(e5)) {
                  e5 = parseFloat(e5);
                  if (h3 < e5 && e5 < o2) return 1;
                }
              })(t4) ? parseFloat(t4) : d2.test(t4) ? new Date(t4) : "" === t4 ? null : t4) : t4)(n3 = m3.header ? r4 >= c2.length ? "__parsed_extra" : c2[r4] : n3, s3 = m3.transform ? m3.transform(s3, n3) : s3);
              "__parsed_extra" === n3 ? (i4[n3] = i4[n3] || [], i4[n3].push(s3)) : i4[n3] = s3;
            }
            return m3.header && (r4 > c2.length ? k3("FieldMismatch", "TooManyFields", "Too many fields: expected " + c2.length + " fields but parsed " + r4, l5 + t3) : r4 < c2.length && k3("FieldMismatch", "TooFewFields", "Too few fields: expected " + c2.length + " fields but parsed " + r4, l5 + t3)), i4;
          }
          var r3;
          p2 && (m3.header || m3.dynamicTyping || m3.transform) && (r3 = 1, !p2.data.length || Array.isArray(p2.data[0]) ? (p2.data = p2.data.map(i3), r3 = p2.data.length) : p2.data = i3(p2.data, 0), m3.header && p2.meta && (p2.meta.fields = c2), l5 += r3);
        }
        function g2() {
          return m3.header && 0 === c2.length;
        }
        function k3(e2, t2, i3, r3) {
          e2 = { type: e2, code: t2, message: i3 };
          void 0 !== r3 && (e2.row = r3), p2.errors.push(e2);
        }
        U2(m3.step) && (t = m3.step, m3.step = function(e2) {
          p2 = e2, g2() ? _4() : (_4(), 0 !== p2.data.length && (r2 += e2.data.length, m3.preview && r2 > m3.preview ? s2.abort() : (p2.data = p2.data[0], t(p2, i2))));
        }), this.parse = function(e2, t2, i3) {
          var r3 = m3.quoteChar || '"', r3 = (m3.newline || (m3.newline = this.guessLineEndings(e2, r3)), a2 = false, m3.delimiter ? U2(m3.delimiter) && (m3.delimiter = m3.delimiter(e2), p2.meta.delimiter = m3.delimiter) : ((r3 = ((e3, t3, i4, r4, n3) => {
            var s3, a3, o3, h4;
            n3 = n3 || [",", "	", "|", ";", w.RECORD_SEP, w.UNIT_SEP];
            for (var u3 = 0; u3 < n3.length; u3++) {
              for (var d3, l6 = n3[u3], f4 = 0, c3 = 0, p3 = 0, _5 = (o3 = void 0, new E2({ comments: r4, delimiter: l6, newline: t3, preview: 10 }).parse(e3)), g3 = 0; g3 < _5.data.length; g3++) i4 && y2(_5.data[g3]) ? p3++ : (d3 = _5.data[g3].length, c3 += d3, void 0 === o3 ? o3 = d3 : 0 < d3 && (f4 += Math.abs(d3 - o3), o3 = d3));
              0 < _5.data.length && (c3 /= _5.data.length - p3), 1.99 < c3 && (void 0 === a3 || f4 < a3 || f4 === a3 && h4 < c3) && (a3 = f4, s3 = l6, h4 = c3);
            }
            return { successful: !!(m3.delimiter = s3), bestDelimiter: s3 };
          })(e2, m3.newline, m3.skipEmptyLines, m3.comments, m3.delimitersToGuess)).successful ? m3.delimiter = r3.bestDelimiter : (a2 = true, m3.delimiter = w.DefaultDelimiter), p2.meta.delimiter = m3.delimiter), b2(m3));
          return m3.preview && m3.header && r3.preview++, n2 = e2, s2 = new E2(r3), p2 = s2.parse(n2, t2, i3), _4(), f3 ? { meta: { paused: true } } : p2 || { meta: { paused: false } };
        }, this.paused = function() {
          return f3;
        }, this.pause = function() {
          f3 = true, s2.abort(), n2 = U2(m3.chunk) ? "" : n2.substring(s2.getCharIndex());
        }, this.resume = function() {
          i2.streamer._halted ? (f3 = false, i2.streamer.parseChunk(n2, true)) : setTimeout(i2.resume, 3);
        }, this.aborted = function() {
          return e;
        }, this.abort = function() {
          e = true, s2.abort(), p2.meta.aborted = true, U2(m3.complete) && m3.complete(p2), n2 = "";
        }, this.guessLineEndings = function(e2, t2) {
          e2 = e2.substring(0, 1048576);
          var t2 = new RegExp(q2(t2) + "([^]*?)" + q2(t2), "gm"), i3 = (e2 = e2.replace(t2, "")).split("\r"), t2 = e2.split("\n"), e2 = 1 < t2.length && t2[0].length < i3[0].length;
          if (1 === i3.length || e2) return "\n";
          for (var r3 = 0, n3 = 0; n3 < i3.length; n3++) "\n" === i3[n3][0] && r3++;
          return r3 >= i3.length / 2 ? "\r\n" : "\r";
        };
      }
      function q2(e) {
        return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      function E2(C3) {
        var S3 = (C3 = C3 || {}).delimiter, O2 = C3.newline, x2 = C3.comments, I2 = C3.step, A2 = C3.preview, T = C3.fastMode, D2 = null, L2 = false, F2 = null == C3.quoteChar ? '"' : C3.quoteChar, z2 = F2;
        if (void 0 !== C3.escapeChar && (z2 = C3.escapeChar), ("string" != typeof S3 || -1 < w.BAD_DELIMITERS.indexOf(S3)) && (S3 = ","), x2 === S3) throw new Error("Comment character same as delimiter");
        true === x2 ? x2 = "#" : ("string" != typeof x2 || -1 < w.BAD_DELIMITERS.indexOf(x2)) && (x2 = false), "\n" !== O2 && "\r" !== O2 && "\r\n" !== O2 && (O2 = "\n");
        var M = 0, j2 = false;
        this.parse = function(i2, t, r2) {
          if ("string" != typeof i2) throw new Error("Input must be a string");
          var n2 = i2.length, e = S3.length, s2 = O2.length, a2 = x2.length, o2 = U2(I2), h3 = [], u2 = [], d2 = [], l5 = M = 0;
          if (!i2) return v3();
          if (T || false !== T && -1 === i2.indexOf(F2)) {
            for (var f3 = i2.split(O2), c2 = 0; c2 < f3.length; c2++) {
              if (d2 = f3[c2], M += d2.length, c2 !== f3.length - 1) M += O2.length;
              else if (r2) return v3();
              if (!x2 || d2.substring(0, a2) !== x2) {
                if (o2) {
                  if (h3 = [], k3(d2.split(S3)), R2(), j2) return v3();
                } else k3(d2.split(S3));
                if (A2 && A2 <= c2) return h3 = h3.slice(0, A2), v3(true);
              }
            }
            return v3();
          }
          for (var p2 = i2.indexOf(S3, M), _4 = i2.indexOf(O2, M), g2 = new RegExp(q2(z2) + q2(F2), "g"), m3 = i2.indexOf(F2, M); ; ) if (i2[M] === F2) for (m3 = M, M++; ; ) {
            if (-1 === (m3 = i2.indexOf(F2, m3 + 1))) return r2 || u2.push({ type: "Quotes", code: "MissingQuotes", message: "Quoted field unterminated", row: h3.length, index: M }), E3();
            if (m3 === n2 - 1) return E3(i2.substring(M, m3).replace(g2, F2));
            if (F2 === z2 && i2[m3 + 1] === z2) m3++;
            else if (F2 === z2 || 0 === m3 || i2[m3 - 1] !== z2) {
              -1 !== p2 && p2 < m3 + 1 && (p2 = i2.indexOf(S3, m3 + 1));
              var y2 = w2(-1 === (_4 = -1 !== _4 && _4 < m3 + 1 ? i2.indexOf(O2, m3 + 1) : _4) ? p2 : Math.min(p2, _4));
              if (i2.substr(m3 + 1 + y2, e) === S3) {
                d2.push(i2.substring(M, m3).replace(g2, F2)), i2[M = m3 + 1 + y2 + e] !== F2 && (m3 = i2.indexOf(F2, M)), p2 = i2.indexOf(S3, M), _4 = i2.indexOf(O2, M);
                break;
              }
              y2 = w2(_4);
              if (i2.substring(m3 + 1 + y2, m3 + 1 + y2 + s2) === O2) {
                if (d2.push(i2.substring(M, m3).replace(g2, F2)), b3(m3 + 1 + y2 + s2), p2 = i2.indexOf(S3, M), m3 = i2.indexOf(F2, M), o2 && (R2(), j2)) return v3();
                if (A2 && h3.length >= A2) return v3(true);
                break;
              }
              u2.push({ type: "Quotes", code: "InvalidQuotes", message: "Trailing quote on quoted field is malformed", row: h3.length, index: M }), m3++;
            }
          }
          else if (x2 && 0 === d2.length && i2.substring(M, M + a2) === x2) {
            if (-1 === _4) return v3();
            M = _4 + s2, _4 = i2.indexOf(O2, M), p2 = i2.indexOf(S3, M);
          } else if (-1 !== p2 && (p2 < _4 || -1 === _4)) d2.push(i2.substring(M, p2)), M = p2 + e, p2 = i2.indexOf(S3, M);
          else {
            if (-1 === _4) break;
            if (d2.push(i2.substring(M, _4)), b3(_4 + s2), o2 && (R2(), j2)) return v3();
            if (A2 && h3.length >= A2) return v3(true);
          }
          return E3();
          function k3(e2) {
            h3.push(e2), l5 = M;
          }
          function w2(e2) {
            var t2 = 0;
            return t2 = -1 !== e2 && (e2 = i2.substring(m3 + 1, e2)) && "" === e2.trim() ? e2.length : t2;
          }
          function E3(e2) {
            return r2 || (void 0 === e2 && (e2 = i2.substring(M)), d2.push(e2), M = n2, k3(d2), o2 && R2()), v3();
          }
          function b3(e2) {
            M = e2, k3(d2), d2 = [], _4 = i2.indexOf(O2, M);
          }
          function v3(e2) {
            if (C3.header && !t && h3.length && !L2) {
              var s3 = h3[0], a3 = /* @__PURE__ */ Object.create(null), o3 = new Set(s3);
              let n3 = false;
              for (let r3 = 0; r3 < s3.length; r3++) {
                let i3 = P2(s3[r3]);
                if (a3[i3 = U2(C3.transformHeader) ? C3.transformHeader(i3, r3) : i3]) {
                  let e3, t2 = a3[i3];
                  for (; e3 = i3 + "_" + t2, t2++, o3.has(e3); ) ;
                  o3.add(e3), s3[r3] = e3, a3[i3]++, n3 = true, (D2 = null === D2 ? {} : D2)[e3] = i3;
                } else a3[i3] = 1, s3[r3] = i3;
                o3.add(i3);
              }
              n3 && console.warn("Duplicate headers found and renamed."), L2 = true;
            }
            return { data: h3, errors: u2, meta: { delimiter: S3, linebreak: O2, aborted: j2, truncated: !!e2, cursor: l5 + (t || 0), renamedHeaders: D2 } };
          }
          function R2() {
            I2(v3()), h3 = [], u2 = [];
          }
        }, this.abort = function() {
          j2 = true;
        }, this.getCharIndex = function() {
          return M;
        };
      }
      function p(e) {
        var t = e.data, i2 = o[t.workerId], r2 = false;
        if (t.error) i2.userError(t.error, t.file);
        else if (t.results && t.results.data) {
          var n2 = { abort: function() {
            r2 = true, _3(t.workerId, { data: [], errors: [], meta: { aborted: true } });
          }, pause: g, resume: g };
          if (U2(i2.userStep)) {
            for (var s2 = 0; s2 < t.results.data.length && (i2.userStep({ data: t.results.data[s2], errors: t.results.errors, meta: t.results.meta }, n2), !r2); s2++) ;
            delete t.results;
          } else U2(i2.userChunk) && (i2.userChunk(t.results, n2, t.file), delete t.results);
        }
        t.finished && !r2 && _3(t.workerId, t.results);
      }
      function _3(e, t) {
        var i2 = o[e];
        U2(i2.userComplete) && i2.userComplete(t), i2.terminate(), delete o[e];
      }
      function g() {
        throw new Error("Not implemented.");
      }
      function b2(e) {
        if ("object" != typeof e || null === e) return e;
        var t, i2 = Array.isArray(e) ? [] : {};
        for (t in e) i2[t] = b2(e[t]);
        return i2;
      }
      function m2(e, t) {
        return function() {
          e.apply(t, arguments);
        };
      }
      function U2(e) {
        return "function" == typeof e;
      }
      return w.parse = function(e, t) {
        var i2 = (t = t || {}).dynamicTyping || false;
        U2(i2) && (t.dynamicTypingFunction = i2, i2 = {});
        if (t.dynamicTyping = i2, t.transform = !!U2(t.transform) && t.transform, !t.worker || !w.WORKERS_SUPPORTED) return i2 = null, w.NODE_STREAM_INPUT, "string" == typeof e ? (e = P2(e), i2 = new (t.download ? d : f2)(t)) : true === e.readable && U2(e.read) && U2(e.on) ? i2 = new c(t) : (n.File && e instanceof File || e instanceof Object) && (i2 = new l4(t)), i2.stream(e);
        (i2 = (() => {
          var e2;
          return !!w.WORKERS_SUPPORTED && (e2 = (() => {
            var e3 = n.URL || n.webkitURL || null, t2 = r.toString();
            return w.BLOB_URL || (w.BLOB_URL = e3.createObjectURL(new Blob(["var global = (function() { if (typeof self !== 'undefined') { return self; } if (typeof window !== 'undefined') { return window; } if (typeof global !== 'undefined') { return global; } return {}; })(); global.IS_PAPA_WORKER=true; ", "(", t2, ")();"], { type: "text/javascript" })));
          })(), (e2 = new n.Worker(e2)).onmessage = p, e2.id = h2++, o[e2.id] = e2);
        })()).userStep = t.step, i2.userChunk = t.chunk, i2.userComplete = t.complete, i2.userError = t.error, t.step = U2(t.step), t.chunk = U2(t.chunk), t.complete = U2(t.complete), t.error = U2(t.error), delete t.worker, i2.postMessage({ input: e, config: t, workerId: i2.id });
      }, w.unparse = function(e, t) {
        var s2 = false, g2 = true, m3 = ",", y2 = "\r\n", a2 = '"', o2 = a2 + a2, i2 = false, r2 = null, h3 = false, u2 = ((() => {
          if ("object" == typeof t) {
            if ("string" != typeof t.delimiter || w.BAD_DELIMITERS.filter(function(e2) {
              return -1 !== t.delimiter.indexOf(e2);
            }).length || (m3 = t.delimiter), "boolean" != typeof t.quotes && "function" != typeof t.quotes && !Array.isArray(t.quotes) || (s2 = t.quotes), "boolean" != typeof t.skipEmptyLines && "string" != typeof t.skipEmptyLines || (i2 = t.skipEmptyLines), "string" == typeof t.newline && (y2 = t.newline), "string" == typeof t.quoteChar && (a2 = t.quoteChar, o2 = a2 + a2), "boolean" == typeof t.header && (g2 = t.header), Array.isArray(t.columns)) {
              if (0 === t.columns.length) throw new Error("Option columns is empty");
              r2 = t.columns;
            }
            void 0 !== t.escapeChar && (o2 = t.escapeChar + a2), t.escapeFormulae instanceof RegExp ? h3 = t.escapeFormulae : "boolean" == typeof t.escapeFormulae && t.escapeFormulae && (h3 = /^[=+\-@\t\r].*$/);
          }
        })(), new RegExp(q2(a2), "g"));
        "string" == typeof e && (e = JSON.parse(e));
        if (Array.isArray(e)) {
          if (!e.length || Array.isArray(e[0])) return n2(null, e, i2);
          if ("object" == typeof e[0]) return n2(r2 || Object.keys(e[0]), e, i2);
        } else if ("object" == typeof e) return "string" == typeof e.data && (e.data = JSON.parse(e.data)), Array.isArray(e.data) && (e.fields || (e.fields = e.meta && e.meta.fields || r2), e.fields || (e.fields = Array.isArray(e.data[0]) ? e.fields : "object" == typeof e.data[0] ? Object.keys(e.data[0]) : []), Array.isArray(e.data[0]) || "object" == typeof e.data[0] || (e.data = [e.data])), n2(e.fields || [], e.data || [], i2);
        throw new Error("Unable to serialize unrecognized input");
        function n2(e2, t2, i3) {
          var r3 = "", n3 = ("string" == typeof e2 && (e2 = JSON.parse(e2)), "string" == typeof t2 && (t2 = JSON.parse(t2)), Array.isArray(e2) && 0 < e2.length), s3 = !Array.isArray(t2[0]);
          if (n3 && g2) {
            for (var a3 = 0; a3 < e2.length; a3++) 0 < a3 && (r3 += m3), r3 += k3(e2[a3], a3);
            0 < t2.length && (r3 += y2);
          }
          for (var o3 = 0; o3 < t2.length; o3++) {
            var h4 = (n3 ? e2 : t2[o3]).length, u3 = false, d2 = n3 ? 0 === Object.keys(t2[o3]).length : 0 === t2[o3].length;
            if (i3 && !n3 && (u3 = "greedy" === i3 ? "" === t2[o3].join("").trim() : 1 === t2[o3].length && 0 === t2[o3][0].length), "greedy" === i3 && n3) {
              for (var l5 = [], f3 = 0; f3 < h4; f3++) {
                var c2 = s3 ? e2[f3] : f3;
                l5.push(t2[o3][c2]);
              }
              u3 = "" === l5.join("").trim();
            }
            if (!u3) {
              for (var p2 = 0; p2 < h4; p2++) {
                0 < p2 && !d2 && (r3 += m3);
                var _4 = n3 && s3 ? e2[p2] : p2;
                r3 += k3(t2[o3][_4], p2);
              }
              o3 < t2.length - 1 && (!i3 || 0 < h4 && !d2) && (r3 += y2);
            }
          }
          return r3;
        }
        function k3(e2, t2) {
          var i3, r3, n3;
          return null == e2 ? "" : e2.constructor === Date ? isNaN(e2.getTime()) ? "" : e2.toISOString() : (n3 = false, h3 && "string" == typeof e2 && h3.test(e2) && (e2 = "'" + e2, n3 = true), r3 = (i3 = e2.toString()).replace(u2, o2), (n3 = n3 || true === s2 || "function" == typeof s2 && s2(e2, t2) || Array.isArray(s2) && s2[t2] || ((e3, t3) => {
            for (var i4 = 0; i4 < t3.length; i4++) if (-1 < e3.indexOf(t3[i4])) return true;
            return false;
          })(r3, w.BAD_DELIMITERS) || -1 < r3.indexOf(m3) || -1 < i3.indexOf(a2) || " " === r3.charAt(0) || " " === r3.charAt(r3.length - 1)) ? a2 + r3 + a2 : r3);
        }
      }, w.RECORD_SEP = String.fromCharCode(30), w.UNIT_SEP = String.fromCharCode(31), w.BYTE_ORDER_MARK = "\uFEFF", w.BAD_DELIMITERS = ["\r", "\n", '"', w.BYTE_ORDER_MARK], w.WORKERS_SUPPORTED = !s && !!n.Worker, w.NODE_STREAM_INPUT = 1, w.LocalChunkSize = 10485760, w.RemoteChunkSize = 5242880, w.DefaultDelimiter = ",", w.Parser = E2, w.ParserHandle = i, w.NetworkStreamer = d, w.FileStreamer = l4, w.StringStreamer = f2, w.ReadableStreamStreamer = c, a && (n.onmessage = function(e) {
        e = e.data;
        void 0 === w.WORKER_ID && e && (w.WORKER_ID = e.workerId);
        "string" == typeof e.input ? n.postMessage({ workerId: w.WORKER_ID, results: w.parse(e.input, e.config), finished: true }) : (n.File && e.input instanceof File || e.input instanceof Object) && (e = w.parse(e.input, e.config)) && n.postMessage({ workerId: w.WORKER_ID, results: e, finished: true });
      }), (d.prototype = Object.create(u.prototype)).constructor = d, (l4.prototype = Object.create(u.prototype)).constructor = l4, (f2.prototype = Object.create(f2.prototype)).constructor = f2, (c.prototype = Object.create(u.prototype)).constructor = c, w;
    });
  }
});

// plugins/editor/web-src/runtime.tsx
function runtime() {
  const value = window.ElowenUiRuntime;
  if (!value) throw new Error("ElowenUiRuntime is not installed");
  return value;
}
function registerEditorUi(registration) {
  window.__elowenRegisterPluginUi?.("editor", registration);
}

// plugins/editor/web-src/EditorPage.tsx
var import_react22 = __toESM(require_react(), 1);

// node_modules/lucide-react/dist/esm/createLucideIcon.js
var import_react2 = __toESM(require_react());

// node_modules/lucide-react/dist/esm/shared/src/utils.js
var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
var mergeClasses = (...classes) => classes.filter((className, index2, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index2;
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

// node_modules/lucide-react/dist/esm/icons/align-left.js
var AlignLeft = createLucideIcon("AlignLeft", [
  ["path", { d: "M15 12H3", key: "6jk70r" }],
  ["path", { d: "M17 18H3", key: "1amg6g" }],
  ["path", { d: "M21 6H3", key: "1jwq7v" }]
]);

// node_modules/lucide-react/dist/esm/icons/check.js
var Check = createLucideIcon("Check", [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]]);

// node_modules/lucide-react/dist/esm/icons/chevron-right.js
var ChevronRight = createLucideIcon("ChevronRight", [
  ["path", { d: "m9 18 6-6-6-6", key: "mthhwq" }]
]);

// node_modules/lucide-react/dist/esm/icons/circle.js
var Circle = createLucideIcon("Circle", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }]
]);

// node_modules/lucide-react/dist/esm/icons/clipboard-copy.js
var ClipboardCopy = createLucideIcon("ClipboardCopy", [
  ["rect", { width: "8", height: "4", x: "8", y: "2", rx: "1", ry: "1", key: "tgr4d6" }],
  ["path", { d: "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2", key: "4jdomd" }],
  ["path", { d: "M16 4h2a2 2 0 0 1 2 2v4", key: "3hqy98" }],
  ["path", { d: "M21 14H11", key: "1bme5i" }],
  ["path", { d: "m15 10-4 4 4 4", key: "5dvupr" }]
]);

// node_modules/lucide-react/dist/esm/icons/code-xml.js
var CodeXml = createLucideIcon("CodeXml", [
  ["path", { d: "m18 16 4-4-4-4", key: "1inbqp" }],
  ["path", { d: "m6 8-4 4 4 4", key: "15zrgr" }],
  ["path", { d: "m14.5 4-5 16", key: "e7oirm" }]
]);

// node_modules/lucide-react/dist/esm/icons/copy.js
var Copy = createLucideIcon("Copy", [
  ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2", key: "17jyea" }],
  ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2", key: "zix9uf" }]
]);

// node_modules/lucide-react/dist/esm/icons/download.js
var Download = createLucideIcon("Download", [
  ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", key: "ih7n3h" }],
  ["polyline", { points: "7 10 12 15 17 10", key: "2ggqvy" }],
  ["line", { x1: "12", x2: "12", y1: "15", y2: "3", key: "1vk2je" }]
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

// node_modules/lucide-react/dist/esm/icons/file-plus.js
var FilePlus = createLucideIcon("FilePlus", [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["path", { d: "M9 15h6", key: "cctwl0" }],
  ["path", { d: "M12 18v-6", key: "17g6i2" }]
]);

// node_modules/lucide-react/dist/esm/icons/file.js
var File2 = createLucideIcon("File", [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }]
]);

// node_modules/lucide-react/dist/esm/icons/folder-open.js
var FolderOpen = createLucideIcon("FolderOpen", [
  [
    "path",
    {
      d: "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
      key: "usdka0"
    }
  ]
]);

// node_modules/lucide-react/dist/esm/icons/folder-plus.js
var FolderPlus = createLucideIcon("FolderPlus", [
  ["path", { d: "M12 10v6", key: "1bos4e" }],
  ["path", { d: "M9 13h6", key: "1uhe8q" }],
  [
    "path",
    {
      d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
      key: "1kt360"
    }
  ]
]);

// node_modules/lucide-react/dist/esm/icons/folder.js
var Folder = createLucideIcon("Folder", [
  [
    "path",
    {
      d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
      key: "1kt360"
    }
  ]
]);

// node_modules/lucide-react/dist/esm/icons/git-compare.js
var GitCompare = createLucideIcon("GitCompare", [
  ["circle", { cx: "18", cy: "18", r: "3", key: "1xkwt0" }],
  ["circle", { cx: "6", cy: "6", r: "3", key: "1lh9wr" }],
  ["path", { d: "M13 6h3a2 2 0 0 1 2 2v7", key: "1yeb86" }],
  ["path", { d: "M11 18H8a2 2 0 0 1-2-2V9", key: "19pyzm" }]
]);

// node_modules/lucide-react/dist/esm/icons/map.js
var Map2 = createLucideIcon("Map", [
  [
    "path",
    {
      d: "M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z",
      key: "169xi5"
    }
  ],
  ["path", { d: "M15 5.764v15", key: "1pn4in" }],
  ["path", { d: "M9 3.236v15", key: "1uimfh" }]
]);

// node_modules/lucide-react/dist/esm/icons/maximize-2.js
var Maximize2 = createLucideIcon("Maximize2", [
  ["polyline", { points: "15 3 21 3 21 9", key: "mznyad" }],
  ["polyline", { points: "9 21 3 21 3 15", key: "1avn1i" }],
  ["line", { x1: "21", x2: "14", y1: "3", y2: "10", key: "ota7mn" }],
  ["line", { x1: "3", x2: "10", y1: "21", y2: "14", key: "1atl0r" }]
]);

// node_modules/lucide-react/dist/esm/icons/minimize-2.js
var Minimize2 = createLucideIcon("Minimize2", [
  ["polyline", { points: "4 14 10 14 10 20", key: "11kfnr" }],
  ["polyline", { points: "20 10 14 10 14 4", key: "rlmsce" }],
  ["line", { x1: "14", x2: "21", y1: "10", y2: "3", key: "o5lafz" }],
  ["line", { x1: "3", x2: "10", y1: "21", y2: "14", key: "1atl0r" }]
]);

// node_modules/lucide-react/dist/esm/icons/panel-left.js
var PanelLeft = createLucideIcon("PanelLeft", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M9 3v18", key: "fh3hqa" }]
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

// node_modules/lucide-react/dist/esm/icons/save.js
var Save = createLucideIcon("Save", [
  [
    "path",
    {
      d: "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
      key: "1c8476"
    }
  ],
  ["path", { d: "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7", key: "1ydtos" }],
  ["path", { d: "M7 3v4a1 1 0 0 0 1 1h7", key: "t51u73" }]
]);

// node_modules/lucide-react/dist/esm/icons/trash-2.js
var Trash2 = createLucideIcon("Trash2", [
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", key: "4alrt4" }],
  ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", key: "v07s0e" }],
  ["line", { x1: "10", x2: "10", y1: "11", y2: "17", key: "1uufr5" }],
  ["line", { x1: "14", x2: "14", y1: "11", y2: "17", key: "xtxkd" }]
]);

// node_modules/lucide-react/dist/esm/icons/type.js
var Type = createLucideIcon("Type", [
  ["polyline", { points: "4 7 4 4 20 4 20 7", key: "1nosan" }],
  ["line", { x1: "9", x2: "15", y1: "20", y2: "20", key: "swin9y" }],
  ["line", { x1: "12", x2: "12", y1: "4", y2: "20", key: "1tx1rr" }]
]);

// node_modules/lucide-react/dist/esm/icons/upload.js
var Upload = createLucideIcon("Upload", [
  ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", key: "ih7n3h" }],
  ["polyline", { points: "17 8 12 3 7 8", key: "t8dd8p" }],
  ["line", { x1: "12", x2: "12", y1: "3", y2: "15", key: "widbto" }]
]);

// node_modules/lucide-react/dist/esm/icons/wrap-text.js
var WrapText = createLucideIcon("WrapText", [
  ["line", { x1: "3", x2: "21", y1: "6", y2: "6", key: "4m8b97" }],
  ["path", { d: "M3 12h15a3 3 0 1 1 0 6h-4", key: "1cl7v7" }],
  ["polyline", { points: "16 16 14 18 16 20", key: "1jznyi" }],
  ["line", { x1: "3", x2: "10", y1: "18", y2: "18", key: "1h33wv" }]
]);

// node_modules/lucide-react/dist/esm/icons/x.js
var X = createLucideIcon("X", [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
]);

// plugins/editor/web-src/editor/ProjectEditor.tsx
var import_react21 = __toESM(require_react(), 1);

// plugins/editor/src/fileTypes.ts
var MAX_BUFFERED_BYTES = 50 * 1024 * 1024;
var MAX_OFFICE_BYTES = 20 * 1024 * 1024;
var MAX_MEDIA_PREVIEW_BYTES = 50 * 1024 * 1024;
var MAX_UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
var MIME_BY_EXTENSION = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  aac: "audio/aac",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv; charset=utf-8"
};
var IMAGE_EXTENSIONS = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"]);
var VIDEO_EXTENSIONS = /* @__PURE__ */ new Set(["mp4", "webm", "ogv", "mov", "m4v"]);
var AUDIO_EXTENSIONS = /* @__PURE__ */ new Set(["mp3", "wav", "ogg", "oga", "m4a", "flac", "aac"]);
var OFFICE_EXTENSIONS = /* @__PURE__ */ new Set(["docx", "xlsx", "pptx"]);
var TEXT_EXTENSIONS = /* @__PURE__ */ new Set([
  "txt",
  "log",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "jsonc",
  "css",
  "scss",
  "sass",
  "less",
  "html",
  "htm",
  "xml",
  "md",
  "markdown",
  "mdx",
  "py",
  "pyi",
  "sh",
  "bash",
  "zsh",
  "fish",
  "yml",
  "yaml",
  "sql",
  "toml",
  "ini",
  "cfg",
  "conf",
  "env",
  "properties",
  "go",
  "rs",
  "php",
  "java",
  "kt",
  "kts",
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "hpp",
  "cs",
  "fs",
  "fsx",
  "vb",
  "rb",
  "swift",
  "dart",
  "lua",
  "r",
  "pl",
  "pm",
  "ex",
  "exs",
  "erl",
  "hrl",
  "vue",
  "svelte",
  "astro",
  "graphql",
  "gql",
  "proto",
  "dockerfile",
  "gitignore",
  "gitattributes",
  "editorconfig",
  "npmrc",
  "yarnrc",
  "lock",
  "patch",
  "diff",
  "csv",
  "tsv",
  "tex",
  "rst",
  "adoc"
]);
var TEXT_BASENAMES = /* @__PURE__ */ new Set([
  "dockerfile",
  "makefile",
  "gnumakefile",
  "license",
  "licence",
  "readme",
  "changelog",
  "authors",
  "contributors",
  "copying",
  "notice",
  "procfile",
  "gemfile",
  "rakefile",
  "vagrantfile",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".npmrc",
  ".yarnrc",
  ".env"
]);
var baseName = (path) => path.split("/").pop() ?? path;
var extOf = (path) => {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
};
function mimeTypeOf(path) {
  return MIME_BY_EXTENSION[extOf(path)] ?? "application/octet-stream";
}
function fileKindOf(path) {
  const ext = extOf(path);
  const name = baseName(path).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (OFFICE_EXTENSIONS.has(ext)) return "office";
  if (ext === "csv") return "csv";
  if (ext === "md" || ext === "markdown" || ext === "mdx") return "markdown";
  if (TEXT_EXTENSIONS.has(ext) || TEXT_BASENAMES.has(name)) return "text";
  return "binary";
}

// plugins/editor/web-src/editor/helpers.ts
function buildTree(nodes) {
  const root = { name: "", path: "", type: "dir", children: [] };
  const dirs = /* @__PURE__ */ new Map([["", root]]);
  for (const node of [...nodes].sort((a, b2) => a.path.localeCompare(b2.path))) {
    const parts = node.path.split("/");
    const parentPath = parts.slice(0, -1).join("/");
    const treeNode = { name: parts[parts.length - 1] ?? node.path, path: node.path, type: node.type, children: [] };
    (dirs.get(parentPath) ?? root).children.push(treeNode);
    if (node.type === "dir") dirs.set(node.path, treeNode);
  }
  const sort = (tree) => {
    tree.children.sort((a, b2) => a.type === b2.type ? a.name.localeCompare(b2.name) : a.type === "dir" ? -1 : 1);
    tree.children.forEach(sort);
  };
  sort(root);
  return root.children;
}
function langOf(path) {
  const map = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", json: "json", css: "css", scss: "scss", html: "html", md: "markdown", py: "python", sh: "shell", bash: "shell", yml: "yaml", yaml: "yaml", sql: "sql", toml: "ini", env: "ini", go: "go", rs: "rust", php: "php" };
  return map[extOf(path)] ?? "plaintext";
}
var parentDir = (path) => path.split("/").slice(0, -1).join("/");
var joinPath = (dir, name) => dir ? `${dir}/${name}` : name;
function copyName(path) {
  const base = baseName(path);
  const dot = base.lastIndexOf(".");
  return joinPath(parentDir(path), `${dot > 0 ? base.slice(0, dot) : base} copy${dot > 0 ? base.slice(dot) : ""}`);
}

// plugins/editor/web-src/editor/FileTree.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
function TreeRow({ node, depth, expanded, onToggle, selected, onSelect, changed, onContextMenu }) {
  const isOpen = expanded.has(node.path);
  const ctx = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, node);
  };
  if (node.type === "dir") {
    const hasChange = changed.size > 0 && [...changed].some((c) => c.startsWith(node.path + "/"));
    const FolderIcon = isOpen ? FolderOpen : Folder;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { role: "treeitem", "aria-expanded": isOpen, "aria-label": node.name, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", onClick: () => onToggle(node.path), onContextMenu: ctx, className: "overlay-menu-item flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs text-text-muted transition-colors hover:bg-elevated", style: { paddingLeft: depth * 12 + 6 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { size: 11, className: `shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`, "aria-hidden": true }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FolderIcon, { size: 13, className: `shrink-0 ${hasChange ? "text-accent" : "text-text-muted"}`, "aria-hidden": true }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `truncate ${hasChange ? "text-text" : ""}`, children: node.name })
      ] }),
      isOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { role: "group", className: "m-0 list-none p-0", children: node.children.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TreeRow, { node: c, depth: depth + 1, expanded, onToggle, selected, onSelect, changed, onContextMenu }, c.path)) }) : null
    ] });
  }
  const isChanged = changed.has(node.path);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { role: "treeitem", "aria-selected": selected === node.path, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", onClick: () => onSelect(node.path), onContextMenu: ctx, className: `overlay-menu-item flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-elevated ${selected === node.path ? "bg-accent/15 text-accent" : isChanged ? "font-medium text-accent" : "text-text"}`, style: { paddingLeft: depth * 12 + 16 }, title: node.path, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(File2, { size: 12, className: `shrink-0 ${isChanged ? "text-accent" : "text-text-muted"}`, "aria-hidden": true }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "min-w-0 flex-1 truncate", children: node.name }),
    isChanged ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "h-1.5 w-1.5 shrink-0 rounded-full bg-accent", "aria-hidden": true }) : null
  ] }) });
}
function FileTree({ tree, expanded, onToggle, selected, onSelect, changed, onContextMenu, emptyLabel, treeLabel }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "h-full", onContextMenu: (e) => {
    e.preventDefault();
    onContextMenu(e, null);
  }, children: tree.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "p-3 text-center text-xs text-text-muted", children: emptyLabel }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { role: "tree", "aria-label": treeLabel, className: "m-0 list-none p-0", children: tree.map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TreeRow, { node: n, depth: 0, expanded, onToggle, selected, onSelect, changed, onContextMenu }, n.path)) }) });
}

// plugins/editor/web-src/editor/dialogs.tsx
var import_react3 = __toESM(require_react(), 1);
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
var { Modal, ModalBody, ModalFooter, Button, Input, Field } = runtime().components;
var { useTranslation } = runtime().hooks;
function PromptDialog({ title, label, initialValue, confirmLabel, icon, onConfirm, onCancel }) {
  const { t } = useTranslation();
  const [value, setValue] = (0, import_react3.useState)(initialValue);
  const trimmed = value.trim();
  const valid = trimmed.length > 0 && trimmed !== initialValue.trim();
  const submit = () => {
    if (valid) onConfirm(trimmed);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(Modal, { title, onClose: onCancel, size: "sm", icon, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ModalBody, { gap: 4, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field, { label, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      Input,
      {
        value,
        onChange: (e) => setValue(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") submit();
        },
        className: "font-mono text-xs",
        autoFocus: true
      }
    ) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(ModalFooter, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "ghost", onClick: onCancel, children: t.common.cancel }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "accent", onClick: submit, disabled: !valid, children: confirmLabel })
    ] })
  ] });
}
function ConfirmDialog({ title, message, confirmLabel, danger, icon, onConfirm, onCancel }) {
  const { t } = useTranslation();
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(Modal, { title, onClose: onCancel, size: "sm", icon, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ModalBody, { gap: 4, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "text-sm text-text-muted", children: message }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(ModalFooter, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "ghost", onClick: onCancel, children: t.common.cancel }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: danger ? "danger" : "accent", onClick: onConfirm, children: confirmLabel })
    ] })
  ] });
}

// plugins/editor/web-src/editor/EditorPane.tsx
var import_react16 = __toESM(require_react(), 1);

// node_modules/@monaco-editor/loader/lib/es/_virtual/_rollupPluginBabelHelpers.js
function _arrayLikeToArray(r, a) {
  (null == a || a > r.length) && (a = r.length);
  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
  return n;
}
function _arrayWithHoles(r) {
  if (Array.isArray(r)) return r;
}
function _defineProperty(e, r, t) {
  return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
    value: t,
    enumerable: true,
    configurable: true,
    writable: true
  }) : e[r] = t, e;
}
function _iterableToArrayLimit(r, l4) {
  var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
  if (null != t) {
    var e, n, i, u, a = [], f2 = true, o = false;
    try {
      if (i = (t = t.call(r)).next, 0 === l4) ;
      else for (; !(f2 = (e = i.call(t)).done) && (a.push(e.value), a.length !== l4); f2 = true) ;
    } catch (r2) {
      o = true, n = r2;
    } finally {
      try {
        if (!f2 && null != t.return && (u = t.return(), Object(u) !== u)) return;
      } finally {
        if (o) throw n;
      }
    }
    return a;
  }
}
function _nonIterableRest() {
  throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function ownKeys(e, r) {
  var t = Object.keys(e);
  if (Object.getOwnPropertySymbols) {
    var o = Object.getOwnPropertySymbols(e);
    r && (o = o.filter(function(r2) {
      return Object.getOwnPropertyDescriptor(e, r2).enumerable;
    })), t.push.apply(t, o);
  }
  return t;
}
function _objectSpread2(e) {
  for (var r = 1; r < arguments.length; r++) {
    var t = null != arguments[r] ? arguments[r] : {};
    r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
      _defineProperty(e, r2, t[r2]);
    }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
      Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
    });
  }
  return e;
}
function _objectWithoutProperties(e, t) {
  if (null == e) return {};
  var o, r, i = _objectWithoutPropertiesLoose(e, t);
  if (Object.getOwnPropertySymbols) {
    var n = Object.getOwnPropertySymbols(e);
    for (r = 0; r < n.length; r++) o = n[r], -1 === t.indexOf(o) && {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]);
  }
  return i;
}
function _objectWithoutPropertiesLoose(r, e) {
  if (null == r) return {};
  var t = {};
  for (var n in r) if ({}.hasOwnProperty.call(r, n)) {
    if (-1 !== e.indexOf(n)) continue;
    t[n] = r[n];
  }
  return t;
}
function _slicedToArray(r, e) {
  return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
}
function _toPrimitive(t, r) {
  if ("object" != typeof t || !t) return t;
  var e = t[Symbol.toPrimitive];
  if (void 0 !== e) {
    var i = e.call(t, r);
    if ("object" != typeof i) return i;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return ("string" === r ? String : Number)(t);
}
function _toPropertyKey(t) {
  var i = _toPrimitive(t, "string");
  return "symbol" == typeof i ? i : i + "";
}
function _unsupportedIterableToArray(r, a) {
  if (r) {
    if ("string" == typeof r) return _arrayLikeToArray(r, a);
    var t = {}.toString.call(r).slice(8, -1);
    return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
  }
}

// node_modules/state-local/lib/es/state-local.js
function _defineProperty2(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }
  return obj;
}
function ownKeys2(object, enumerableOnly) {
  var keys = Object.keys(object);
  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    if (enumerableOnly) symbols = symbols.filter(function(sym) {
      return Object.getOwnPropertyDescriptor(object, sym).enumerable;
    });
    keys.push.apply(keys, symbols);
  }
  return keys;
}
function _objectSpread22(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i] != null ? arguments[i] : {};
    if (i % 2) {
      ownKeys2(Object(source), true).forEach(function(key) {
        _defineProperty2(target, key, source[key]);
      });
    } else if (Object.getOwnPropertyDescriptors) {
      Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
      ownKeys2(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
  }
  return target;
}
function compose() {
  for (var _len = arguments.length, fns = new Array(_len), _key = 0; _key < _len; _key++) {
    fns[_key] = arguments[_key];
  }
  return function(x2) {
    return fns.reduceRight(function(y2, f2) {
      return f2(y2);
    }, x2);
  };
}
function curry(fn) {
  return function curried() {
    var _this = this;
    for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
      args[_key2] = arguments[_key2];
    }
    return args.length >= fn.length ? fn.apply(this, args) : function() {
      for (var _len3 = arguments.length, nextArgs = new Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
        nextArgs[_key3] = arguments[_key3];
      }
      return curried.apply(_this, [].concat(args, nextArgs));
    };
  };
}
function isObject(value) {
  return {}.toString.call(value).includes("Object");
}
function isEmpty(obj) {
  return !Object.keys(obj).length;
}
function isFunction(value) {
  return typeof value === "function";
}
function hasOwnProperty(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}
function validateChanges(initial, changes) {
  if (!isObject(changes)) errorHandler("changeType");
  if (Object.keys(changes).some(function(field) {
    return !hasOwnProperty(initial, field);
  })) errorHandler("changeField");
  return changes;
}
function validateSelector(selector) {
  if (!isFunction(selector)) errorHandler("selectorType");
}
function validateHandler(handler) {
  if (!(isFunction(handler) || isObject(handler))) errorHandler("handlerType");
  if (isObject(handler) && Object.values(handler).some(function(_handler) {
    return !isFunction(_handler);
  })) errorHandler("handlersType");
}
function validateInitial(initial) {
  if (!initial) errorHandler("initialIsRequired");
  if (!isObject(initial)) errorHandler("initialType");
  if (isEmpty(initial)) errorHandler("initialContent");
}
function throwError(errorMessages3, type) {
  throw new Error(errorMessages3[type] || errorMessages3["default"]);
}
var errorMessages = {
  initialIsRequired: "initial state is required",
  initialType: "initial state should be an object",
  initialContent: "initial state shouldn't be an empty object",
  handlerType: "handler should be an object or a function",
  handlersType: "all handlers should be a functions",
  selectorType: "selector should be a function",
  changeType: "provided value of changes should be an object",
  changeField: 'it seams you want to change a field in the state which is not specified in the "initial" state',
  "default": "an unknown error accured in `state-local` package"
};
var errorHandler = curry(throwError)(errorMessages);
var validators = {
  changes: validateChanges,
  selector: validateSelector,
  handler: validateHandler,
  initial: validateInitial
};
function create(initial) {
  var handler = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
  validators.initial(initial);
  validators.handler(handler);
  var state = {
    current: initial
  };
  var didUpdate = curry(didStateUpdate)(state, handler);
  var update = curry(updateState)(state);
  var validate = curry(validators.changes)(initial);
  var getChanges = curry(extractChanges)(state);
  function getState2() {
    var selector = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : function(state2) {
      return state2;
    };
    validators.selector(selector);
    return selector(state.current);
  }
  function setState2(causedChanges) {
    compose(didUpdate, update, validate, getChanges)(causedChanges);
  }
  return [getState2, setState2];
}
function extractChanges(state, causedChanges) {
  return isFunction(causedChanges) ? causedChanges(state.current) : causedChanges;
}
function updateState(state, changes) {
  state.current = _objectSpread22(_objectSpread22({}, state.current), changes);
  return changes;
}
function didStateUpdate(state, handler, changes) {
  isFunction(handler) ? handler(state.current) : Object.keys(changes).forEach(function(field) {
    var _handler$field;
    return (_handler$field = handler[field]) === null || _handler$field === void 0 ? void 0 : _handler$field.call(handler, state.current[field]);
  });
  return changes;
}
var index = {
  create
};
var state_local_default = index;

// node_modules/@monaco-editor/loader/lib/es/config/index.js
var config = {
  paths: {
    vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs"
  }
};

// node_modules/@monaco-editor/loader/lib/es/utils/curry.js
function curry2(fn) {
  return function curried() {
    var _this = this;
    for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }
    return args.length >= fn.length ? fn.apply(this, args) : function() {
      for (var _len2 = arguments.length, nextArgs = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
        nextArgs[_key2] = arguments[_key2];
      }
      return curried.apply(_this, [].concat(args, nextArgs));
    };
  };
}

// node_modules/@monaco-editor/loader/lib/es/utils/isObject.js
function isObject2(value) {
  return {}.toString.call(value).includes("Object");
}

// node_modules/@monaco-editor/loader/lib/es/validators/index.js
function validateConfig(config3) {
  if (!config3) errorHandler2("configIsRequired");
  if (!isObject2(config3)) errorHandler2("configType");
  if (config3.urls) {
    informAboutDeprecation();
    return {
      paths: {
        vs: config3.urls.monacoBase
      }
    };
  }
  return config3;
}
function informAboutDeprecation() {
  console.warn(errorMessages2.deprecation);
}
function throwError2(errorMessages3, type) {
  throw new Error(errorMessages3[type] || errorMessages3["default"]);
}
var errorMessages2 = {
  configIsRequired: "the configuration object is required",
  configType: "the configuration object should be an object",
  "default": "an unknown error accured in `@monaco-editor/loader` package",
  deprecation: "Deprecation warning!\n    You are using deprecated way of configuration.\n\n    Instead of using\n      monaco.config({ urls: { monacoBase: '...' } })\n    use\n      monaco.config({ paths: { vs: '...' } })\n\n    For more please check the link https://github.com/suren-atoyan/monaco-loader#config\n  "
};
var errorHandler2 = curry2(throwError2)(errorMessages2);
var validators2 = {
  config: validateConfig
};

// node_modules/@monaco-editor/loader/lib/es/utils/compose.js
var compose2 = function compose3() {
  for (var _len = arguments.length, fns = new Array(_len), _key = 0; _key < _len; _key++) {
    fns[_key] = arguments[_key];
  }
  return function(x2) {
    return fns.reduceRight(function(y2, f2) {
      return f2(y2);
    }, x2);
  };
};

// node_modules/@monaco-editor/loader/lib/es/utils/deepMerge.js
function merge(target, source) {
  Object.keys(source).forEach(function(key) {
    if (source[key] instanceof Object) {
      if (target[key]) {
        Object.assign(source[key], merge(target[key], source[key]));
      }
    }
  });
  return _objectSpread2(_objectSpread2({}, target), source);
}

// node_modules/@monaco-editor/loader/lib/es/utils/makeCancelable.js
var CANCELATION_MESSAGE = {
  type: "cancelation",
  msg: "operation is manually canceled"
};
function makeCancelable(promise) {
  var hasCanceled_ = false;
  var wrappedPromise = new Promise(function(resolve, reject) {
    promise.then(function(val) {
      return hasCanceled_ ? reject(CANCELATION_MESSAGE) : resolve(val);
    });
    promise["catch"](reject);
  });
  return wrappedPromise.cancel = function() {
    return hasCanceled_ = true;
  }, wrappedPromise;
}

// node_modules/@monaco-editor/loader/lib/es/loader/index.js
var _excluded = ["monaco"];
var _state$create = state_local_default.create({
  config,
  isInitialized: false,
  resolve: null,
  reject: null,
  monaco: null
});
var _state$create2 = _slicedToArray(_state$create, 2);
var getState = _state$create2[0];
var setState = _state$create2[1];
function config2(globalConfig) {
  var _validators$config = validators2.config(globalConfig), monaco = _validators$config.monaco, config3 = _objectWithoutProperties(_validators$config, _excluded);
  setState(function(state) {
    return {
      config: merge(state.config, config3),
      monaco
    };
  });
}
function init() {
  var state = getState(function(_ref2) {
    var monaco = _ref2.monaco, isInitialized = _ref2.isInitialized, resolve = _ref2.resolve;
    return {
      monaco,
      isInitialized,
      resolve
    };
  });
  if (!state.isInitialized) {
    setState({
      isInitialized: true
    });
    if (state.monaco) {
      state.resolve(state.monaco);
      return makeCancelable(wrapperPromise);
    }
    if (window.monaco && window.monaco.editor) {
      storeMonacoInstance(window.monaco);
      state.resolve(window.monaco);
      return makeCancelable(wrapperPromise);
    }
    compose2(injectScripts, getMonacoLoaderScript)(configureLoader);
  }
  return makeCancelable(wrapperPromise);
}
function injectScripts(script) {
  return document.body.appendChild(script);
}
function createScript(src) {
  var script = document.createElement("script");
  return src && (script.src = src), script;
}
function getMonacoLoaderScript(configureLoader2) {
  var state = getState(function(_ref2) {
    var config3 = _ref2.config, reject = _ref2.reject;
    return {
      config: config3,
      reject
    };
  });
  var loaderScript = createScript("".concat(state.config.paths.vs, "/loader.js"));
  loaderScript.onload = function() {
    return configureLoader2();
  };
  loaderScript.onerror = state.reject;
  return loaderScript;
}
function configureLoader() {
  var state = getState(function(_ref3) {
    var config3 = _ref3.config, resolve = _ref3.resolve, reject = _ref3.reject;
    return {
      config: config3,
      resolve,
      reject
    };
  });
  var require2 = window.require;
  require2.config(state.config);
  require2(["vs/editor/editor.main"], function(loaded) {
    var monaco = loaded.m || loaded;
    storeMonacoInstance(monaco);
    state.resolve(monaco);
  }, function(error) {
    state.reject(error);
  });
}
function storeMonacoInstance(monaco) {
  if (!getState().monaco) {
    setState({
      monaco
    });
  }
}
function __getMonacoInstance() {
  return getState(function(_ref4) {
    var monaco = _ref4.monaco;
    return monaco;
  });
}
var wrapperPromise = new Promise(function(resolve, reject) {
  return setState({
    resolve,
    reject
  });
});
var loader = {
  config: config2,
  init,
  __getMonacoInstance
};

// node_modules/@monaco-editor/react/dist/index.mjs
var import_react4 = __toESM(require_react(), 1);
var import_react5 = __toESM(require_react(), 1);
var import_react6 = __toESM(require_react(), 1);
var import_react7 = __toESM(require_react(), 1);
var import_react8 = __toESM(require_react(), 1);
var import_react9 = __toESM(require_react(), 1);
var import_react10 = __toESM(require_react(), 1);
var import_react11 = __toESM(require_react(), 1);
var import_react12 = __toESM(require_react(), 1);
var import_react13 = __toESM(require_react(), 1);
var import_react14 = __toESM(require_react(), 1);
var le = { wrapper: { display: "flex", position: "relative", textAlign: "initial" }, fullWidth: { width: "100%" }, hide: { display: "none" } };
var v = le;
var ae = { container: { display: "flex", height: "100%", width: "100%", justifyContent: "center", alignItems: "center" } };
var Y = ae;
function Me({ children: e }) {
  return import_react8.default.createElement("div", { style: Y.container }, e);
}
var Z = Me;
var $ = Z;
function Ee({ width: e, height: r, isEditorReady: n, loading: t, _ref: a, className: m2, wrapperProps: E2 }) {
  return import_react7.default.createElement("section", { style: { ...v.wrapper, width: e, height: r }, ...E2 }, !n && import_react7.default.createElement($, null, t), import_react7.default.createElement("div", { ref: a, style: { ...v.fullWidth, ...!n && v.hide }, className: m2 }));
}
var ee = Ee;
var H = (0, import_react6.memo)(ee);
function Ce(e) {
  (0, import_react9.useEffect)(e, []);
}
var k = Ce;
function he(e, r, n = true) {
  let t = (0, import_react10.useRef)(true);
  (0, import_react10.useEffect)(t.current || !n ? () => {
    t.current = false;
  } : e, r);
}
var l = he;
function D() {
}
function h(e, r, n, t) {
  return De(e, t) || be(e, r, n, t);
}
function De(e, r) {
  return e.editor.getModel(te(e, r));
}
function be(e, r, n, t) {
  return e.editor.createModel(r, n, t ? te(e, t) : void 0);
}
function te(e, r) {
  return e.Uri.parse(r);
}
function Oe({ original: e, modified: r, language: n, originalLanguage: t, modifiedLanguage: a, originalModelPath: m2, modifiedModelPath: E2, keepCurrentOriginalModel: g = false, keepCurrentModifiedModel: N = false, theme: x2 = "light", loading: P2 = "Loading...", options: y2 = {}, height: V2 = "100%", width: z2 = "100%", className: F2, wrapperProps: j2 = {}, beforeMount: A2 = D, onMount: q2 = D }) {
  let [M, O2] = (0, import_react5.useState)(false), [T, s] = (0, import_react5.useState)(true), u = (0, import_react5.useRef)(null), c = (0, import_react5.useRef)(null), w = (0, import_react5.useRef)(null), d = (0, import_react5.useRef)(q2), o = (0, import_react5.useRef)(A2), b2 = (0, import_react5.useRef)(false);
  k(() => {
    let i = loader.init();
    return i.then((f2) => (c.current = f2) && s(false)).catch((f2) => f2?.type !== "cancelation" && console.error("Monaco initialization: error:", f2)), () => u.current ? I2() : i.cancel();
  }), l(() => {
    if (u.current && c.current) {
      let i = u.current.getOriginalEditor(), f2 = h(c.current, e || "", t || n || "text", m2 || "");
      f2 !== i.getModel() && i.setModel(f2);
    }
  }, [m2], M), l(() => {
    if (u.current && c.current) {
      let i = u.current.getModifiedEditor(), f2 = h(c.current, r || "", a || n || "text", E2 || "");
      f2 !== i.getModel() && i.setModel(f2);
    }
  }, [E2], M), l(() => {
    let i = u.current.getModifiedEditor();
    i.getOption(c.current.editor.EditorOption.readOnly) ? i.setValue(r || "") : r !== i.getValue() && (i.executeEdits("", [{ range: i.getModel().getFullModelRange(), text: r || "", forceMoveMarkers: true }]), i.pushUndoStop());
  }, [r], M), l(() => {
    u.current?.getModel()?.original.setValue(e || "");
  }, [e], M), l(() => {
    let { original: i, modified: f2 } = u.current.getModel();
    c.current.editor.setModelLanguage(i, t || n || "text"), c.current.editor.setModelLanguage(f2, a || n || "text");
  }, [n, t, a], M), l(() => {
    c.current?.editor.setTheme(x2);
  }, [x2], M), l(() => {
    u.current?.updateOptions(y2);
  }, [y2], M);
  let L2 = (0, import_react5.useCallback)(() => {
    if (!c.current) return;
    o.current(c.current);
    let i = h(c.current, e || "", t || n || "text", m2 || ""), f2 = h(c.current, r || "", a || n || "text", E2 || "");
    u.current?.setModel({ original: i, modified: f2 });
  }, [n, r, a, e, t, m2, E2]), U2 = (0, import_react5.useCallback)(() => {
    !b2.current && w.current && (u.current = c.current.editor.createDiffEditor(w.current, { automaticLayout: true, ...y2 }), L2(), c.current?.editor.setTheme(x2), O2(true), b2.current = true);
  }, [y2, x2, L2]);
  (0, import_react5.useEffect)(() => {
    M && d.current(u.current, c.current);
  }, [M]), (0, import_react5.useEffect)(() => {
    !T && !M && U2();
  }, [T, M, U2]);
  function I2() {
    let i = u.current?.getModel();
    g || i?.original?.dispose(), N || i?.modified?.dispose(), u.current?.dispose();
  }
  return import_react5.default.createElement(H, { width: z2, height: V2, isEditorReady: M, loading: P2, _ref: w, className: F2, wrapperProps: j2 });
}
var ie = Oe;
var we = (0, import_react4.memo)(ie);
function He(e) {
  let r = (0, import_react14.useRef)();
  return (0, import_react14.useEffect)(() => {
    r.current = e;
  }, [e]), r.current;
}
var se = He;
var _ = /* @__PURE__ */ new Map();
function Ve({ defaultValue: e, defaultLanguage: r, defaultPath: n, value: t, language: a, path: m2, theme: E2 = "light", line: g, loading: N = "Loading...", options: x2 = {}, overrideServices: P2 = {}, saveViewState: y2 = true, keepCurrentModel: V2 = false, width: z2 = "100%", height: F2 = "100%", className: j2, wrapperProps: A2 = {}, beforeMount: q2 = D, onMount: M = D, onChange: O2, onValidate: T = D }) {
  let [s, u] = (0, import_react13.useState)(false), [c, w] = (0, import_react13.useState)(true), d = (0, import_react13.useRef)(null), o = (0, import_react13.useRef)(null), b2 = (0, import_react13.useRef)(null), L2 = (0, import_react13.useRef)(M), U2 = (0, import_react13.useRef)(q2), I2 = (0, import_react13.useRef)(), i = (0, import_react13.useRef)(t), f2 = se(m2), Q2 = (0, import_react13.useRef)(false), B2 = (0, import_react13.useRef)(false);
  k(() => {
    let p = loader.init();
    return p.then((R2) => (d.current = R2) && w(false)).catch((R2) => R2?.type !== "cancelation" && console.error("Monaco initialization: error:", R2)), () => o.current ? pe2() : p.cancel();
  }), l(() => {
    let p = h(d.current, e || t || "", r || a || "", m2 || n || "");
    p !== o.current?.getModel() && (y2 && _.set(f2, o.current?.saveViewState()), o.current?.setModel(p), y2 && o.current?.restoreViewState(_.get(m2)));
  }, [m2], s), l(() => {
    o.current?.updateOptions(x2);
  }, [x2], s), l(() => {
    !o.current || t === void 0 || (o.current.getOption(d.current.editor.EditorOption.readOnly) ? o.current.setValue(t) : t !== o.current.getValue() && (B2.current = true, o.current.executeEdits("", [{ range: o.current.getModel().getFullModelRange(), text: t, forceMoveMarkers: true }]), o.current.pushUndoStop(), B2.current = false));
  }, [t], s), l(() => {
    let p = o.current?.getModel();
    p && a && d.current?.editor.setModelLanguage(p, a);
  }, [a], s), l(() => {
    g !== void 0 && o.current?.revealLine(g);
  }, [g], s), l(() => {
    d.current?.editor.setTheme(E2);
  }, [E2], s);
  let X3 = (0, import_react13.useCallback)(() => {
    if (!(!b2.current || !d.current) && !Q2.current) {
      U2.current(d.current);
      let p = m2 || n, R2 = h(d.current, t || e || "", r || a || "", p || "");
      o.current = d.current?.editor.create(b2.current, { model: R2, automaticLayout: true, ...x2 }, P2), y2 && o.current.restoreViewState(_.get(p)), d.current.editor.setTheme(E2), g !== void 0 && o.current.revealLine(g), u(true), Q2.current = true;
    }
  }, [e, r, n, t, a, m2, x2, P2, y2, E2, g]);
  (0, import_react13.useEffect)(() => {
    s && L2.current(o.current, d.current);
  }, [s]), (0, import_react13.useEffect)(() => {
    !c && !s && X3();
  }, [c, s, X3]), i.current = t, (0, import_react13.useEffect)(() => {
    s && O2 && (I2.current?.dispose(), I2.current = o.current?.onDidChangeModelContent((p) => {
      B2.current || O2(o.current.getValue(), p);
    }));
  }, [s, O2]), (0, import_react13.useEffect)(() => {
    if (s) {
      let p = d.current.editor.onDidChangeMarkers((R2) => {
        let G2 = o.current.getModel()?.uri;
        if (G2 && R2.find((J2) => J2.path === G2.path)) {
          let J2 = d.current.editor.getModelMarkers({ resource: G2 });
          T?.(J2);
        }
      });
      return () => {
        p?.dispose();
      };
    }
    return () => {
    };
  }, [s, T]);
  function pe2() {
    I2.current?.dispose(), V2 ? y2 && _.set(m2, o.current.saveViewState()) : o.current.getModel()?.dispose(), o.current.dispose();
  }
  return import_react13.default.createElement(H, { width: z2, height: F2, isEditorReady: s, loading: N, _ref: b2, className: j2, wrapperProps: A2 });
}
var fe = Ve;
var de = (0, import_react12.memo)(fe);
var Ft = de;

// plugins/editor/web-src/editor/monacoLoader.ts
loader.config({ paths: { vs: "/monaco/vs" } });

// plugins/editor/web-src/editor/editorOptions.ts
var DEFAULT_PREFS = { fontSize: 13, tabSize: 2, wordWrap: false, minimap: true };
var MIN_FONT_SIZE = 10;
var MAX_FONT_SIZE = 24;
var TAB_SIZES = [2, 4, 8];
function normalisePrefs(raw) {
  const value = raw ?? {};
  const size = Number(value.fontSize);
  const tab = Number(value.tabSize);
  return {
    fontSize: Number.isFinite(size) ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size))) : DEFAULT_PREFS.fontSize,
    tabSize: TAB_SIZES.includes(tab) ? tab : DEFAULT_PREFS.tabSize,
    wordWrap: typeof value.wordWrap === "boolean" ? value.wordWrap : DEFAULT_PREFS.wordWrap,
    minimap: typeof value.minimap === "boolean" ? value.minimap : DEFAULT_PREFS.minimap
  };
}
function editorOptions(prefs) {
  return {
    fontSize: prefs.fontSize,
    tabSize: prefs.tabSize,
    wordWrap: prefs.wordWrap ? "on" : "off",
    minimap: { enabled: prefs.minimap, renderCharacters: false, maxColumn: 90 },
    // The affordances that carry the "this is an editor" impression.
    stickyScroll: { enabled: true },
    bracketPairColorization: { enabled: true },
    guides: { indentation: true, bracketPairs: "active" },
    renderLineHighlight: "all",
    occurrencesHighlight: "singleFile",
    selectionHighlight: true,
    matchBrackets: "always",
    folding: true,
    foldingHighlight: true,
    showFoldingControls: "mouseover",
    glyphMargin: true,
    lineNumbersMinChars: 3,
    renderWhitespace: "selection",
    // Movement. Smooth caret and scrolling are the difference between "a text box updated" and "an
    // editor responded"; both are cheap and both are off by default in standalone Monaco.
    smoothScrolling: true,
    cursorBlinking: "smooth",
    cursorSmoothCaretAnimation: "on",
    mouseWheelZoom: true,
    // A scrollbar sized to be grabbed, and an overview ruler that actually reports something.
    scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 12, useShadows: false },
    overviewRulerBorder: false,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    padding: { top: 10, bottom: 10 },
    fontLigatures: true,
    roundedSelection: false,
    // Monaco has no language services here, so word-based suggestions are all it can honestly offer.
    // Left on: inside one file they are genuinely useful, and quiet when they have nothing to say.
    quickSuggestions: { other: true, comments: false, strings: false },
    suggestSelection: "first",
    tabCompletion: "on"
  };
}
function diffOptions(prefs) {
  return {
    ...editorOptions(prefs),
    readOnly: true,
    renderSideBySide: true,
    // Whitespace-only changes are real changes when reviewing a file you are about to save.
    ignoreTrimWhitespace: false,
    stickyScroll: { enabled: false },
    quickSuggestions: false,
    occurrencesHighlight: "off"
  };
}

// plugins/editor/web-src/editor/EditorPane.tsx
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
function EditorPane({ path, value, onChange, onSave, prefs, onCursor }) {
  const saveRef = (0, import_react16.useRef)(onSave);
  saveRef.current = onSave;
  const cursorRef = (0, import_react16.useRef)(onCursor);
  cursorRef.current = onCursor;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    Ft,
    {
      height: "100%",
      theme: runtime().utils.editorTheme(),
      beforeMount: runtime().utils.defineEditorThemes,
      onMount: (editor, monaco) => {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
        const report = () => {
          const position = editor.getPosition();
          const selection = editor.getSelection();
          const selected = selection && !selection.isEmpty() ? editor.getModel()?.getValueInRange(selection).length ?? 0 : 0;
          if (position) cursorRef.current?.({ line: position.lineNumber, column: position.column, selected });
        };
        editor.onDidChangeCursorPosition(report);
        editor.onDidChangeCursorSelection(report);
        report();
      },
      language: langOf(path),
      value,
      onChange: (v3) => onChange(v3 ?? ""),
      options: editorOptions(prefs)
    },
    path
  );
}

// plugins/editor/web-src/editor/DiffEditorPane.tsx
var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
function DiffEditorPane({ path, original, modified, prefs }) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
    we,
    {
      height: "100%",
      theme: runtime().utils.editorTheme(),
      beforeMount: runtime().utils.defineEditorThemes,
      language: langOf(path),
      original,
      modified,
      options: diffOptions(prefs)
    },
    path
  );
}

// plugins/editor/web-src/editor/MenuBar.tsx
var import_jsx_runtime5 = __toESM(require_jsx_runtime(), 1);
function MenuBar({ menus, openId, onOpen }) {
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "flex items-center", role: "menubar", children: menus.map((menu) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
    "button",
    {
      type: "button",
      role: "menuitem",
      "aria-haspopup": "menu",
      "aria-expanded": openId === menu.id,
      onClick: (event) => {
        if (openId === menu.id) {
          onOpen(null, 0, 0);
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        onOpen(menu, rect.left, rect.bottom + 4);
      },
      className: `overlay-menu-item rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${openId === menu.id ? "bg-elevated text-text" : "text-text-muted hover:bg-elevated hover:text-text"}`,
      children: menu.label
    },
    menu.id
  )) });
}

// plugins/editor/web-src/editor/ViewSwitch.tsx
var import_jsx_runtime6 = __toESM(require_jsx_runtime(), 1);
function ViewSwitch({ options, value, onChange, label }) {
  if (options.length < 2) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { role: "tablist", "aria-label": label, className: "flex items-center gap-0.5 rounded-lg border border-border bg-bg/60 p-0.5", children: options.map((option) => {
    const Icon2 = option.icon;
    const active = option.id === value;
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
      "button",
      {
        type: "button",
        role: "tab",
        "aria-selected": active,
        onClick: () => onChange(option.id),
        className: `overlay-menu-item flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${active ? "bg-elevated text-text shadow-sm" : "text-text-muted hover:text-text"}`,
        children: [
          Icon2 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon2, { size: 13, className: "shrink-0" }) : null,
          option.label
        ]
      },
      option.id
    );
  }) });
}

// plugins/editor/web-src/editor/StatusBar.tsx
var import_jsx_runtime7 = __toESM(require_jsx_runtime(), 1);
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["kB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}
function StatusBar({ path, cursor, language, tabSize, size, dirty, labels }) {
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "flex h-6 shrink-0 items-center gap-3 border-t border-border bg-bg/60 px-3 text-[11px] text-text-muted", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "flex min-w-0 items-center gap-1.5", children: [
      dirty ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Circle, { size: 7, className: "shrink-0 fill-warning text-warning", "aria-label": labels.unsaved }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "truncate font-mono", title: path, children: path })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "ml-auto flex shrink-0 items-center gap-3 tabular-nums", children: [
      cursor ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { children: [
        labels.line,
        " ",
        cursor.line,
        ", ",
        labels.column,
        " ",
        cursor.column,
        cursor.selected > 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "text-accent", children: [
          " (",
          cursor.selected,
          " ",
          labels.selected,
          ")"
        ] }) : null
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { children: [
        labels.spaces,
        ": ",
        tabSize
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: formatBytes(size) }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "font-medium uppercase text-text", children: language })
    ] })
  ] });
}

// plugins/editor/web-src/editor/upload.ts
var UploadError = class extends Error {
};
async function refusal(response) {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
}
async function uploadFile(projectId, path, file, options) {
  if (file.size > MAX_BUFFERED_BYTES) throw new UploadError("file too large");
  const overwrite = options?.overwrite ? "1" : "0";
  let offset = 0;
  do {
    const chunk = file.slice(offset, offset + MAX_UPLOAD_CHUNK_BYTES);
    const final = offset + chunk.size >= file.size;
    const query = `path=${encodeURIComponent(path)}&offset=${offset}&overwrite=${overwrite}${final ? "&final=1" : ""}`;
    const response = await fetch(`/api/projects/${projectId}/upload?${query}`, {
      method: "PUT",
      body: chunk,
      headers: { "content-type": "application/octet-stream" },
      signal: options?.signal
    });
    if (!response.ok) throw new UploadError(await refusal(response));
    offset += chunk.size;
    options?.onProgress?.(offset, file.size);
  } while (offset < file.size);
}

// plugins/editor/web-src/editor/menu.ts
var DIVIDER = "divider";

// plugins/editor/web-src/editor/MarkdownPreview.tsx
var import_react17 = __toESM(require_react(), 1);

// node_modules/marked/lib/marked.esm.js
function C2() {
  return { async: false, breaks: false, extensions: null, gfm: true, hooks: null, pedantic: false, renderer: null, silent: false, tokenizer: null, walkTokens: null };
}
var R = C2();
function j(l4) {
  R = l4;
}
var z = { exec: () => null };
function A(l4) {
  let e = [];
  return (t) => {
    let n = Math.max(0, Math.min(3, t - 1)), s = e[n];
    return s || (s = l4(n), e[n] = s), s;
  };
}
function k2(l4, e = "") {
  let t = typeof l4 == "string" ? l4 : l4.source, n = { replace: (s, r) => {
    let i = typeof r == "string" ? r : r.source;
    return i = i.replace(m.caret, "$1"), t = t.replace(s, i), n;
  }, getRegex: () => new RegExp(t, e) };
  return n;
}
var Te2 = ((l4 = "") => {
  try {
    return !!new RegExp("(?<=1)(?<!1)" + l4);
  } catch {
    return false;
  }
})();
var m = { codeRemoveIndent: /^(?: {1,4}| {0,3}\t)/gm, outputLinkReplace: /\\([\[\]])/g, indentCodeCompensation: /^(\s+)(?:```)/, beginningSpace: /^\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\n/g, tabCharGlobal: /\t/g, multipleSpaceGlobal: /\s+/g, blankLine: /^[ \t]*$/, doubleBlankLine: /\n[ \t]*\n[ \t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\[[ xX]\] +\S/, listReplaceTask: /^\[[ xX]\] +/, listTaskCheckbox: /\[[ xX]\]/, anyLine: /\n.*\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\||\| *$/g, tableRowBlankLine: /\n[ \t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i, endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/, unicodeAlphaNumeric: /[\p{L}\p{N}]/u, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, caret: /(^|[^\[])\^/g, percentDecode: /%25/g, findPipe: /\|/g, splitPipe: / \|/, slashPipe: /\\\|/g, carriageReturn: /\r\n|\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\S*/, endingNewline: /\n$/, listItemRegex: (l4) => new RegExp(`^( {0,3}${l4})((?:[	 ][^\\n]*)?(?:\\n|$))`), nextBulletRegex: A((l4) => new RegExp(`^ {0,${l4}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)), hrRegex: A((l4) => new RegExp(`^ {0,${l4}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`)), fencesBeginRegex: A((l4) => new RegExp(`^ {0,${l4}}(?:\`\`\`|~~~)`)), headingBeginRegex: A((l4) => new RegExp(`^ {0,${l4}}#`)), htmlBeginRegex: A((l4) => new RegExp(`^ {0,${l4}}<(?:[a-z].*>|!--)`, "i")), blockquoteBeginRegex: A((l4) => new RegExp(`^ {0,${l4}}>`)) };
var Oe2 = /^(?:[ \t]*(?:\n|$))+/;
var we2 = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
var ye2 = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
var q = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var Pe = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var U = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
var oe2 = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
var ae2 = k2(oe2).replace(/bull/g, U).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
var Se = k2(oe2).replace(/bull/g, U).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
var K2 = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
var _e2 = /^[^\n]+/;
var W2 = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
var $e = k2(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", W2).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
var Le = k2(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, U).getRegex();
var Q = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var X2 = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var Me2 = k2("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", X2).replace("tag", Q).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
var le2 = (l4) => k2(K2).replace("hr", q).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~~~)[^\\n]*\\n").replace("list", l4).replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", Q).getRegex();
var ze2 = le2(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/);
var Ee2 = le2(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
var Ce2 = k2(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", Ee2).getRegex();
var J = { blockquote: Ce2, code: we2, def: $e, fences: ye2, heading: Pe, hr: q, html: Me2, lheading: ae2, list: Le, newline: Oe2, paragraph: ze2, table: z, text: _e2 };
var se2 = k2("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", q).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~~~)[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", Q).getRegex();
var Ae = { ...J, lheading: Se, table: se2, paragraph: k2(K2).replace("hr", q).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", se2).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~~~)[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", Q).getRegex() };
var Ie2 = { ...J, html: k2(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", X2).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(), def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/, heading: /^(#{1,6})(.*)(?:\n+|$)/, fences: z, lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/, paragraph: k2(K2).replace("hr", q).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", ae2).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() };
var Be = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var De2 = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var pe = /^( {2,}|\\)\n(?!\s*$)/;
var qe = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var _2 = /[\p{P}\p{S}]/u;
var I = /[\s\p{P}\p{S}]/u;
var v2 = /[^\s\p{P}\p{S}]/u;
var ve2 = k2(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, I).getRegex();
var He2 = /[\p{Pi}\p{Ps}"']/u;
var ue2 = /(?!~)[\p{P}\p{S}]/u;
var Ze = /(?!~)[\s\p{P}\p{S}]/u;
var Ge = /(?:[^\s\p{P}\p{S}]|~)/u;
var Qe = k2(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", Te2 ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
var ce = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
var Ne = k2(ce, "u").replace(/punct/g, _2).getRegex();
var je = k2(ce, "u").replace(/punct/g, ue2).getRegex();
var Fe = /^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/;
var Ue2 = k2(Fe, "u").replace(/openQuote/g, He2).replace(/punct/g, _2).getRegex();
var he2 = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
var Ke = k2(he2, "gu").replace(/notPunctSpace/g, v2).replace(/punctSpace/g, I).replace(/punct/g, _2).getRegex();
var We2 = k2(he2, "gu").replace(/notPunctSpace/g, Ge).replace(/punctSpace/g, Ze).replace(/punct/g, ue2).getRegex();
var Xe = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)";
var Je = k2(Xe, "gu").replace(/notPunctSpace/g, v2).replace(/punctSpace/g, I).replace(/punct/g, _2).getRegex();
var Ve2 = k2("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, v2).replace(/punctSpace/g, I).replace(/punct/g, _2).getRegex();
var Ye = "^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)";
var et = k2(Ye, "gu").replace(/notPunctSpace/g, v2).replace(/punctSpace/g, I).replace(/punct/g, _2).getRegex();
var tt = k2(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, _2).getRegex();
var nt = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)";
var rt = k2(nt, "gu").replace(/notPunctSpace/g, v2).replace(/punctSpace/g, I).replace(/punct/g, _2).getRegex();
var st = k2(/\\(punct)/, "gu").replace(/punct/g, _2).getRegex();
var it = k2(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var ot = k2(X2).replace("(?:-->|$)", "-->").getRegex();
var at = k2("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", ot).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var G = /(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/;
var lt = k2(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?\s*\)/).replace("label", G).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
var de2 = k2(/^!?\[(label)\]\[(ref)\]/).replace("label", G).replace("ref", W2).getRegex();
var ke2 = k2(/^!?\[(ref)\](?:\[\])?/).replace("ref", W2).getRegex();
var pt = k2("reflink|nolink(?!\\()", "g").replace("reflink", de2).replace("nolink", ke2).getRegex();
var ie2 = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
var V = { _backpedal: z, anyPunctuation: st, autolink: it, blockSkip: Qe, br: pe, code: De2, del: z, delLDelim: z, delRDelim: z, emStrongLDelim: Ne, emStrongRDelimAst: Ke, emStrongRDelimUnd: Ve2, escape: Be, link: lt, nolink: ke2, punctuation: ve2, reflink: de2, reflinkSearch: pt, tag: at, text: qe, url: z };
var ut = { ...V, emStrongLDelim: Ue2, emStrongRDelimAst: Je, emStrongRDelimUnd: et, link: k2(/^!?\[(label)\]\((.*?)\)/).replace("label", G).getRegex(), reflink: k2(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", G).getRegex() };
var F = { ...V, emStrongRDelimAst: We2, emStrongLDelim: je, delLDelim: tt, delRDelim: rt, url: k2(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol", ie2).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/, text: k2(/^(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol", ie2).getRegex() };
var ct = { ...F, br: k2(pe).replace("{2,}", "*").getRegex(), text: k2(F.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex() };
var H2 = { normal: J, gfm: Ae, pedantic: Ie2 };
var B = { normal: V, gfm: F, breaks: ct, pedantic: ut };
var ht = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
var ge2 = (l4) => ht[l4];
function O(l4, e) {
  if (e) {
    if (m.escapeTest.test(l4)) return l4.replace(m.escapeReplace, ge2);
  } else if (m.escapeTestNoEncode.test(l4)) return l4.replace(m.escapeReplaceNoEncode, ge2);
  return l4;
}
function Y2(l4) {
  try {
    l4 = encodeURI(l4).replace(m.percentDecode, "%");
  } catch {
    return null;
  }
  return l4;
}
function ee2(l4, e) {
  let t = l4.replace(m.findPipe, (r, i, o) => {
    let p = false, a = i;
    for (; --a >= 0 && o[a] === "\\"; ) p = !p;
    return p ? "|" : " |";
  }), n = t.split(m.splitPipe), s = 0;
  if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
  else for (; n.length < e; ) n.push("");
  for (; s < n.length; s++) n[s] = n[s].trim().replace(m.slashPipe, "|");
  return n;
}
function $2(l4, e, t) {
  let n = l4.length;
  if (n === 0) return "";
  let s = 0;
  for (; s < n; ) {
    let r = l4.charAt(n - s - 1);
    if (r === e && !t) s++;
    else if (r !== e && t) s++;
    else break;
  }
  return l4.slice(0, n - s);
}
function te2(l4) {
  let e = l4.split(`
`), t = e.length - 1;
  for (; t >= 0 && m.blankLine.test(e[t]); ) t--;
  return e.length - t <= 2 ? l4 : e.slice(0, t + 1).join(`
`);
}
function fe2(l4, e) {
  if (l4.indexOf(e[1]) === -1) return -1;
  let t = 0;
  for (let n = 0; n < l4.length; n++) if (l4[n] === "\\") n++;
  else if (l4[n] === e[0]) t++;
  else if (l4[n] === e[1] && (t--, t < 0)) return n;
  return t > 0 ? -2 : -1;
}
function me2(l4, e = 0) {
  let t = e, n = "";
  for (let s of l4) if (s === "	") {
    let r = 4 - t % 4;
    n += " ".repeat(r), t += r;
  } else n += s, t++;
  return n;
}
function xe2(l4, e, t, n, s) {
  let r = e.href, i = e.title || null, o = l4[1].replace(s.other.outputLinkReplace, "$1");
  n.state.inLink = true;
  let p = { type: l4[0].charAt(0) === "!" ? "image" : "link", raw: t, href: r, title: i, text: o, tokens: n.inlineTokens(o) };
  return n.state.inLink = false, p;
}
function dt(l4, e, t) {
  let n = l4.match(t.other.indentCodeCompensation);
  if (n === null) return e;
  let s = n[1];
  return e.split(`
`).map((r) => {
    let i = r.match(t.other.beginningSpace);
    if (i === null) return r;
    let [o] = i;
    return o.length >= s.length ? r.slice(s.length) : r;
  }).join(`
`);
}
var y = class {
  options;
  rules;
  lexer;
  constructor(e) {
    this.options = e || R;
  }
  space(e) {
    let t = this.rules.block.newline.exec(e);
    if (t && t[0].length > 0) return { type: "space", raw: t[0] };
  }
  code(e) {
    let t = this.rules.block.code.exec(e);
    if (t) {
      let n = this.options.pedantic ? t[0] : te2(t[0]), s = n.replace(this.rules.other.codeRemoveIndent, "");
      return { type: "code", raw: n, codeBlockStyle: "indented", text: s };
    }
  }
  fences(e) {
    let t = this.rules.block.fences.exec(e);
    if (t) {
      let n = t[0], s = dt(n, t[3] || "", this.rules);
      return { type: "code", raw: n, lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2], text: s };
    }
  }
  heading(e) {
    let t = this.rules.block.heading.exec(e);
    if (t) {
      let n = t[2].trim();
      if (this.rules.other.endingHash.test(n)) {
        let s = $2(n, "#");
        (this.options.pedantic || !s || this.rules.other.endingSpaceChar.test(s)) && (n = s.trim());
      }
      return { type: "heading", raw: $2(t[0], `
`), depth: t[1].length, text: n, tokens: this.lexer.inline(n) };
    }
  }
  hr(e) {
    let t = this.rules.block.hr.exec(e);
    if (t) return { type: "hr", raw: $2(t[0], `
`) };
  }
  blockquote(e) {
    let t = this.rules.block.blockquote.exec(e);
    if (t) {
      let n = $2(t[0], `
`).split(`
`), s = "", r = "", i = [];
      for (; n.length > 0; ) {
        let o = false, p = [], a;
        for (a = 0; a < n.length; a++) if (this.rules.other.blockquoteStart.test(n[a])) p.push(n[a]), o = true;
        else if (!o) p.push(n[a]);
        else break;
        n = n.slice(a);
        let u = p.join(`
`), c = u.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
        s = s ? `${s}
${u}` : u, r = r ? `${r}
${c}` : c;
        let h2 = this.lexer.state.top;
        if (this.lexer.state.top = true, this.lexer.blockTokens(c, i, true), this.lexer.state.top = h2, n.length === 0) break;
        let d = i.at(-1);
        if (d?.type === "code") break;
        if (d?.type === "blockquote") {
          let T = d, g = n.join(`
`), w = T.raw + `
` + g.replace(this.rules.other.blockquoteSetextReplace2, ""), M = this.blockquote(w);
          i[i.length - 1] = M, s = `${s}
${g}`, r = r.substring(0, r.length - T.text.length) + M.text;
          break;
        } else if (d?.type === "list") {
          let T = d, g = T.raw + `
` + n.join(`
`), w = this.list(g);
          i[i.length - 1] = w, s = s.substring(0, s.length - d.raw.length) + w.raw, r = r.substring(0, r.length - T.raw.length) + w.raw, n = g.substring(i.at(-1).raw.length).split(`
`);
          continue;
        }
      }
      return { type: "blockquote", raw: s, tokens: i, text: r };
    }
  }
  list(e) {
    let t = this.rules.block.list.exec(e);
    if (t) {
      let n = t[1].trim(), s = n.length > 1, r = { type: "list", raw: "", ordered: s, start: s ? +n.slice(0, -1) : "", loose: false, items: [] };
      n = s ? `\\d{1,9}\\${n.slice(-1)}` : `\\${n}`, this.options.pedantic && (n = s ? n : "[*+-]");
      let i = this.rules.other.listItemRegex(n), o = false;
      for (; e; ) {
        let a = false, u = "", c = "";
        if (!(t = i.exec(e)) || this.rules.block.hr.test(e)) break;
        u = t[0], e = e.substring(u.length);
        let h2 = me2(t[2].split(`
`, 1)[0], t[1].length), d = e.split(`
`, 1)[0], T = !h2.trim(), g = 0;
        if (this.options.pedantic ? (g = 2, c = h2.trimStart()) : T ? g = t[1].length + 1 : (g = h2.search(this.rules.other.nonSpaceChar), g = g > 4 ? 1 : g, c = h2.slice(g), g += t[1].length), T && this.rules.other.blankLine.test(d) && (u += d + `
`, e = e.substring(d.length + 1), a = true), !a) {
          let w = this.rules.other.nextBulletRegex(g), M = this.rules.other.hrRegex(g), ne2 = this.rules.other.fencesBeginRegex(g), re2 = this.rules.other.headingBeginRegex(g), be2 = this.rules.other.htmlBeginRegex(g), Re2 = this.rules.other.blockquoteBeginRegex(g);
          for (; e; ) {
            let N = e.split(`
`, 1)[0], D2;
            if (d = N, this.options.pedantic ? (d = d.replace(this.rules.other.listReplaceNesting, "  "), D2 = d) : D2 = d.replace(this.rules.other.tabCharGlobal, "    "), ne2.test(d) || re2.test(d) || be2.test(d) || Re2.test(d) || w.test(d) || M.test(d)) break;
            if (D2.search(this.rules.other.nonSpaceChar) >= g || !d.trim()) c += `
` + D2.slice(g);
            else {
              if (T || h2.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || ne2.test(h2) || re2.test(h2) || M.test(h2)) break;
              c += `
` + d;
            }
            T = !d.trim(), u += N + `
`, e = e.substring(N.length + 1), h2 = D2.slice(g);
          }
        }
        r.loose || (o ? r.loose = true : this.rules.other.doubleBlankLine.test(u) && (o = true)), r.items.push({ type: "list_item", raw: u, task: !!this.options.gfm && this.rules.other.listIsTask.test(c), loose: false, text: c, tokens: [] }), r.raw += u;
      }
      let p = r.items.at(-1);
      if (p) p.raw = p.raw.trimEnd(), p.text = p.text.trimEnd();
      else return;
      r.raw = r.raw.trimEnd();
      for (let a of r.items) {
        this.lexer.state.top = false, a.tokens = this.lexer.blockTokens(a.text, []);
        let u = a.tokens[0];
        if (a.task && (u?.type === "text" || u?.type === "paragraph")) {
          a.text = a.text.replace(this.rules.other.listReplaceTask, ""), u.raw = u.raw.replace(this.rules.other.listReplaceTask, ""), u.text = u.text.replace(this.rules.other.listReplaceTask, "");
          for (let h2 = this.lexer.inlineQueue.length - 1; h2 >= 0; h2--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[h2].src)) {
            this.lexer.inlineQueue[h2].src = this.lexer.inlineQueue[h2].src.replace(this.rules.other.listReplaceTask, "");
            break;
          }
          let c = this.rules.other.listTaskCheckbox.exec(a.raw);
          if (c) {
            let h2 = { type: "checkbox", raw: c[0] + " ", checked: c[0] !== "[ ]" };
            a.checked = h2.checked, r.loose ? a.tokens[0] && ["paragraph", "text"].includes(a.tokens[0].type) && "tokens" in a.tokens[0] && a.tokens[0].tokens ? (a.tokens[0].raw = h2.raw + a.tokens[0].raw, a.tokens[0].text = h2.raw + a.tokens[0].text, a.tokens[0].tokens.unshift(h2)) : a.tokens.unshift({ type: "paragraph", raw: h2.raw, text: h2.raw, tokens: [h2] }) : a.tokens.unshift(h2);
          }
        } else a.task && (a.task = false);
        if (!r.loose) {
          let c = a.tokens.filter((d) => d.type === "space"), h2 = c.length > 0 && c.some((d) => this.rules.other.anyLine.test(d.raw));
          r.loose = h2;
        }
      }
      if (r.loose) for (let a of r.items) {
        a.loose = true;
        for (let u of a.tokens) u.type === "text" && (u.type = "paragraph");
      }
      return r;
    }
  }
  html(e) {
    let t = this.rules.block.html.exec(e);
    if (t) {
      let n = te2(t[0]);
      return { type: "html", block: true, raw: n, pre: t[1] === "pre" || t[1] === "script" || t[1] === "style", text: n };
    }
  }
  def(e) {
    let t = this.rules.block.def.exec(e);
    if (t) {
      let n = t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, " "), s = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
      return { type: "def", tag: n, raw: $2(t[0], `
`), href: s, title: r };
    }
  }
  table(e) {
    let t = this.rules.block.table.exec(e);
    if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
    let n = ee2(t[1]), s = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), r = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], i = { type: "table", raw: $2(t[0], `
`), header: [], align: [], rows: [] };
    if (n.length === s.length) {
      for (let o of s) this.rules.other.tableAlignRight.test(o) ? i.align.push("right") : this.rules.other.tableAlignCenter.test(o) ? i.align.push("center") : this.rules.other.tableAlignLeft.test(o) ? i.align.push("left") : i.align.push(null);
      for (let o = 0; o < n.length; o++) i.header.push({ text: n[o], tokens: this.lexer.inline(n[o]), header: true, align: i.align[o] });
      for (let o of r) i.rows.push(ee2(o, i.header.length).map((p, a) => ({ text: p, tokens: this.lexer.inline(p), header: false, align: i.align[a] })));
      return i;
    }
  }
  lheading(e) {
    let t = this.rules.block.lheading.exec(e);
    if (t) {
      let n = t[1].trim();
      return { type: "heading", raw: $2(t[0], `
`), depth: t[2].charAt(0) === "=" ? 1 : 2, text: n, tokens: this.lexer.inline(n) };
    }
  }
  paragraph(e) {
    let t = this.rules.block.paragraph.exec(e);
    if (t) {
      let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
      return { type: "paragraph", raw: t[0], text: n, tokens: this.lexer.inline(n) };
    }
  }
  text(e) {
    let t = this.rules.block.text.exec(e);
    if (t) return { type: "text", raw: t[0], text: t[0], tokens: this.lexer.inline(t[0]) };
  }
  escape(e) {
    let t = this.rules.inline.escape.exec(e);
    if (t) return { type: "escape", raw: t[0], text: t[1] };
  }
  tag(e) {
    let t = this.rules.inline.tag.exec(e);
    if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = true : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = false), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = true : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = false), { type: "html", raw: t[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: false, text: t[0] };
  }
  link(e) {
    let t = this.rules.inline.link.exec(e);
    if (t) {
      let n = t[2].trim();
      if (!this.options.pedantic && this.rules.other.startAngleBracket.test(n)) {
        if (!this.rules.other.endAngleBracket.test(n)) return;
        let i = $2(n.slice(0, -1), "\\");
        if ((n.length - i.length) % 2 === 0) return;
      } else {
        let i = fe2(t[2], "()");
        if (i === -2) return;
        if (i > -1) {
          let p = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + i;
          t[2] = t[2].substring(0, i), t[0] = t[0].substring(0, p).trim(), t[3] = "";
        }
      }
      let s = t[2], r = "";
      if (this.options.pedantic) {
        let i = this.rules.other.pedanticHrefTitle.exec(s);
        i && (s = i[1], r = i[3]);
      } else r = t[3] ? t[3].slice(1, -1) : "";
      return s = s.trim(), this.rules.other.startAngleBracket.test(s) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(n) ? s = s.slice(1) : s = s.slice(1, -1)), xe2(t, { href: s && s.replace(this.rules.inline.anyPunctuation, "$1"), title: r && r.replace(this.rules.inline.anyPunctuation, "$1") }, t[0], this.lexer, this.rules);
    }
  }
  reflink(e, t) {
    let n;
    if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
      let s = (n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "), r = t[s.toLowerCase()];
      if (!r) {
        let i = n[0].charAt(0);
        return { type: "text", raw: i, text: i };
      }
      return xe2(n, r, n[0], this.lexer, this.rules);
    }
  }
  emStrong(e, t, n = "") {
    let s = this.rules.inline.emStrongLDelim.exec(e);
    if (!s || !s[1] && !s[2] && !s[3] && !s[4] || s[4] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
    if (!(s[1] || s[3] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let i = [...s[0]].length - 1, o, p, a = i, u = 0, c = s[0][0], h2 = n === c, d = c === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      for (d.lastIndex = 0, t = t.slice(-1 * e.length + i); (s = d.exec(t)) !== null; ) {
        if (o = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !o) continue;
        if (p = [...o].length, s[3] || s[4]) {
          a += p;
          continue;
        } else if (s[5] || s[6]) {
          if (i % 3 && !((i + p) % 3)) {
            u += p;
            continue;
          }
          if (h2) break;
        }
        if (a -= p, a > 0) continue;
        p = Math.min(p, p + a + u);
        let T = [...s[0]][0].length, g = e.slice(0, i + s.index + T + p);
        if (Math.min(i, p) % 2) {
          let M = g.slice(1, -1);
          return { type: "em", raw: g, text: M, tokens: this.lexer.inlineTokens(M) };
        }
        let w = g.slice(2, -2);
        return { type: "strong", raw: g, text: w, tokens: this.lexer.inlineTokens(w) };
      }
    }
  }
  codespan(e) {
    let t = this.rules.inline.code.exec(e);
    if (t) {
      let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), s = this.rules.other.nonSpaceChar.test(n), r = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
      return s && r && (n = n.substring(1, n.length - 1)), { type: "codespan", raw: t[0], text: n };
    }
  }
  br(e) {
    let t = this.rules.inline.br.exec(e);
    if (t) return { type: "br", raw: t[0] };
  }
  del(e, t, n = "") {
    let s = this.rules.inline.delLDelim.exec(e);
    if (!s) return;
    if (!(s[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let i = [...s[0]].length - 1, o, p, a = i, u = this.rules.inline.delRDelim;
      for (u.lastIndex = 0, t = t.slice(-1 * e.length + i); (s = u.exec(t)) !== null; ) {
        if (o = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !o || (p = [...o].length, p !== i)) continue;
        if (s[3] || s[4]) {
          a += p;
          continue;
        }
        if (a -= p, a > 0) continue;
        p = Math.min(p, p + a);
        let c = [...s[0]][0].length, h2 = e.slice(0, i + s.index + c + p), d = h2.slice(i, -i);
        return { type: "del", raw: h2, text: d, tokens: this.lexer.inlineTokens(d) };
      }
    }
  }
  autolink(e) {
    let t = this.rules.inline.autolink.exec(e);
    if (t) {
      let n, s;
      return t[2] === "@" ? (n = t[1], s = "mailto:" + n) : (n = t[1], s = n), { type: "link", raw: t[0], text: n, href: s, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  url(e) {
    let t;
    if (t = this.rules.inline.url.exec(e)) {
      let n, s;
      if (t[2] === "@") n = t[0], s = "mailto:" + n;
      else {
        let r;
        do
          r = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
        while (r !== t[0]);
        n = t[0], t[1] === "www." ? s = "http://" + t[0] : s = t[0];
      }
      return { type: "link", raw: t[0], text: n, href: s, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  inlineText(e) {
    let t = this.rules.inline.text.exec(e);
    if (t) {
      let n = this.lexer.state.inRawBlock;
      return { type: "text", raw: t[0], text: t[0], escaped: n };
    }
  }
};
var x = class l2 {
  tokens;
  options;
  state;
  inlineQueue;
  tokenizer;
  constructor(e) {
    this.tokens = [], this.tokens.links = /* @__PURE__ */ Object.create(null), this.options = e || R, this.options.tokenizer = this.options.tokenizer || new y(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: false, inRawBlock: false, top: true };
    let t = { other: m, block: H2.normal, inline: B.normal };
    this.options.pedantic ? (t.block = H2.pedantic, t.inline = B.pedantic) : this.options.gfm && (t.block = H2.gfm, this.options.breaks ? t.inline = B.breaks : t.inline = B.gfm), this.tokenizer.rules = t;
  }
  static get rules() {
    return { block: H2, inline: B };
  }
  static lex(e, t) {
    return new l2(t).lex(e);
  }
  static lexInline(e, t) {
    return new l2(t).inlineTokens(e);
  }
  lex(e) {
    e = e.replace(m.carriageReturn, `
`), this.blockTokens(e, this.tokens);
    for (let t = 0; t < this.inlineQueue.length; t++) {
      let n = this.inlineQueue[t];
      this.inlineTokens(n.src, n.tokens);
    }
    return this.inlineQueue = [], this.tokens;
  }
  blockTokens(e, t = [], n = false) {
    this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(m.tabCharGlobal, "    ").replace(m.spaceLine, ""));
    let s = 1 / 0;
    for (; e; ) {
      if (e.length < s) s = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      let r;
      if (this.options.extensions?.block?.some((o) => (r = o.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), true) : false)) continue;
      if (r = this.tokenizer.space(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        r.raw.length === 1 && o !== void 0 ? o.raw += `
` : t.push(r);
        continue;
      }
      if (r = this.tokenizer.code(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        o?.type === "paragraph" || o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.at(-1).src = o.text) : t.push(r);
        continue;
      }
      if (r = this.tokenizer.fences(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.heading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.hr(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.blockquote(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.list(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.html(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.def(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        o?.type === "paragraph" || o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.raw, this.inlineQueue.at(-1).src = o.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = { href: r.href, title: r.title }, t.push(r));
        continue;
      }
      if (r = this.tokenizer.table(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.lheading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      let i = e;
      if (this.options.extensions?.startBlock) {
        let o = 1 / 0, p = e.slice(1), a;
        this.options.extensions.startBlock.forEach((u) => {
          a = u.call({ lexer: this }, p), typeof a == "number" && a >= 0 && (o = Math.min(o, a));
        }), o < 1 / 0 && o >= 0 && (i = e.substring(0, o + 1));
      }
      if (this.state.top && (r = this.tokenizer.paragraph(i))) {
        let o = t.at(-1);
        n && o?.type === "paragraph" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = o.text) : t.push(r), n = i.length !== e.length, e = e.substring(r.raw.length);
        continue;
      }
      if (r = this.tokenizer.text(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = o.text) : t.push(r);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return this.state.top = true, t;
  }
  inline(e, t = []) {
    return this.inlineQueue.push({ src: e, tokens: t }), t;
  }
  inlineTokens(e, t = []) {
    this.tokenizer.lexer = this;
    let n = e;
    if (this.tokens.links) {
      let o = Object.keys(this.tokens.links);
      o.length > 0 && (n = n.replace(this.tokenizer.rules.inline.reflinkSearch, (p) => o.includes(p.slice(p.lastIndexOf("[") + 1, -1)) ? "[" + "a".repeat(p.length - 2) + "]" : p));
    }
    n = n.replace(this.tokenizer.rules.inline.anyPunctuation, "++"), n = n.replace(this.tokenizer.rules.inline.blockSkip, (o, p, a) => {
      let u = a ? a.length : 0;
      return o.slice(0, u) + "[" + "a".repeat(o.length - u - 2) + "]";
    }), n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
    let s = false, r = "", i = 1 / 0;
    for (; e; ) {
      if (e.length < i) i = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      s || (r = ""), s = false;
      let o;
      if (this.options.extensions?.inline?.some((a) => (o = a.call({ lexer: this }, e, t)) ? (e = e.substring(o.raw.length), t.push(o), true) : false)) continue;
      if (o = this.tokenizer.escape(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.tag(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.link(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.reflink(e, this.tokens.links)) {
        e = e.substring(o.raw.length);
        let a = t.at(-1);
        o.type === "text" && a?.type === "text" ? (a.raw += o.raw, a.text += o.text) : t.push(o);
        continue;
      }
      if (o = this.tokenizer.emStrong(e, n, r)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.codespan(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.br(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.del(e, n, r)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.autolink(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (!this.state.inLink && (o = this.tokenizer.url(e))) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      let p = e;
      if (this.options.extensions?.startInline) {
        let a = 1 / 0, u = e.slice(1), c;
        this.options.extensions.startInline.forEach((h2) => {
          c = h2.call({ lexer: this }, u), typeof c == "number" && c >= 0 && (a = Math.min(a, c));
        }), a < 1 / 0 && a >= 0 && (p = e.substring(0, a + 1));
      }
      if (o = this.tokenizer.inlineText(p)) {
        e = e.substring(o.raw.length), o.raw.slice(-1) !== "_" && (r = o.raw.slice(-1)), s = true;
        let a = t.at(-1);
        a?.type === "text" ? (a.raw += o.raw, a.text += o.text) : t.push(o);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return t;
  }
  infiniteLoopError(e) {
    let t = "Infinite loop on byte: " + e;
    if (this.options.silent) console.error(t);
    else throw new Error(t);
  }
};
var P = class {
  options;
  parser;
  constructor(e) {
    this.options = e || R;
  }
  space(e) {
    return "";
  }
  code({ text: e, lang: t, escaped: n }) {
    let s = (t || "").match(m.notSpaceStart)?.[0], r = e.replace(m.endingNewline, "") + `
`;
    return s ? '<pre><code class="language-' + O(s) + '">' + (n ? r : O(r, true)) + `</code></pre>
` : "<pre><code>" + (n ? r : O(r, true)) + `</code></pre>
`;
  }
  blockquote({ tokens: e }) {
    return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
  }
  html({ text: e }) {
    return e;
  }
  def(e) {
    return "";
  }
  heading({ tokens: e, depth: t }) {
    return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
  }
  hr(e) {
    return `<hr>
`;
  }
  list(e) {
    let t = e.ordered, n = e.start, s = "";
    for (let o = 0; o < e.items.length; o++) {
      let p = e.items[o];
      s += this.listitem(p);
    }
    let r = t ? "ol" : "ul", i = t && n !== 1 ? ' start="' + n + '"' : "";
    return "<" + r + i + `>
` + s + "</" + r + `>
`;
  }
  listitem(e) {
    return `<li>${this.parser.parse(e.tokens)}</li>
`;
  }
  checkbox({ checked: e }) {
    return "<input " + (e ? 'checked="" ' : "") + 'disabled="" type="checkbox"> ';
  }
  paragraph({ tokens: e }) {
    return `<p>${this.parser.parseInline(e)}</p>
`;
  }
  table(e) {
    let t = "", n = "";
    for (let r = 0; r < e.header.length; r++) n += this.tablecell(e.header[r]);
    t += this.tablerow({ text: n });
    let s = "";
    for (let r = 0; r < e.rows.length; r++) {
      let i = e.rows[r];
      n = "";
      for (let o = 0; o < i.length; o++) n += this.tablecell(i[o]);
      s += this.tablerow({ text: n });
    }
    return s && (s = `<tbody>${s}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + s + `</table>
`;
  }
  tablerow({ text: e }) {
    return `<tr>
${e}</tr>
`;
  }
  tablecell(e) {
    let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
    return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
  }
  strong({ tokens: e }) {
    return `<strong>${this.parser.parseInline(e)}</strong>`;
  }
  em({ tokens: e }) {
    return `<em>${this.parser.parseInline(e)}</em>`;
  }
  codespan({ text: e }) {
    return `<code>${O(e, true)}</code>`;
  }
  br(e) {
    return "<br>";
  }
  del({ tokens: e }) {
    return `<del>${this.parser.parseInline(e)}</del>`;
  }
  link({ href: e, title: t, tokens: n }) {
    let s = this.parser.parseInline(n), r = Y2(e);
    if (r === null) return s;
    e = r;
    let i = '<a href="' + e + '"';
    return t && (i += ' title="' + O(t) + '"'), i += ">" + s + "</a>", i;
  }
  image({ href: e, title: t, text: n, tokens: s }) {
    s && (n = this.parser.parseInline(s, this.parser.textRenderer));
    let r = Y2(e);
    if (r === null) return O(n);
    e = r;
    let i = `<img src="${e}" alt="${O(n)}"`;
    return t && (i += ` title="${O(t)}"`), i += ">", i;
  }
  text(e) {
    return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : O(e.text);
  }
};
var L = class {
  strong({ text: e }) {
    return e;
  }
  em({ text: e }) {
    return e;
  }
  codespan({ text: e }) {
    return e;
  }
  del({ text: e }) {
    return e;
  }
  html({ text: e }) {
    return e;
  }
  text({ text: e }) {
    return e;
  }
  link({ text: e }) {
    return "" + e;
  }
  image({ text: e }) {
    return "" + e;
  }
  br() {
    return "";
  }
  checkbox({ raw: e }) {
    return e;
  }
};
var b = class l3 {
  options;
  renderer;
  textRenderer;
  constructor(e) {
    this.options = e || R, this.options.renderer = this.options.renderer || new P(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new L();
  }
  static parse(e, t) {
    return new l3(t).parse(e);
  }
  static parseInline(e, t) {
    return new l3(t).parseInline(e);
  }
  parse(e) {
    this.renderer.parser = this;
    let t = "";
    for (let n = 0; n < e.length; n++) {
      let s = e[n];
      if (this.options.extensions?.renderers?.[s.type]) {
        let i = s, o = this.options.extensions.renderers[i.type].call({ parser: this }, i);
        if (o !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "checkbox", "html", "def", "paragraph", "text"].includes(i.type)) {
          t += o || "";
          continue;
        }
      }
      let r = s;
      switch (r.type) {
        case "space": {
          t += this.renderer.space(r);
          break;
        }
        case "hr": {
          t += this.renderer.hr(r);
          break;
        }
        case "heading": {
          t += this.renderer.heading(r);
          break;
        }
        case "code": {
          t += this.renderer.code(r);
          break;
        }
        case "table": {
          t += this.renderer.table(r);
          break;
        }
        case "blockquote": {
          t += this.renderer.blockquote(r);
          break;
        }
        case "list": {
          t += this.renderer.list(r);
          break;
        }
        case "checkbox": {
          t += this.renderer.checkbox(r);
          break;
        }
        case "html": {
          t += this.renderer.html(r);
          break;
        }
        case "def": {
          t += this.renderer.def(r);
          break;
        }
        case "paragraph": {
          t += this.renderer.paragraph(r);
          break;
        }
        case "text": {
          t += this.renderer.text(r);
          break;
        }
        default: {
          let i = 'Token with "' + r.type + '" type was not found.';
          if (this.options.silent) return console.error(i), "";
          throw new Error(i);
        }
      }
    }
    return t;
  }
  parseInline(e, t = this.renderer) {
    this.renderer.parser = this;
    let n = "";
    for (let s = 0; s < e.length; s++) {
      let r = e[s];
      if (this.options.extensions?.renderers?.[r.type]) {
        let o = this.options.extensions.renderers[r.type].call({ parser: this }, r);
        if (o !== false || !["escape", "html", "link", "image", "checkbox", "strong", "em", "codespan", "br", "del", "text"].includes(r.type)) {
          n += o || "";
          continue;
        }
      }
      let i = r;
      switch (i.type) {
        case "escape": {
          n += t.text(i);
          break;
        }
        case "html": {
          n += t.html(i);
          break;
        }
        case "link": {
          n += t.link(i);
          break;
        }
        case "image": {
          n += t.image(i);
          break;
        }
        case "checkbox": {
          n += t.checkbox(i);
          break;
        }
        case "strong": {
          n += t.strong(i);
          break;
        }
        case "em": {
          n += t.em(i);
          break;
        }
        case "codespan": {
          n += t.codespan(i);
          break;
        }
        case "br": {
          n += t.br(i);
          break;
        }
        case "del": {
          n += t.del(i);
          break;
        }
        case "text": {
          n += t.text(i);
          break;
        }
        default: {
          let o = 'Token with "' + i.type + '" type was not found.';
          if (this.options.silent) return console.error(o), "";
          throw new Error(o);
        }
      }
    }
    return n;
  }
};
var S2 = class {
  options;
  block;
  constructor(e) {
    this.options = e || R;
  }
  static passThroughHooks = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"]);
  static passThroughHooksRespectAsync = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens"]);
  preprocess(e) {
    return e;
  }
  postprocess(e) {
    return e;
  }
  processAllTokens(e) {
    return e;
  }
  emStrongMask(e) {
    return e;
  }
  provideLexer(e = this.block) {
    return e ? x.lex : x.lexInline;
  }
  provideParser(e = this.block) {
    return e ? b.parse : b.parseInline;
  }
};
var Z2 = class {
  defaults = C2();
  options = this.setOptions;
  parse = this.parseMarkdown(true);
  parseInline = this.parseMarkdown(false);
  Parser = b;
  Renderer = P;
  TextRenderer = L;
  Lexer = x;
  Tokenizer = y;
  Hooks = S2;
  constructor(...e) {
    this.use(...e);
  }
  walkTokens(e, t) {
    let n = [];
    for (let s of e) switch (n = n.concat(t.call(this, s)), s.type) {
      case "table": {
        let r = s;
        for (let i of r.header) n = n.concat(this.walkTokens(i.tokens, t));
        for (let i of r.rows) for (let o of i) n = n.concat(this.walkTokens(o.tokens, t));
        break;
      }
      case "list": {
        let r = s;
        n = n.concat(this.walkTokens(r.items, t));
        break;
      }
      default: {
        let r = s;
        this.defaults.extensions?.childTokens?.[r.type] ? this.defaults.extensions.childTokens[r.type].forEach((i) => {
          let o = r[i].flat(1 / 0);
          n = n.concat(this.walkTokens(o, t));
        }) : r.tokens && (n = n.concat(this.walkTokens(r.tokens, t)));
      }
    }
    return n;
  }
  use(...e) {
    let t = this.defaults.extensions || { renderers: {}, childTokens: {} };
    return e.forEach((n) => {
      let s = { ...n };
      if (s.async = this.defaults.async || s.async || false, n.extensions && (n.extensions.forEach((r) => {
        if (!r.name) throw new Error("extension name required");
        if ("renderer" in r) {
          let i = t.renderers[r.name];
          i ? t.renderers[r.name] = function(...o) {
            let p = r.renderer.apply(this, o);
            return p === false && (p = i.apply(this, o)), p;
          } : t.renderers[r.name] = r.renderer;
        }
        if ("tokenizer" in r) {
          if (!r.level || r.level !== "block" && r.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
          let i = t[r.level];
          i ? i.unshift(r.tokenizer) : t[r.level] = [r.tokenizer], r.start && (r.level === "block" ? t.startBlock ? t.startBlock.push(r.start) : t.startBlock = [r.start] : r.level === "inline" && (t.startInline ? t.startInline.push(r.start) : t.startInline = [r.start]));
        }
        "childTokens" in r && r.childTokens && (t.childTokens[r.name] = r.childTokens);
      }), s.extensions = t), n.renderer) {
        let r = this.defaults.renderer || new P(this.defaults);
        for (let i in n.renderer) {
          if (!(i in r)) throw new Error(`renderer '${i}' does not exist`);
          if (["options", "parser"].includes(i)) continue;
          let o = i, p = n.renderer[o], a = r[o];
          r[o] = (...u) => {
            let c = p.apply(r, u);
            return c === false && (c = a.apply(r, u)), c || "";
          };
        }
        s.renderer = r;
      }
      if (n.tokenizer) {
        let r = this.defaults.tokenizer || new y(this.defaults);
        for (let i in n.tokenizer) {
          if (!(i in r)) throw new Error(`tokenizer '${i}' does not exist`);
          if (["options", "rules", "lexer"].includes(i)) continue;
          let o = i, p = n.tokenizer[o], a = r[o];
          r[o] = (...u) => {
            let c = p.apply(r, u);
            return c === false && (c = a.apply(r, u)), c;
          };
        }
        s.tokenizer = r;
      }
      if (n.hooks) {
        let r = this.defaults.hooks || new S2();
        for (let i in n.hooks) {
          if (!(i in r)) throw new Error(`hook '${i}' does not exist`);
          if (["options", "block"].includes(i)) continue;
          let o = i, p = n.hooks[o], a = r[o];
          S2.passThroughHooks.has(i) ? r[o] = (u) => {
            if (this.defaults.async && S2.passThroughHooksRespectAsync.has(i)) return (async () => {
              let h2 = await p.call(r, u);
              return a.call(r, h2);
            })();
            let c = p.call(r, u);
            return a.call(r, c);
          } : r[o] = (...u) => {
            if (this.defaults.async) return (async () => {
              let h2 = await p.apply(r, u);
              return h2 === false && (h2 = await a.apply(r, u)), h2;
            })();
            let c = p.apply(r, u);
            return c === false && (c = a.apply(r, u)), c;
          };
        }
        s.hooks = r;
      }
      if (n.walkTokens) {
        let r = this.defaults.walkTokens, i = n.walkTokens;
        s.walkTokens = function(o) {
          let p = [];
          return p.push(i.call(this, o)), r && (p = p.concat(r.call(this, o))), p;
        };
      }
      this.defaults = { ...this.defaults, ...s };
    }), this;
  }
  setOptions(e) {
    return this.defaults = { ...this.defaults, ...e }, this;
  }
  lexer(e, t) {
    return x.lex(e, t ?? this.defaults);
  }
  parser(e, t) {
    return b.parse(e, t ?? this.defaults);
  }
  parseMarkdown(e) {
    return (n, s) => {
      let r = { ...s }, i = { ...this.defaults, ...r }, o = this.onError(!!i.silent, !!i.async);
      if (this.defaults.async === true && r.async === false) return o(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
      if (typeof n > "u" || n === null) return o(new Error("marked(): input parameter is undefined or null"));
      if (typeof n != "string") return o(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
      if (i.hooks && (i.hooks.options = i, i.hooks.block = e), i.async) return (async () => {
        let p = i.hooks ? await i.hooks.preprocess(n) : n, u = await (i.hooks ? await i.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(p, i), c = i.hooks ? await i.hooks.processAllTokens(u) : u;
        i.walkTokens && await Promise.all(this.walkTokens(c, i.walkTokens));
        let d = await (i.hooks ? await i.hooks.provideParser(e) : e ? b.parse : b.parseInline)(c, i);
        return i.hooks ? await i.hooks.postprocess(d) : d;
      })().catch(o);
      try {
        i.hooks && (n = i.hooks.preprocess(n));
        let a = (i.hooks ? i.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(n, i);
        i.hooks && (a = i.hooks.processAllTokens(a)), i.walkTokens && this.walkTokens(a, i.walkTokens);
        let c = (i.hooks ? i.hooks.provideParser(e) : e ? b.parse : b.parseInline)(a, i);
        return i.hooks && (c = i.hooks.postprocess(c)), c;
      } catch (p) {
        return o(p);
      }
    };
  }
  onError(e, t) {
    return (n) => {
      if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
        let s = "<p>An error occurred:</p><pre>" + O(n.message + "", true) + "</pre>";
        return t ? Promise.resolve(s) : s;
      }
      if (t) return Promise.reject(n);
      throw n;
    };
  }
};
var E = new Z2();
function f(l4, e) {
  return E.parse(l4, e);
}
f.options = f.setOptions = function(l4) {
  return E.setOptions(l4), f.defaults = E.defaults, j(f.defaults), f;
};
f.getDefaults = C2;
f.defaults = R;
function kt(...l4) {
  return E.use(...l4), f.defaults = E.defaults, j(f.defaults), f;
}
f.use = kt;
f.walkTokens = function(l4, e) {
  return E.walkTokens(l4, e);
};
f.parseInline = E.parseInline;
f.Parser = b;
f.parser = b.parse;
f.Renderer = P;
f.TextRenderer = L;
f.Lexer = x;
f.lexer = x.lex;
f.Tokenizer = y;
f.Hooks = S2;
f.parse = f;
var nn = f.options;
var rn = f.setOptions;
var sn = f.walkTokens;
var on = f.parseInline;
var ln = b.parse;
var pn = x.lex;

// node_modules/dompurify/dist/purify.es.mjs
function _arrayLikeToArray2(r, a) {
  (null == a || a > r.length) && (a = r.length);
  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
  return n;
}
function _arrayWithHoles2(r) {
  if (Array.isArray(r)) return r;
}
function _iterableToArrayLimit2(r, l4) {
  var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
  if (null != t) {
    var e, n, i, u, a = [], f2 = true, o = false;
    try {
      if (i = (t = t.call(r)).next, 0 === l4) ;
      else for (; !(f2 = (e = i.call(t)).done) && (a.push(e.value), a.length !== l4); f2 = true) ;
    } catch (r2) {
      o = true, n = r2;
    } finally {
      try {
        if (!f2 && null != t.return && (u = t.return(), Object(u) !== u)) return;
      } finally {
        if (o) throw n;
      }
    }
    return a;
  }
}
function _nonIterableRest2() {
  throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _slicedToArray2(r, e) {
  return _arrayWithHoles2(r) || _iterableToArrayLimit2(r, e) || _unsupportedIterableToArray2(r, e) || _nonIterableRest2();
}
function _unsupportedIterableToArray2(r, a) {
  if (r) {
    if ("string" == typeof r) return _arrayLikeToArray2(r, a);
    var t = {}.toString.call(r).slice(8, -1);
    return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray2(r, a) : void 0;
  }
}
var entries = Object.entries;
var setPrototypeOf = Object.setPrototypeOf;
var isFrozen = Object.isFrozen;
var getPrototypeOf = Object.getPrototypeOf;
var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
var freeze = Object.freeze;
var seal = Object.seal;
var create2 = Object.create;
var _ref = typeof Reflect !== "undefined" && Reflect;
var apply = _ref.apply;
var construct = _ref.construct;
if (!freeze) {
  freeze = function freeze2(x2) {
    return x2;
  };
}
if (!seal) {
  seal = function seal2(x2) {
    return x2;
  };
}
if (!apply) {
  apply = function apply2(func, thisArg) {
    for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) {
      args[_key - 2] = arguments[_key];
    }
    return func.apply(thisArg, args);
  };
}
if (!construct) {
  construct = function construct2(Func) {
    for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
      args[_key2 - 1] = arguments[_key2];
    }
    return new Func(...args);
  };
}
var arrayForEach = unapply(Array.prototype.forEach);
var arrayLastIndexOf = unapply(Array.prototype.lastIndexOf);
var arrayPop = unapply(Array.prototype.pop);
var arrayPush = unapply(Array.prototype.push);
var arraySplice = unapply(Array.prototype.splice);
var arrayIsArray = Array.isArray;
var stringToLowerCase = unapply(String.prototype.toLowerCase);
var stringToString = unapply(String.prototype.toString);
var stringMatch = unapply(String.prototype.match);
var stringReplace = unapply(String.prototype.replace);
var stringIndexOf = unapply(String.prototype.indexOf);
var stringTrim = unapply(String.prototype.trim);
var numberToString = unapply(Number.prototype.toString);
var booleanToString = unapply(Boolean.prototype.toString);
var bigintToString = typeof BigInt === "undefined" ? null : unapply(BigInt.prototype.toString);
var symbolToString = typeof Symbol === "undefined" ? null : unapply(Symbol.prototype.toString);
var objectHasOwnProperty = unapply(Object.prototype.hasOwnProperty);
var objectToString = unapply(Object.prototype.toString);
var regExpTest = unapply(RegExp.prototype.test);
var typeErrorCreate = unconstruct(TypeError);
function unapply(func) {
  return function(thisArg) {
    if (thisArg instanceof RegExp) {
      thisArg.lastIndex = 0;
    }
    for (var _len3 = arguments.length, args = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
      args[_key3 - 1] = arguments[_key3];
    }
    return apply(func, thisArg, args);
  };
}
function unconstruct(Func) {
  return function() {
    for (var _len4 = arguments.length, args = new Array(_len4), _key4 = 0; _key4 < _len4; _key4++) {
      args[_key4] = arguments[_key4];
    }
    return construct(Func, args);
  };
}
function addToSet(set, array) {
  let transformCaseFunc = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : stringToLowerCase;
  if (setPrototypeOf) {
    setPrototypeOf(set, null);
  }
  if (!arrayIsArray(array)) {
    return set;
  }
  let l4 = array.length;
  while (l4--) {
    let element = array[l4];
    if (typeof element === "string") {
      const lcElement = transformCaseFunc(element);
      if (lcElement !== element) {
        if (!isFrozen(array)) {
          array[l4] = lcElement;
        }
        element = lcElement;
      }
    }
    set[element] = true;
  }
  return set;
}
function cleanArray(array) {
  for (let index2 = 0; index2 < array.length; index2++) {
    const isPropertyExist = objectHasOwnProperty(array, index2);
    if (!isPropertyExist) {
      array[index2] = null;
    }
  }
  return array;
}
function clone(object) {
  const newObject = create2(null);
  for (const _ref2 of entries(object)) {
    var _ref3 = _slicedToArray2(_ref2, 2);
    const property = _ref3[0];
    const value = _ref3[1];
    const isPropertyExist = objectHasOwnProperty(object, property);
    if (isPropertyExist) {
      if (arrayIsArray(value)) {
        newObject[property] = cleanArray(value);
      } else if (value && typeof value === "object" && value.constructor === Object) {
        newObject[property] = clone(value);
      } else {
        newObject[property] = value;
      }
    }
  }
  return newObject;
}
function stringifyValue(value) {
  switch (typeof value) {
    case "string": {
      return value;
    }
    case "number": {
      return numberToString(value);
    }
    case "boolean": {
      return booleanToString(value);
    }
    case "bigint": {
      return bigintToString ? bigintToString(value) : "0";
    }
    case "symbol": {
      return symbolToString ? symbolToString(value) : "Symbol()";
    }
    case "undefined": {
      return objectToString(value);
    }
    case "function":
    case "object": {
      if (value === null) {
        return objectToString(value);
      }
      const valueAsRecord = value;
      const valueToString = lookupGetter(valueAsRecord, "toString");
      if (typeof valueToString === "function") {
        const stringified = valueToString(valueAsRecord);
        return typeof stringified === "string" ? stringified : objectToString(stringified);
      }
      return objectToString(value);
    }
    default: {
      return objectToString(value);
    }
  }
}
function lookupGetter(object, prop) {
  while (object !== null) {
    const desc = getOwnPropertyDescriptor(object, prop);
    if (desc) {
      if (desc.get) {
        return unapply(desc.get);
      }
      if (typeof desc.value === "function") {
        return unapply(desc.value);
      }
    }
    object = getPrototypeOf(object);
  }
  function fallbackValue() {
    return null;
  }
  return fallbackValue;
}
function isRegex(value) {
  try {
    regExpTest(value, "");
    return true;
  } catch (_unused) {
    return false;
  }
}
var html$1 = freeze(["a", "abbr", "acronym", "address", "area", "article", "aside", "audio", "b", "bdi", "bdo", "big", "blink", "blockquote", "body", "br", "button", "canvas", "caption", "center", "cite", "code", "col", "colgroup", "content", "data", "datalist", "dd", "decorator", "del", "details", "dfn", "dialog", "dir", "div", "dl", "dt", "element", "em", "fieldset", "figcaption", "figure", "font", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html", "i", "img", "input", "ins", "kbd", "label", "legend", "li", "main", "map", "mark", "marquee", "menu", "menuitem", "meter", "nav", "nobr", "ol", "optgroup", "option", "output", "p", "picture", "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "search", "section", "select", "shadow", "slot", "small", "source", "spacer", "span", "strike", "strong", "style", "sub", "summary", "sup", "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "time", "tr", "track", "tt", "u", "ul", "var", "video", "wbr"]);
var svg$1 = freeze(["svg", "a", "altglyph", "altglyphdef", "altglyphitem", "animatecolor", "animatemotion", "animatetransform", "circle", "clippath", "defs", "desc", "ellipse", "enterkeyhint", "exportparts", "filter", "font", "g", "glyph", "glyphref", "hkern", "image", "inputmode", "line", "lineargradient", "marker", "mask", "metadata", "mpath", "part", "path", "pattern", "polygon", "polyline", "radialgradient", "rect", "stop", "style", "switch", "symbol", "text", "textpath", "title", "tref", "tspan", "view", "vkern"]);
var svgFilters = freeze(["feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix", "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur", "feImage", "feMerge", "feMergeNode", "feMorphology", "feOffset", "fePointLight", "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence"]);
var svgDisallowed = freeze(["animate", "color-profile", "cursor", "discard", "font-face", "font-face-format", "font-face-name", "font-face-src", "font-face-uri", "foreignobject", "hatch", "hatchpath", "mesh", "meshgradient", "meshpatch", "meshrow", "missing-glyph", "script", "set", "solidcolor", "unknown", "use"]);
var mathMl$1 = freeze(["math", "menclose", "merror", "mfenced", "mfrac", "mglyph", "mi", "mlabeledtr", "mmultiscripts", "mn", "mo", "mover", "mpadded", "mphantom", "mroot", "mrow", "ms", "mspace", "msqrt", "mstyle", "msub", "msup", "msubsup", "mtable", "mtd", "mtext", "mtr", "munder", "munderover", "mprescripts"]);
var mathMlDisallowed = freeze(["maction", "maligngroup", "malignmark", "mlongdiv", "mscarries", "mscarry", "msgroup", "mstack", "msline", "msrow", "semantics", "annotation", "annotation-xml", "mprescripts", "none"]);
var text = freeze(["#text"]);
var html = freeze(["accept", "action", "align", "alt", "autocapitalize", "autocomplete", "autopictureinpicture", "autoplay", "background", "bgcolor", "border", "capture", "cellpadding", "cellspacing", "checked", "cite", "class", "clear", "color", "cols", "colspan", "command", "commandfor", "controls", "controlslist", "coords", "crossorigin", "datetime", "decoding", "default", "dir", "disabled", "disablepictureinpicture", "disableremoteplayback", "download", "draggable", "enctype", "enterkeyhint", "exportparts", "face", "for", "headers", "height", "hidden", "high", "href", "hreflang", "id", "inert", "inputmode", "integrity", "ismap", "kind", "label", "lang", "list", "loading", "loop", "low", "max", "maxlength", "media", "method", "min", "minlength", "multiple", "muted", "name", "nonce", "noshade", "novalidate", "nowrap", "open", "optimum", "part", "pattern", "placeholder", "playsinline", "popover", "popovertarget", "popovertargetaction", "poster", "preload", "pubdate", "radiogroup", "readonly", "rel", "required", "rev", "reversed", "role", "rows", "rowspan", "spellcheck", "scope", "selected", "shape", "size", "sizes", "slot", "span", "srclang", "start", "src", "srcset", "step", "style", "summary", "tabindex", "title", "translate", "type", "usemap", "valign", "value", "width", "wrap", "xmlns"]);
var svg = freeze(["accent-height", "accumulate", "additive", "alignment-baseline", "amplitude", "ascent", "attributename", "attributetype", "azimuth", "basefrequency", "baseline-shift", "begin", "bias", "by", "class", "clip", "clippathunits", "clip-path", "clip-rule", "color", "color-interpolation", "color-interpolation-filters", "color-profile", "color-rendering", "cx", "cy", "d", "dx", "dy", "diffuseconstant", "direction", "display", "divisor", "dominant-baseline", "dur", "edgemode", "elevation", "end", "exponent", "fill", "fill-opacity", "fill-rule", "filter", "filterunits", "flood-color", "flood-opacity", "font-family", "font-size", "font-size-adjust", "font-stretch", "font-style", "font-variant", "font-weight", "fx", "fy", "g1", "g2", "glyph-name", "glyphref", "gradientunits", "gradienttransform", "height", "href", "id", "image-rendering", "in", "in2", "intercept", "k", "k1", "k2", "k3", "k4", "kerning", "keypoints", "keysplines", "keytimes", "lang", "lengthadjust", "letter-spacing", "kernelmatrix", "kernelunitlength", "lighting-color", "local", "marker-end", "marker-mid", "marker-start", "markerheight", "markerunits", "markerwidth", "maskcontentunits", "maskunits", "max", "mask", "mask-type", "media", "method", "mode", "min", "name", "numoctaves", "offset", "operator", "opacity", "order", "orient", "orientation", "origin", "overflow", "paint-order", "path", "pathlength", "patterncontentunits", "patterntransform", "patternunits", "points", "preservealpha", "preserveaspectratio", "primitiveunits", "r", "rx", "ry", "radius", "refx", "refy", "repeatcount", "repeatdur", "restart", "result", "rotate", "scale", "seed", "shape-rendering", "slope", "specularconstant", "specularexponent", "spreadmethod", "startoffset", "stddeviation", "stitchtiles", "stop-color", "stop-opacity", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-opacity", "stroke", "stroke-width", "style", "surfacescale", "systemlanguage", "tabindex", "tablevalues", "targetx", "targety", "transform", "transform-origin", "text-anchor", "text-decoration", "text-orientation", "text-rendering", "textlength", "type", "u1", "u2", "unicode", "values", "viewbox", "visibility", "version", "vert-adv-y", "vert-origin-x", "vert-origin-y", "width", "word-spacing", "wrap", "writing-mode", "xchannelselector", "ychannelselector", "x", "x1", "x2", "xmlns", "y", "y1", "y2", "z", "zoomandpan"]);
var mathMl = freeze(["accent", "accentunder", "align", "bevelled", "close", "columnalign", "columnlines", "columnspacing", "columnspan", "denomalign", "depth", "dir", "display", "displaystyle", "encoding", "fence", "frame", "height", "href", "id", "largeop", "length", "linethickness", "lquote", "lspace", "mathbackground", "mathcolor", "mathsize", "mathvariant", "maxsize", "minsize", "movablelimits", "notation", "numalign", "open", "rowalign", "rowlines", "rowspacing", "rowspan", "rspace", "rquote", "scriptlevel", "scriptminsize", "scriptsizemultiplier", "selection", "separator", "separators", "stretchy", "subscriptshift", "supscriptshift", "symmetric", "voffset", "width", "xmlns"]);
var xml = freeze(["xlink:href", "xml:id", "xlink:title", "xml:space", "xmlns:xlink"]);
var MUSTACHE_EXPR = seal(/{{[\w\W]*|^[\w\W]*}}/g);
var ERB_EXPR = seal(/<%[\w\W]*|^[\w\W]*%>/g);
var TMPLIT_EXPR = seal(/\${[\w\W]*/g);
var DATA_ATTR = seal(/^data-[\-\w.\u00B7-\uFFFF]+$/);
var ARIA_ATTR = seal(/^aria-[\-\w]+$/);
var IS_ALLOWED_URI = seal(
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
  // eslint-disable-line no-useless-escape
);
var IS_SCRIPT_OR_DATA = seal(/^(?:\w+script|data):/i);
var ATTR_WHITESPACE = seal(
  /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g
  // eslint-disable-line no-control-regex
);
var DOCTYPE_NAME = seal(/^html$/i);
var CUSTOM_ELEMENT = seal(/^[a-z][.\w]*(-[.\w]+)+$/i);
var ELEMENT_MARKUP_PROBE = seal(/<[/\w!]/g);
var COMMENT_MARKUP_PROBE = seal(/<[/\w]/g);
var FALLBACK_TAG_CLOSE = seal(/<\/no(script|embed|frames)/i);
var SELF_CLOSING_TAG = seal(/\/>/i);
var NODE_TYPE = {
  element: 1,
  attribute: 2,
  text: 3,
  cdataSection: 4,
  entityReference: 5,
  // Deprecated
  entityNode: 6,
  // Deprecated
  processingInstruction: 7,
  comment: 8,
  document: 9,
  documentType: 10,
  documentFragment: 11,
  notation: 12
  // Deprecated
};
var getGlobal = function getGlobal2() {
  return typeof window === "undefined" ? null : window;
};
var _createTrustedTypesPolicy = function _createTrustedTypesPolicy2(trustedTypes, purifyHostElement) {
  if (typeof trustedTypes !== "object" || typeof trustedTypes.createPolicy !== "function") {
    return null;
  }
  let suffix = null;
  const ATTR_NAME = "data-tt-policy-suffix";
  if (purifyHostElement && purifyHostElement.hasAttribute(ATTR_NAME)) {
    suffix = purifyHostElement.getAttribute(ATTR_NAME);
  }
  const policyName = "dompurify" + (suffix ? "#" + suffix : "");
  try {
    return trustedTypes.createPolicy(policyName, {
      createHTML(html2) {
        return html2;
      },
      createScriptURL(scriptUrl) {
        return scriptUrl;
      }
    });
  } catch (_3) {
    console.warn("TrustedTypes policy " + policyName + " could not be created.");
    return null;
  }
};
var _createHooksMap = function _createHooksMap2() {
  return {
    afterSanitizeAttributes: [],
    afterSanitizeElements: [],
    afterSanitizeShadowDOM: [],
    beforeSanitizeAttributes: [],
    beforeSanitizeElements: [],
    beforeSanitizeShadowDOM: [],
    uponSanitizeAttribute: [],
    uponSanitizeElement: [],
    uponSanitizeShadowNode: []
  };
};
var _resolveSetOption = function _resolveSetOption2(cfg, key, fallback, options) {
  return objectHasOwnProperty(cfg, key) && arrayIsArray(cfg[key]) ? addToSet(options.base ? clone(options.base) : {}, cfg[key], options.transform) : fallback;
};
function createDOMPurify() {
  let window2 = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : getGlobal();
  const DOMPurify = (root) => createDOMPurify(root);
  DOMPurify.version = "3.4.13";
  DOMPurify.removed = [];
  if (!window2 || !window2.document || window2.document.nodeType !== NODE_TYPE.document || !window2.Element) {
    DOMPurify.isSupported = false;
    return DOMPurify;
  }
  let document2 = window2.document;
  const originalDocument = document2;
  const currentScript = originalDocument.currentScript;
  window2.DocumentFragment;
  const HTMLTemplateElement = window2.HTMLTemplateElement, Node = window2.Node, Element = window2.Element, NodeFilter = window2.NodeFilter, _window$NamedNodeMap = window2.NamedNodeMap;
  _window$NamedNodeMap === void 0 ? window2.NamedNodeMap || window2.MozNamedAttrMap : _window$NamedNodeMap;
  window2.HTMLFormElement;
  const DOMParser = window2.DOMParser, trustedTypes = window2.trustedTypes;
  const ElementPrototype = Element.prototype;
  const cloneNode = lookupGetter(ElementPrototype, "cloneNode");
  const remove = lookupGetter(ElementPrototype, "remove");
  const getNextSibling = lookupGetter(ElementPrototype, "nextSibling");
  const getChildNodes = lookupGetter(ElementPrototype, "childNodes");
  const getParentNode = lookupGetter(ElementPrototype, "parentNode");
  const getShadowRoot = lookupGetter(ElementPrototype, "shadowRoot");
  const getAttributes = lookupGetter(ElementPrototype, "attributes");
  const getNodeType = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeType") : null;
  const getNodeName = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeName") : null;
  const getOwnerDocument = Node && Node.prototype ? lookupGetter(Node.prototype, "ownerDocument") : null;
  if (typeof HTMLTemplateElement === "function") {
    const template = document2.createElement("template");
    if (template.content && template.content.ownerDocument) {
      document2 = template.content.ownerDocument;
    }
  }
  let trustedTypesPolicy;
  let emptyHTML = "";
  let defaultTrustedTypesPolicy;
  let defaultTrustedTypesPolicyResolved = false;
  let IN_TRUSTED_TYPES_POLICY = 0;
  const _assertNotInTrustedTypesPolicy = function _assertNotInTrustedTypesPolicy2() {
    if (IN_TRUSTED_TYPES_POLICY > 0) {
      throw typeErrorCreate('A configured TRUSTED_TYPES_POLICY callback (createHTML or createScriptURL) must not call DOMPurify.sanitize, as that causes infinite recursion. Do not pass a policy whose callbacks wrap DOMPurify as TRUSTED_TYPES_POLICY; see the "DOMPurify and Trusted Types" section of the README.');
    }
  };
  const _createTrustedHTML = function _createTrustedHTML2(html2) {
    _assertNotInTrustedTypesPolicy();
    IN_TRUSTED_TYPES_POLICY++;
    try {
      return trustedTypesPolicy.createHTML(html2);
    } finally {
      IN_TRUSTED_TYPES_POLICY--;
    }
  };
  const _createTrustedScriptURL = function _createTrustedScriptURL2(scriptUrl) {
    _assertNotInTrustedTypesPolicy();
    IN_TRUSTED_TYPES_POLICY++;
    try {
      return trustedTypesPolicy.createScriptURL(scriptUrl);
    } finally {
      IN_TRUSTED_TYPES_POLICY--;
    }
  };
  const _getDefaultTrustedTypesPolicy = function _getDefaultTrustedTypesPolicy2() {
    if (!defaultTrustedTypesPolicyResolved) {
      defaultTrustedTypesPolicy = _createTrustedTypesPolicy(trustedTypes, currentScript);
      defaultTrustedTypesPolicyResolved = true;
    }
    return defaultTrustedTypesPolicy;
  };
  const _document = document2, implementation = _document.implementation, createNodeIterator = _document.createNodeIterator, createDocumentFragment = _document.createDocumentFragment, getElementsByTagName = _document.getElementsByTagName;
  const importNode = originalDocument.importNode;
  let hooks2 = _createHooksMap();
  DOMPurify.isSupported = typeof entries === "function" && typeof getParentNode === "function" && implementation && implementation.createHTMLDocument !== void 0;
  const MUSTACHE_EXPR$1 = MUSTACHE_EXPR, ERB_EXPR$1 = ERB_EXPR, TMPLIT_EXPR$1 = TMPLIT_EXPR, DATA_ATTR$1 = DATA_ATTR, ARIA_ATTR$1 = ARIA_ATTR, IS_SCRIPT_OR_DATA$1 = IS_SCRIPT_OR_DATA, ATTR_WHITESPACE$1 = ATTR_WHITESPACE, CUSTOM_ELEMENT$1 = CUSTOM_ELEMENT;
  let IS_ALLOWED_URI$1 = IS_ALLOWED_URI;
  let ALLOWED_TAGS = null;
  const DEFAULT_ALLOWED_TAGS = addToSet({}, [...html$1, ...svg$1, ...svgFilters, ...mathMl$1, ...text]);
  let ALLOWED_ATTR = null;
  const DEFAULT_ALLOWED_ATTR = addToSet({}, [...html, ...svg, ...mathMl, ...xml]);
  let CUSTOM_ELEMENT_HANDLING = Object.seal(create2(null, {
    tagNameCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    },
    attributeNameCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    },
    allowCustomizedBuiltInElements: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: false
    }
  }));
  let FORBID_TAGS = null;
  let FORBID_ATTR = null;
  const EXTRA_ELEMENT_HANDLING = Object.seal(create2(null, {
    tagCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    },
    attributeCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    }
  }));
  let ALLOW_ARIA_ATTR = true;
  let ALLOW_DATA_ATTR = true;
  let ALLOW_UNKNOWN_PROTOCOLS = false;
  let ALLOW_SELF_CLOSE_IN_ATTR = true;
  let SAFE_FOR_TEMPLATES = false;
  let SAFE_FOR_XML = true;
  let WHOLE_DOCUMENT = false;
  let SET_CONFIG = false;
  let SET_CONFIG_ALLOWED_TAGS = null;
  let SET_CONFIG_ALLOWED_ATTR = null;
  let FORCE_BODY = false;
  let RETURN_DOM = false;
  let RETURN_DOM_FRAGMENT = false;
  let RETURN_TRUSTED_TYPE = false;
  let SANITIZE_DOM = true;
  let SANITIZE_NAMED_PROPS = false;
  const SANITIZE_NAMED_PROPS_PREFIX = "user-content-";
  let KEEP_CONTENT = true;
  let IN_PLACE = false;
  let USE_PROFILES = {};
  let FORBID_CONTENTS = null;
  const DEFAULT_FORBID_CONTENTS = addToSet({}, [
    "annotation-xml",
    "audio",
    "colgroup",
    "desc",
    "foreignobject",
    "head",
    "iframe",
    "math",
    "mi",
    "mn",
    "mo",
    "ms",
    "mtext",
    "noembed",
    "noframes",
    "noscript",
    "plaintext",
    "script",
    // <selectedcontent> mirrors the selected <option>'s subtree, cloned by
    // the UA (customizable <select>) — including any on* handlers — and the
    // engine re-mirrors synchronously whenever a removal changes which
    // option/selectedcontent is current, even inside DOMPurify's inert
    // DOMParser document. Hoisting its children on removal re-inserts a fresh
    // mirror target ahead of the walk, which the engine refills, looping
    // forever (DoS) and amplifying output. Dropping its content on removal
    // (rather than hoisting) breaks that cascade; the content is a duplicate
    // of the option, which is sanitized on its own. See campaign-3 F1/F6.
    "selectedcontent",
    "style",
    "svg",
    "template",
    "thead",
    "title",
    "video",
    "xmp"
  ]);
  let DATA_URI_TAGS = null;
  const DEFAULT_DATA_URI_TAGS = addToSet({}, ["audio", "video", "img", "source", "image", "track"]);
  let URI_SAFE_ATTRIBUTES = null;
  const DEFAULT_URI_SAFE_ATTRIBUTES = addToSet({}, ["alt", "class", "for", "id", "label", "name", "pattern", "placeholder", "role", "summary", "title", "value", "style", "xmlns"]);
  const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
  let NAMESPACE = HTML_NAMESPACE;
  let IS_EMPTY_INPUT = false;
  let ALLOWED_NAMESPACES = null;
  const DEFAULT_ALLOWED_NAMESPACES = addToSet({}, [MATHML_NAMESPACE, SVG_NAMESPACE, HTML_NAMESPACE], stringToString);
  const DEFAULT_MATHML_TEXT_INTEGRATION_POINTS = freeze(["mi", "mo", "mn", "ms", "mtext"]);
  let MATHML_TEXT_INTEGRATION_POINTS = addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS);
  const DEFAULT_HTML_INTEGRATION_POINTS = freeze(["annotation-xml"]);
  let HTML_INTEGRATION_POINTS = addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS);
  const COMMON_SVG_AND_HTML_ELEMENTS = addToSet({}, ["title", "style", "font", "a", "script"]);
  let PARSER_MEDIA_TYPE = null;
  const SUPPORTED_PARSER_MEDIA_TYPES = ["application/xhtml+xml", "text/html"];
  const DEFAULT_PARSER_MEDIA_TYPE = "text/html";
  let transformCaseFunc = null;
  let CONFIG = null;
  const formElement = document2.createElement("form");
  const isRegexOrFunction = function isRegexOrFunction2(testValue) {
    return testValue instanceof RegExp || testValue instanceof Function;
  };
  const _parseConfig = function _parseConfig2() {
    let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
    if (CONFIG && CONFIG === cfg) {
      return;
    }
    if (!cfg || typeof cfg !== "object") {
      cfg = {};
    }
    cfg = clone(cfg);
    PARSER_MEDIA_TYPE = // eslint-disable-next-line unicorn/prefer-includes
    SUPPORTED_PARSER_MEDIA_TYPES.indexOf(cfg.PARSER_MEDIA_TYPE) === -1 ? DEFAULT_PARSER_MEDIA_TYPE : cfg.PARSER_MEDIA_TYPE;
    transformCaseFunc = PARSER_MEDIA_TYPE === "application/xhtml+xml" ? stringToString : stringToLowerCase;
    ALLOWED_TAGS = _resolveSetOption(cfg, "ALLOWED_TAGS", DEFAULT_ALLOWED_TAGS, {
      transform: transformCaseFunc
    });
    ALLOWED_ATTR = _resolveSetOption(cfg, "ALLOWED_ATTR", DEFAULT_ALLOWED_ATTR, {
      transform: transformCaseFunc
    });
    ALLOWED_NAMESPACES = _resolveSetOption(cfg, "ALLOWED_NAMESPACES", DEFAULT_ALLOWED_NAMESPACES, {
      transform: stringToString
    });
    URI_SAFE_ATTRIBUTES = _resolveSetOption(cfg, "ADD_URI_SAFE_ATTR", DEFAULT_URI_SAFE_ATTRIBUTES, {
      transform: transformCaseFunc,
      base: DEFAULT_URI_SAFE_ATTRIBUTES
    });
    DATA_URI_TAGS = _resolveSetOption(cfg, "ADD_DATA_URI_TAGS", DEFAULT_DATA_URI_TAGS, {
      transform: transformCaseFunc,
      base: DEFAULT_DATA_URI_TAGS
    });
    FORBID_CONTENTS = _resolveSetOption(cfg, "FORBID_CONTENTS", DEFAULT_FORBID_CONTENTS, {
      transform: transformCaseFunc
    });
    FORBID_TAGS = _resolveSetOption(cfg, "FORBID_TAGS", clone({}), {
      transform: transformCaseFunc
    });
    FORBID_ATTR = _resolveSetOption(cfg, "FORBID_ATTR", clone({}), {
      transform: transformCaseFunc
    });
    USE_PROFILES = objectHasOwnProperty(cfg, "USE_PROFILES") ? cfg.USE_PROFILES && typeof cfg.USE_PROFILES === "object" ? clone(cfg.USE_PROFILES) : cfg.USE_PROFILES : false;
    ALLOW_ARIA_ATTR = cfg.ALLOW_ARIA_ATTR !== false;
    ALLOW_DATA_ATTR = cfg.ALLOW_DATA_ATTR !== false;
    ALLOW_UNKNOWN_PROTOCOLS = cfg.ALLOW_UNKNOWN_PROTOCOLS || false;
    ALLOW_SELF_CLOSE_IN_ATTR = cfg.ALLOW_SELF_CLOSE_IN_ATTR !== false;
    SAFE_FOR_TEMPLATES = cfg.SAFE_FOR_TEMPLATES || false;
    SAFE_FOR_XML = cfg.SAFE_FOR_XML !== false;
    WHOLE_DOCUMENT = cfg.WHOLE_DOCUMENT || false;
    RETURN_DOM = cfg.RETURN_DOM || false;
    RETURN_DOM_FRAGMENT = cfg.RETURN_DOM_FRAGMENT || false;
    RETURN_TRUSTED_TYPE = cfg.RETURN_TRUSTED_TYPE || false;
    FORCE_BODY = cfg.FORCE_BODY || false;
    SANITIZE_DOM = cfg.SANITIZE_DOM !== false;
    SANITIZE_NAMED_PROPS = cfg.SANITIZE_NAMED_PROPS || false;
    KEEP_CONTENT = cfg.KEEP_CONTENT !== false;
    IN_PLACE = cfg.IN_PLACE || false;
    IS_ALLOWED_URI$1 = isRegex(cfg.ALLOWED_URI_REGEXP) ? cfg.ALLOWED_URI_REGEXP : IS_ALLOWED_URI;
    NAMESPACE = typeof cfg.NAMESPACE === "string" ? cfg.NAMESPACE : HTML_NAMESPACE;
    MATHML_TEXT_INTEGRATION_POINTS = objectHasOwnProperty(cfg, "MATHML_TEXT_INTEGRATION_POINTS") && cfg.MATHML_TEXT_INTEGRATION_POINTS && typeof cfg.MATHML_TEXT_INTEGRATION_POINTS === "object" ? clone(cfg.MATHML_TEXT_INTEGRATION_POINTS) : addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS);
    HTML_INTEGRATION_POINTS = objectHasOwnProperty(cfg, "HTML_INTEGRATION_POINTS") && cfg.HTML_INTEGRATION_POINTS && typeof cfg.HTML_INTEGRATION_POINTS === "object" ? clone(cfg.HTML_INTEGRATION_POINTS) : addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS);
    const customElementHandling = objectHasOwnProperty(cfg, "CUSTOM_ELEMENT_HANDLING") && cfg.CUSTOM_ELEMENT_HANDLING && typeof cfg.CUSTOM_ELEMENT_HANDLING === "object" ? clone(cfg.CUSTOM_ELEMENT_HANDLING) : create2(null);
    CUSTOM_ELEMENT_HANDLING = create2(null);
    if (objectHasOwnProperty(customElementHandling, "tagNameCheck") && isRegexOrFunction(customElementHandling.tagNameCheck)) {
      CUSTOM_ELEMENT_HANDLING.tagNameCheck = customElementHandling.tagNameCheck;
    }
    if (objectHasOwnProperty(customElementHandling, "attributeNameCheck") && isRegexOrFunction(customElementHandling.attributeNameCheck)) {
      CUSTOM_ELEMENT_HANDLING.attributeNameCheck = customElementHandling.attributeNameCheck;
    }
    if (objectHasOwnProperty(customElementHandling, "allowCustomizedBuiltInElements") && typeof customElementHandling.allowCustomizedBuiltInElements === "boolean") {
      CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements = customElementHandling.allowCustomizedBuiltInElements;
    }
    seal(CUSTOM_ELEMENT_HANDLING);
    if (SAFE_FOR_TEMPLATES) {
      ALLOW_DATA_ATTR = false;
    }
    if (RETURN_DOM_FRAGMENT) {
      RETURN_DOM = true;
    }
    if (USE_PROFILES) {
      ALLOWED_TAGS = addToSet({}, text);
      ALLOWED_ATTR = create2(null);
      if (USE_PROFILES.html === true) {
        addToSet(ALLOWED_TAGS, html$1);
        addToSet(ALLOWED_ATTR, html);
      }
      if (USE_PROFILES.svg === true) {
        addToSet(ALLOWED_TAGS, svg$1);
        addToSet(ALLOWED_ATTR, svg);
        addToSet(ALLOWED_ATTR, xml);
      }
      if (USE_PROFILES.svgFilters === true) {
        addToSet(ALLOWED_TAGS, svgFilters);
        addToSet(ALLOWED_ATTR, svg);
        addToSet(ALLOWED_ATTR, xml);
      }
      if (USE_PROFILES.mathMl === true) {
        addToSet(ALLOWED_TAGS, mathMl$1);
        addToSet(ALLOWED_ATTR, mathMl);
        addToSet(ALLOWED_ATTR, xml);
      }
    }
    EXTRA_ELEMENT_HANDLING.tagCheck = null;
    EXTRA_ELEMENT_HANDLING.attributeCheck = null;
    if (objectHasOwnProperty(cfg, "ADD_TAGS")) {
      if (typeof cfg.ADD_TAGS === "function") {
        EXTRA_ELEMENT_HANDLING.tagCheck = cfg.ADD_TAGS;
      } else if (arrayIsArray(cfg.ADD_TAGS)) {
        if (ALLOWED_TAGS === DEFAULT_ALLOWED_TAGS) {
          ALLOWED_TAGS = clone(ALLOWED_TAGS);
        }
        addToSet(ALLOWED_TAGS, cfg.ADD_TAGS, transformCaseFunc);
      }
    }
    if (objectHasOwnProperty(cfg, "ADD_ATTR")) {
      if (typeof cfg.ADD_ATTR === "function") {
        EXTRA_ELEMENT_HANDLING.attributeCheck = cfg.ADD_ATTR;
      } else if (arrayIsArray(cfg.ADD_ATTR)) {
        if (ALLOWED_ATTR === DEFAULT_ALLOWED_ATTR) {
          ALLOWED_ATTR = clone(ALLOWED_ATTR);
        }
        addToSet(ALLOWED_ATTR, cfg.ADD_ATTR, transformCaseFunc);
      }
    }
    if (objectHasOwnProperty(cfg, "ADD_URI_SAFE_ATTR") && arrayIsArray(cfg.ADD_URI_SAFE_ATTR)) {
      addToSet(URI_SAFE_ATTRIBUTES, cfg.ADD_URI_SAFE_ATTR, transformCaseFunc);
    }
    if (objectHasOwnProperty(cfg, "FORBID_CONTENTS") && arrayIsArray(cfg.FORBID_CONTENTS)) {
      if (FORBID_CONTENTS === DEFAULT_FORBID_CONTENTS) {
        FORBID_CONTENTS = clone(FORBID_CONTENTS);
      }
      addToSet(FORBID_CONTENTS, cfg.FORBID_CONTENTS, transformCaseFunc);
    }
    if (objectHasOwnProperty(cfg, "ADD_FORBID_CONTENTS") && arrayIsArray(cfg.ADD_FORBID_CONTENTS)) {
      if (FORBID_CONTENTS === DEFAULT_FORBID_CONTENTS) {
        FORBID_CONTENTS = clone(FORBID_CONTENTS);
      }
      addToSet(FORBID_CONTENTS, cfg.ADD_FORBID_CONTENTS, transformCaseFunc);
    }
    if (KEEP_CONTENT) {
      ALLOWED_TAGS["#text"] = true;
    }
    if (WHOLE_DOCUMENT) {
      addToSet(ALLOWED_TAGS, ["html", "head", "body"]);
    }
    if (ALLOWED_TAGS.table) {
      addToSet(ALLOWED_TAGS, ["tbody"]);
      delete FORBID_TAGS.tbody;
    }
    if (cfg.TRUSTED_TYPES_POLICY) {
      if (typeof cfg.TRUSTED_TYPES_POLICY.createHTML !== "function") {
        throw typeErrorCreate('TRUSTED_TYPES_POLICY configuration option must provide a "createHTML" hook.');
      }
      if (typeof cfg.TRUSTED_TYPES_POLICY.createScriptURL !== "function") {
        throw typeErrorCreate('TRUSTED_TYPES_POLICY configuration option must provide a "createScriptURL" hook.');
      }
      const previousTrustedTypesPolicy = trustedTypesPolicy;
      trustedTypesPolicy = cfg.TRUSTED_TYPES_POLICY;
      try {
        emptyHTML = _createTrustedHTML("");
      } catch (error) {
        trustedTypesPolicy = previousTrustedTypesPolicy;
        throw error;
      }
    } else if (cfg.TRUSTED_TYPES_POLICY === null) {
      trustedTypesPolicy = void 0;
      emptyHTML = "";
    } else {
      if (trustedTypesPolicy === void 0) {
        trustedTypesPolicy = _getDefaultTrustedTypesPolicy();
      }
      if (trustedTypesPolicy && typeof emptyHTML === "string") {
        emptyHTML = _createTrustedHTML("");
      }
    }
    if (freeze) {
      freeze(cfg);
    }
    CONFIG = cfg;
  };
  const ALL_SVG_TAGS = addToSet({}, [...svg$1, ...svgFilters, ...svgDisallowed]);
  const ALL_MATHML_TAGS = addToSet({}, [...mathMl$1, ...mathMlDisallowed]);
  const _checkSvgNamespace = function _checkSvgNamespace2(tagName, parent, parentTagName) {
    if (parent.namespaceURI === HTML_NAMESPACE) {
      return tagName === "svg";
    }
    if (parent.namespaceURI === MATHML_NAMESPACE) {
      return tagName === "svg" && (parentTagName === "annotation-xml" || MATHML_TEXT_INTEGRATION_POINTS[parentTagName]);
    }
    return Boolean(ALL_SVG_TAGS[tagName]);
  };
  const _checkMathMlNamespace = function _checkMathMlNamespace2(tagName, parent, parentTagName) {
    if (parent.namespaceURI === HTML_NAMESPACE) {
      return tagName === "math";
    }
    if (parent.namespaceURI === SVG_NAMESPACE) {
      return tagName === "math" && HTML_INTEGRATION_POINTS[parentTagName];
    }
    return Boolean(ALL_MATHML_TAGS[tagName]);
  };
  const _checkHtmlNamespace = function _checkHtmlNamespace2(tagName, parent, parentTagName) {
    if (parent.namespaceURI === SVG_NAMESPACE && !HTML_INTEGRATION_POINTS[parentTagName]) {
      return false;
    }
    if (parent.namespaceURI === MATHML_NAMESPACE && !MATHML_TEXT_INTEGRATION_POINTS[parentTagName]) {
      return false;
    }
    return !ALL_MATHML_TAGS[tagName] && (COMMON_SVG_AND_HTML_ELEMENTS[tagName] || !ALL_SVG_TAGS[tagName]);
  };
  const _checkValidNamespace = function _checkValidNamespace2(element) {
    let parent = getParentNode(element);
    if (!parent || !parent.tagName) {
      parent = {
        namespaceURI: NAMESPACE,
        tagName: "template"
      };
    }
    const tagName = stringToLowerCase(element.tagName);
    const parentTagName = stringToLowerCase(parent.tagName);
    if (!ALLOWED_NAMESPACES[element.namespaceURI]) {
      return false;
    }
    if (element.namespaceURI === SVG_NAMESPACE) {
      return _checkSvgNamespace(tagName, parent, parentTagName);
    }
    if (element.namespaceURI === MATHML_NAMESPACE) {
      return _checkMathMlNamespace(tagName, parent, parentTagName);
    }
    if (element.namespaceURI === HTML_NAMESPACE) {
      return _checkHtmlNamespace(tagName, parent, parentTagName);
    }
    if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && ALLOWED_NAMESPACES[element.namespaceURI]) {
      return true;
    }
    return false;
  };
  const _forceRemove = function _forceRemove2(node) {
    arrayPush(DOMPurify.removed, {
      element: node
    });
    try {
      getParentNode(node).removeChild(node);
    } catch (_3) {
      remove(node);
      if (!getParentNode(node)) {
        throw typeErrorCreate("a node selected for removal could not be detached from its tree and cannot be safely returned; refusing to sanitize in place");
      }
    }
  };
  const _neutralizeRoot = function _neutralizeRoot2(root) {
    _neutralizeSubtree(root);
    const childNodes = getChildNodes(root);
    if (childNodes) {
      const snapshot = [];
      arrayForEach(childNodes, (child) => {
        arrayPush(snapshot, child);
      });
      arrayForEach(snapshot, (child) => {
        try {
          remove(child);
        } catch (_3) {
        }
      });
    }
    const attributes = getAttributes(root);
    if (attributes) {
      for (let i = attributes.length - 1; i >= 0; --i) {
        const attribute = attributes[i];
        const name = attribute && attribute.name;
        if (typeof name === "string") {
          try {
            root.removeAttribute(name);
          } catch (_3) {
          }
        }
      }
    }
  };
  const _removeAttribute = function _removeAttribute2(name, element) {
    try {
      arrayPush(DOMPurify.removed, {
        attribute: element.getAttributeNode(name),
        from: element
      });
    } catch (_3) {
      arrayPush(DOMPurify.removed, {
        attribute: null,
        from: element
      });
    }
    element.removeAttribute(name);
    if (name === "is") {
      if (RETURN_DOM || RETURN_DOM_FRAGMENT) {
        try {
          _forceRemove(element);
        } catch (_3) {
        }
      } else {
        try {
          element.setAttribute(name, "");
        } catch (_3) {
        }
      }
    }
  };
  const _stripDisallowedAttributes = function _stripDisallowedAttributes2(element) {
    const attributes = getAttributes(element);
    if (!attributes) {
      return;
    }
    for (let i = attributes.length - 1; i >= 0; --i) {
      const attribute = attributes[i];
      const name = attribute && attribute.name;
      if (typeof name !== "string" || ALLOWED_ATTR[transformCaseFunc(name)]) {
        continue;
      }
      try {
        element.removeAttribute(name);
      } catch (_3) {
      }
    }
  };
  const _neutralizeSubtree = function _neutralizeSubtree2(root) {
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      const nodeType = getNodeType ? getNodeType(node) : node.nodeType;
      if (nodeType === NODE_TYPE.element) {
        _stripDisallowedAttributes(node);
      }
      const childNodes = getChildNodes(node);
      if (childNodes) {
        for (let i = childNodes.length - 1; i >= 0; --i) {
          stack.push(childNodes[i]);
        }
      }
    }
  };
  const _neutralizePatchLinkage = function _neutralizePatchLinkage2(root) {
    if (!SAFE_FOR_XML) {
      return;
    }
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      const nodeType = getNodeType ? getNodeType(node) : node.nodeType;
      if (nodeType === NODE_TYPE.processingInstruction || nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, node.data)) {
        try {
          remove(node);
        } catch (_3) {
        }
        continue;
      }
      if (nodeType === NODE_TYPE.element) {
        const element = node;
        const lcTag = transformCaseFunc(getNodeName ? getNodeName(node) : node.nodeName);
        try {
          if (element.hasAttribute && element.hasAttribute("patchsrc")) {
            element.removeAttribute("patchsrc");
          }
          if (element.hasAttribute && element.hasAttribute("for") && lcTag !== "label" && lcTag !== "output") {
            element.removeAttribute("for");
          }
        } catch (_3) {
        }
      }
      const childNodes = getChildNodes(node);
      if (childNodes) {
        for (let i = childNodes.length - 1; i >= 0; --i) {
          stack.push(childNodes[i]);
        }
      }
    }
  };
  const _initDocument = function _initDocument2(dirty) {
    let doc = null;
    let leadingWhitespace = null;
    if (FORCE_BODY) {
      dirty = "<remove></remove>" + dirty;
    } else {
      const matches = stringMatch(dirty, /^[\r\n\t ]+/);
      leadingWhitespace = matches && matches[0];
    }
    if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && NAMESPACE === HTML_NAMESPACE) {
      dirty = '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>' + dirty + "</body></html>";
    }
    const dirtyPayload = trustedTypesPolicy ? _createTrustedHTML(dirty) : dirty;
    if (NAMESPACE === HTML_NAMESPACE) {
      try {
        doc = new DOMParser().parseFromString(dirtyPayload, PARSER_MEDIA_TYPE);
      } catch (_3) {
      }
    }
    if (!doc || !doc.documentElement) {
      doc = implementation.createDocument(NAMESPACE, "template", null);
      try {
        doc.documentElement.innerHTML = IS_EMPTY_INPUT ? emptyHTML : dirtyPayload;
      } catch (_3) {
      }
    }
    const body = doc.body || doc.documentElement;
    if (dirty && leadingWhitespace) {
      body.insertBefore(document2.createTextNode(leadingWhitespace), body.childNodes[0] || null);
    }
    if (NAMESPACE === HTML_NAMESPACE) {
      return getElementsByTagName.call(doc, WHOLE_DOCUMENT ? "html" : "body")[0];
    }
    return WHOLE_DOCUMENT ? doc.documentElement : body;
  };
  const _createNodeIterator = function _createNodeIterator2(root) {
    const doc = getOwnerDocument ? getOwnerDocument(root) : root.ownerDocument;
    return createNodeIterator.call(
      doc || root,
      root,
      // eslint-disable-next-line no-bitwise
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_PROCESSING_INSTRUCTION | NodeFilter.SHOW_CDATA_SECTION,
      null
    );
  };
  const _stripTemplateExpressions = function _stripTemplateExpressions2(value) {
    value = stringReplace(value, MUSTACHE_EXPR$1, " ");
    value = stringReplace(value, ERB_EXPR$1, " ");
    value = stringReplace(value, TMPLIT_EXPR$1, " ");
    return value;
  };
  const _scrubTemplateExpressions2 = function _scrubTemplateExpressions(node) {
    var _node$querySelectorAl;
    node.normalize();
    const doc = getOwnerDocument ? getOwnerDocument(node) : node.ownerDocument;
    const walker = createNodeIterator.call(
      doc || node,
      node,
      // eslint-disable-next-line no-bitwise
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_CDATA_SECTION | NodeFilter.SHOW_PROCESSING_INSTRUCTION,
      null
    );
    let currentNode = walker.nextNode();
    while (currentNode) {
      currentNode.data = _stripTemplateExpressions(currentNode.data);
      currentNode = walker.nextNode();
    }
    const templates = (_node$querySelectorAl = node.querySelectorAll) === null || _node$querySelectorAl === void 0 ? void 0 : _node$querySelectorAl.call(node, "template");
    if (templates) {
      arrayForEach(templates, (tmpl) => {
        if (_isDocumentFragment(tmpl.content)) {
          _scrubTemplateExpressions2(tmpl.content);
        }
      });
    }
  };
  const _isClobbered = function _isClobbered2(element) {
    const realTagName = getNodeName ? getNodeName(element) : null;
    if (typeof realTagName !== "string") {
      return false;
    }
    if (transformCaseFunc(realTagName) !== "form") {
      return false;
    }
    return typeof element.nodeName !== "string" || typeof element.textContent !== "string" || typeof element.removeChild !== "function" || // Realm-safe NamedNodeMap detection: equality against the cached
    // prototype getter. Clobbered .attributes (e.g. <input name="attributes">)
    // makes the direct read diverge from the cached read; a clean form
    // (same-realm OR foreign-realm) has both reads pointing at the same
    // canonical NamedNodeMap.
    element.attributes !== getAttributes(element) || typeof element.removeAttribute !== "function" || typeof element.setAttribute !== "function" || typeof element.namespaceURI !== "string" || typeof element.insertBefore !== "function" || typeof element.hasChildNodes !== "function" || // NodeType clobbering probe. Cached Node.prototype.nodeType getter
    // returns the integer 1 for any Element regardless of realm; direct
    // read on a clobbered form (e.g. <input name="nodeType">) returns
    // the named child element. Cheap addition — nodeType is read from
    // an internal slot, no serialization cost — and removes a residual
    // clobbering surface used by several mXSS / PI / comment branches
    // in _sanitizeElements that compare currentNode.nodeType directly.
    element.nodeType !== getNodeType(element) || // HTMLFormElement has [LegacyOverrideBuiltIns]: a descendant named
    // "childNodes" shadows the prototype getter. Direct reads of
    // form.childNodes from a clobbered form return the named child
    // instead of the real NodeList, so any walk that reads it directly
    // skips the form's real children. Compare the direct read to the
    // cached Node.prototype getter — when the form's named-property
    // getter intercepts the read, the two values differ and we flag
    // the form. This catches every clobbering child type (input,
    // select, etc.) regardless of whether the named child happens to
    // carry a numeric .length, which a typeof-based probe would miss
    // (e.g. HTMLSelectElement.length is a defined unsigned-long).
    element.childNodes !== getChildNodes(element);
  };
  const _isDocumentFragment = function _isDocumentFragment2(value) {
    if (!getNodeType || typeof value !== "object" || value === null) {
      return false;
    }
    try {
      return getNodeType(value) === NODE_TYPE.documentFragment;
    } catch (_3) {
      return false;
    }
  };
  const _isNode = function _isNode2(value) {
    if (!getNodeType || typeof value !== "object" || value === null) {
      return false;
    }
    try {
      return typeof getNodeType(value) === "number";
    } catch (_3) {
      return false;
    }
  };
  function _executeHooks(hooks3, currentNode, data) {
    if (hooks3.length === 0) {
      return;
    }
    arrayForEach(hooks3, (hook) => {
      hook.call(DOMPurify, currentNode, data, CONFIG);
    });
  }
  const _isUnsafeNode = function _isUnsafeNode2(currentNode, tagName) {
    if (SAFE_FOR_XML && currentNode.hasChildNodes() && !_isNode(currentNode.firstElementChild) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.textContent) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.innerHTML)) {
      return true;
    }
    if (SAFE_FOR_XML && currentNode.namespaceURI === HTML_NAMESPACE && tagName === "style" && _isNode(currentNode.firstElementChild)) {
      return true;
    }
    if (currentNode.nodeType === NODE_TYPE.processingInstruction) {
      return true;
    }
    if (SAFE_FOR_XML && currentNode.nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, currentNode.data)) {
      return true;
    }
    return false;
  };
  const _sanitizeDisallowedNode = function _sanitizeDisallowedNode2(currentNode, tagName, root) {
    if (!FORBID_TAGS[tagName] && _isBasicCustomElement(tagName)) {
      if (CUSTOM_ELEMENT_HANDLING.tagNameCheck instanceof RegExp && regExpTest(CUSTOM_ELEMENT_HANDLING.tagNameCheck, tagName)) {
        return false;
      }
      if (CUSTOM_ELEMENT_HANDLING.tagNameCheck instanceof Function && CUSTOM_ELEMENT_HANDLING.tagNameCheck(tagName)) {
        return false;
      }
    }
    if (KEEP_CONTENT && !FORBID_CONTENTS[tagName]) {
      const parentNode = getParentNode(currentNode);
      const childNodes = getChildNodes(currentNode);
      if (childNodes && parentNode) {
        const childCount = childNodes.length;
        for (let i = childCount - 1; i >= 0; --i) {
          const hoisted = currentNode === root ? cloneNode(childNodes[i], true) : childNodes[i];
          parentNode.insertBefore(hoisted, getNextSibling(currentNode));
        }
      }
    }
    _forceRemove(currentNode);
    return true;
  };
  const _forkSharedAllowlist = function _forkSharedAllowlist2(hookList, set, defaultSet, setConfigSet) {
    if (hookList.length === 0) {
      return set;
    }
    return set === defaultSet || set === setConfigSet ? clone(set) : set;
  };
  const _sanitizeElements = function _sanitizeElements2(currentNode, root) {
    _executeHooks(hooks2.beforeSanitizeElements, currentNode, null);
    if (currentNode !== root && getParentNode(currentNode) === null) {
      if (IN_PLACE) {
        _neutralizeSubtree(currentNode);
      }
      return true;
    }
    if (_isClobbered(currentNode)) {
      _forceRemove(currentNode);
      return true;
    }
    const tagName = transformCaseFunc(getNodeName ? getNodeName(currentNode) : currentNode.nodeName);
    ALLOWED_TAGS = _forkSharedAllowlist(hooks2.uponSanitizeElement, ALLOWED_TAGS, DEFAULT_ALLOWED_TAGS, SET_CONFIG_ALLOWED_TAGS);
    _executeHooks(hooks2.uponSanitizeElement, currentNode, {
      tagName,
      allowedTags: ALLOWED_TAGS
    });
    if (currentNode !== root && getParentNode(currentNode) === null) {
      if (IN_PLACE) {
        _neutralizeSubtree(currentNode);
      }
      return true;
    }
    if (_isUnsafeNode(currentNode, tagName)) {
      _forceRemove(currentNode);
      return true;
    }
    if (FORBID_TAGS[tagName] || !(EXTRA_ELEMENT_HANDLING.tagCheck instanceof Function && EXTRA_ELEMENT_HANDLING.tagCheck(tagName)) && !ALLOWED_TAGS[tagName]) {
      const removed = _sanitizeDisallowedNode(currentNode, tagName, root);
      if (removed === false) {
        _executeHooks(hooks2.afterSanitizeElements, currentNode, null);
      }
      return removed;
    }
    const nt2 = getNodeType ? getNodeType(currentNode) : currentNode.nodeType;
    if (nt2 === NODE_TYPE.element && !_checkValidNamespace(currentNode)) {
      _forceRemove(currentNode);
      return true;
    }
    if ((tagName === "noscript" || tagName === "noembed" || tagName === "noframes") && regExpTest(FALLBACK_TAG_CLOSE, currentNode.innerHTML)) {
      _forceRemove(currentNode);
      return true;
    }
    if (SAFE_FOR_TEMPLATES && currentNode.nodeType === NODE_TYPE.text) {
      const content = _stripTemplateExpressions(currentNode.textContent);
      if (currentNode.textContent !== content) {
        arrayPush(DOMPurify.removed, {
          element: currentNode.cloneNode()
        });
        currentNode.textContent = content;
      }
    }
    _executeHooks(hooks2.afterSanitizeElements, currentNode, null);
    return false;
  };
  const _isValidAttribute = function _isValidAttribute2(lcTag, lcName, value) {
    if (FORBID_ATTR[lcName]) {
      return false;
    }
    if (SAFE_FOR_XML && lcName === "patchsrc") {
      return false;
    }
    if (SAFE_FOR_XML && lcName === "for" && lcTag !== "label" && lcTag !== "output") {
      return false;
    }
    if (SANITIZE_DOM && (lcName === "id" || lcName === "name") && (value in document2 || value in formElement)) {
      return false;
    }
    const nameIsPermitted = ALLOWED_ATTR[lcName] || EXTRA_ELEMENT_HANDLING.attributeCheck instanceof Function && EXTRA_ELEMENT_HANDLING.attributeCheck(lcName, lcTag);
    if (ALLOW_DATA_ATTR && regExpTest(DATA_ATTR$1, lcName)) ;
    else if (ALLOW_ARIA_ATTR && regExpTest(ARIA_ATTR$1, lcName)) ;
    else if (!nameIsPermitted) {
      if (
        // First condition does a very basic check if a) it's basically a valid custom element tagname AND
        // b) if the tagName passes whatever the user has configured for CUSTOM_ELEMENT_HANDLING.tagNameCheck
        // and c) if the attribute name passes whatever the user has configured for CUSTOM_ELEMENT_HANDLING.attributeNameCheck
        _isBasicCustomElement(lcTag) && (CUSTOM_ELEMENT_HANDLING.tagNameCheck instanceof RegExp && regExpTest(CUSTOM_ELEMENT_HANDLING.tagNameCheck, lcTag) || CUSTOM_ELEMENT_HANDLING.tagNameCheck instanceof Function && CUSTOM_ELEMENT_HANDLING.tagNameCheck(lcTag)) && (CUSTOM_ELEMENT_HANDLING.attributeNameCheck instanceof RegExp && regExpTest(CUSTOM_ELEMENT_HANDLING.attributeNameCheck, lcName) || CUSTOM_ELEMENT_HANDLING.attributeNameCheck instanceof Function && CUSTOM_ELEMENT_HANDLING.attributeNameCheck(lcName, lcTag)) || // Alternative, second condition checks if it's an `is`-attribute, AND
        // the value passes whatever the user has configured for CUSTOM_ELEMENT_HANDLING.tagNameCheck
        lcName === "is" && CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements && (CUSTOM_ELEMENT_HANDLING.tagNameCheck instanceof RegExp && regExpTest(CUSTOM_ELEMENT_HANDLING.tagNameCheck, value) || CUSTOM_ELEMENT_HANDLING.tagNameCheck instanceof Function && CUSTOM_ELEMENT_HANDLING.tagNameCheck(value))
      ) ;
      else {
        return false;
      }
    } else if (URI_SAFE_ATTRIBUTES[lcName]) ;
    else if (regExpTest(IS_ALLOWED_URI$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) ;
    else if ((lcName === "src" || lcName === "xlink:href" || lcName === "href") && lcTag !== "script" && stringIndexOf(value, "data:") === 0 && DATA_URI_TAGS[lcTag]) ;
    else if (ALLOW_UNKNOWN_PROTOCOLS && !regExpTest(IS_SCRIPT_OR_DATA$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) ;
    else if (value) {
      return false;
    } else ;
    return true;
  };
  const RESERVED_CUSTOM_ELEMENT_NAMES = addToSet({}, ["annotation-xml", "color-profile", "font-face", "font-face-format", "font-face-name", "font-face-src", "font-face-uri", "missing-glyph"]);
  const _isBasicCustomElement = function _isBasicCustomElement2(tagName) {
    return !RESERVED_CUSTOM_ELEMENT_NAMES[stringToLowerCase(tagName)] && regExpTest(CUSTOM_ELEMENT$1, tagName);
  };
  const _applyTrustedTypesToAttribute = function _applyTrustedTypesToAttribute2(lcTag, lcName, namespaceURI, value) {
    if (trustedTypesPolicy && typeof trustedTypes === "object" && typeof trustedTypes.getAttributeType === "function" && !namespaceURI) {
      switch (trustedTypes.getAttributeType(lcTag, lcName)) {
        case "TrustedHTML": {
          return _createTrustedHTML(value);
        }
        case "TrustedScriptURL": {
          return _createTrustedScriptURL(value);
        }
      }
    }
    return value;
  };
  const _setAttributeValue = function _setAttributeValue2(currentNode, name, namespaceURI, value) {
    try {
      if (namespaceURI) {
        currentNode.setAttributeNS(namespaceURI, name, value);
      } else {
        currentNode.setAttribute(name, value);
      }
      if (_isClobbered(currentNode)) {
        _forceRemove(currentNode);
      } else {
        arrayPop(DOMPurify.removed);
      }
    } catch (_3) {
      _removeAttribute(name, currentNode);
    }
  };
  const _sanitizeAttributes = function _sanitizeAttributes2(currentNode) {
    _executeHooks(hooks2.beforeSanitizeAttributes, currentNode, null);
    const attributes = currentNode.attributes;
    if (!attributes || _isClobbered(currentNode)) {
      return;
    }
    ALLOWED_ATTR = _forkSharedAllowlist(hooks2.uponSanitizeAttribute, ALLOWED_ATTR, DEFAULT_ALLOWED_ATTR, SET_CONFIG_ALLOWED_ATTR);
    const hookEvent = {
      attrName: "",
      attrValue: "",
      keepAttr: true,
      allowedAttributes: ALLOWED_ATTR,
      forceKeepAttr: void 0
    };
    let l4 = attributes.length;
    const lcTag = transformCaseFunc(currentNode.nodeName);
    while (l4--) {
      const attr = attributes[l4];
      const name = attr.name, namespaceURI = attr.namespaceURI, attrValue = attr.value;
      const lcName = transformCaseFunc(name);
      const initValue = attrValue;
      let value = name === "value" ? initValue : stringTrim(initValue);
      hookEvent.attrName = lcName;
      hookEvent.attrValue = value;
      hookEvent.keepAttr = true;
      hookEvent.forceKeepAttr = void 0;
      _executeHooks(hooks2.uponSanitizeAttribute, currentNode, hookEvent);
      value = hookEvent.attrValue;
      if (SANITIZE_NAMED_PROPS && (lcName === "id" || lcName === "name") && stringIndexOf(value, SANITIZE_NAMED_PROPS_PREFIX) !== 0) {
        _removeAttribute(name, currentNode);
        value = SANITIZE_NAMED_PROPS_PREFIX + value;
      }
      if (SAFE_FOR_XML && regExpTest(/((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i, value)) {
        _removeAttribute(name, currentNode);
        continue;
      }
      if (lcName === "attributename" && stringMatch(value, "href")) {
        _removeAttribute(name, currentNode);
        continue;
      }
      if (hookEvent.forceKeepAttr) {
        continue;
      }
      if (!hookEvent.keepAttr) {
        _removeAttribute(name, currentNode);
        continue;
      }
      if (!ALLOW_SELF_CLOSE_IN_ATTR && regExpTest(SELF_CLOSING_TAG, value)) {
        _removeAttribute(name, currentNode);
        continue;
      }
      if (SAFE_FOR_TEMPLATES) {
        value = _stripTemplateExpressions(value);
      }
      if (!_isValidAttribute(lcTag, lcName, value)) {
        _removeAttribute(name, currentNode);
        continue;
      }
      value = _applyTrustedTypesToAttribute(lcTag, lcName, namespaceURI, value);
      if (value !== initValue) {
        _setAttributeValue(currentNode, name, namespaceURI, value);
      }
    }
    _executeHooks(hooks2.afterSanitizeAttributes, currentNode, null);
  };
  const _sanitizeShadowDOM2 = function _sanitizeShadowDOM(fragment) {
    let shadowNode = null;
    const shadowIterator = _createNodeIterator(fragment);
    _executeHooks(hooks2.beforeSanitizeShadowDOM, fragment, null);
    while (shadowNode = shadowIterator.nextNode()) {
      _executeHooks(hooks2.uponSanitizeShadowNode, shadowNode, null);
      _sanitizeElements(shadowNode, fragment);
      _sanitizeAttributes(shadowNode);
      if (_isDocumentFragment(shadowNode.content)) {
        _sanitizeShadowDOM2(shadowNode.content);
      }
      const shadowNodeType = getNodeType ? getNodeType(shadowNode) : shadowNode.nodeType;
      if (shadowNodeType === NODE_TYPE.element) {
        const innerSr = getShadowRoot(shadowNode);
        if (_isDocumentFragment(innerSr)) {
          _sanitizeAttachedShadowRoots(innerSr);
          _sanitizeShadowDOM2(innerSr);
        }
      }
    }
    _executeHooks(hooks2.afterSanitizeShadowDOM, fragment, null);
  };
  const _sanitizeAttachedShadowRoots = function _sanitizeAttachedShadowRoots2(root) {
    const stack = [{
      node: root,
      shadow: null
    }];
    while (stack.length > 0) {
      const item = stack.pop();
      if (item.shadow) {
        _sanitizeShadowDOM2(item.shadow);
        continue;
      }
      const node = item.node;
      const nodeType = getNodeType ? getNodeType(node) : node.nodeType;
      const isElement = nodeType === NODE_TYPE.element;
      const childNodes = getChildNodes(node);
      if (childNodes) {
        for (let i = childNodes.length - 1; i >= 0; --i) {
          stack.push({
            node: childNodes[i],
            shadow: null
          });
        }
      }
      if (isElement) {
        const rootName = getNodeName ? getNodeName(node) : null;
        if (typeof rootName === "string" && transformCaseFunc(rootName) === "template") {
          const content = node.content;
          if (_isDocumentFragment(content)) {
            stack.push({
              node: content,
              shadow: null
            });
          }
        }
      }
      if (isElement) {
        const sr = getShadowRoot(node);
        if (_isDocumentFragment(sr)) {
          stack.push({
            node: null,
            shadow: sr
          }, {
            node: sr,
            shadow: null
          });
        }
      }
    }
  };
  DOMPurify.sanitize = function(dirty) {
    let cfg = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    let body = null;
    let importedNode = null;
    let currentNode = null;
    let returnNode = null;
    IS_EMPTY_INPUT = !dirty;
    if (IS_EMPTY_INPUT) {
      dirty = "<!-->";
    }
    if (typeof dirty !== "string" && !_isNode(dirty)) {
      dirty = stringifyValue(dirty);
      if (typeof dirty !== "string") {
        throw typeErrorCreate("dirty is not a string, aborting");
      }
    }
    if (!DOMPurify.isSupported) {
      return dirty;
    }
    if (SET_CONFIG) {
      ALLOWED_TAGS = SET_CONFIG_ALLOWED_TAGS;
      ALLOWED_ATTR = SET_CONFIG_ALLOWED_ATTR;
    } else {
      _parseConfig(cfg);
    }
    if (hooks2.uponSanitizeElement.length > 0 || hooks2.uponSanitizeAttribute.length > 0) {
      ALLOWED_TAGS = clone(ALLOWED_TAGS);
    }
    if (hooks2.uponSanitizeAttribute.length > 0) {
      ALLOWED_ATTR = clone(ALLOWED_ATTR);
    }
    DOMPurify.removed = [];
    const inPlace = IN_PLACE && typeof dirty !== "string" && _isNode(dirty);
    if (inPlace) {
      _neutralizePatchLinkage(dirty);
      const nn2 = getNodeName ? getNodeName(dirty) : dirty.nodeName;
      if (typeof nn2 === "string") {
        const tagName = transformCaseFunc(nn2);
        if (!ALLOWED_TAGS[tagName] || FORBID_TAGS[tagName]) {
          _neutralizeRoot(dirty);
          throw typeErrorCreate("root node is forbidden and cannot be sanitized in-place");
        }
      }
      if (_isClobbered(dirty)) {
        _neutralizeRoot(dirty);
        throw typeErrorCreate("root node is clobbered and cannot be sanitized in-place");
      }
      try {
        _sanitizeAttachedShadowRoots(dirty);
      } catch (error) {
        _neutralizeRoot(dirty);
        throw error;
      }
    } else if (_isNode(dirty)) {
      body = _initDocument("<!---->");
      importedNode = body.ownerDocument.importNode(dirty, true);
      if (importedNode.nodeType === NODE_TYPE.element && importedNode.nodeName === "BODY") {
        body = importedNode;
      } else if (importedNode.nodeName === "HTML") {
        body = importedNode;
      } else {
        body.appendChild(importedNode);
      }
      _sanitizeAttachedShadowRoots(importedNode);
    } else {
      if (!RETURN_DOM && !SAFE_FOR_TEMPLATES && !WHOLE_DOCUMENT && // eslint-disable-next-line unicorn/prefer-includes
      dirty.indexOf("<") === -1) {
        return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(dirty) : dirty;
      }
      body = _initDocument(dirty);
      if (!body) {
        return RETURN_DOM ? null : RETURN_TRUSTED_TYPE ? emptyHTML : "";
      }
    }
    if (body && FORCE_BODY) {
      _forceRemove(body.firstChild);
    }
    const walkRoot = inPlace ? dirty : body;
    try {
      const nodeIterator = _createNodeIterator(walkRoot);
      while (currentNode = nodeIterator.nextNode()) {
        _sanitizeElements(currentNode, walkRoot);
        _sanitizeAttributes(currentNode);
        if (_isDocumentFragment(currentNode.content)) {
          _sanitizeShadowDOM2(currentNode.content);
        }
      }
    } catch (error) {
      if (inPlace) {
        _neutralizeRoot(dirty);
        arrayForEach(DOMPurify.removed, (entry) => {
          if (entry.element) {
            _neutralizeSubtree(entry.element);
          }
        });
      }
      throw error;
    }
    if (inPlace) {
      arrayForEach(DOMPurify.removed, (entry) => {
        if (entry.element) {
          _neutralizeSubtree(entry.element);
        }
      });
      if (SAFE_FOR_TEMPLATES) {
        _scrubTemplateExpressions2(dirty);
      }
      return dirty;
    }
    if (RETURN_DOM) {
      if (SAFE_FOR_TEMPLATES) {
        _scrubTemplateExpressions2(body);
      }
      if (RETURN_DOM_FRAGMENT) {
        returnNode = createDocumentFragment.call(body.ownerDocument);
        while (body.firstChild) {
          returnNode.appendChild(body.firstChild);
        }
      } else {
        returnNode = body;
      }
      if (ALLOWED_ATTR.shadowroot || ALLOWED_ATTR.shadowrootmode) {
        returnNode = importNode.call(originalDocument, returnNode, true);
      }
      return returnNode;
    }
    let serializedHTML = WHOLE_DOCUMENT ? body.outerHTML : body.innerHTML;
    if (WHOLE_DOCUMENT && ALLOWED_TAGS["!doctype"] && body.ownerDocument && body.ownerDocument.doctype && body.ownerDocument.doctype.name && regExpTest(DOCTYPE_NAME, body.ownerDocument.doctype.name)) {
      serializedHTML = "<!DOCTYPE " + body.ownerDocument.doctype.name + ">\n" + serializedHTML;
    }
    if (SAFE_FOR_TEMPLATES) {
      serializedHTML = _stripTemplateExpressions(serializedHTML);
    }
    return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(serializedHTML) : serializedHTML;
  };
  DOMPurify.setConfig = function() {
    let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
    _parseConfig(cfg);
    SET_CONFIG = true;
    SET_CONFIG_ALLOWED_TAGS = ALLOWED_TAGS;
    SET_CONFIG_ALLOWED_ATTR = ALLOWED_ATTR;
  };
  DOMPurify.clearConfig = function() {
    CONFIG = null;
    SET_CONFIG = false;
    SET_CONFIG_ALLOWED_TAGS = null;
    SET_CONFIG_ALLOWED_ATTR = null;
    trustedTypesPolicy = defaultTrustedTypesPolicy;
    emptyHTML = "";
  };
  DOMPurify.isValidAttribute = function(tag, attr, value) {
    if (!CONFIG) {
      _parseConfig({});
    }
    const lcTag = transformCaseFunc(tag);
    const lcName = transformCaseFunc(attr);
    return _isValidAttribute(lcTag, lcName, value);
  };
  DOMPurify.addHook = function(entryPoint, hookFunction) {
    if (typeof hookFunction !== "function") {
      return;
    }
    if (!objectHasOwnProperty(hooks2, entryPoint)) {
      return;
    }
    arrayPush(hooks2[entryPoint], hookFunction);
  };
  DOMPurify.removeHook = function(entryPoint, hookFunction) {
    if (!objectHasOwnProperty(hooks2, entryPoint)) {
      return void 0;
    }
    if (hookFunction !== void 0) {
      const index2 = arrayLastIndexOf(hooks2[entryPoint], hookFunction);
      return index2 === -1 ? void 0 : arraySplice(hooks2[entryPoint], index2, 1)[0];
    }
    return arrayPop(hooks2[entryPoint]);
  };
  DOMPurify.removeHooks = function(entryPoint) {
    if (!objectHasOwnProperty(hooks2, entryPoint)) {
      return;
    }
    hooks2[entryPoint] = [];
  };
  DOMPurify.removeAllHooks = function() {
    hooks2 = _createHooksMap();
  };
  return DOMPurify;
}
var purify = createDOMPurify();

// plugins/editor/web-src/editor/MarkdownPreview.tsx
var import_jsx_runtime8 = __toESM(require_jsx_runtime(), 1);
function MarkdownPreview({ source }) {
  const html2 = (0, import_react17.useMemo)(() => purify.sanitize(f.parse(source, { async: false })), [source]);
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "markdown-preview h-full overflow-auto p-5 text-sm leading-relaxed text-text", dangerouslySetInnerHTML: { __html: html2 } });
}

// plugins/editor/web-src/editor/ImagePreview.tsx
var import_react18 = __toESM(require_react(), 1);
var import_jsx_runtime9 = __toESM(require_jsx_runtime(), 1);
function ImagePreview({ projectId, path }) {
  const [url, setUrl] = (0, import_react18.useState)(null);
  const [failed, setFailed] = (0, import_react18.useState)(false);
  (0, import_react18.useEffect)(() => {
    let cancelled = false;
    let objectUrl = null;
    setUrl(null);
    setFailed(false);
    fetch(`/api/projects/${projectId}/raw?path=${encodeURIComponent(path)}`, { credentials: "same-origin" }).then((response) => {
      if (!response.ok) throw new Error(`raw ${response.status}`);
      return response.blob();
    }).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, path]);
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "flex h-full items-center justify-center overflow-auto bg-bg p-6", children: failed ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "text-sm text-text-muted", children: path }) : url ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("img", { src: url, alt: path, className: "max-h-full max-w-full object-contain" }) : null });
}

// plugins/editor/web-src/editor/PdfPreview.tsx
var import_react19 = __toESM(require_react(), 1);
var import_jsx_runtime10 = __toESM(require_jsx_runtime(), 1);
function PdfPreview({ projectId, path, failedLabel, office = false }) {
  const [url, setUrl] = (0, import_react19.useState)(null);
  const [failed, setFailed] = (0, import_react19.useState)(false);
  (0, import_react19.useEffect)(() => {
    let cancelled = false;
    let objectUrl = null;
    setUrl(null);
    setFailed(false);
    const route = office ? "office-preview" : "raw";
    fetch(`/api/projects/${projectId}/${route}?path=${encodeURIComponent(path)}`, { credentials: "same-origin" }).then((response) => {
      if (!response.ok) throw new Error(`${route} ${response.status}`);
      return response.blob();
    }).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, path, office]);
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "h-full overflow-hidden bg-bg p-3", children: failed ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "p-4 text-center text-sm text-danger", children: failedLabel.replace("{path}", path) }) : url ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("iframe", { src: url, title: path, className: "h-full w-full rounded-md border border-border bg-white" }) : null });
}

// plugins/editor/web-src/editor/MediaPreview.tsx
var import_jsx_runtime11 = __toESM(require_jsx_runtime(), 1);
function MediaPreview({ projectId, path, kind }) {
  const src = `/api/projects/${projectId}/raw?path=${encodeURIComponent(path)}`;
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "flex h-full items-center justify-center overflow-auto bg-bg p-6", children: kind === "video" ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("video", { controls: true, preload: "metadata", src, className: "max-h-full max-w-full rounded-md bg-black" }) : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("audio", { controls: true, preload: "metadata", src, className: "w-full max-w-2xl" }) });
}

// plugins/editor/web-src/editor/BinaryPreview.tsx
var import_jsx_runtime12 = __toESM(require_jsx_runtime(), 1);
var { components } = runtime();
var { Button: Button2 } = components;
function formatBytes2(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}
function BinaryPreview({ projectId, path, size, message, downloadLabel, sizeLabel, typeLabel, downloadUnavailableLabel, downloadAvailable }) {
  const download = () => {
    const anchor = document.createElement("a");
    anchor.href = `/api/projects/${projectId}/raw?path=${encodeURIComponent(path)}&download=1`;
    anchor.download = baseName(path);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "flex h-full items-center justify-center overflow-auto bg-bg p-6", children: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "w-full max-w-md rounded-xl border border-border bg-document p-6 text-center shadow-sm", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(File2, { size: 36, className: "mx-auto text-text-muted", "aria-hidden": true }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "mt-3 break-all font-mono text-sm font-semibold text-text", children: baseName(path) }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "mt-2 text-sm text-text-muted", children: message }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("dl", { className: "mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-left text-xs", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dt", { className: "text-text-muted", children: sizeLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dd", { className: "text-right text-text", children: formatBytes2(size) }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dt", { className: "text-text-muted", children: typeLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dd", { className: "break-all text-right font-mono text-text", children: mimeTypeOf(path) })
    ] }),
    !downloadAvailable ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "mt-4 text-xs text-warning", children: downloadUnavailableLabel }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "mt-5 flex justify-center", children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Button2, { variant: "accent", icon: Download, disabled: !downloadAvailable, onClick: download, children: downloadLabel }) })
  ] }) });
}

// plugins/editor/web-src/editor/CsvPreview.tsx
var import_react20 = __toESM(require_react(), 1);
var import_papaparse = __toESM(require_papaparse_min(), 1);
var import_jsx_runtime13 = __toESM(require_jsx_runtime(), 1);
var MAX_ROWS = 1e3;
function CsvPreview({ source, invalidLabel, limitedLabel }) {
  const parsed = (0, import_react20.useMemo)(() => import_papaparse.default.parse(source, { skipEmptyLines: false }), [source]);
  const fatalErrors = parsed.errors.filter((error) => error.code !== "UndetectableDelimiter");
  if (fatalErrors.length > 0) {
    const first = fatalErrors[0];
    return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("p", { className: "p-4 text-center text-sm text-danger", children: [
      invalidLabel,
      ": ",
      first.message
    ] });
  }
  const rows = parsed.data.slice(0, MAX_ROWS);
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "h-full overflow-auto bg-bg p-4", children: [
    parsed.data.length > MAX_ROWS ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "mb-3 text-xs text-text-muted", children: limitedLabel.replace("{count}", String(MAX_ROWS)) }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("table", { className: "min-w-full border-collapse text-left text-xs text-text", children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("tbody", { children: rows.map((row, rowIndex) => /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("tr", { className: rowIndex === 0 ? "bg-elevated font-semibold" : void 0, children: Array.from({ length: width }, (_3, columnIndex) => /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("td", { className: "whitespace-pre-wrap border border-border px-2 py-1.5 align-top", children: row[columnIndex] ?? "" }, columnIndex)) }, rowIndex)) }) })
  ] });
}

// plugins/editor/web-src/editor/Tabs.tsx
var import_jsx_runtime14 = __toESM(require_jsx_runtime(), 1);
function Tabs({ tabs, active, dirty, onSelect, onClose, closeLabel }) {
  if (tabs.length === 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "flex items-stretch overflow-x-auto border-b border-border bg-bg/40", children: tabs.map((p) => {
    const isActive = p === active;
    const isDirty = dirty.has(p);
    return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: `group flex shrink-0 items-center gap-1.5 border-r border-border px-3 py-1.5 text-xs ${isActive ? "bg-surface text-text" : "text-text-muted hover:bg-elevated"}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", { type: "button", onClick: () => onSelect(p), className: "max-w-40 truncate", title: p, children: baseName(p) }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("button", { type: "button", onClick: () => onClose(p), "aria-label": closeLabel, className: "overlay-touch-target flex h-4 w-4 items-center justify-center rounded text-text-muted hover:bg-bg hover:text-text", children: [
        isDirty ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { className: "h-1.5 w-1.5 rounded-full bg-accent group-hover:hidden [@media(pointer:coarse)]:hidden", "aria-hidden": true }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(X, { size: 11, className: isDirty ? "hidden group-hover:block [@media(pointer:coarse)]:block" : "block", "aria-hidden": true })
      ] })
    ] }, p);
  }) });
}

// plugins/editor/web-src/editor/ProjectEditor.tsx
var import_jsx_runtime15 = __toESM(require_jsx_runtime(), 1);
var { hooks, components: components2, utils } = runtime();
var { useProjectFiles, useProjectFile, useProjectFileAtHead, useProjectCommit, useProjectCommitFileDiff, useProjectChanged, useProjectChanges, useWriteProjectFile, useNewProjectFile, useNewProjectDir, useRenameProjectEntry, useCopyProjectEntry, useDeleteProjectEntry, useMobile, useToast, useTranslation: useTranslation2, usePluginStrings } = hooks;
var { Button: Button3, LoadingState, EmptyState, ContextMenu, PatchView, WorkspaceTakeover } = components2;
var EDITOR_H_KEY = "elowen:editor:height";
var PREFS_KEY = "elowen:editor:prefs";
var MIN_EDITOR_H = 320;
var clampEditorH = (px) => Math.max(MIN_EDITOR_H, Math.min(typeof window !== "undefined" ? window.innerHeight * 0.96 : 4e3, px));
function ProjectEditor({ projectId, onClose, initialCommit, initialWorking, fill = false }) {
  const s = usePluginStrings("editor");
  const { t } = useTranslation2();
  const { toast } = useToast();
  const files = useProjectFiles(projectId);
  const [selected, setSelected] = (0, import_react21.useState)(null);
  const [openTabs, setOpenTabs] = (0, import_react21.useState)([]);
  const [commit] = (0, import_react21.useState)(initialCommit ?? null);
  const [working] = (0, import_react21.useState)(!!initialWorking);
  const [expanded, setExpanded] = (0, import_react21.useState)(/* @__PURE__ */ new Set());
  const [tab, setTab] = (0, import_react21.useState)("edit");
  const [prefs, setPrefs] = (0, import_react21.useState)(DEFAULT_PREFS);
  const [cursor, setCursor] = (0, import_react21.useState)(null);
  const [openMenu, setOpenMenu] = (0, import_react21.useState)(null);
  const [uploading, setUploading] = (0, import_react21.useState)(false);
  const [dropping, setDropping] = (0, import_react21.useState)(false);
  const fileInput = (0, import_react21.useRef)(null);
  const [fullscreen, setFullscreen] = (0, import_react21.useState)(false);
  const [editorH, setEditorH] = (0, import_react21.useState)(560);
  const dragY = (0, import_react21.useRef)(null);
  const [menu, setMenu] = (0, import_react21.useState)(null);
  const [dialog, setDialog] = (0, import_react21.useState)(null);
  const [drafts, setDrafts] = (0, import_react21.useState)({});
  const draftsRef = (0, import_react21.useRef)(drafts);
  const updateDrafts = (fn) => {
    draftsRef.current = fn(draftsRef.current);
    setDrafts(draftsRef.current);
  };
  const [dirtyPaths, setDirtyPaths] = (0, import_react21.useState)(/* @__PURE__ */ new Set());
  const mobile = useMobile();
  const [showTree, setShowTree] = (0, import_react21.useState)(false);
  (0, import_react21.useEffect)(() => {
    let stored = null;
    try {
      const raw = localStorage.getItem(EDITOR_H_KEY);
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n)) stored = n;
      }
    } catch {
    }
    setEditorH(clampEditorH(stored ?? window.innerHeight * 0.7));
  }, []);
  (0, import_react21.useEffect)(() => {
    try {
      localStorage.setItem(EDITOR_H_KEY, String(editorH));
    } catch {
    }
  }, [editorH]);
  (0, import_react21.useEffect)(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) setPrefs(normalisePrefs(JSON.parse(raw)));
    } catch {
    }
  }, []);
  const updatePrefs = (patch) => {
    setPrefs((current) => {
      const next = normalisePrefs({ ...current, ...patch });
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
      }
      return next;
    });
  };
  const commitData = useProjectCommit(projectId, commit);
  const changesData = useProjectChanges(projectId, working);
  const commitFileDiff = useProjectCommitFileDiff(projectId, commit, commit ? selected : null);
  const workingChanged = useProjectChanged(projectId).data?.changed;
  const changedSet = (0, import_react21.useMemo)(
    () => new Set(commit ? commitData.data?.files ?? [] : workingChanged ?? []),
    [commit, commitData.data?.files, workingChanged]
  );
  const selectedFile = selected ? files.data?.find((node) => node.type === "file" && node.path === selected) : void 0;
  const fileKind = selected ? fileKindOf(selected) : null;
  const textFile = fileKind === "text" || fileKind === "markdown" || fileKind === "csv";
  const fileData = useProjectFile(projectId, textFile ? selected : null);
  const write = useWriteProjectFile();
  const newFile = useNewProjectFile();
  const newDir = useNewProjectDir();
  const rename = useRenameProjectEntry();
  const copy = useCopyProjectEntry();
  const del = useDeleteProjectEntry();
  const tree = (0, import_react21.useMemo)(() => buildTree(files.data ?? []), [files.data]);
  const serverContent = fileData.data?.content ?? "";
  const draft = selected != null ? drafts[selected] : void 0;
  const value = draft ?? serverContent;
  const dirty = selected != null && dirtyPaths.has(selected);
  const previewableText = fileKind === "markdown" || fileKind === "csv";
  const editable = selected != null && textFile && !commit && !working;
  const effTab = tab === "preview" && !previewableText ? "edit" : tab;
  const fileSize = selectedFile?.size ?? 0;
  const headData = useProjectFileAtHead(projectId, selected, editable && effTab === "diff");
  const openFile = (p) => {
    setSelected(p);
    setOpenTabs((tabs) => tabs.includes(p) ? tabs : [...tabs, p]);
    setTab(fileKindOf(p) === "csv" ? "preview" : "edit");
  };
  const selectInTree = (p) => {
    if (commit) setSelected(p);
    else openFile(p);
  };
  const onChange = (v3) => {
    if (selected == null) return;
    updateDrafts((d) => ({ ...d, [selected]: v3 }));
    setDirtyPaths((cur) => {
      const n = new Set(cur);
      v3 !== serverContent ? n.add(selected) : n.delete(selected);
      return n;
    });
  };
  const toggle = (p) => setExpanded((cur) => {
    const n = new Set(cur);
    n.has(p) ? n.delete(p) : n.add(p);
    return n;
  });
  const expandPath = (dir) => setExpanded((cur) => {
    const n = new Set(cur);
    let acc = "";
    for (const part of dir.split("/").filter(Boolean)) {
      acc = acc ? `${acc}/${part}` : part;
      n.add(acc);
    }
    return n;
  });
  const leaveFullscreen = () => {
    if (menu) {
      setMenu(null);
      setOpenMenu(null);
      return;
    }
    setShowTree(false);
    if (mobile && onClose) onClose();
    else setFullscreen(false);
  };
  (0, import_react21.useEffect)(() => {
    if (mobile) setFullscreen(true);
  }, [mobile]);
  (0, import_react21.useEffect)(() => {
    if (!fullscreen || !mobile) setShowTree(false);
  }, [fullscreen, mobile]);
  const save = () => {
    if (selected == null) return;
    const path = selected;
    const sent = value;
    void write.mutateAsync({ id: projectId, path, content: sent }).then(
      () => {
        const current = draftsRef.current[path];
        if (current === void 0 || current === sent) {
          updateDrafts((d) => {
            const n = { ...d };
            delete n[path];
            return n;
          });
          setDirtyPaths((cur) => {
            const n = new Set(cur);
            n.delete(path);
            return n;
          });
        }
        toast(s.fileSaved.replace("{path}", path));
      },
      (e) => toast(String(e), "error")
    );
  };
  const closeTab = (p) => {
    setOpenTabs((tabs) => {
      const next = tabs.filter((x2) => x2 !== p);
      if (selected === p) setSelected(next[next.length - 1] ?? null);
      return next;
    });
  };
  const forgetPath = (path) => {
    const under = (x2) => x2 === path || x2.startsWith(path + "/");
    setOpenTabs((tabs) => tabs.filter((x2) => !under(x2)));
    updateDrafts((d) => {
      const n = { ...d };
      for (const k3 of Object.keys(n)) if (under(k3)) delete n[k3];
      return n;
    });
    setDirtyPaths((cur) => {
      const n = new Set([...cur].filter((x2) => !under(x2)));
      return n;
    });
    setSelected((cur) => cur && under(cur) ? null : cur);
  };
  const remapPath = (from, to) => {
    const remap = (x2) => x2 === from ? to : x2.startsWith(from + "/") ? to + x2.slice(from.length) : x2;
    setOpenTabs((tabs) => tabs.map(remap));
    updateDrafts((d) => {
      const n = {};
      for (const [k3, v3] of Object.entries(d)) n[remap(k3)] = v3;
      return n;
    });
    setDirtyPaths((cur) => new Set([...cur].map(remap)));
    setSelected((cur) => cur ? remap(cur) : cur);
  };
  const err = (e) => toast(String(e), "error");
  const copyPath = (p) => {
    void utils.copyText(p).then((ok) => {
      if (ok) toast(s.pathCopied);
      else toast(s.copyFailed, "error");
    });
  };
  const uploadDir = selected ? parentDir(selected) : "";
  const runUpload = (chosen, dir) => {
    if (!chosen.length || uploading) return;
    setUploading(true);
    void (async () => {
      let done = 0;
      for (const file of chosen) {
        try {
          await uploadFile(projectId, joinPath(dir, file.name), file);
          done += 1;
        } catch (error) {
          toast(`${file.name}: ${error instanceof UploadError ? error.message : String(error)}`, "error");
        }
      }
      setUploading(false);
      if (done > 0) {
        files.refetch();
        expandPath(dir);
        toast(s.uploaded.replace("{count}", String(done)));
      }
    })();
  };
  const download = (path) => {
    const anchor = document.createElement("a");
    anchor.href = `/api/projects/${projectId}/raw?path=${encodeURIComponent(path)}&download=1`;
    anchor.download = baseName(path);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };
  const submitDialog = (val) => {
    if (!dialog) return;
    if (dialog.kind === "newFile") {
      const path = joinPath(dialog.dir, val);
      newFile.mutate({ id: projectId, path }, { onSuccess: () => {
        expandPath(dialog.dir);
        openFile(path);
        toast(s.fileCreated.replace("{path}", path));
      }, onError: err });
    } else if (dialog.kind === "newFolder") {
      const path = joinPath(dialog.dir, val);
      newDir.mutate({ id: projectId, path }, { onSuccess: () => {
        expandPath(path);
        toast(s.folderCreated.replace("{path}", path));
      }, onError: err });
    } else if (dialog.kind === "rename") {
      const to = joinPath(parentDir(dialog.target), val);
      rename.mutate({ id: projectId, from: dialog.target, to }, { onSuccess: () => {
        remapPath(dialog.target, to);
        toast(s.renamed.replace("{path}", to));
      }, onError: err });
    } else if (dialog.kind === "duplicate") {
      const to = joinPath(parentDir(dialog.target), val);
      copy.mutate({ id: projectId, from: dialog.target, to }, { onSuccess: () => {
        toast(s.duplicated.replace("{path}", to));
      }, onError: err });
    }
    setDialog(null);
  };
  const confirmDelete = () => {
    if (dialog?.kind !== "delete") return;
    const path = dialog.target;
    del.mutate({ id: projectId, path }, { onSuccess: () => {
      forgetPath(path);
      toast(s.deleted.replace("{path}", path));
    }, onError: err });
    setDialog(null);
  };
  const buildMenu = (node) => {
    if (!node) return [
      { label: s.ctxNewFile, icon: FilePlus, onClick: () => setDialog({ kind: "newFile", dir: "" }) },
      { label: s.ctxNewFolder, icon: FolderPlus, onClick: () => setDialog({ kind: "newFolder", dir: "" }) }
    ];
    const common = [
      { label: s.ctxRename, icon: Pencil, onClick: () => setDialog({ kind: "rename", target: node.path }) },
      { label: s.ctxDuplicate, icon: Copy, onClick: () => setDialog({ kind: "duplicate", target: node.path }) },
      { label: s.ctxDelete, icon: Trash2, danger: true, onClick: () => setDialog({ kind: "delete", target: node.path }) },
      DIVIDER,
      { label: s.ctxCopyPath, icon: ClipboardCopy, onClick: () => copyPath(node.path) }
    ];
    if (node.type === "dir") return [
      { label: s.ctxNewFile, icon: FilePlus, onClick: () => setDialog({ kind: "newFile", dir: node.path }) },
      { label: s.ctxNewFolder, icon: FolderPlus, onClick: () => setDialog({ kind: "newFolder", dir: node.path }) },
      DIVIDER,
      ...common
    ];
    return [
      { label: s.ctxOpen, icon: File2, onClick: () => openFile(node.path) },
      DIVIDER,
      ...common
    ];
  };
  const onContextMenu = (e, node) => {
    setOpenMenu(null);
    setMenu({ x: e.clientX, y: e.clientY, items: buildMenu(node) });
  };
  const menus = [
    { id: "file", label: s.menuFile, items: [
      { label: s.ctxNewFile, icon: FilePlus, onClick: () => setDialog({ kind: "newFile", dir: uploadDir }) },
      { label: s.ctxNewFolder, icon: FolderPlus, onClick: () => setDialog({ kind: "newFolder", dir: uploadDir }) },
      DIVIDER,
      { label: s.menuUpload, icon: Upload, disabled: uploading, onClick: () => fileInput.current?.click() },
      { label: s.download, icon: Download, disabled: !selected, onClick: () => {
        if (selected) download(selected);
      } },
      DIVIDER,
      { label: s.ctxRename, icon: Pencil, disabled: !selected, onClick: () => {
        if (selected) setDialog({ kind: "rename", target: selected });
      } },
      { label: s.ctxDuplicate, icon: Copy, disabled: !selected, onClick: () => {
        if (selected) setDialog({ kind: "duplicate", target: selected });
      } },
      { label: s.ctxDelete, icon: Trash2, danger: true, disabled: !selected, onClick: () => {
        if (selected) setDialog({ kind: "delete", target: selected });
      } }
    ] },
    { id: "view", label: s.menuView, items: [
      { label: s.wordWrap, icon: prefs.wordWrap ? Check : WrapText, onClick: () => updatePrefs({ wordWrap: !prefs.wordWrap }) },
      { label: s.menuMinimap, icon: prefs.minimap ? Check : Map2, onClick: () => updatePrefs({ minimap: !prefs.minimap }) },
      DIVIDER,
      { label: fullscreen ? s.exitFullscreen : s.fullscreen, icon: fullscreen ? Minimize2 : Maximize2, onClick: () => setFullscreen((f2) => !f2) }
    ] },
    { id: "settings", label: s.menuSettings, items: [
      { label: s.fontBigger, icon: Type, disabled: prefs.fontSize >= MAX_FONT_SIZE, onClick: () => updatePrefs({ fontSize: prefs.fontSize + 1 }) },
      { label: s.fontSmaller, icon: Type, disabled: prefs.fontSize <= MIN_FONT_SIZE, onClick: () => updatePrefs({ fontSize: prefs.fontSize - 1 }) },
      DIVIDER,
      ...TAB_SIZES.map((n) => ({
        label: s.tabSizeOption.replace("{n}", String(n)),
        icon: prefs.tabSize === n ? Check : AlignLeft,
        onClick: () => updatePrefs({ tabSize: n })
      }))
    ] }
  ];
  const openTopMenu = (menu2, x2, y2) => {
    if (!menu2) {
      setOpenMenu(null);
      setMenu(null);
      return;
    }
    setOpenMenu(menu2.id);
    setMenu({ x: x2, y: y2, items: menu2.items });
  };
  const dialogTitle = dialog?.kind === "newFile" ? s.dlgNewFile : dialog?.kind === "newFolder" ? s.dlgNewFolder : dialog?.kind === "rename" ? s.dlgRename : dialog?.kind === "duplicate" ? s.dlgDuplicate : "";
  const dialogInitial = dialog?.kind === "rename" ? baseName(dialog.target) : dialog?.kind === "duplicate" ? baseName(copyName(dialog.target)) : "";
  const viewControls = editable ? /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
      ViewSwitch,
      {
        label: s.viewMode,
        value: effTab,
        onChange: setTab,
        options: [
          { id: "edit", label: s.tabEdit, icon: CodeXml },
          ...previewableText ? [{ id: "preview", label: s.tabPreview, icon: Eye }] : [],
          { id: "diff", label: s.tabDiff, icon: GitCompare }
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Button3, { variant: "accent", icon: Save, disabled: !dirty || write.isPending, onClick: save, children: t.common.save })
  ] }) : null;
  const surface = /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "flex flex-wrap items-center gap-2 border-b border-border px-3 py-2", children: [
      mobile && fullscreen && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
        "button",
        {
          type: "button",
          onClick: () => setShowTree((cur) => !cur),
          "aria-pressed": showTree,
          "aria-label": s.toggleTree,
          title: s.toggleTree,
          className: `overlay-touch-target flex h-7 w-7 items-center justify-center rounded-md transition-colors ${showTree ? "bg-accent/15 text-accent" : "text-text-muted hover:bg-elevated hover:text-text"}`,
          children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(PanelLeft, { size: 15 })
        }
      ),
      !fullscreen && /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(CodeXml, { size: 15, className: "shrink-0 text-accent", "aria-hidden": true }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "text-sm font-semibold text-text", children: s.editorTitle })
      ] }),
      working ? /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("span", { className: "truncate font-mono text-xs text-warning", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(GitCompare, { size: 11, className: "mr-1 inline", "aria-hidden": true }),
        s.workingChanges
      ] }) : commit ? /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("button", { type: "button", onClick: () => setSelected(null), disabled: !selected, title: selected ? s.viewCommit : void 0, className: "overlay-menu-item flex min-w-0 items-center truncate font-mono text-xs text-accent transition-colors enabled:hover:text-text disabled:cursor-default", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(GitCompare, { size: 11, className: "mr-1 inline shrink-0", "aria-hidden": true }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("span", { className: "truncate", children: [
          s.commitLabel,
          " ",
          commit.slice(0, 8),
          selected ? ` \xB7 ${selected}` : ""
        ] })
      ] }) : null,
      !commit && !working ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(MenuBar, { menus, openId: openMenu, onOpen: openTopMenu }) : null,
      uploading ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "text-xs text-text-muted", children: s.uploading }) : null,
      !fullscreen ? /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "ml-auto flex items-center gap-2", children: [
        viewControls,
        onClose ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("button", { type: "button", "aria-label": t.common.close, onClick: onClose, className: "overlay-touch-target flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-elevated hover:text-text", children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(X, { size: 15 }) }) : null
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "relative flex min-h-0 flex-1", children: [
      mobile && fullscreen && !showTree ? null : /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(
        "div",
        {
          onDragOver: (e) => {
            if (commit || working) return;
            e.preventDefault();
            setDropping(true);
          },
          onDragLeave: (e) => {
            if (e.currentTarget.contains(e.relatedTarget)) return;
            setDropping(false);
          },
          onDrop: (e) => {
            if (commit || working) return;
            e.preventDefault();
            setDropping(false);
            runUpload(Array.from(e.dataTransfer.files ?? []), uploadDir);
          },
          className: `relative flex shrink-0 flex-col border-r border-border ${mobile && fullscreen ? "absolute inset-y-0 left-0 z-10 w-[80%] max-w-72 bg-surface shadow-[var(--shadow-raised)]" : "w-[clamp(11rem,18vw,16rem)] bg-bg/40"} ${dropping ? "ring-2 ring-inset ring-accent" : ""}`,
          children: [
            dropping ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-accent/10 px-3 text-center text-xs font-medium text-accent", children: s.dropHere.replace("{dir}", uploadDir || "/") }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "min-h-0 flex-1 overflow-auto p-1.5", children: files.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(LoadingState, {}) : /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(FileTree, { tree, expanded, onToggle: toggle, selected, onSelect: (p) => {
              selectInTree(p);
              if (mobile && fullscreen) setShowTree(false);
            }, changed: changedSet, onContextMenu, emptyLabel: s.noFiles, treeLabel: s.editorTitle }) }),
            !fullscreen ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "shrink-0 border-t border-border p-1.5", children: /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(
              "button",
              {
                type: "button",
                onClick: () => setFullscreen(true),
                title: s.fullscreen,
                className: "overlay-menu-item flex w-full items-center justify-center gap-2 rounded-md border border-border bg-elevated px-2 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text",
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Maximize2, { size: 13, "aria-hidden": true }),
                  s.fullscreen
                ]
              }
            ) }) : null
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "flex min-w-0 flex-1 flex-col", children: [
        !commit && !working ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Tabs, { tabs: openTabs, active: selected, dirty: dirtyPaths, onSelect: setSelected, onClose: closeTab, closeLabel: t.common.close }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "min-h-0 flex-1", children: working ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(PatchView, { diff: changesData.data?.diff ?? "", loading: changesData.isLoading, empty: s.noChanges }) : commit && selected ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(PatchView, { diff: commitFileDiff.data?.diff ?? "", loading: commitFileDiff.isLoading, empty: s.noChanges }) : commit ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(PatchView, { diff: commitData.data?.diff ?? "", loading: commitData.isLoading, empty: s.noChanges }) : !selected ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(EmptyState, { title: s.selectFile, icon: File2 }) : fileKind === "image" && fileSize <= MAX_BUFFERED_BYTES ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ImagePreview, { projectId, path: selected }) : fileKind === "pdf" && fileSize <= MAX_BUFFERED_BYTES ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(PdfPreview, { projectId, path: selected, failedLabel: s.previewFailed }) : fileKind === "office" && fileSize <= MAX_OFFICE_BYTES ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(PdfPreview, { projectId, path: selected, failedLabel: s.previewFailed, office: true }) : (fileKind === "video" || fileKind === "audio") && fileSize <= MAX_MEDIA_PREVIEW_BYTES ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(MediaPreview, { projectId, path: selected, kind: fileKind }) : fileKind === "binary" || fileKind === "image" || fileKind === "pdf" || fileKind === "office" || fileKind === "video" || fileKind === "audio" ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(BinaryPreview, { projectId, path: selected, size: fileSize, message: fileKind === "binary" ? s.binaryFile : s.previewTooLarge, downloadLabel: s.download, sizeLabel: s.fileSize, typeLabel: s.fileType, downloadAvailable: fileSize <= MAX_BUFFERED_BYTES, downloadUnavailableLabel: s.downloadUnavailable }) : fileData.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(LoadingState, {}) : fileData.data?.truncated ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "p-4 text-center text-sm text-text-muted", children: s.fileTooBig }) : effTab === "diff" ? headData.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(LoadingState, {}) : /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(DiffEditorPane, { path: selected, original: headData.data?.content ?? "", modified: value, prefs }) : effTab === "preview" && fileKind === "csv" ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(CsvPreview, { source: value, invalidLabel: s.csvInvalid, limitedLabel: s.csvLimited }) : effTab === "preview" ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(MarkdownPreview, { source: value }) : /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(EditorPane, { path: selected, value, onChange, onSave: save, prefs, onCursor: setCursor }) }),
        selected && textFile && !commit && !working && effTab === "edit" ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
          StatusBar,
          {
            path: selected,
            cursor,
            language: langOf(selected),
            tabSize: prefs.tabSize,
            size: fileSize,
            dirty,
            labels: { line: s.statusLine, column: s.statusColumn, selected: s.statusSelected, spaces: s.statusSpaces, unsaved: s.statusUnsaved }
          }
        ) : null
      ] })
    ] }),
    !fullscreen && !fill ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
      "div",
      {
        role: "separator",
        "aria-orientation": "horizontal",
        "aria-label": s.resizeEditor,
        title: s.resizeEditor,
        onPointerDown: (e) => {
          e.preventDefault();
          dragY.current = e.clientY;
          e.currentTarget.setPointerCapture?.(e.pointerId);
        },
        onPointerMove: (e) => {
          if (dragY.current === null) return;
          const dy = e.clientY - dragY.current;
          dragY.current = e.clientY;
          setEditorH((h2) => clampEditorH(h2 + dy));
        },
        onPointerUp: (e) => {
          if (dragY.current === null) return;
          dragY.current = null;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        },
        onLostPointerCapture: () => {
          dragY.current = null;
        },
        className: "group flex h-3.5 shrink-0 cursor-row-resize items-center justify-center border-t border-border bg-bg/40 transition-colors hover:bg-elevated",
        children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "h-1 w-10 rounded-full bg-border transition-all duration-200 group-hover:w-16 group-hover:bg-text-muted" })
      }
    ) : null,
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
      "input",
      {
        ref: fileInput,
        type: "file",
        multiple: true,
        className: "hidden",
        onChange: (e) => {
          runUpload(Array.from(e.target.files ?? []), uploadDir);
          e.target.value = "";
        }
      }
    ),
    menu ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ContextMenu, { state: menu, onClose: () => {
      setMenu(null);
      setOpenMenu(null);
    } }) : null,
    dialog && dialog.kind === "delete" ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ConfirmDialog, { title: s.dlgDelete, message: s.dlgDeleteMsg.replace("{name}", baseName(dialog.target)), confirmLabel: s.ctxDelete, danger: true, icon: Trash2, onConfirm: confirmDelete, onCancel: () => setDialog(null) }) : dialog ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(PromptDialog, { title: dialogTitle, label: s.dlgName, initialValue: dialogInitial, confirmLabel: t.common.save, onConfirm: submitDialog, onCancel: () => setDialog(null) }) : null
  ] });
  if (fullscreen) {
    return /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
      WorkspaceTakeover,
      {
        title: s.editorTitle,
        onBack: leaveFullscreen,
        backLabel: mobile && onClose ? t.common.back : s.exitFullscreen,
        toolbar: viewControls,
        children: surface
      }
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "flex flex-col overflow-hidden border-y border-border bg-document", style: { height: fill ? "100%" : editorH }, children: surface });
}

// plugins/editor/web-src/EditorPage.tsx
var import_jsx_runtime16 = __toESM(require_jsx_runtime(), 1);
var { useProjects, usePluginStrings: usePluginStrings2, useProjectFilter, useFillHeight, useMobile: useMobile2 } = runtime().hooks;
var {
  ModuleHeader,
  EmptyState: EmptyState2,
  WorkspacePage,
  WorkspaceHero,
  ProjectFilterPills,
  ControlSurfaceDocument,
  MotionPresence,
  MotionLayoutItem
} = runtime().components;
var { navigate } = runtime();
function linkTarget() {
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get("project"));
  return {
    project: Number.isInteger(id) && id > 0 ? id : null,
    commit: params.get("commit"),
    working: params.get("working") === "1"
  };
}
function EditorPage() {
  const s = usePluginStrings2("editor");
  const mobile = useMobile2();
  const projects = useProjects();
  const surfaceRef = (0, import_react22.useRef)(null);
  const fillHeight = useFillHeight(surfaceRef);
  const { selectedProject, setProject } = useProjectFilter("elowen.editor.project");
  const [link] = (0, import_react22.useState)(linkTarget);
  const list = projects.data ?? [];
  const filtered = selectedProject === "all" ? list[0]?.id ?? null : selectedProject;
  const projectId = link.project != null && list.some((item) => item.id === link.project) ? link.project : filtered;
  const project = list.find((item) => item.id === projectId) ?? null;
  const onClose = mobile ? () => {
    if (window.history.length > 1) window.history.back();
    else navigate("/dash");
  } : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ModuleHeader, { title: s.title, icon: CodeXml }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(WorkspacePage, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
        WorkspaceHero,
        {
          eyebrow: s.workspaceEyebrow,
          title: s.title,
          icon: CodeXml,
          status: project ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "workspace-status", children: s.workspaceReady.replace("{project}", project.slug) }) : void 0,
          action: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ProjectFilterPills, { value: projectId ?? "all", onChange: setProject, includeAll: false, variant: "dropdown" })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { ref: surfaceRef, className: "pt-4", style: fillHeight ? { height: fillHeight } : void 0, children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ControlSurfaceDocument, { className: "editor-control-surface", children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(MotionPresence, { mode: "wait", children: projectId == null ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(MotionLayoutItem, { className: "h-full", children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(EmptyState2, { title: s.noProjects, description: s.noProjectsDescription, icon: CodeXml }) }, "empty") : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(MotionLayoutItem, { className: "h-full", children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ProjectEditor, { projectId, initialCommit: link.commit, initialWorking: link.working, onClose, fill: true }) }, `${projectId}:${link.commit ?? ""}:${link.working}`) }) }) })
    ] })
  ] });
}

// plugins/editor/web-src/index.tsx
registerEditorUi({
  requiresApiVersion: 8,
  pages: { "": EditorPage }
});
