import { createRequire as __shipping_mode_createRequire } from "node:module";
const require = __shipping_mode_createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf, __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require < "u" ? require : typeof Proxy < "u" ? new Proxy(x, {
  get: (a, b) => (typeof require < "u" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require < "u") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: !0 });
}, __copyProps = (to, from, except, desc) => {
  if (from && typeof from == "object" || typeof from == "function")
    for (let key of __getOwnPropNames(from))
      !__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: !0 }) : target,
  mod
));

// node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = Symbol.for("yaml.alias"), DOC = Symbol.for("yaml.document"), MAP = Symbol.for("yaml.map"), PAIR = Symbol.for("yaml.pair"), SCALAR = Symbol.for("yaml.scalar"), SEQ = Symbol.for("yaml.seq"), NODE_TYPE = Symbol.for("yaml.node.type"), isAlias = (node) => !!node && typeof node == "object" && node[NODE_TYPE] === ALIAS, isDocument = (node) => !!node && typeof node == "object" && node[NODE_TYPE] === DOC, isMap = (node) => !!node && typeof node == "object" && node[NODE_TYPE] === MAP, isPair = (node) => !!node && typeof node == "object" && node[NODE_TYPE] === PAIR, isScalar = (node) => !!node && typeof node == "object" && node[NODE_TYPE] === SCALAR, isSeq = (node) => !!node && typeof node == "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node == "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return !0;
        }
      return !1;
    }
    function isNode(node) {
      if (node && typeof node == "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return !0;
        }
      return !1;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity(), BREAK = Symbol("break visit"), SKIP = Symbol("skip children"), REMOVE = Symbol("remove node");
    function visit(node, visitor) {
      let visitor_ = initVisitor(visitor);
      identity.isDocument(node) ? visit_(null, node.contents, visitor_, Object.freeze([node])) === REMOVE && (node.contents = null) : visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path14) {
      let ctrl = callVisitor(key, node, visitor, path14);
      if (identity.isNode(ctrl) || identity.isPair(ctrl))
        return replaceNode(key, path14, ctrl), visit_(key, ctrl, visitor, path14);
      if (typeof ctrl != "symbol") {
        if (identity.isCollection(node)) {
          path14 = Object.freeze(path14.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            let ci = visit_(i, node.items[i], visitor, path14);
            if (typeof ci == "number")
              i = ci - 1;
            else {
              if (ci === BREAK)
                return BREAK;
              ci === REMOVE && (node.items.splice(i, 1), i -= 1);
            }
          }
        } else if (identity.isPair(node)) {
          path14 = Object.freeze(path14.concat(node));
          let ck = visit_("key", node.key, visitor, path14);
          if (ck === BREAK)
            return BREAK;
          ck === REMOVE && (node.key = null);
          let cv = visit_("value", node.value, visitor, path14);
          if (cv === BREAK)
            return BREAK;
          cv === REMOVE && (node.value = null);
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      let visitor_ = initVisitor(visitor);
      identity.isDocument(node) ? await visitAsync_(null, node.contents, visitor_, Object.freeze([node])) === REMOVE && (node.contents = null) : await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path14) {
      let ctrl = await callVisitor(key, node, visitor, path14);
      if (identity.isNode(ctrl) || identity.isPair(ctrl))
        return replaceNode(key, path14, ctrl), visitAsync_(key, ctrl, visitor, path14);
      if (typeof ctrl != "symbol") {
        if (identity.isCollection(node)) {
          path14 = Object.freeze(path14.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            let ci = await visitAsync_(i, node.items[i], visitor, path14);
            if (typeof ci == "number")
              i = ci - 1;
            else {
              if (ci === BREAK)
                return BREAK;
              ci === REMOVE && (node.items.splice(i, 1), i -= 1);
            }
          }
        } else if (identity.isPair(node)) {
          path14 = Object.freeze(path14.concat(node));
          let ck = await visitAsync_("key", node.key, visitor, path14);
          if (ck === BREAK)
            return BREAK;
          ck === REMOVE && (node.key = null);
          let cv = await visitAsync_("value", node.value, visitor, path14);
          if (cv === BREAK)
            return BREAK;
          cv === REMOVE && (node.value = null);
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      return typeof visitor == "object" && (visitor.Collection || visitor.Node || visitor.Value) ? Object.assign({
        Alias: visitor.Node,
        Map: visitor.Node,
        Scalar: visitor.Node,
        Seq: visitor.Node
      }, visitor.Value && {
        Map: visitor.Value,
        Scalar: visitor.Value,
        Seq: visitor.Value
      }, visitor.Collection && {
        Map: visitor.Collection,
        Seq: visitor.Collection
      }, visitor) : visitor;
    }
    function callVisitor(key, node, visitor, path14) {
      if (typeof visitor == "function")
        return visitor(key, node, path14);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path14);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path14);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path14);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path14);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path14);
    }
    function replaceNode(key, path14, node) {
      let parent = path14[path14.length - 1];
      if (identity.isCollection(parent))
        parent.items[key] = node;
      else if (identity.isPair(parent))
        key === "key" ? parent.key = node : parent.value = node;
      else if (identity.isDocument(parent))
        parent.contents = node;
      else {
        let pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity = require_identity(), visit = require_visit(), escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    }, escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]), Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null, this.docEnd = !1, this.yaml = Object.assign({}, _Directives.defaultYaml, yaml), this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        let copy = new _Directives(this.yaml, this.tags);
        return copy.docStart = this.docStart, copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        let res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = !0;
            break;
          case "1.2":
            this.atNextDocument = !1, this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            }, this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        this.atNextDocument && (this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" }, this.tags = Object.assign({}, _Directives.defaultTags), this.atNextDocument = !1);
        let parts = line.trim().split(/[ \t]+/), name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2 && (onError(0, "%TAG directive should contain exactly two parts"), parts.length < 2))
              return !1;
            let [handle, prefix] = parts;
            return this.tags[handle] = prefix, !0;
          }
          case "%YAML": {
            if (this.yaml.explicit = !0, parts.length !== 1)
              return onError(0, "%YAML directive should contain exactly one part"), !1;
            let [version] = parts;
            if (version === "1.1" || version === "1.2")
              return this.yaml.version = version, !0;
            {
              let isValid = /^\d+\.\d+$/.test(version);
              return onError(6, `Unsupported YAML version ${version}`, isValid), !1;
            }
          }
          default:
            return onError(0, `Unknown directive ${name}`, !0), !1;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!")
          return onError(`Not a valid tag: ${source}`), null;
        if (source[1] === "<") {
          let verbatim = source.slice(2, -1);
          return verbatim === "!" || verbatim === "!!" ? (onError(`Verbatim tags aren't resolved, so ${source} is invalid.`), null) : (source[source.length - 1] !== ">" && onError("Verbatim tags must end with a >"), verbatim);
        }
        let [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        suffix || onError(`The ${source} tag has no suffix`);
        let prefix = this.tags[handle];
        if (prefix)
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            return onError(String(error)), null;
          }
        return handle === "!" ? source : (onError(`Could not resolve tag: ${source}`), null);
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (let [handle, prefix] of Object.entries(this.tags))
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        let lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [], tagEntries = Object.entries(this.tags), tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          let tags = {};
          visit.visit(doc.contents, (_key, node) => {
            identity.isNode(node) && node.tag && (tags[node.tag] = !0);
          }), tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (let [handle, prefix] of tagEntries)
          handle === "!!" && prefix === "tag:yaml.org,2002:" || (!doc || tagNames.some((tn) => tn.startsWith(prefix))) && lines.push(`%TAG ${handle} ${prefix}`);
        return lines.join(`
`);
      }
    };
    Directives.defaultYaml = { explicit: !1, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity = require_identity(), visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        let msg = `Anchor must not contain whitespace or control characters: ${JSON.stringify(anchor)}`;
        throw new Error(msg);
      }
      return !0;
    }
    function anchorNames(root) {
      let anchors = /* @__PURE__ */ new Set();
      return visit.visit(root, {
        Value(_key, node) {
          node.anchor && anchors.add(node.anchor);
        }
      }), anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; ; ++i) {
        let name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      let aliasObjects = [], sourceObjects = /* @__PURE__ */ new Map(), prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source), prevAnchors ?? (prevAnchors = anchorNames(doc));
          let anchor = findNewAnchor(prefix, prevAnchors);
          return prevAnchors.add(anchor), anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (let source of aliasObjects) {
            let ref = sourceObjects.get(source);
            if (typeof ref == "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node)))
              ref.node.anchor = ref.anchor;
            else {
              let error = new Error("Failed to resolve repeated object (this should not happen)");
              throw error.source = source, error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val == "object")
        if (Array.isArray(val))
          for (let i = 0, len = val.length; i < len; ++i) {
            let v0 = val[i], v1 = applyReviver(reviver, val, String(i), v0);
            v1 === void 0 ? delete val[i] : v1 !== v0 && (val[i] = v1);
          }
        else if (val instanceof Map)
          for (let k of Array.from(val.keys())) {
            let v0 = val.get(k), v1 = applyReviver(reviver, val, k, v0);
            v1 === void 0 ? val.delete(k) : v1 !== v0 && val.set(k, v1);
          }
        else if (val instanceof Set)
          for (let v0 of Array.from(val)) {
            let v1 = applyReviver(reviver, val, v0, v0);
            v1 === void 0 ? val.delete(v0) : v1 !== v0 && (val.delete(v0), val.add(v1));
          }
        else
          for (let [k, v0] of Object.entries(val)) {
            let v1 = applyReviver(reviver, val, k, v0);
            v1 === void 0 ? delete val[k] : v1 !== v0 && (val[k] = v1);
          }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON == "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        let data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data), ctx.onCreate = (res2) => {
          data.res = res2, delete ctx.onCreate;
        };
        let res = value.toJSON(arg, ctx);
        return ctx.onCreate && ctx.onCreate(res), res;
      }
      return typeof value == "bigint" && !ctx?.keep ? Number(value) : value;
    }
    exports.toJS = toJS;
  }
});

// node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver(), identity = require_identity(), toJS = require_toJS(), NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        let copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        return this.range && (copy.range = this.range.slice()), copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        let ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: !0,
          mapAsMap: mapAsMap === !0,
          mapKeyWarned: !1,
          maxAliasCount: typeof maxAliasCount == "number" ? maxAliasCount : 100
        }, res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor == "function")
          for (let { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver == "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors(), visit = require_visit(), identity = require_identity(), Node = require_Node(), toJS = require_toJS(), Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS), this.source = source, Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        ctx?.aliasResolveCache ? nodes = ctx.aliasResolveCache : (nodes = [], visit.visit(doc, {
          Node: (_key, node) => {
            (identity.isAlias(node) || identity.hasAnchor(node)) && nodes.push(node);
          }
        }), ctx && (ctx.aliasResolveCache = nodes));
        let found;
        for (let node of nodes) {
          if (node === this)
            break;
          node.anchor === this.source && (found = node);
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        let { anchors: anchors2, doc, maxAliasCount } = ctx, source = this.resolve(doc, ctx);
        if (!source) {
          let msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        let data = anchors2.get(source);
        if (data || (toJS.toJS(source, null, ctx), data = anchors2.get(source)), data?.res === void 0) {
          let msg = "This should not happen: Alias anchor was not resolved?";
          throw new ReferenceError(msg);
        }
        if (maxAliasCount >= 0 && (data.count += 1, data.aliasCount === 0 && (data.aliasCount = getAliasCount(doc, source, anchors2)), data.count * data.aliasCount > maxAliasCount)) {
          let msg = "Excessive alias count indicates a resource exhaustion attack";
          throw new ReferenceError(msg);
        }
        return data.res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        let src = `*${this.source}`;
        if (ctx) {
          if (anchors.anchorIsValid(this.source), ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            let msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        let source = node.resolve(doc), anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (let item of node.items) {
          let c = getAliasCount(doc, item, anchors2);
          c > count && (count = c);
        }
        return count;
      } else if (identity.isPair(node)) {
        let kc = getAliasCount(doc, node.key, anchors2), vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity = require_identity(), Node = require_Node(), toJS = require_toJS(), isScalarValue = (value) => !value || typeof value != "function" && typeof value != "object", Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR), this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias(), identity = require_identity(), Scalar = require_Scalar(), defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        let match = tags.filter((t) => t.tag === tagName), tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value) && (value = value.contents), identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        let map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        return map.items.push(value), map;
      }
      (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt < "u" && value instanceof BigInt) && (value = value.valueOf());
      let { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx, ref;
      if (aliasDuplicateObjects && value && typeof value == "object") {
        if (ref = sourceObjects.get(value), ref)
          return ref.anchor ?? (ref.anchor = onAnchor(value)), new Alias.Alias(ref.anchor);
        ref = { anchor: null, node: null }, sourceObjects.set(value, ref);
      }
      tagName?.startsWith("!!") && (tagName = defaultTagPrefix + tagName.slice(2));
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON == "function" && (value = value.toJSON()), !value || typeof value != "object") {
          let node2 = new Scalar.Scalar(value);
          return ref && (ref.node = node2), node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      onTagObj && (onTagObj(tagObj), delete ctx.onTagObj);
      let node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from == "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      return tagName ? node.tag = tagName : tagObj.default || (node.tag = tagObj.tag), ref && (ref.node = node), node;
    }
    exports.createNode = createNode;
  }
});

// node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode(), identity = require_identity(), Node = require_Node();
    function collectionFromPath(schema, path14, value) {
      let v = value;
      for (let i = path14.length - 1; i >= 0; --i) {
        let k = path14[i];
        if (typeof k == "number" && Number.isInteger(k) && k >= 0) {
          let a = [];
          a[k] = v, v = a;
        } else
          v = /* @__PURE__ */ new Map([[k, v]]);
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: !1,
        keepUndefined: !1,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path14) => path14 == null || typeof path14 == "object" && !!path14[Symbol.iterator]().next().done, Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type), Object.defineProperty(this, "schema", {
          value: schema,
          configurable: !0,
          enumerable: !1,
          writable: !0
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        let copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        return schema && (copy.schema = schema), copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it), this.range && (copy.range = this.range.slice()), copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path14, value) {
        if (isEmptyPath(path14))
          this.add(value);
        else {
          let [key, ...rest] = path14, node = this.get(key, !0);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path14) {
        let [key, ...rest] = path14;
        if (rest.length === 0)
          return this.delete(key);
        let node = this.get(key, !0);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path14, keepScalar) {
        let [key, ...rest] = path14, node = this.get(key, !0);
        return rest.length === 0 ? !keepScalar && identity.isScalar(node) ? node.value : node : identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return !1;
          let n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path14) {
        let [key, ...rest] = path14;
        if (rest.length === 0)
          return this.has(key);
        let node = this.get(key, !0);
        return identity.isCollection(node) ? node.hasIn(rest) : !1;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path14, value) {
        let [key, ...rest] = path14;
        if (rest.length === 0)
          this.set(key, value);
        else {
          let node = this.get(key, !0);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      return /^\n+$/.test(comment) ? comment.substring(1) : indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith(`
`) ? indentComment(comment, indent) : comment.includes(`
`) ? `
` + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow", FOLD_BLOCK = "block", FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      lineWidth < minContentWidth && (minContentWidth = 0);
      let endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      let folds = [], escapedFolds = {}, end = lineWidth - indent.length;
      typeof indentAtStart == "number" && (indentAtStart > lineWidth - Math.max(2, minContentWidth) ? folds.push(0) : end = lineWidth - indentAtStart);
      let split, prev, overflow = !1, i = -1, escStart = -1, escEnd = -1;
      mode === FOLD_BLOCK && (i = consumeMoreIndentedLines(text, i, indent.length), i !== -1 && (end = i + endStep));
      for (let ch; ch = text[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          switch (escStart = i, text[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === `
`)
          mode === FOLD_BLOCK && (i = consumeMoreIndentedLines(text, i, indent.length)), end = i + indent.length + endStep, split = void 0;
        else {
          if (ch === " " && prev && prev !== " " && prev !== `
` && prev !== "	") {
            let next = text[i + 1];
            next && next !== " " && next !== `
` && next !== "	" && (split = i);
          }
          if (i >= end)
            if (split)
              folds.push(split), end = split + endStep, split = void 0;
            else if (mode === FOLD_QUOTED) {
              for (; prev === " " || prev === "	"; )
                prev = ch, ch = text[i += 1], overflow = !0;
              let j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j), escapedFolds[j] = !0, end = j + endStep, split = void 0;
            } else
              overflow = !0;
        }
        prev = ch;
      }
      if (overflow && onOverflow && onOverflow(), folds.length === 0)
        return text;
      onFold && onFold();
      let res = text.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        let fold = folds[i2], end2 = folds[i2 + 1] || text.length;
        fold === 0 ? res = `
${indent}${text.slice(0, end2)}` : (mode === FOLD_QUOTED && escapedFolds[fold] && (res += `${text[fold]}\\`), res += `
${indent}${text.slice(fold + 1, end2)}`);
      }
      return res;
    }
    function consumeMoreIndentedLines(text, i, indent) {
      let end = i, start = i + 1, ch = text[start];
      for (; ch === " " || ch === "	"; )
        if (i < start + indent)
          ch = text[++i];
        else {
          do
            ch = text[++i];
          while (ch && ch !== `
`);
          end = i, start = i + 1, ch = text[start];
        }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar(), foldFlowLines = require_foldFlowLines(), getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    }), containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return !1;
      let limit = lineWidth - indentLength, strLen = str.length;
      if (strLen <= limit)
        return !1;
      for (let i = 0, start = 0; i < strLen; ++i)
        if (str[i] === `
`) {
          if (i - start > limit)
            return !0;
          if (start = i + 1, strLen - start <= limit)
            return !1;
        }
      return !0;
    }
    function doubleQuotedString(value, ctx) {
      let json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      let { implicitKey } = ctx, minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength, indent = ctx.indent || (containsDocumentMarker(value) ? "  " : ""), str = "", start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i])
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n" && (str += json.slice(start, i) + "\\ ", i += 1, start = i, ch = "\\"), ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start, i);
                let code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    code.substr(0, 2) === "00" ? str += "\\x" + code.substr(2) : str += json.substr(i, 6);
                }
                i += 5, start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength)
                i += 1;
              else {
                for (str += json.slice(start, i) + `

`; json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"'; )
                  str += `
`, i += 2;
                str += indent, json[i + 2] === " " && (str += "\\"), i += 1, start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      return str = start ? str + json.slice(start) : json, implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, !1));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === !1 || ctx.implicitKey && value.includes(`
`) || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      let indent = ctx.indent || (containsDocumentMarker(value) ? "  " : ""), res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, !1));
    }
    function quotedString(value, ctx) {
      let { singleQuote } = ctx.options, qs;
      if (singleQuote === !1)
        qs = doubleQuotedString;
      else {
        let hasDouble = value.includes('"'), hasSingle = value.includes("'");
        hasDouble && !hasSingle ? qs = singleQuotedString : hasSingle && !hasDouble ? qs = doubleQuotedString : qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp(`(^|(?<!
))
+(?!
|$)`, "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      let { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value))
        return quotedString(value, ctx);
      let indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : ""), literal = blockQuote === "literal" ? !0 : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? !1 : type === Scalar.Scalar.BLOCK_LITERAL ? !0 : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? `|
` : `>
`;
      let chomp, endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        let ch = value[endStart - 1];
        if (ch !== `
` && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart), endNlPos = end.indexOf(`
`);
      endNlPos === -1 ? chomp = "-" : value === end || endNlPos !== end.length - 1 ? (chomp = "+", onChompKeep && onChompKeep()) : chomp = "", end && (value = value.slice(0, -end.length), end[end.length - 1] === `
` && (end = end.slice(0, -1)), end = end.replace(blockEndNewlines, `$&${indent}`));
      let startWithSpace = !1, startEnd, startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        let ch = value[startEnd];
        if (ch === " ")
          startWithSpace = !0;
        else if (ch === `
`)
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      start && (value = value.substring(start.length), start = start.replace(/\n+/g, `$&${indent}`));
      let header = (startWithSpace ? indent ? "2" : "1" : "") + chomp;
      if (comment && (header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " ")), onComment && onComment()), !literal) {
        let foldedValue = value.replace(/\n+/g, `
$&`).replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`), literalFallback = !1, foldOptions = getFoldOptions(ctx, !0);
        blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED && (foldOptions.onOverflow = () => {
          literalFallback = !0;
        });
        let body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      return value = value.replace(/\n+/g, `$&${indent}`), `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      let { type, value } = item, { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes(`
`) || inFlow && /[[\]{},]/.test(value))
        return quotedString(value, ctx);
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value))
        return implicitKey || inFlow || !value.includes(`
`) ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes(`
`))
        return blockString(item, ctx, onComment, onChompKeep);
      if (containsDocumentMarker(value)) {
        if (indent === "")
          return ctx.forceBlockIndent = !0, blockString(item, ctx, onComment, onChompKeep);
        if (implicitKey && indent === indentStep)
          return quotedString(value, ctx);
      }
      let str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        let test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str), { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, !1));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      let { implicitKey, inFlow } = ctx, ss = typeof item.value == "string" ? item : Object.assign({}, item, { value: String(item.value) }), { type } = item;
      type !== Scalar.Scalar.QUOTE_DOUBLE && /[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value) && (type = Scalar.Scalar.QUOTE_DOUBLE);
      let _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      }, res = _stringify(type);
      if (res === null) {
        let { defaultKeyType, defaultStringType } = ctx.options, t = implicitKey && defaultKeyType || defaultStringType;
        if (res = _stringify(t), res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors(), identity = require_identity(), stringifyComment = require_stringifyComment(), stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      let opt = Object.assign({
        blockQuote: !0,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: !1,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: !0,
        indentSeq: !0,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: !1,
        singleQuote: null,
        trailingComma: !1,
        trueStr: "true",
        verifyAliasOrder: !0
      }, doc.schema.toStringOptions, options), inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = !1;
          break;
        case "flow":
          inFlow = !0;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent == "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        let match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj, obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          let testMatch = match.filter((t) => t.test);
          testMatch.length > 0 && (match = testMatch);
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else
        obj = item, tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      if (!tagObj) {
        let name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      let props = [], anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      anchor && anchors.anchorIsValid(anchor) && (anchors$1.add(anchor), props.push(`&${anchor}`));
      let tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      return tag && props.push(doc.directives.tagString(tag)), props.join(" ");
    }
    function stringify(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item))
          throw new TypeError("Cannot stringify circular structure without alias nodes");
        ctx.resolvedAliases ? ctx.resolvedAliases.add(item) : ctx.resolvedAliases = /* @__PURE__ */ new Set([item]), item = item.resolve(ctx.doc);
      }
      let tagObj, node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      let props = stringifyProps(node, tagObj, ctx);
      props.length > 0 && (ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1);
      let str = typeof tagObj.stringify == "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      return props ? identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}` : str;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity(), Scalar = require_Scalar(), stringify = require_stringify(), stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      let { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx, keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment)
          throw new Error("With simple keys, key nodes cannot have comments");
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key == "object") {
          let msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key == "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: !1,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = !1, chompKeep = !1, str = stringify.stringify(key, ctx, () => keyCommentDone = !0, () => chompKeep = !0);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = !0;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null)
          return keyCommentDone && onComment && onComment(), str === "" ? "?" : explicitKey ? `? ${str}` : str;
      } else if (allNullValues && !simpleKeys || value == null && explicitKey)
        return str = `? ${str}`, keyComment && !keyCommentDone ? str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment)) : chompKeep && onChompKeep && onChompKeep(), str;
      keyCommentDone && (keyComment = null), explicitKey ? (keyComment && (str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment))), str = `? ${str}
${indent}:`) : (str = `${str}:`, keyComment && (str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment))));
      let vsb, vcb, valueComment;
      identity.isNode(value) ? (vsb = !!value.spaceBefore, vcb = value.commentBefore, valueComment = value.comment) : (vsb = !1, vcb = null, valueComment = null, value && typeof value == "object" && (value = doc.createNode(value))), ctx.implicitKey = !1, !explicitKey && !keyComment && identity.isScalar(value) && (ctx.indentAtStart = str.length + 1), chompKeep = !1, !indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor && (ctx.indent = ctx.indent.substring(2));
      let valueCommentDone = !1, valueStr = stringify.stringify(value, ctx, () => valueCommentDone = !0, () => chompKeep = !0), ws = " ";
      if (keyComment || vsb || vcb) {
        if (ws = vsb ? `
` : "", vcb) {
          let cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        valueStr === "" && !ctx.inFlow ? ws === `
` && valueComment && (ws = `

`) : ws += `
${ctx.indent}`;
      } else if (!explicitKey && identity.isCollection(value)) {
        let vs0 = valueStr[0], nl0 = valueStr.indexOf(`
`), hasNewline = nl0 !== -1, flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = !1;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!" && (sp0 = valueStr.indexOf(" ", sp0 + 1)), (sp0 === -1 || nl0 < sp0) && (hasPropsLine = !0);
          }
          hasPropsLine || (ws = `
${ctx.indent}`);
        }
      } else (valueStr === "" || valueStr[0] === `
`) && (ws = "");
      return str += ws + valueStr, ctx.inFlow ? valueCommentDone && onComment && onComment() : valueComment && !valueCommentDone ? str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment)) : chompKeep && onChompKeep && onChompKeep(), str;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/yaml/dist/log.js"(exports) {
    "use strict";
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      logLevel === "debug" && console.log(...messages);
    }
    function warn(logLevel, warning) {
      (logLevel === "debug" || logLevel === "warn") && (typeof node_process.emitWarning == "function" ? node_process.emitWarning(warning) : console.warn(warning));
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    "use strict";
    var identity = require_identity(), Scalar = require_Scalar(), MERGE_KEY = "<<", merge = {
      identify: (value) => value === MERGE_KEY || typeof value == "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    }, isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      let source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (let it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (let it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      let source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      let srcMap = source.toJSON(null, ctx, Map);
      for (let [key, value2] of srcMap)
        map instanceof Map ? map.has(key) || map.set(key, value2) : map instanceof Set ? map.add(key) : Object.prototype.hasOwnProperty.call(map, key) || Object.defineProperty(map, key, {
          value: value2,
          writable: !0,
          enumerable: !0,
          configurable: !0
        });
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge;
  }
});

// node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log = require_log(), merge = require_merge(), stringify = require_stringify(), identity = require_identity(), toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        let jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map)
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        else if (map instanceof Set)
          map.add(jsKey);
        else {
          let stringKey = stringifyKey(key, jsKey, ctx), jsValue = toJS.toJS(value, stringKey, ctx);
          stringKey in map ? Object.defineProperty(map, stringKey, {
            value: jsValue,
            writable: !0,
            enumerable: !0,
            configurable: !0
          }) : map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey != "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        let strCtx = stringify.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (let node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = !0, strCtx.inStringifyKey = !0;
        let strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          jsonStr.length > 40 && (jsonStr = jsonStr.substring(0, 36) + '..."'), log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`), ctx.mapKeyWarned = !0;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/yaml/dist/nodes/Pair.js"(exports) {
    "use strict";
    var createNode = require_createNode(), stringifyPair = require_stringifyPair(), addPairToJSMap = require_addPairToJSMap(), identity = require_identity();
    function createPair(key, value, ctx) {
      let k = createNode.createNode(key, void 0, ctx), v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR }), this.key = key, this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        return identity.isNode(key) && (key = key.clone(schema)), identity.isNode(value) && (value = value.clone(schema)), new _Pair(key, value);
      }
      toJSON(_, ctx) {
        let pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity = require_identity(), stringify = require_stringify(), stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      return (ctx.inFlow ?? collection.flow ? stringifyFlowCollection : stringifyBlockCollection)(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      let { indent, options: { commentString } } = ctx, itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null }), chompKeep = !1, lines = [];
      for (let i = 0; i < items.length; ++i) {
        let item = items[i], comment2 = null;
        if (identity.isNode(item))
          !chompKeep && item.spaceBefore && lines.push(""), addCommentBefore(ctx, lines, item.commentBefore, chompKeep), item.comment && (comment2 = item.comment);
        else if (identity.isPair(item)) {
          let ik = identity.isNode(item.key) ? item.key : null;
          ik && (!chompKeep && ik.spaceBefore && lines.push(""), addCommentBefore(ctx, lines, ik.commentBefore, chompKeep));
        }
        chompKeep = !1;
        let str2 = stringify.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = !0);
        comment2 && (str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2))), chompKeep && comment2 && (chompKeep = !1), lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0)
        str = flowChars.start + flowChars.end;
      else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          let line = lines[i];
          str += line ? `
${indent}${line}` : `
`;
        }
      }
      return comment ? (str += `
` + stringifyComment.indentComment(commentString(comment), indent), onComment && onComment()) : chompKeep && onChompKeep && onChompKeep(), str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      let { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      let itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: !0,
        type: null
      }), reqNewline = !1, linesAtValue = 0, lines = [];
      for (let i = 0; i < items.length; ++i) {
        let item = items[i], comment = null;
        if (identity.isNode(item))
          item.spaceBefore && lines.push(""), addCommentBefore(ctx, lines, item.commentBefore, !1), item.comment && (comment = item.comment);
        else if (identity.isPair(item)) {
          let ik = identity.isNode(item.key) ? item.key : null;
          ik && (ik.spaceBefore && lines.push(""), addCommentBefore(ctx, lines, ik.commentBefore, !1), ik.comment && (reqNewline = !0));
          let iv = identity.isNode(item.value) ? item.value : null;
          iv ? (iv.comment && (comment = iv.comment), iv.commentBefore && (reqNewline = !0)) : item.value == null && ik?.comment && (comment = ik.comment);
        }
        comment && (reqNewline = !0);
        let str = stringify.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes(`
`)), i < items.length - 1 ? str += "," : ctx.options.trailingComma && (ctx.options.lineWidth > 0 && (reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth)), reqNewline && (str += ",")), comment && (str += stringifyComment.lineComment(str, itemIndent, commentString(comment))), lines.push(str), linesAtValue = lines.length;
      }
      let { start, end } = flowChars;
      if (lines.length === 0)
        return start + end;
      if (!reqNewline) {
        let len = lines.reduce((sum, line) => sum + line.length + 2, 2);
        reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
      }
      if (reqNewline) {
        let str = start;
        for (let line of lines)
          str += line ? `
${indentStep}${indent}${line}` : `
`;
        return `${str}
${indent}${end}`;
      } else
        return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep && (comment = comment.replace(/^\n+/, "")), comment) {
        let ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    "use strict";
    var stringifyCollection = require_stringifyCollection(), addPairToJSMap = require_addPairToJSMap(), Collection = require_Collection(), identity = require_identity(), Pair = require_Pair(), Scalar = require_Scalar();
    function findPair(items, key) {
      let k = identity.isScalar(key) ? key.value : key;
      for (let it of items)
        if (identity.isPair(it) && (it.key === key || it.key === k || identity.isScalar(it.key) && it.key.value === k))
          return it;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema), this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        let { keepUndefined, replacer } = ctx, map = new this(schema), add = (key, value) => {
          if (typeof replacer == "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          (value !== void 0 || keepUndefined) && map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map)
          for (let [key, value] of obj)
            add(key, value);
        else if (obj && typeof obj == "object")
          for (let key of Object.keys(obj))
            add(key, obj[key]);
        return typeof schema.sortMapEntries == "function" && map.items.sort(schema.sortMapEntries), map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        identity.isPair(pair) ? _pair = pair : !pair || typeof pair != "object" || !("key" in pair) ? _pair = new Pair.Pair(pair, pair?.value) : _pair = new Pair.Pair(pair.key, pair.value);
        let prev = findPair(this.items, _pair.key), sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value) ? prev.value.value = _pair.value : prev.value = _pair.value;
        } else if (sortEntries) {
          let i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          i === -1 ? this.items.push(_pair) : this.items.splice(i, 0, _pair);
        } else
          this.items.push(_pair);
      }
      delete(key) {
        let it = findPair(this.items, key);
        return it ? this.items.splice(this.items.indexOf(it), 1).length > 0 : !1;
      }
      get(key, keepScalar) {
        let node = findPair(this.items, key)?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), !0);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        let map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        ctx?.onCreate && ctx.onCreate(map);
        for (let item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (let item of this.items)
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        return !ctx.allNullValues && this.hasAllNullValues(!1) && (ctx = Object.assign({}, ctx, { allNullValues: !0 })), stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/yaml/dist/schema/common/map.js"(exports) {
    "use strict";
    var identity = require_identity(), YAMLMap = require_YAMLMap(), map = {
      collection: "map",
      default: !0,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        return identity.isMap(map2) || onError("Expected a mapping for this tag"), map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    "use strict";
    var createNode = require_createNode(), stringifyCollection = require_stringifyCollection(), Collection = require_Collection(), identity = require_identity(), Scalar = require_Scalar(), toJS = require_toJS(), YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema), this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        let idx = asItemIndex(key);
        return typeof idx != "number" ? !1 : this.items.splice(idx, 1).length > 0;
      }
      get(key, keepScalar) {
        let idx = asItemIndex(key);
        if (typeof idx != "number")
          return;
        let it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        let idx = asItemIndex(key);
        return typeof idx == "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        let idx = asItemIndex(key);
        if (typeof idx != "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        let prev = this.items[idx];
        identity.isScalar(prev) && Scalar.isScalarValue(value) ? prev.value = value : this.items[idx] = value;
      }
      toJSON(_, ctx) {
        let seq = [];
        ctx?.onCreate && ctx.onCreate(seq);
        let i = 0;
        for (let item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx ? stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        }) : JSON.stringify(this);
      }
      static from(schema, obj, ctx) {
        let { replacer } = ctx, seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer == "function") {
              let key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      return idx && typeof idx == "string" && (idx = Number(idx)), typeof idx == "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/yaml/dist/schema/common/seq.js"(exports) {
    "use strict";
    var identity = require_identity(), YAMLSeq = require_YAMLSeq(), seq = {
      collection: "seq",
      default: !0,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        return identity.isSeq(seq2) || onError("Expected a sequence for this tag"), seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/yaml/dist/schema/common/string.js"(exports) {
    "use strict";
    var stringifyString = require_stringifyString(), string = {
      identify: (value) => typeof value == "string",
      default: !0,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        return ctx = Object.assign({ actualString: !0 }, ctx), stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string;
  }
});

// node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/yaml/dist/schema/common/null.js"(exports) {
    "use strict";
    var Scalar = require_Scalar(), nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: !0,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source == "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/yaml/dist/schema/core/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar(), boolTag = {
      identify: (value) => typeof value == "boolean",
      default: !0,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          let sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value == "bigint")
        return String(value);
      let num = typeof value == "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        i < 0 && (i = n.length, n += ".");
        let d = minFractionDigits - (n.length - i - 1);
        for (; d-- > 0; )
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/yaml/dist/schema/core/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar(), stringifyNumber = require_stringifyNumber(), floatNaN = {
      identify: (value) => typeof value == "number",
      default: !0,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    }, floatExp = {
      identify: (value) => typeof value == "number",
      default: !0,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        let num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    }, float = {
      identify: (value) => typeof value == "number",
      default: !0,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        let node = new Scalar.Scalar(parseFloat(str)), dot = str.indexOf(".");
        return dot !== -1 && str[str.length - 1] === "0" && (node.minFractionDigits = str.length - dot - 1), node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/yaml/dist/schema/core/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber(), intIdentify = (value) => typeof value == "bigint" || Number.isInteger(value), intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      let { value } = node;
      return intIdentify(value) && value >= 0 ? prefix + value.toString(radix) : stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: !0,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    }, int = {
      identify: intIdentify,
      default: !0,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    }, intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: !0,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/yaml/dist/schema/core/schema.js"(exports) {
    "use strict";
    var map = require_map(), _null = require_null(), seq = require_seq(), string = require_string(), bool = require_bool(), float = require_float(), int = require_int(), schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/yaml/dist/schema/json/schema.js"(exports) {
    "use strict";
    var Scalar = require_Scalar(), map = require_map(), seq = require_seq();
    function intIdentify(value) {
      return typeof value == "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value), jsonScalars = [
      {
        identify: (value) => typeof value == "string",
        default: !0,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: !0,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value == "boolean",
        default: !0,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: !0,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value == "number",
        default: !0,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ], jsonError = {
      default: !0,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        return onError(`Unresolved plain scalar ${JSON.stringify(str)}`), str;
      }
    }, schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    "use strict";
    var node_buffer = __require("buffer"), Scalar = require_Scalar(), stringifyString = require_stringifyString(), binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: !1,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer == "function")
          return node_buffer.Buffer.from(src, "base64");
        if (typeof atob == "function") {
          let str = atob(src.replace(/[\n\r]/g, "")), buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else
          return onError("This environment does not support reading binary tags; either Buffer or atob is required"), src;
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        let buf = value, str;
        if (typeof node_buffer.Buffer == "function")
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        else if (typeof btoa == "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        if (type ?? (type = Scalar.Scalar.BLOCK_LITERAL), type !== Scalar.Scalar.QUOTE_DOUBLE) {
          let lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth), n = Math.ceil(str.length / lineWidth), lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth)
            lines[i] = str.substr(o, lineWidth);
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? `
` : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity = require_identity(), Pair = require_Pair(), Scalar = require_Scalar(), YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq))
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (!identity.isPair(item)) {
            if (identity.isMap(item)) {
              item.items.length > 1 && onError("Each pair must have its own sequence indicator");
              let pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
              if (item.commentBefore && (pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore), item.comment) {
                let cn = pair.value ?? pair.key;
                cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
              }
              item = pair;
            }
            seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
          }
        }
      else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      let { replacer } = ctx, pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          typeof replacer == "function" && (it = replacer.call(iterable, String(i++), it));
          let key, value;
          if (Array.isArray(it))
            if (it.length === 2)
              key = it[0], value = it[1];
            else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          else if (it && it instanceof Object) {
            let keys = Object.keys(it);
            if (keys.length === 1)
              key = keys[0], value = it[key];
            else
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
          } else
            key = it;
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: !1,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    "use strict";
    var identity = require_identity(), toJS = require_toJS(), YAMLMap = require_YAMLMap(), YAMLSeq = require_YAMLSeq(), pairs = require_pairs(), YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super(), this.add = YAMLMap.YAMLMap.prototype.add.bind(this), this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this), this.get = YAMLMap.YAMLMap.prototype.get.bind(this), this.has = YAMLMap.YAMLMap.prototype.has.bind(this), this.set = YAMLMap.YAMLMap.prototype.set.bind(this), this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        let map = /* @__PURE__ */ new Map();
        ctx?.onCreate && ctx.onCreate(map);
        for (let pair of this.items) {
          let key, value;
          if (identity.isPair(pair) ? (key = toJS.toJS(pair.key, "", ctx), value = toJS.toJS(pair.value, key, ctx)) : key = toJS.toJS(pair, "", ctx), map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        let pairs$1 = pairs.createPairs(schema, iterable, ctx), omap2 = new this();
        return omap2.items = pairs$1.items, omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: !1,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        let pairs$1 = pairs.resolvePairs(seq, onError), seenKeys = [];
        for (let { key } of pairs$1.items)
          identity.isScalar(key) && (seenKeys.includes(key.value) ? onError(`Ordered maps must not include duplicate keys: ${key.value}`) : seenKeys.push(key.value));
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      return source && (value ? trueTag : falseTag).test.test(source) ? source : value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === !0,
      default: !0,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(!0),
      stringify: boolStringify
    }, falseTag = {
      identify: (value) => value === !1,
      default: !0,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(!1),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar(), stringifyNumber = require_stringifyNumber(), floatNaN = {
      identify: (value) => typeof value == "number",
      default: !0,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    }, floatExp = {
      identify: (value) => typeof value == "number",
      default: !0,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        let num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    }, float = {
      identify: (value) => typeof value == "number",
      default: !0,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        let node = new Scalar.Scalar(parseFloat(str.replace(/_/g, ""))), dot = str.indexOf(".");
        if (dot !== -1) {
          let f = str.substring(dot + 1).replace(/_/g, "");
          f[f.length - 1] === "0" && (node.minFractionDigits = f.length);
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber(), intIdentify = (value) => typeof value == "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      let sign = str[0];
      if ((sign === "-" || sign === "+") && (offset += 1), str = str.substring(offset).replace(/_/g, ""), intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        let n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      let n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      let { value } = node;
      if (intIdentify(value)) {
        let str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: !0,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    }, intOct = {
      identify: intIdentify,
      default: !0,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    }, int = {
      identify: intIdentify,
      default: !0,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    }, intHex = {
      identify: intIdentify,
      default: !0,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    "use strict";
    var identity = require_identity(), Pair = require_Pair(), YAMLMap = require_YAMLMap(), YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema), this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        identity.isPair(key) ? pair = key : key && typeof key == "object" && "key" in key && "value" in key && key.value === null ? pair = new Pair.Pair(key.key, null) : pair = new Pair.Pair(key, null), YAMLMap.findPair(this.items, pair.key) || this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        let pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value != "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        let prev = YAMLMap.findPair(this.items, key);
        prev && !value ? this.items.splice(this.items.indexOf(prev), 1) : !prev && value && this.items.push(new Pair.Pair(key));
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(!0))
          return super.toString(Object.assign({}, ctx, { allNullValues: !0 }), onComment, onChompKeep);
        throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        let { replacer } = ctx, set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable)
            typeof replacer == "function" && (value = replacer.call(iterable, value, value)), set2.items.push(Pair.createPair(value, null, ctx));
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: !1,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(!0))
            return Object.assign(new YAMLSet(), map);
          onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      let sign = str[0], parts = sign === "-" || sign === "+" ? str.substring(1) : str, num = (n) => asBigInt ? BigInt(n) : Number(n), res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node, num = (n) => n;
      if (typeof value == "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      value < 0 && (sign = "-", value *= num(-1));
      let _60 = num(60), parts = [value % _60];
      return value < 60 ? parts.unshift(0) : (value = (value - parts[0]) / _60, parts.unshift(value % _60), value >= 60 && (value = (value - parts[0]) / _60, parts.unshift(value))), sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value == "bigint" || Number.isInteger(value),
      default: !0,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    }, floatTime = {
      identify: (value) => typeof value == "number",
      default: !0,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, !1),
      stringify: stringifySexagesimal
    }, timestamp = {
      identify: (value) => value instanceof Date,
      default: !0,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        let match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        let [, year, month, day, hour, minute, second] = match.map(Number), millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0, date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec), tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, !1);
          Math.abs(d) < 30 && (d *= 60), date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    "use strict";
    var map = require_map(), _null = require_null(), seq = require_seq(), string = require_string(), binary = require_binary(), bool = require_bool2(), float = require_float2(), int = require_int2(), merge = require_merge(), omap = require_omap(), pairs = require_pairs(), set = require_set(), timestamp = require_timestamp(), schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/yaml/dist/schema/tags.js"(exports) {
    "use strict";
    var map = require_map(), _null = require_null(), seq = require_seq(), string = require_string(), bool = require_bool(), float = require_float(), int = require_int(), schema = require_schema(), schema$1 = require_schema2(), binary = require_binary(), merge = require_merge(), omap = require_omap(), pairs = require_pairs(), schema$2 = require_schema3(), set = require_set(), timestamp = require_timestamp(), schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]), tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    }, coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      let schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags)
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      let tags = schemaTags;
      if (!tags)
        if (Array.isArray(customTags))
          tags = [];
        else {
          let keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      if (Array.isArray(customTags))
        for (let tag of customTags)
          tags = tags.concat(tag);
      else typeof customTags == "function" && (tags = customTags(tags.slice()));
      return addMergeTag && (tags = tags.concat(merge.merge)), tags.reduce((tags2, tag) => {
        let tagObj = typeof tag == "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          let tagName = JSON.stringify(tag), keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        return tags2.includes(tagObj) || tags2.push(tagObj), tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity = require_identity(), map = require_map(), seq = require_seq(), string = require_string(), tags = require_tags(), sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0, Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null, this.name = typeof schema == "string" && schema || "core", this.knownTags = resolveKnownTags ? tags.coreKnownTags : {}, this.tags = tags.getTags(customTags, this.name, merge), this.toStringOptions = toStringDefaults ?? null, Object.defineProperty(this, identity.MAP, { value: map.map }), Object.defineProperty(this, identity.SCALAR, { value: string.string }), Object.defineProperty(this, identity.SEQ, { value: seq.seq }), this.sortMapEntries = typeof sortMapEntries == "function" ? sortMapEntries : sortMapEntries === !0 ? sortMapEntriesByKey : null;
      }
      clone() {
        let copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        return copy.tags = this.tags.slice(), copy;
      }
    };
    exports.Schema = Schema;
  }
});

// node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity = require_identity(), stringify = require_stringify(), stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      let lines = [], hasDirectives = options.directives === !0;
      if (options.directives !== !1 && doc.directives) {
        let dir = doc.directives.toString(doc);
        dir ? (lines.push(dir), hasDirectives = !0) : doc.directives.docStart && (hasDirectives = !0);
      }
      hasDirectives && lines.push("---");
      let ctx = stringify.createStringifyContext(doc, options), { commentString } = ctx.options;
      if (doc.commentBefore) {
        lines.length !== 1 && lines.unshift("");
        let cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = !1, contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives && lines.push(""), doc.contents.commentBefore) {
            let cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment, contentComment = doc.contents.comment;
        }
        let onChompKeep = contentComment ? void 0 : () => chompKeep = !0, body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        contentComment && (body += stringifyComment.lineComment(body, "", commentString(contentComment))), (body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---" ? lines[lines.length - 1] = `--- ${body}` : lines.push(body);
      } else
        lines.push(stringify.stringify(doc.contents, ctx));
      if (doc.directives?.docEnd)
        if (doc.comment) {
          let cs = commentString(doc.comment);
          cs.includes(`
`) ? (lines.push("..."), lines.push(stringifyComment.indentComment(cs, ""))) : lines.push(`... ${cs}`);
        } else
          lines.push("...");
      else {
        let dc = doc.comment;
        dc && chompKeep && (dc = dc.replace(/^\n+/, "")), dc && ((!chompKeep || contentComment) && lines[lines.length - 1] !== "" && lines.push(""), lines.push(stringifyComment.indentComment(commentString(dc), "")));
      }
      return lines.join(`
`) + `
`;
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/yaml/dist/doc/Document.js"(exports) {
    "use strict";
    var Alias = require_Alias(), Collection = require_Collection(), identity = require_identity(), Pair = require_Pair(), toJS = require_toJS(), Schema = require_Schema(), stringifyDocument = require_stringifyDocument(), anchors = require_anchors(), applyReviver = require_applyReviver(), createNode = require_createNode(), directives = require_directives(), Document2 = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null, this.comment = null, this.errors = [], this.warnings = [], Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        typeof replacer == "function" || Array.isArray(replacer) ? _replacer = replacer : options === void 0 && replacer && (options = replacer, replacer = void 0);
        let opt = Object.assign({
          intAsBigInt: !1,
          keepSourceTokens: !1,
          logLevel: "warn",
          prettyErrors: !0,
          strict: !0,
          stringKeys: !1,
          uniqueKeys: !0,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        options?._directives ? (this.directives = options._directives.atDocument(), this.directives.yaml.explicit && (version = this.directives.yaml.version)) : this.directives = new directives.Directives({ version }), this.setSchema(version, options), this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        let copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        return copy.commentBefore = this.commentBefore, copy.comment = this.comment, copy.errors = this.errors.slice(), copy.warnings = this.warnings.slice(), copy.options = Object.assign({}, this.options), this.directives && (copy.directives = this.directives.clone()), copy.schema = this.schema.clone(), copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents, this.range && (copy.range = this.range.slice()), copy;
      }
      /** Adds a value to the document. */
      add(value) {
        assertCollection(this.contents) && this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path14, value) {
        assertCollection(this.contents) && this.contents.addIn(path14, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          let prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer;
        if (typeof replacer == "function")
          value = replacer.call({ "": value }, "", value), _replacer = replacer;
        else if (Array.isArray(replacer)) {
          let keyToStr = (v) => typeof v == "number" || v instanceof String || v instanceof Number, asStr = replacer.filter(keyToStr).map(String);
          asStr.length > 0 && (replacer = replacer.concat(asStr)), _replacer = replacer;
        } else options === void 0 && replacer && (options = replacer, replacer = void 0);
        let { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {}, { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        ), ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? !0,
          keepUndefined: keepUndefined ?? !1,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        }, node = createNode.createNode(value, tag, ctx);
        return flow && identity.isCollection(node) && (node.flow = !0), setAnchors(), node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        let k = this.createNode(key, null, options), v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : !1;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path14) {
        return Collection.isEmptyPath(path14) ? this.contents == null ? !1 : (this.contents = null, !0) : assertCollection(this.contents) ? this.contents.deleteIn(path14) : !1;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path14, keepScalar) {
        return Collection.isEmptyPath(path14) ? !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents : identity.isCollection(this.contents) ? this.contents.getIn(path14, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : !1;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path14) {
        return Collection.isEmptyPath(path14) ? this.contents !== void 0 : identity.isCollection(this.contents) ? this.contents.hasIn(path14) : !1;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        this.contents == null ? this.contents = Collection.collectionFromPath(this.schema, [key], value) : assertCollection(this.contents) && this.contents.set(key, value);
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path14, value) {
        Collection.isEmptyPath(path14) ? this.contents = value : this.contents == null ? this.contents = Collection.collectionFromPath(this.schema, Array.from(path14), value) : assertCollection(this.contents) && this.contents.setIn(path14, value);
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        typeof version == "number" && (version = String(version));
        let opt;
        switch (version) {
          case "1.1":
            this.directives ? this.directives.yaml.version = "1.1" : this.directives = new directives.Directives({ version: "1.1" }), opt = { resolveKnownTags: !1, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            this.directives ? this.directives.yaml.version = version : this.directives = new directives.Directives({ version }), opt = { resolveKnownTags: !0, schema: "core" };
            break;
          case null:
            this.directives && delete this.directives, opt = null;
            break;
          default: {
            let sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error("With a null YAML version, the { schema: Schema } option is required");
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        let ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === !0,
          mapKeyWarned: !1,
          maxAliasCount: typeof maxAliasCount == "number" ? maxAliasCount : 100
        }, res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor == "function")
          for (let { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver == "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: !0, jsonArg, mapAsMap: !1, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          let s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return !0;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document2;
  }
});

// node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/yaml/dist/errors.js"(exports) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super(), this.name = name, this.code = code, this.message = message, this.pos = pos;
      }
    }, YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    }, YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    }, prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      let { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1, lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        let trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart), ci -= trimStart - 1;
      }
      if (lineStr.length > 80 && (lineStr = lineStr.substring(0, 79) + "\u2026"), line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        prev.length > 80 && (prev = prev.substring(0, 79) + `\u2026
`), lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1, end = error.linePos[1];
        end?.line === line && end.col > col && (count = Math.max(1, Math.min(end.col - col, 80 - ci)));
        let pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = !1, atNewline = startOnNewline, hasSpace = startOnNewline, comment = "", commentSep = "", hasNewline = !1, reqSpace = !1, tab = null, anchor = null, tag = null, newlineAfterProp = null, comma = null, found = null, start = null;
      for (let token of tokens)
        switch (reqSpace && (token.type !== "space" && token.type !== "newline" && token.type !== "comma" && onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space"), reqSpace = !1), tab && (atNewline && token.type !== "comment" && token.type !== "newline" && onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation"), tab = null), token.type) {
          case "space":
            !flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	") && (tab = token), hasSpace = !0;
            break;
          case "comment": {
            hasSpace || onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            let cb = token.source.substring(1) || " ";
            comment ? comment += commentSep + cb : comment = cb, commentSep = "", atNewline = !1;
            break;
          }
          case "newline":
            atNewline ? comment ? comment += token.source : (!found || indicator !== "seq-item-ind") && (spaceBefore = !0) : commentSep += token.source, atNewline = !0, hasNewline = !0, (anchor || tag) && (newlineAfterProp = token), hasSpace = !0;
            break;
          case "anchor":
            anchor && onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor"), token.source.endsWith(":") && onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", !0), anchor = token, start ?? (start = token.offset), atNewline = !1, hasSpace = !1, reqSpace = !0;
            break;
          case "tag": {
            tag && onError(token, "MULTIPLE_TAGS", "A node can have at most one tag"), tag = token, start ?? (start = token.offset), atNewline = !1, hasSpace = !1, reqSpace = !0;
            break;
          }
          case indicator:
            (anchor || tag) && onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`), found && onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`), found = token, atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind", hasSpace = !1;
            break;
          case "comma":
            if (flow) {
              comma && onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`), comma = token, atNewline = !1, hasSpace = !1;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`), atNewline = !1, hasSpace = !1;
        }
      let last = tokens[tokens.length - 1], end = last ? last.offset + last.source.length : offset;
      return reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "") && onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space"), tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq") && onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation"), {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes(`
`))
            return !0;
          if (key.end) {
            for (let st of key.end)
              if (st.type === "newline")
                return !0;
          }
          return !1;
        case "flow-collection":
          for (let it of key.items) {
            for (let st of it.start)
              if (st.type === "newline")
                return !0;
            if (it.sep) {
              for (let st of it.sep)
                if (st.type === "newline")
                  return !0;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return !0;
          }
          return !1;
        default:
          return !0;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        let end = fc.end[0];
        end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc) && onError(end, "BAD_INDENT", "Flow end indicator should be more indented than parent", !0);
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      let { uniqueKeys } = ctx.options;
      if (uniqueKeys === !1)
        return !1;
      let isEqual = typeof uniqueKeys == "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    "use strict";
    var Pair = require_Pair(), YAMLMap = require_YAMLMap(), resolveProps = require_resolve_props(), utilContainsNewline = require_util_contains_newline(), utilFlowIndentCheck = require_util_flow_indent_check(), utilMapIncludes = require_util_map_includes(), startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      let NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap, map = new NodeClass(ctx.schema);
      ctx.atRoot && (ctx.atRoot = !1);
      let offset = bm.offset, commentEnd = null;
      for (let collItem of bm.items) {
        let { start, key, sep, value } = collItem, keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: !0
        }), implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key && (key.type === "block-seq" ? onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key") : "indent" in key && key.indent !== bm.indent && onError(offset, "BAD_INDENT", startColMsg)), !keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end, keyProps.comment && (map.comment ? map.comment += `
` + keyProps.comment : map.comment = keyProps.comment);
            continue;
          }
          (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) && onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
        } else keyProps.found?.indent !== bm.indent && onError(offset, "BAD_INDENT", startColMsg);
        ctx.atKey = !0;
        let keyStart = keyProps.end, keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        ctx.schema.compat && utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError), ctx.atKey = !1, utilMapIncludes.mapIncludes(ctx, map.items, keyNode) && onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        let valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        if (offset = valueProps.end, valueProps.found) {
          implicitKey && (value?.type === "block-map" && !valueProps.hasNewline && onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings"), ctx.options.strict && keyProps.start < valueProps.found.offset - 1024 && onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key"));
          let valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          ctx.schema.compat && utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError), offset = valueNode.range[2];
          let pair = new Pair.Pair(keyNode, valueNode);
          ctx.options.keepSourceTokens && (pair.srcToken = collItem), map.items.push(pair);
        } else {
          implicitKey && onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values"), valueProps.comment && (keyNode.comment ? keyNode.comment += `
` + valueProps.comment : keyNode.comment = valueProps.comment);
          let pair = new Pair.Pair(keyNode);
          ctx.options.keepSourceTokens && (pair.srcToken = collItem), map.items.push(pair);
        }
      }
      return commentEnd && commentEnd < offset && onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content"), map.range = [bm.offset, offset, commentEnd ?? offset], map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    "use strict";
    var YAMLSeq = require_YAMLSeq(), resolveProps = require_resolve_props(), utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      let NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq, seq = new NodeClass(ctx.schema);
      ctx.atRoot && (ctx.atRoot = !1), ctx.atKey && (ctx.atKey = !1);
      let offset = bs.offset, commentEnd = null;
      for (let { start, value } of bs.items) {
        let props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: !0
        });
        if (!props.found)
          if (props.anchor || props.tag || value)
            value?.type === "block-seq" ? onError(props.end, "BAD_INDENT", "All sequence items must start at the same column") : onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          else {
            commentEnd = props.end, props.comment && (seq.comment = props.comment);
            continue;
          }
        let node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        ctx.schema.compat && utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError), offset = node.range[2], seq.items.push(node);
      }
      return seq.range = [bs.offset, offset, commentEnd ?? offset], seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = !1, sep = "";
        for (let token of end) {
          let { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = !0;
              break;
            case "comment": {
              reqSpace && !hasSpace && onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              let cb = source.substring(1) || " ";
              comment ? comment += sep + cb : comment = cb, sep = "";
              break;
            }
            case "newline":
              comment && (sep += source), hasSpace = !0;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    "use strict";
    var identity = require_identity(), Pair = require_Pair(), YAMLMap = require_YAMLMap(), YAMLSeq = require_YAMLSeq(), resolveEnd = require_resolve_end(), resolveProps = require_resolve_props(), utilContainsNewline = require_util_contains_newline(), utilMapIncludes = require_util_map_includes(), blockMsg = "Block collections are not allowed within flow collections", isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      let isMap = fc.start.source === "{", fcName = isMap ? "flow map" : "flow sequence", NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq), coll = new NodeClass(ctx.schema);
      coll.flow = !0;
      let atRoot = ctx.atRoot;
      atRoot && (ctx.atRoot = !1), ctx.atKey && (ctx.atKey = !1);
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        let collItem = fc.items[i], { start, key, sep, value } = collItem, props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: !1
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            i === 0 && props.comma ? onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`) : i < fc.items.length - 1 && onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`), props.comment && (coll.comment ? coll.comment += `
` + props.comment : coll.comment = props.comment), offset = props.end;
            continue;
          }
          !isMap && ctx.options.strict && utilContainsNewline.containsNewline(key) && onError(
            key,
            // checked by containsNewline()
            "MULTILINE_IMPLICIT_KEY",
            "Implicit keys of flow sequence pairs need to be on a single line"
          );
        }
        if (i === 0)
          props.comma && onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        else if (props.comma || onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`), props.comment) {
          let prevItemComment = "";
          loop: for (let st of start)
            switch (st.type) {
              case "comma":
              case "space":
                break;
              case "comment":
                prevItemComment = st.source.substring(1);
                break loop;
              default:
                break loop;
            }
          if (prevItemComment) {
            let prev = coll.items[coll.items.length - 1];
            identity.isPair(prev) && (prev = prev.value ?? prev.key), prev.comment ? prev.comment += `
` + prevItemComment : prev.comment = prevItemComment, props.comment = props.comment.substring(prevItemComment.length + 1);
          }
        }
        if (!isMap && !sep && !props.found) {
          let valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode), offset = valueNode.range[2], isBlock(value) && onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = !0;
          let keyStart = props.end, keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          isBlock(key) && onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg), ctx.atKey = !1;
          let valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: !1
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep)
                for (let st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              props.start < valueProps.found.offset - 1024 && onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else value && ("source" in value && value.source?.[0] === ":" ? onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`) : onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`));
          let valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          valueNode ? isBlock(value) && onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg) : valueProps.comment && (keyNode.comment ? keyNode.comment += `
` + valueProps.comment : keyNode.comment = valueProps.comment);
          let pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens && (pair.srcToken = collItem), isMap) {
            let map = coll;
            utilMapIncludes.mapIncludes(ctx, map.items, keyNode) && onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique"), map.items.push(pair);
          } else {
            let map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = !0, map.items.push(pair);
            let endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]], coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      let expectedEnd = isMap ? "}" : "]", [ce, ...ee] = fc.end, cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        let name = fcName[0].toUpperCase() + fcName.substring(1), msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg), ce && ce.source.length !== 1 && ee.unshift(ce);
      }
      if (ee.length > 0) {
        let end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        end.comment && (coll.comment ? coll.comment += `
` + end.comment : coll.comment = end.comment), coll.range = [fc.offset, cePos, end.offset];
      } else
        coll.range = [fc.offset, cePos, cePos];
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    "use strict";
    var identity = require_identity(), Scalar = require_Scalar(), YAMLMap = require_YAMLMap(), YAMLSeq = require_YAMLSeq(), resolveBlockMap = require_resolve_block_map(), resolveBlockSeq = require_resolve_block_seq(), resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      let coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag), Coll = coll.constructor;
      return tagName === "!" || tagName === Coll.tagName ? (coll.tag = Coll.tagName, coll) : (tagName && (coll.tag = tagName), coll);
    }
    function composeCollection(CN, ctx, token, props, onError) {
      let tagToken = props.tag, tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      if (token.type === "block-seq") {
        let { anchor, newlineAfterProp: nl } = props, lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        lastProp && (!nl || nl.offset < lastProp.offset) && onError(lastProp, "MISSING_CHAR", "Missing newline after block sequence props");
      }
      let expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq")
        return resolveCollection(CN, ctx, token, onError, tagName);
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        let kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType)
          ctx.schema.tags.push(Object.assign({}, kt, { default: !1 })), tag = kt;
        else
          return kt ? onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, !0) : onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, !0), resolveCollection(CN, ctx, token, onError, tagName);
      }
      let coll = resolveCollection(CN, ctx, token, onError, tagName, tag), res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll, node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      return node.range = coll.range, node.tag = tagName, tag?.format && (node.format = tag.format), node;
    }
    exports.composeCollection = composeCollection;
  }
});

// node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      let start = scalar.offset, header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      let type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL, lines = scalar.source ? splitLines(scalar.source) : [], chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        let content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        let value2 = header.chomp === "+" && lines.length > 0 ? `
`.repeat(Math.max(1, lines.length - 1)) : "", end2 = start + header.length;
        return scalar.source && (end2 += scalar.source.length), { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent, offset = scalar.offset + header.length, contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        if (content === "" || content === "\r")
          header.indent === 0 && indent.length > trimIndent && (trimIndent = indent.length);
        else {
          indent.length < trimIndent && onError(offset + indent.length, "MISSING_CHAR", "Block scalars with more-indented leading empty lines must use an explicit indentation indicator"), header.indent === 0 && (trimIndent = indent.length), contentStart = i, trimIndent === 0 && !ctx.atRoot && onError(offset, "BAD_INDENT", "Block scalar values in collections must be indented");
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i)
        lines[i][0].length > trimIndent && (chompStart = i + 1);
      let value = "", sep = "", prevMoreIndented = !1;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + `
`;
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        let crlf = content[content.length - 1] === "\r";
        if (crlf && (content = content.slice(0, -1)), content && indent.length < trimIndent) {
          let message = `Block scalar lines must not be less indented than their ${header.indent ? "explicit indentation indicator" : "first line"}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message), indent = "";
        }
        type === Scalar.Scalar.BLOCK_LITERAL ? (value += sep + indent.slice(trimIndent) + content, sep = `
`) : indent.length > trimIndent || content[0] === "	" ? (sep === " " ? sep = `
` : !prevMoreIndented && sep === `
` && (sep = `

`), value += sep + indent.slice(trimIndent) + content, sep = `
`, prevMoreIndented = !0) : content === "" ? sep === `
` ? value += `
` : sep = `
` : (value += sep + content, sep = " ", prevMoreIndented = !1);
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += `
` + lines[i][0].slice(trimIndent);
          value[value.length - 1] !== `
` && (value += `
`);
          break;
        default:
          value += `
`;
      }
      let end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header")
        return onError(props[0], "IMPOSSIBLE", "Block scalar header not found"), null;
      let { source } = props[0], mode = source[0], indent = 0, chomp = "", error = -1;
      for (let i = 1; i < source.length; ++i) {
        let ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          let n = Number(ch);
          !indent && n ? indent = n : error === -1 && (error = offset + i);
        }
      }
      error !== -1 && onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = !1, comment = "", length = source.length;
      for (let i = 1; i < props.length; ++i) {
        let token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = !0;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            strict && !hasSpace && onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters"), length += token.source.length, comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message), length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            let message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            let ts = token.source;
            ts && typeof ts == "string" && (length += ts.length);
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      let split = source.split(/\n( *)/), first = split[0], m = first.match(/^( *)/), lines = [m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first]];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar(), resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      let { offset, type, source, end } = scalar, _type, value, _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN, value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE, value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE, value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          return onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`), {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      let valueEnd = offset + source.length, re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      return badChar && onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`), foldLines(source);
    }
    function singleQuotedValue(source, onError) {
      return (source[source.length - 1] !== "'" || source.length === 1) && onError(source.length, "MISSING_CHAR", "Missing closing 'quote"), foldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function foldLines(source) {
      let first, line;
      try {
        first = new RegExp(`(.*?)(?<![ 	])[ 	]*\r?
`, "sy"), line = new RegExp(`[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?
`, "sy");
      } catch {
        first = /(.*?)[ \t]*\r?\n/sy, line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
      }
      let match = first.exec(source);
      if (!match)
        return source;
      let res = match[1], sep = " ", pos = first.lastIndex;
      for (line.lastIndex = pos; match = line.exec(source); )
        match[1] === "" ? sep === `
` ? res += sep : sep = `
` : (res += sep + match[1], sep = " "), pos = line.lastIndex;
      let last = /[ \t]*(.*)/sy;
      return last.lastIndex = pos, match = last.exec(source), res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        let ch = source[i];
        if (!(ch === "\r" && source[i + 1] === `
`))
          if (ch === `
`) {
            let { fold, offset } = foldNewline(source, i);
            res += fold, i = offset;
          } else if (ch === "\\") {
            let next = source[++i], cc = escapeCodes[next];
            if (cc)
              res += cc;
            else if (next === `
`)
              for (next = source[i + 1]; next === " " || next === "	"; )
                next = source[++i + 1];
            else if (next === "\r" && source[i + 1] === `
`)
              for (next = source[++i + 1]; next === " " || next === "	"; )
                next = source[++i + 1];
            else if (next === "x" || next === "u" || next === "U") {
              let length = next === "x" ? 2 : next === "u" ? 4 : 8;
              res += parseCharCode(source, i + 1, length, onError), i += length;
            } else {
              let raw = source.substr(i - 1, 2);
              onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`), res += raw;
            }
          } else if (ch === " " || ch === "	") {
            let wsStart = i, next = source[i + 1];
            for (; next === " " || next === "	"; )
              next = source[++i + 1];
            next !== `
` && !(next === "\r" && source[i + 2] === `
`) && (res += i > wsStart ? source.slice(wsStart, i + 1) : ch);
          } else
            res += ch;
      }
      return (source[source.length - 1] !== '"' || source.length === 1) && onError(source.length, "MISSING_CHAR", 'Missing closing "quote'), res;
    }
    function foldNewline(source, offset) {
      let fold = "", ch = source[offset + 1];
      for (; (ch === " " || ch === "	" || ch === `
` || ch === "\r") && !(ch === "\r" && source[offset + 2] !== `
`); )
        ch === `
` && (fold += `
`), offset += 1, ch = source[offset + 1];
      return fold || (fold = " "), { fold, offset };
    }
    var escapeCodes = {
      0: "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: `
`,
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      let cc = source.substr(offset, length), code = cc.length === length && /^[0-9a-fA-F]+$/.test(cc) ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        let raw = source.substr(offset - 2, length + 2);
        return onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`), raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    "use strict";
    var identity = require_identity(), Scalar = require_Scalar(), resolveBlockScalar = require_resolve_block_scalar(), resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      let { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError), tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null, tag;
      ctx.options.stringKeys && ctx.atKey ? tag = ctx.schema[identity.SCALAR] : tagName ? tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError) : token.type === "scalar" ? tag = findScalarTagByTest(ctx, value, token, onError) : tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        let res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        let msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), scalar = new Scalar.Scalar(value);
      }
      return scalar.range = range, scalar.source = value, type && (scalar.type = type), tagName && (scalar.tag = tagName), tag.format && (scalar.format = tag.format), comment && (scalar.comment = comment), scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      let matchWithTest = [];
      for (let tag of schema.tags)
        if (!tag.collection && tag.tag === tagName)
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
      for (let tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      let kt = schema.knownTags[tagName];
      return kt && !kt.collection ? (schema.tags.push(Object.assign({}, kt, { default: !1, test: void 0 })), kt) : (onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str"), schema[identity.SCALAR]);
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      let tag = schema.tags.find((tag2) => (tag2.default === !0 || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        let compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          let ts = directives.tagString(tag.tag), cs = directives.tagString(compat.tag), msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, !0);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          for (st = before[++i]; st?.type === "space"; )
            offset += st.source.length, st = before[++i];
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/yaml/dist/compose/compose-node.js"(exports) {
    "use strict";
    var Alias = require_Alias(), identity = require_identity(), composeCollection = require_compose_collection(), composeScalar = require_compose_scalar(), resolveEnd = require_resolve_end(), utilEmptyScalarPosition = require_util_empty_scalar_position(), CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      let atKey = ctx.atKey, { spaceBefore, comment, anchor, tag } = props, node, isSrcToken = !0;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError), (anchor || tag) && onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError), anchor && (node.anchor = anchor.source.substring(1));
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError), anchor && (node.anchor = anchor.source.substring(1));
          } catch (error) {
            let message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          let message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message), isSrcToken = !1;
        }
      }
      return node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError)), anchor && node.anchor === "" && onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string"), atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value != "string" || node.tag && node.tag !== "tag:yaml.org,2002:str") && onError(tag ?? token, "NON_STRING_KEY", "With stringKeys, all keys must be strings"), spaceBefore && (node.spaceBefore = !0), comment && (token.type === "scalar" && token.source === "" ? node.comment = comment : node.commentBefore = comment), ctx.options.keepSourceTokens && isSrcToken && (node.srcToken = token), node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      let token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      }, node = composeScalar.composeScalar(ctx, token, tag, onError);
      return anchor && (node.anchor = anchor.source.substring(1), node.anchor === "" && onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string")), spaceBefore && (node.spaceBefore = !0), comment && (node.comment = comment, node.range[2] = end), node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      let alias = new Alias.Alias(source.substring(1));
      alias.source === "" && onError(offset, "BAD_ALIAS", "Alias cannot be an empty string"), alias.source.endsWith(":") && onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", !0);
      let valueEnd = offset + source.length, re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      return alias.range = [offset, valueEnd, re.offset], re.comment && (alias.comment = re.comment), alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document2 = require_Document(), composeNode = require_compose_node(), resolveEnd = require_resolve_end(), resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      let opts = Object.assign({ _directives: directives }, options), doc = new Document2.Document(void 0, opts), ctx = {
        atKey: !1,
        atRoot: !0,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      }, props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: !0
      });
      props.found && (doc.directives.docStart = !0, value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline && onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker")), doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      let contentEnd = doc.contents.range[2], re = resolveEnd.resolveEnd(end, contentEnd, !1, onError);
      return re.comment && (doc.comment = re.comment), doc.range = [offset, contentEnd, re.offset], doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process"), directives = require_directives(), Document2 = require_Document(), errors = require_errors(), identity = require_identity(), composeDoc = require_compose_doc(), resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src == "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      let { offset, source } = src;
      return [offset, offset + (typeof source == "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "", atComment = !1, afterEmptyLine = !1;
      for (let i = 0; i < prelude.length; ++i) {
        let source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? `

` : `
`) + (source.substring(1) || " "), atComment = !0, afterEmptyLine = !1;
            break;
          case "%":
            prelude[i + 1]?.[0] !== "#" && (i += 1), atComment = !1;
            break;
          default:
            atComment || (afterEmptyLine = !0), atComment = !1;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null, this.atDirectives = !1, this.prelude = [], this.errors = [], this.warnings = [], this.onError = (source, code, message, warning) => {
          let pos = getErrorPos(source);
          warning ? this.warnings.push(new errors.YAMLWarning(pos, code, message)) : this.errors.push(new errors.YAMLParseError(pos, code, message));
        }, this.directives = new directives.Directives({ version: options.version || "1.2" }), this.options = options;
      }
      decorate(doc, afterDoc) {
        let { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          let dc = doc.contents;
          if (afterDoc)
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          else if (afterEmptyLine || doc.directives.docStart || !dc)
            doc.commentBefore = comment;
          else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            identity.isPair(it) && (it = it.key);
            let cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            let cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else
          doc.errors = this.errors, doc.warnings = this.warnings;
        this.prelude = [], this.errors = [], this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = !1, endOffset = -1) {
        for (let token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        switch (node_process.env.LOG_STREAM && console.dir(token, { depth: null }), token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              let pos = getErrorPos(token);
              pos[0] += offset, this.onError(pos, "BAD_DIRECTIVE", message, warning);
            }), this.prelude.push(token.source), this.atDirectives = !0;
            break;
          case "document": {
            let doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            this.atDirectives && !doc.directives.docStart && this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line"), this.decorate(doc, !1), this.doc && (yield this.doc), this.doc = doc, this.atDirectives = !1;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            let msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message, error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            this.atDirectives || !this.doc ? this.errors.push(error) : this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              let msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = !0;
            let end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            if (this.decorate(this.doc, !0), end.comment) {
              let dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = !1, endOffset = -1) {
        if (this.doc)
          this.decorate(this.doc, !0), yield this.doc, this.doc = null;
        else if (forceDoc) {
          let opts = Object.assign({ _directives: this.directives }, this.options), doc = new Document2.Document(void 0, opts);
          this.atDirectives && this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line"), doc.range = [0, endOffset, endOffset], this.decorate(doc, !1), yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar(), resolveFlowScalar = require_resolve_flow_scalar(), errors = require_errors(), stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = !0, onError) {
      if (token) {
        let _onError = (pos, code, message) => {
          let offset = typeof pos == "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      let { implicitKey = !1, indent, inFlow = !1, offset = -1, type = "PLAIN" } = context, source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: !0, lineWidth: -1 }
      }), end = context.end ?? [
        { type: "newline", offset: -1, indent, source: `
` }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          let he = source.indexOf(`
`), head = source.substring(0, he), body = source.substring(he + 1) + `
`, props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          return addEndtoBlockProps(props, end) || props.push({ type: "newline", offset: -1, indent, source: `
` }), { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = !1, implicitKey = !1, inFlow = !1, type } = context, indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent == "number" && (indent += 2), !type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            let header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      let source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: !0, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      let he = source.indexOf(`
`), head = source.substring(0, he), body = source.substring(he + 1) + `
`;
      if (token.type === "block-scalar") {
        let header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head, token.source = body;
      } else {
        let { offset } = token, indent = "indent" in token ? token.indent : -1, props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        addEndtoBlockProps(props, "end" in token ? token.end : void 0) || props.push({ type: "newline", offset: -1, indent, source: `
` });
        for (let key of Object.keys(token))
          key !== "type" && key !== "offset" && delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (let st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              return props.push(st), !0;
          }
      return !1;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type, token.source = source;
          break;
        case "block-scalar": {
          let end = token.props.slice(1), oa = source.length;
          token.props[0].type === "block-scalar-header" && (oa -= token.props[0].source.length);
          for (let tok of end)
            tok.offset += oa;
          delete token.props, Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          let nl = { type: "newline", offset: token.offset + source.length, indent: token.indent, source: `
` };
          delete token.items, Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          let indent = "indent" in token ? token.indent : -1, end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (let key of Object.keys(token))
            key !== "type" && key !== "offset" && delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (let tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (let item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (let item of token.items)
            res += stringifyItem(item);
          for (let st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (let st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (let st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (let st of start)
        res += st.source;
      if (key && (res += stringifyToken(key)), sep)
        for (let st of sep)
          res += st.source;
      return value && (res += stringifyToken(value)), res;
    }
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = Symbol("break visit"), SKIP = Symbol("skip children"), REMOVE = Symbol("remove item");
    function visit(cst, visitor) {
      "type" in cst && cst.type === "document" && (cst = { start: cst.start, value: cst.value }), _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path14) => {
      let item = cst;
      for (let [field, index] of path14) {
        let tok = item?.[field];
        if (tok && "items" in tok)
          item = tok.items[index];
        else
          return;
      }
      return item;
    };
    visit.parentCollection = (cst, path14) => {
      let parent = visit.itemAtPath(cst, path14.slice(0, -1)), field = path14[path14.length - 1][0], coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path14, item, visitor) {
      let ctrl = visitor(item, path14);
      if (typeof ctrl == "symbol")
        return ctrl;
      for (let field of ["key", "value"]) {
        let token = item[field];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            let ci = _visit(Object.freeze(path14.concat([[field, i]])), token.items[i], visitor);
            if (typeof ci == "number")
              i = ci - 1;
            else {
              if (ci === BREAK)
                return BREAK;
              ci === REMOVE && (token.items.splice(i, 1), i -= 1);
            }
          }
          typeof ctrl == "function" && field === "key" && (ctrl = ctrl(item, path14));
        }
      }
      return typeof ctrl == "function" ? ctrl(item, path14) : ctrl;
    }
    exports.visit = visit;
  }
});

// node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/yaml/dist/parse/cst.js"(exports) {
    "use strict";
    var cstScalar = require_cst_scalar(), cstStringify = require_cst_stringify(), cstVisit = require_cst_visit(), BOM = "\uFEFF", DOCUMENT = "", FLOW_END = "", SCALAR = "", isCollection = (token) => !!token && "items" in token, isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case `
`:
        case `\r
`:
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/yaml/dist/parse/lexer.js"(exports) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case `
`:
        case "\r":
        case "	":
          return !0;
        default:
          return !1;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef"), tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()"), flowIndicatorChars = new Set(",[]{}"), invalidAnchorChars = new Set(` ,[]{}
\r	`), isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch), Lexer = class {
      constructor() {
        this.atEnd = !1, this.blockScalarIndent = -1, this.blockScalarKeep = !1, this.buffer = "", this.flowKey = !1, this.flowLevel = 0, this.indentNext = 0, this.indentValue = 0, this.lineEndPos = null, this.next = null, this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = !1) {
        if (source) {
          if (typeof source != "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source, this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        for (; next && (incomplete || this.hasChars(1)); )
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos, ch = this.buffer[i];
        for (; ch === " " || ch === "	"; )
          ch = this.buffer[++i];
        return !ch || ch === "#" || ch === `
` ? !0 : ch === "\r" ? this.buffer[i + 1] === `
` : !1;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          for (; ch === " "; )
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            let next = this.buffer[indent + offset + 1];
            if (next === `
` || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === `
` || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          let dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        return (typeof end != "number" || end !== -1 && end < this.pos) && (end = this.buffer.indexOf(`
`, this.pos), this.lineEndPos = end), end === -1 ? this.atEnd ? this.buffer.substring(this.pos) : null : (this.buffer[end - 1] === "\r" && (end -= 1), this.buffer.substring(this.pos, end));
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        return this.buffer = this.buffer.substring(this.pos), this.pos = 0, this.lineEndPos = null, this.next = state, null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM && (yield* this.pushCount(1), line = line.substring(1)), line[0] === "%") {
          let dirEnd = line.length, cs = line.indexOf("#");
          for (; cs !== -1; ) {
            let ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else
              cs = line.indexOf("#", cs + 1);
          }
          for (; ; ) {
            let ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          let n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(!0));
          return yield* this.pushCount(line.length - n), this.pushNewline(), "stream";
        }
        if (this.atLineEnd()) {
          let sp = yield* this.pushSpaces(!0);
          return yield* this.pushCount(line.length - sp), yield* this.pushNewline(), "stream";
        }
        return yield cst.DOCUMENT, yield* this.parseLineStart();
      }
      *parseLineStart() {
        let ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          let s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3)))
            return yield* this.pushCount(3), this.indentValue = 0, this.indentNext = 0, s === "---" ? "doc" : "stream";
        }
        return this.indentValue = yield* this.pushSpaces(!1), this.indentNext > this.indentValue && !isEmpty(this.charAt(1)) && (this.indentNext = this.indentValue), yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        let [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          let n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(!0));
          return this.indentNext = this.indentValue + 1, this.indentValue += n, "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(!0);
        let line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            return yield* this.pushNewline(), yield* this.parseLineStart();
          case "{":
          case "[":
            return yield* this.pushCount(1), this.flowKey = !1, this.flowLevel = 1, "flow";
          case "}":
          case "]":
            return yield* this.pushCount(1), "doc";
          case "*":
            return yield* this.pushUntil(isNotAnchorChar), "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            return n += yield* this.parseBlockScalarHeader(), n += yield* this.pushSpaces(!0), yield* this.pushCount(line.length - n), yield* this.pushNewline(), yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp, indent = -1;
        do
          nl = yield* this.pushNewline(), nl > 0 ? (sp = yield* this.pushSpaces(!1), this.indentValue = indent = sp) : sp = 0, sp += yield* this.pushSpaces(!0);
        while (nl + sp > 0);
        let line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if ((indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) && !(indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}")))
          return this.flowLevel = 0, yield cst.FLOW_END, yield* this.parseLineStart();
        let n = 0;
        for (; line[n] === ","; )
          n += yield* this.pushCount(1), n += yield* this.pushSpaces(!0), this.flowKey = !1;
        switch (n += yield* this.pushIndicators(), line[n]) {
          case void 0:
            return "flow";
          case "#":
            return yield* this.pushCount(line.length - n), "flow";
          case "{":
          case "[":
            return yield* this.pushCount(1), this.flowKey = !1, this.flowLevel += 1, "flow";
          case "}":
          case "]":
            return yield* this.pushCount(1), this.flowKey = !0, this.flowLevel -= 1, this.flowLevel ? "flow" : "doc";
          case "*":
            return yield* this.pushUntil(isNotAnchorChar), "flow";
          case '"':
          case "'":
            return this.flowKey = !0, yield* this.parseQuotedScalar();
          case ":": {
            let next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",")
              return this.flowKey = !1, yield* this.pushCount(1), yield* this.pushSpaces(!0), "flow";
          }
          // fallthrough
          default:
            return this.flowKey = !1, yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        let quote = this.charAt(0), end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'")
          for (; end !== -1 && this.buffer[end + 1] === "'"; )
            end = this.buffer.indexOf("'", end + 2);
        else
          for (; end !== -1; ) {
            let n = 0;
            for (; this.buffer[end - 1 - n] === "\\"; )
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        let qb = this.buffer.substring(0, end), nl = qb.indexOf(`
`, this.pos);
        if (nl !== -1) {
          for (; nl !== -1; ) {
            let cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf(`
`, cs);
          }
          nl !== -1 && (end = nl - (qb[nl - 1] === "\r" ? 2 : 1));
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        return yield* this.pushToIndex(end + 1, !1), this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1, this.blockScalarKeep = !1;
        let i = this.pos;
        for (; ; ) {
          let ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = !0;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1, indent = 0, ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2)
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case `
`:
              nl = i2, indent = 0;
              break;
            case "\r": {
              let next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === `
`)
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          this.blockScalarIndent === -1 ? this.indentNext = indent : this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          do {
            let cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf(`
`, cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        for (ch = this.buffer[i]; ch === " "; )
          ch = this.buffer[++i];
        if (ch === "	") {
          for (; ch === "	" || ch === " " || ch === "\r" || ch === `
`; )
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep)
          do {
            let i2 = nl - 1, ch2 = this.buffer[i2];
            ch2 === "\r" && (ch2 = this.buffer[--i2]);
            let lastChar = i2;
            for (; ch2 === " "; )
              ch2 = this.buffer[--i2];
            if (ch2 === `
` && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (!0);
        return yield cst.SCALAR, yield* this.pushToIndex(nl + 1, !0), yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        let inFlow = this.flowLevel > 0, end = this.pos - 1, i = this.pos - 1, ch;
        for (; ch = this.buffer[++i]; )
          if (ch === ":") {
            let next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r" && (next === `
` ? (i += 1, ch = `
`, next = this.buffer[i + 1]) : end = i), next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === `
`) {
              let cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        return !ch && !this.atEnd ? this.setNext("plain-scalar") : (yield cst.SCALAR, yield* this.pushToIndex(end + 1, !0), inFlow ? "flow" : "doc");
      }
      *pushCount(n) {
        return n > 0 ? (yield this.buffer.substr(this.pos, n), this.pos += n, n) : 0;
      }
      *pushToIndex(i, allowEmpty) {
        let s = this.buffer.slice(this.pos, i);
        return s ? (yield s, this.pos += s.length, s.length) : (allowEmpty && (yield ""), 0);
      }
      *pushIndicators() {
        let n = 0;
        loop: for (; ; ) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag(), n += yield* this.pushSpaces(!0);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar), n += yield* this.pushSpaces(!0);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              let inFlow = this.flowLevel > 0, ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                inFlow ? this.flowKey && (this.flowKey = !1) : this.indentNext = this.indentValue + 1, n += yield* this.pushCount(1), n += yield* this.pushSpaces(!0);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2, ch = this.buffer[i];
          for (; !isEmpty(ch) && ch !== ">"; )
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, !1);
        } else {
          let i = this.pos + 1, ch = this.buffer[i];
          for (; ch; )
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2]))
              ch = this.buffer[i += 3];
            else
              break;
          return yield* this.pushToIndex(i, !1);
        }
      }
      *pushNewline() {
        let ch = this.buffer[this.pos];
        return ch === `
` ? yield* this.pushCount(1) : ch === "\r" && this.charAt(1) === `
` ? yield* this.pushCount(2) : 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1, ch;
        do
          ch = this.buffer[++i];
        while (ch === " " || allowTabs && ch === "	");
        let n = i - this.pos;
        return n > 0 && (yield this.buffer.substr(this.pos, n), this.pos = i), n;
      }
      *pushUntil(test) {
        let i = this.pos, ch = this.buffer[i];
        for (; !test(ch); )
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, !1);
      }
    };
    exports.Lexer = Lexer;
  }
});

// node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/yaml/dist/parse/line-counter.js"(exports) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [], this.addNewLine = (offset) => this.lineStarts.push(offset), this.linePos = (offset) => {
          let low = 0, high = this.lineStarts.length;
          for (; low < high; ) {
            let mid = low + high >> 1;
            this.lineStarts[mid] < offset ? low = mid + 1 : high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          let start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter;
  }
});

// node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process"), cst = require_cst(), lexer = require_lexer();
    function includesToken(list, type) {
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return !0;
      return !1;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i)
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return !0;
        default:
          return !1;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          let it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: for (; --i >= 0; )
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      for (; prev[++i]?.type === "space"; )
        ;
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start")
        for (let it of fc.items)
          it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind") && (it.key && (it.value = it.key), delete it.key, isFlowToken(it.value) ? it.value.end ? arrayPushArray(it.value.end, it.sep) : it.value.end = it.sep : arrayPushArray(it.start, it.sep), delete it.sep);
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = !0, this.atScalar = !1, this.indent = 0, this.offset = 0, this.onKeyLine = !1, this.stack = [], this.source = "", this.type = "", this.lexer = new lexer.Lexer(), this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = !1) {
        this.onNewLine && this.offset === 0 && this.onNewLine(0);
        for (let lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        incomplete || (yield* this.end());
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        if (this.source = source, node_process.env.LOG_TOKENS && console.log("|", cst.prettyToken(source)), this.atScalar) {
          this.atScalar = !1, yield* this.step(), this.offset += source.length;
          return;
        }
        let type = cst.tokenType(source);
        if (type)
          if (type === "scalar")
            this.atNewLine = !1, this.atScalar = !0, this.type = "scalar";
          else {
            switch (this.type = type, yield* this.step(), type) {
              case "newline":
                this.atNewLine = !0, this.indent = 0, this.onNewLine && this.onNewLine(this.offset + source.length);
                break;
              case "space":
                this.atNewLine && source[0] === " " && (this.indent += source.length);
                break;
              case "explicit-key-ind":
              case "map-value-ind":
              case "seq-item-ind":
                this.atNewLine && (this.indent += source.length);
                break;
              case "doc-mode":
              case "flow-error-end":
                return;
              default:
                this.atNewLine = !1;
            }
            this.offset += source.length;
          }
        else {
          let message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source }), this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        for (; this.stack.length > 0; )
          yield* this.pop();
      }
      get sourceToken() {
        return {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      *step() {
        let top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          for (; this.stack.length > 0; )
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        let token = error ?? this.stack.pop();
        if (!token)
          yield { type: "error", offset: this.offset, source: "", message: "Tried to pop an empty stack" };
        else if (this.stack.length === 0)
          yield token;
        else {
          let top = this.peek(1);
          switch (token.type === "block-scalar" ? token.indent = "indent" in top ? top.indent : 0 : token.type === "flow-collection" && top.type === "document" && (token.indent = 0), token.type === "flow-collection" && fixFlowSeqItems(token), top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              let it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] }), this.onKeyLine = !0;
                return;
              } else if (it.sep)
                it.value = token;
              else {
                Object.assign(it, { key: token, sep: [] }), this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              let it = top.items[top.items.length - 1];
              it.value ? top.items.push({ start: [], value: token }) : it.value = token;
              break;
            }
            case "flow-collection": {
              let it = top.items[top.items.length - 1];
              !it || it.value ? top.items.push({ start: [], key: token, sep: [] }) : it.sep ? it.value = token : Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop(), yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            let last = token.items[token.items.length - 1];
            last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent)) && (top.type === "document" ? top.end = last.start : top.items.push({ start: last.start }), token.items.splice(-1, 1));
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            let doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            this.type === "doc-start" && doc.start.push(this.sourceToken), this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            findNonEmptyIndex(doc.start) !== -1 ? (yield* this.pop(), yield* this.step()) : doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        let bv = this.startBlockValue(doc);
        bv ? this.stack.push(bv) : yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML document`,
          source: this.source
        };
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          let prev = getPrevProps(this.peek(2)), start = getFirstKeyStartProps(prev), sep;
          scalar.end ? (sep = scalar.end, sep.push(this.sourceToken), delete scalar.end) : sep = [this.sourceToken];
          let map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep }]
          };
          this.onKeyLine = !0, this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            if (scalar.source = this.source, this.atNewLine = !0, this.indent = 0, this.onNewLine) {
              let nl = this.source.indexOf(`
`) + 1;
              for (; nl !== 0; )
                this.onNewLine(this.offset + nl), nl = this.source.indexOf(`
`, nl) + 1;
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop(), yield* this.step();
        }
      }
      *blockMap(map) {
        let it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            if (this.onKeyLine = !1, it.value) {
              let end = "end" in it.value ? it.value.end : void 0;
              (Array.isArray(end) ? end[end.length - 1] : void 0)?.type === "comment" ? end?.push(this.sourceToken) : map.items.push({ start: [this.sourceToken] });
            } else it.sep ? it.sep.push(this.sourceToken) : it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              map.items.push({ start: [this.sourceToken] });
            else if (it.sep)
              it.sep.push(this.sourceToken);
            else {
              if (this.atIndentedComment(it.start, map.indent)) {
                let end = map.items[map.items.length - 2]?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start), end.push(this.sourceToken), map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          let atMapIndent = !this.onKeyLine && this.indent === map.indent, atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind", start = [];
          if (atNextItem && it.sep && !it.value) {
            let nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              let st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  st.indent > map.indent && (nl.length = 0);
                  break;
                default:
                  nl.length = 0;
              }
            }
            nl.length >= 2 && (start = it.sep.splice(nl[1]));
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              atNextItem || it.value ? (start.push(this.sourceToken), map.items.push({ start }), this.onKeyLine = !0) : it.sep ? it.sep.push(this.sourceToken) : it.start.push(this.sourceToken);
              return;
            case "explicit-key-ind":
              !it.sep && !it.explicitKey ? (it.start.push(this.sourceToken), it.explicitKey = !0) : atNextItem || it.value ? (start.push(this.sourceToken), map.items.push({ start, explicitKey: !0 })) : this.stack.push({
                type: "block-map",
                offset: this.offset,
                indent: this.indent,
                items: [{ start: [this.sourceToken], explicitKey: !0 }]
              }), this.onKeyLine = !0;
              return;
            case "map-value-ind":
              if (it.explicitKey)
                if (it.sep)
                  if (it.value)
                    map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                  else if (includesToken(it.sep, "map-value-ind"))
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start, key: null, sep: [this.sourceToken] }]
                    });
                  else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                    let start2 = getFirstKeyStartProps(it.start), key = it.key, sep = it.sep;
                    sep.push(this.sourceToken), delete it.key, delete it.sep, this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key, sep }]
                    });
                  } else start.length > 0 ? it.sep = it.sep.concat(start, this.sourceToken) : it.sep.push(this.sourceToken);
                else if (includesToken(it.start, "newline"))
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                else {
                  let start2 = getFirstKeyStartProps(it.start);
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                  });
                }
              else
                it.sep ? it.value || atNextItem ? map.items.push({ start, key: null, sep: [this.sourceToken] }) : includesToken(it.sep, "map-value-ind") ? this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [], key: null, sep: [this.sourceToken] }]
                }) : it.sep.push(this.sourceToken) : Object.assign(it, { key: null, sep: [this.sourceToken] });
              this.onKeyLine = !0;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              let fs13 = this.flowScalar(this.type);
              atNextItem || it.value ? (map.items.push({ start, key: fs13, sep: [] }), this.onKeyLine = !0) : it.sep ? this.stack.push(fs13) : (Object.assign(it, { key: fs13, sep: [] }), this.onKeyLine = !0);
              return;
            }
            default: {
              let bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else atMapIndent && map.items.push({ start });
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop(), yield* this.step();
      }
      *blockSequence(seq) {
        let it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              let end = "end" in it.value ? it.value.end : void 0;
              (Array.isArray(end) ? end[end.length - 1] : void 0)?.type === "comment" ? end?.push(this.sourceToken) : seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                let end = seq.items[seq.items.length - 2]?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start), end.push(this.sourceToken), seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            it.value || includesToken(it.start, "seq-item-ind") ? seq.items.push({ start: [this.sourceToken] }) : it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          let bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop(), yield* this.step();
      }
      *flowCollection(fc) {
        let it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do
            yield* this.pop(), top = this.peek(1);
          while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              !it || it.sep ? fc.items.push({ start: [this.sourceToken] }) : it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              !it || it.value ? fc.items.push({ start: [], key: null, sep: [this.sourceToken] }) : it.sep ? it.sep.push(this.sourceToken) : Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              !it || it.value ? fc.items.push({ start: [this.sourceToken] }) : it.sep ? it.sep.push(this.sourceToken) : it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              let fs13 = this.flowScalar(this.type);
              !it || it.value ? fc.items.push({ start: [], key: fs13, sep: [] }) : it.sep ? this.stack.push(fs13) : Object.assign(it, { key: fs13, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          let bv = this.startBlockValue(fc);
          bv ? this.stack.push(bv) : (yield* this.pop(), yield* this.step());
        } else {
          let parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep))
            yield* this.pop(), yield* this.step();
          else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            let prev = getPrevProps(parent), start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            let sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            let map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = !0, this.stack[this.stack.length - 1] = map;
          } else
            yield* this.lineEnd(fc);
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf(`
`) + 1;
          for (; nl !== 0; )
            this.onNewLine(this.offset + nl), nl = this.source.indexOf(`
`, nl) + 1;
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = !0;
            let prev = getPrevProps(parent), start = getFirstKeyStartProps(prev);
            return start.push(this.sourceToken), {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: !0 }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = !0;
            let prev = getPrevProps(parent), start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        return this.type !== "comment" || this.indent <= indent ? !1 : start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        this.type !== "doc-mode" && (docEnd.end ? docEnd.end.push(this.sourceToken) : docEnd.end = [this.sourceToken], this.type === "newline" && (yield* this.pop()));
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop(), yield* this.step();
            break;
          case "newline":
            this.onKeyLine = !1;
          // fallthrough
          case "space":
          case "comment":
          default:
            token.end ? token.end.push(this.sourceToken) : token.end = [this.sourceToken], this.type === "newline" && (yield* this.pop());
        }
      }
    };
    exports.Parser = Parser;
  }
});

// node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer(), Document2 = require_Document(), errors = require_errors(), log = require_log(), identity = require_identity(), lineCounter = require_line_counter(), parser = require_parser();
    function parseOptions(options) {
      let prettyErrors = options.prettyErrors !== !1;
      return { lineCounter: options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      let { lineCounter: lineCounter2, prettyErrors } = parseOptions(options), parser$1 = new parser.Parser(lineCounter2?.addNewLine), composer$1 = new composer.Composer(options), docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (let doc of docs)
          doc.errors.forEach(errors.prettifyError(source, lineCounter2)), doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      return docs.length > 0 ? docs : Object.assign([], { empty: !0 }, composer$1.streamInfo());
    }
    function parseDocument2(source, options = {}) {
      let { lineCounter: lineCounter2, prettyErrors } = parseOptions(options), parser$1 = new parser.Parser(lineCounter2?.addNewLine), composer$1 = new composer.Composer(options), doc = null;
      for (let _doc of composer$1.compose(parser$1.parse(source), !0, source.length))
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      return prettyErrors && lineCounter2 && (doc.errors.forEach(errors.prettifyError(source, lineCounter2)), doc.warnings.forEach(errors.prettifyError(source, lineCounter2))), doc;
    }
    function parse(src, reviver, options) {
      let _reviver;
      typeof reviver == "function" ? _reviver = reviver : options === void 0 && reviver && typeof reviver == "object" && (options = reviver);
      let doc = parseDocument2(src, options);
      if (!doc)
        return null;
      if (doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning)), doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer == "function" || Array.isArray(replacer) ? _replacer = replacer : options === void 0 && replacer && (options = replacer), typeof options == "string" && (options = options.length), typeof options == "number") {
        let indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        let { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return;
      }
      return identity.isDocument(value) && !_replacer ? value.toString(options) : new Document2.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument2;
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer(), Document2 = require_Document(), Schema = require_Schema(), errors = require_errors(), Alias = require_Alias(), identity = require_identity(), Pair = require_Pair(), Scalar = require_Scalar(), YAMLMap = require_YAMLMap(), YAMLSeq = require_YAMLSeq(), cst = require_cst(), lexer = require_lexer(), lineCounter = require_line_counter(), parser = require_parser(), publicApi = require_public_api(), visit = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document2.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity.isAlias;
    exports.isCollection = identity.isCollection;
    exports.isDocument = identity.isDocument;
    exports.isMap = identity.isMap;
    exports.isNode = identity.isNode;
    exports.isPair = identity.isPair;
    exports.isScalar = identity.isScalar;
    exports.isSeq = identity.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit.visit;
    exports.visitAsync = visit.visitAsync;
  }
});

// runtime/src/index.mjs
import fs12 from "node:fs";
import path13 from "node:path";

// runtime/src/commands/init.mjs
import path8 from "node:path";

// runtime/src/lib/changeset.mjs
import fs7 from "node:fs";
import path7 from "node:path";

// runtime/src/lib/ids.mjs
import crypto from "node:crypto";
var UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function generateUuidV7(now = Date.now()) {
  let ms = BigInt(now), bytes = new Uint8Array(16);
  bytes[0] = Number(ms >> 40n & 0xffn), bytes[1] = Number(ms >> 32n & 0xffn), bytes[2] = Number(ms >> 24n & 0xffn), bytes[3] = Number(ms >> 16n & 0xffn), bytes[4] = Number(ms >> 8n & 0xffn), bytes[5] = Number(ms & 0xffn);
  let rand = crypto.randomBytes(10);
  bytes[6] = 112 | rand[0] & 15, bytes[7] = rand[1], bytes[8] = 128 | rand[2] & 63, bytes[9] = rand[3], bytes[10] = rand[4], bytes[11] = rand[5], bytes[12] = rand[6], bytes[13] = rand[7], bytes[14] = rand[8], bytes[15] = rand[9];
  let hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
function isUuidV7(value) {
  return typeof value == "string" && UUID_V7_PATTERN.test(value);
}

// runtime/src/lib/canonical.mjs
import crypto2 from "node:crypto";
function canonicalize(value) {
  return Array.isArray(value) ? value.map(canonicalize) : value && typeof value == "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])) : value;
}
function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}
function sha256Hex(bytesOrString) {
  return crypto2.createHash("sha256").update(bytesOrString).digest("hex");
}
function revisionHash(value) {
  return sha256Hex(canonicalJson(value));
}
function contentHash(bytesOrString) {
  return sha256Hex(bytesOrString);
}
var ABSENT = "ABSENT";

// runtime/src/lib/paths.mjs
import fs from "node:fs";
import path from "node:path";
var PathConfinementError = class extends Error {
  constructor(message) {
    super(message), this.name = "PathConfinementError";
  }
};
function isWithin(target, root) {
  let relative = path.relative(root, target);
  return relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative);
}
function lexicalTarget(root, relativePath) {
  if (typeof relativePath != "string" || relativePath.length === 0)
    throw new PathConfinementError("path must be a non-empty relative string");
  if (path.isAbsolute(relativePath))
    throw new PathConfinementError(`absolute path rejected: ${relativePath}`);
  let target = path.resolve(root, relativePath);
  if (!isWithin(target, root))
    throw new PathConfinementError(`path escapes root: ${relativePath}`);
  return target;
}
function confineUnder(root, relativePath) {
  let normalizedTarget = lexicalTarget(root, relativePath), segments = relativePath.split(/[\\/]+/).filter(Boolean), currentPath = root, currentReal = fs.realpathSync.native(root), resolvedCount = 0;
  for (let segment of segments) {
    currentPath = path.join(currentPath, segment);
    let stat;
    try {
      stat = fs.lstatSync(currentPath);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      let real = fs.realpathSync.native(currentPath);
      if (!isWithin(real, currentReal))
        throw new PathConfinementError(`symlink escapes root: ${currentPath}`);
      currentReal = real;
    } else
      currentReal = fs.realpathSync.native(currentPath);
    resolvedCount += 1;
  }
  let remainingSegments = segments.slice(resolvedCount);
  return remainingSegments.length > 0 ? path.join(currentReal, ...remainingSegments) : currentReal;
}
function confineWritePath(root, relativePath) {
  let normalizedTarget = lexicalTarget(root, relativePath), rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new PathConfinementError(`${root} must be a real directory`);
  let segments = relativePath.split(/[\\/]+/).filter(Boolean), current = root;
  for (let [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
    if (stat.isSymbolicLink())
      throw new PathConfinementError(`symlink component rejected for mutation path: ${current}`);
    if (index < segments.length - 1 && !stat.isDirectory())
      throw new PathConfinementError(`non-directory path component rejected: ${current}`);
  }
  return normalizedTarget;
}
function ensureDirectoryTree(root, relativeDirectory = "") {
  let rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new PathConfinementError(`${root} must be a real directory`);
  if (!relativeDirectory || relativeDirectory === ".") return root;
  lexicalTarget(root, relativeDirectory);
  let current = root;
  for (let segment of relativeDirectory.split(/[\\/]+/).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      fs.mkdirSync(current);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    let stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new PathConfinementError(`directory component must be a real directory: ${current}`);
  }
  return current;
}
function confineRuntimeWritePath(planningRoot, relativePath) {
  return confineWritePath(planningRoot, relativePath);
}
function confineScopePath(workspaceRoot, relativePath) {
  let resolved = confineUnder(workspaceRoot, relativePath), planningRoot = path.resolve(workspaceRoot, ".planning");
  if (isWithin(resolved, planningRoot))
    throw new PathConfinementError("scope path must not point inside .planning/");
  return resolved;
}
function assertTrustedRoot(parentDir, name) {
  let candidate = path.join(parentDir, name), stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink())
    throw new PathConfinementError(`${candidate} must not be a symlink`);
  if (!stat.isDirectory())
    throw new PathConfinementError(`${candidate} must be a directory`);
  let real = fs.realpathSync.native(candidate), realParent = fs.realpathSync.native(parentDir);
  if (!isWithin(real, realParent))
    throw new PathConfinementError(`${candidate} resolves outside ${parentDir}`);
}
function assertTrustedRoots(planningRoot) {
  let workspaceRoot = path.dirname(planningRoot);
  assertTrustedRoot(workspaceRoot, path.basename(planningRoot));
  try {
    fs.lstatSync(planningRoot);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (let name of ["operations", "events", ".runtime", "scopes", "sources"])
    assertTrustedRoot(planningRoot, name);
  let runtimeRoot = path.join(planningRoot, ".runtime");
  try {
    fs.lstatSync(runtimeRoot);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  assertTrustedRoot(runtimeRoot, "operations");
}

// runtime/src/lib/safeFs.mjs
import crypto3 from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";
function parentRelative(relativePath) {
  let parent = path2.dirname(relativePath);
  return parent === "." ? "" : parent;
}
function removeTemporary(tempPath) {
  try {
    fs2.rmSync(tempPath, { force: !0 });
  } catch {
  }
}
function writeFileAtomic(root, relativePath, contents) {
  ensureDirectoryTree(root, parentRelative(relativePath));
  let targetPath = confineWritePath(root, relativePath), tempRelativePath = `${relativePath}.tmp-${process.pid}-${crypto3.randomUUID()}`, tempPath = confineWritePath(root, tempRelativePath);
  try {
    fs2.writeFileSync(tempPath, contents, { flag: "wx" }), confineWritePath(root, relativePath), fs2.renameSync(tempPath, targetPath);
  } finally {
    removeTemporary(tempPath);
  }
}
function createFileAtomic(root, relativePath, contents) {
  ensureDirectoryTree(root, parentRelative(relativePath));
  let targetPath = confineWritePath(root, relativePath), tempRelativePath = `${relativePath}.tmp-${process.pid}-${crypto3.randomUUID()}`, tempPath = confineWritePath(root, tempRelativePath);
  try {
    fs2.writeFileSync(tempPath, contents, { flag: "wx" }), fs2.linkSync(tempPath, targetPath);
  } finally {
    removeTemporary(tempPath);
  }
}
function renameWithinRoot(root, fromRelativePath, toRelativePath) {
  ensureDirectoryTree(root, parentRelative(toRelativePath));
  let fromPath = confineWritePath(root, fromRelativePath), toPath = confineWritePath(root, toRelativePath);
  fs2.renameSync(fromPath, toPath);
}
function copyFileAtomic(root, sourceRelativePath, targetRelativePath) {
  let sourcePath = confineWritePath(root, sourceRelativePath), contents = fs2.readFileSync(sourcePath);
  writeFileAtomic(root, targetRelativePath, contents);
}
function assertDistinctMutationTargets(root, relativePaths) {
  let seen = /* @__PURE__ */ new Set();
  for (let relativePath of relativePaths) {
    let normalized = path2.normalize(confineWritePath(root, relativePath));
    if (seen.has(normalized))
      throw new PathConfinementError(`duplicate or aliased mutation target: ${relativePath}`);
    seen.add(normalized);
  }
}

// runtime/src/lib/yaml.mjs
var import_yaml = __toESM(require_dist(), 1);
function parseYaml(text) {
  let doc = (0, import_yaml.parseDocument)(text, { uniqueKeys: !0, strict: !0 });
  if (doc.errors.length > 0)
    throw new Error(doc.errors.map((error) => error.message).join("; "));
  return doc.toJS({ maxAliasCount: 0 });
}
function stringifyYaml(value) {
  return new import_yaml.Document(canonicalize(value), { sortMapEntries: !0 }).toString();
}

// runtime/src/lib/lock.mjs
import fs3 from "node:fs";
import os from "node:os";
import path3 from "node:path";
import crypto4 from "node:crypto";
var LockHeldError = class extends Error {
  constructor(message) {
    super(message), this.name = "LockHeldError";
  }
};
function isProcessAlive(pid) {
  try {
    return process.kill(pid, 0), !0;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
function readMetadata(metadataPath) {
  try {
    return JSON.parse(fs3.readFileSync(metadataPath, "utf8"));
  } catch {
    return null;
  }
}
function writeMetadataExclusive(metadataPath, content) {
  fs3.writeFileSync(metadataPath, content, { flag: "wx" });
}
function acquireWorkspaceLock(planningRoot, operationId = null) {
  let runtimeDir = path3.join(planningRoot, ".runtime"), lockDir = path3.join(runtimeDir, "workspace.lock"), metadataPath = path3.join(lockDir, "lock.json");
  try {
    fs3.mkdirSync(planningRoot);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  let planningStat = fs3.lstatSync(planningRoot);
  if (planningStat.isSymbolicLink() || !planningStat.isDirectory())
    throw new PathConfinementError(`${planningRoot} must be a real directory`);
  ensureDirectoryTree(planningRoot, ".runtime");
  try {
    fs3.mkdirSync(lockDir);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let metadata = readMetadata(metadataPath);
    throw metadata ? metadata.hostname !== os.hostname() ? new LockHeldError(`workspace lock held by host ${metadata.hostname}`) : isProcessAlive(metadata.pid) ? new LockHeldError(`workspace lock held by running process ${metadata.pid}`) : new LockHeldError(
      `workspace lock belongs to dead process ${metadata.pid} on this host; inspect ${metadataPath} and remove ${lockDir} manually only after confirming no writer is active`
    ) : new LockHeldError(
      "workspace lock exists without readable metadata; automatic removal is unsafe and manual resolution is required"
    );
  }
  let token = crypto4.randomUUID();
  try {
    writeMetadataExclusive(metadataPath, JSON.stringify({
      token,
      pid: process.pid,
      hostname: os.hostname(),
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      operationId
    }, null, 2));
  } catch (error) {
    throw new LockHeldError(`workspace lock metadata could not be committed safely: ${error.message}`);
  }
  return {
    token,
    release() {
      let currentMetadata = readMetadata(metadataPath);
      !currentMetadata || currentMetadata.token !== token || fs3.rmSync(lockDir, { recursive: !0, force: !0 });
    }
  };
}

// runtime/src/lib/recovery.mjs
import fs6 from "node:fs";
import path6 from "node:path";

// runtime/src/lib/operationStore.mjs
import fs4 from "node:fs";
import path4 from "node:path";

// runtime/src/lib/errors.mjs
var UsageError = class extends Error {
  constructor(message) {
    super(message), this.name = "UsageError";
  }
}, StateError = class extends Error {
  constructor(message) {
    super(message), this.name = "StateError";
  }
}, StaleError = class extends Error {
  constructor(message) {
    super(message), this.name = "StaleError";
  }
};

// runtime/src/lib/operationStore.mjs
function ensureOperationsRoot(operationsRoot) {
  let parent = path4.dirname(operationsRoot);
  ensureDirectoryTree(parent, path4.basename(operationsRoot));
}
function operationDir(operationsRoot, id, { create = !1 } = {}) {
  if (!isUuidV7(id)) throw new UsageError(`invalid operation id: ${id}`);
  if (create && ensureOperationsRoot(operationsRoot), !fs4.existsSync(operationsRoot)) {
    let error = new Error(`operations root does not exist: ${operationsRoot}`);
    throw error.code = "ENOENT", error;
  }
  let relative = id;
  return create && ensureDirectoryTree(operationsRoot, relative), confineWritePath(operationsRoot, relative);
}
function relativeFile(id, name) {
  return path4.join(id, name);
}
function writeOperation(operationsRoot, id, operation) {
  operationDir(operationsRoot, id, { create: !0 }), writeFileAtomic(operationsRoot, relativeFile(id, "operation.yml"), stringifyYaml(operation));
}
function readOperation(operationsRoot, id) {
  operationDir(operationsRoot, id);
  let filePath = confineWritePath(operationsRoot, relativeFile(id, "operation.yml"));
  return parseYaml(fs4.readFileSync(filePath, "utf8"));
}
function writeChangeSet(operationsRoot, id, changeSet) {
  operationDir(operationsRoot, id, { create: !0 }), writeFileAtomic(operationsRoot, relativeFile(id, "change-set.json"), `${JSON.stringify(changeSet, null, 2)}
`);
}
function readChangeSet(operationsRoot, id) {
  operationDir(operationsRoot, id);
  let filePath = confineWritePath(operationsRoot, relativeFile(id, "change-set.json"));
  return JSON.parse(fs4.readFileSync(filePath, "utf8"));
}
function writeResult(operationsRoot, id, result) {
  operationDir(operationsRoot, id, { create: !0 }), writeFileAtomic(operationsRoot, relativeFile(id, "result.json"), `${JSON.stringify(result, null, 2)}
`);
}
function readResult(operationsRoot, id) {
  operationDir(operationsRoot, id);
  let filePath = confineWritePath(operationsRoot, relativeFile(id, "result.json"));
  return JSON.parse(fs4.readFileSync(filePath, "utf8"));
}

// runtime/src/lib/journal.mjs
import fs5 from "node:fs";
import path5 from "node:path";

// runtime/src/generated/validators.mjs
var validators_exports = {};
__export(validators_exports, {
  validate_change_set: () => validate_change_set,
  validate_config: () => validate_config,
  validate_event: () => validate_event,
  validate_operation: () => validate_operation,
  validate_plugin_lock: () => validate_plugin_lock,
  validate_result: () => validate_result,
  validate_scope: () => validate_scope,
  validate_source: () => validate_source
});
function __ucs2length(str) {
  let len = str.length, length = 0, pos = 0, value;
  for (; pos < len; )
    length++, value = str.charCodeAt(pos++), value >= 55296 && value <= 56319 && pos < len && (value = str.charCodeAt(pos), (value & 64512) === 56320 && pos++);
  return length;
}
function __deepEqual(a, b) {
  if (a === b) return !0;
  if (a && b && typeof a == "object" && typeof b == "object") {
    if (a.constructor !== b.constructor) return !1;
    let length, i, keys;
    if (Array.isArray(a)) {
      if (length = a.length, length != b.length) return !1;
      for (i = length; i-- !== 0; ) if (!__deepEqual(a[i], b[i])) return !1;
      return !0;
    }
    if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
    if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
    if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
    if (keys = Object.keys(a), length = keys.length, length !== Object.keys(b).length) return !1;
    for (i = length; i-- !== 0; ) if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return !1;
    for (i = length; i-- !== 0; ) {
      let key = keys[i];
      if (!__deepEqual(a[key], b[key])) return !1;
    }
    return !0;
  }
  return a !== a && b !== b;
}
var validate_change_set = validate10, schema11 = { $id: "https://shipping-mode.dev/schemas/change-set.schema.json", type: "object", additionalProperties: !1, required: ["schemaVersion", "operationId", "kind", "target", "baseRevisions", "payload", "hash"], properties: { schemaVersion: { const: 1 }, operationId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, kind: { enum: ["workspace.init", "config.update", "scope.add"] }, target: { type: "object" }, baseRevisions: { type: "object", additionalProperties: { type: "object", additionalProperties: !1, required: ["revisionHash", "contentHash"], properties: { revisionHash: { type: "string", pattern: "^([0-9a-f]{64}|ABSENT)$" }, contentHash: { type: "string", pattern: "^([0-9a-f]{64}|ABSENT)$" } } } }, payload: { type: "object" }, hash: { type: "string", pattern: "^[0-9a-f]{64}$" } }, allOf: [{ if: { properties: { kind: { const: "workspace.init" } } }, then: { properties: { payload: { type: "object", additionalProperties: !1, required: ["name", "vcs", "pluginVersion", "templatePackFingerprint"], properties: { name: { type: "string", minLength: 1 }, baseBranch: { type: ["string", "null"] }, vcs: { enum: ["git", "none"] }, pluginVersion: { type: "string", minLength: 1 }, templatePackFingerprint: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" } } } } } }, { if: { properties: { kind: { const: "config.update" } } }, then: { properties: { payload: { type: "object", additionalProperties: !1, required: ["name"], properties: { name: { type: "string", minLength: 1 } } } } } }, { if: { properties: { kind: { const: "scope.add" } } }, then: { properties: { payload: { type: "object", additionalProperties: !1, required: ["id", "key", "label", "kind", "path"], properties: { id: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, key: { type: "string", minLength: 1 }, label: { type: "string", minLength: 1 }, kind: { enum: ["code", "non_code"] }, path: { type: "string", minLength: 1 }, owner: { type: ["string", "null"] } } } } } }] }, func2 = __ucs2length, pattern0 = new RegExp("^sha256:[0-9a-f]{64}$", "u"), pattern1 = new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", "u"), pattern3 = new RegExp("^([0-9a-f]{64}|ABSENT)$", "u"), pattern5 = new RegExp("^[0-9a-f]{64}$", "u");
function validate10(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null, errors = 0, _errs2 = errors, valid1 = !0, _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data) && data.kind !== void 0 && data.kind !== "workspace.init") {
    let err0 = {};
    vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
  }
  var _valid0 = _errs3 === errors;
  if (errors = _errs2, vErrors !== null && (_errs2 ? vErrors.length = _errs2 : vErrors = null), _valid0) {
    let _errs5 = errors;
    if (data && typeof data == "object" && !Array.isArray(data) && data.payload !== void 0) {
      let data1 = data.payload;
      if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
        if (data1.name === void 0) {
          let err1 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/0/then/properties/payload/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
          vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
        }
        if (data1.vcs === void 0) {
          let err2 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/0/then/properties/payload/required", keyword: "required", params: { missingProperty: "vcs" }, message: "must have required property 'vcs'" };
          vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
        }
        if (data1.pluginVersion === void 0) {
          let err3 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/0/then/properties/payload/required", keyword: "required", params: { missingProperty: "pluginVersion" }, message: "must have required property 'pluginVersion'" };
          vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
        }
        if (data1.templatePackFingerprint === void 0) {
          let err4 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/0/then/properties/payload/required", keyword: "required", params: { missingProperty: "templatePackFingerprint" }, message: "must have required property 'templatePackFingerprint'" };
          vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
        }
        for (let key0 in data1)
          if (!(key0 === "name" || key0 === "baseBranch" || key0 === "vcs" || key0 === "pluginVersion" || key0 === "templatePackFingerprint")) {
            let err5 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/0/then/properties/payload/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
          }
        if (data1.name !== void 0) {
          let data2 = data1.name;
          if (typeof data2 == "string") {
            if (func2(data2) < 1) {
              let err6 = { instancePath: instancePath + "/payload/name", schemaPath: "#/allOf/0/then/properties/payload/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
            }
          } else {
            let err7 = { instancePath: instancePath + "/payload/name", schemaPath: "#/allOf/0/then/properties/payload/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
          }
        }
        if (data1.baseBranch !== void 0) {
          let data3 = data1.baseBranch;
          if (typeof data3 != "string" && data3 !== null) {
            let err8 = { instancePath: instancePath + "/payload/baseBranch", schemaPath: "#/allOf/0/then/properties/payload/properties/baseBranch/type", keyword: "type", params: { type: schema11.allOf[0].then.properties.payload.properties.baseBranch.type }, message: "must be string,null" };
            vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
          }
        }
        if (data1.vcs !== void 0) {
          let data4 = data1.vcs;
          if (!(data4 === "git" || data4 === "none")) {
            let err9 = { instancePath: instancePath + "/payload/vcs", schemaPath: "#/allOf/0/then/properties/payload/properties/vcs/enum", keyword: "enum", params: { allowedValues: schema11.allOf[0].then.properties.payload.properties.vcs.enum }, message: "must be equal to one of the allowed values" };
            vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
          }
        }
        if (data1.pluginVersion !== void 0) {
          let data5 = data1.pluginVersion;
          if (typeof data5 == "string") {
            if (func2(data5) < 1) {
              let err10 = { instancePath: instancePath + "/payload/pluginVersion", schemaPath: "#/allOf/0/then/properties/payload/properties/pluginVersion/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
            }
          } else {
            let err11 = { instancePath: instancePath + "/payload/pluginVersion", schemaPath: "#/allOf/0/then/properties/payload/properties/pluginVersion/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
          }
        }
        if (data1.templatePackFingerprint !== void 0) {
          let data6 = data1.templatePackFingerprint;
          if (typeof data6 == "string") {
            if (!pattern0.test(data6)) {
              let err12 = { instancePath: instancePath + "/payload/templatePackFingerprint", schemaPath: "#/allOf/0/then/properties/payload/properties/templatePackFingerprint/pattern", keyword: "pattern", params: { pattern: "^sha256:[0-9a-f]{64}$" }, message: 'must match pattern "^sha256:[0-9a-f]{64}$"' };
              vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
            }
          } else {
            let err13 = { instancePath: instancePath + "/payload/templatePackFingerprint", schemaPath: "#/allOf/0/then/properties/payload/properties/templatePackFingerprint/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
          }
        }
      } else {
        let err14 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/0/then/properties/payload/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
  }
  if (!valid1) {
    let err15 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
  }
  let _errs19 = errors, valid5 = !0, _errs20 = errors;
  if (data && typeof data == "object" && !Array.isArray(data) && data.kind !== void 0 && data.kind !== "config.update") {
    let err16 = {};
    vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
  }
  var _valid1 = _errs20 === errors;
  if (errors = _errs19, vErrors !== null && (_errs19 ? vErrors.length = _errs19 : vErrors = null), _valid1) {
    let _errs22 = errors;
    if (data && typeof data == "object" && !Array.isArray(data) && data.payload !== void 0) {
      let data8 = data.payload;
      if (data8 && typeof data8 == "object" && !Array.isArray(data8)) {
        if (data8.name === void 0) {
          let err17 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/1/then/properties/payload/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
          vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
        }
        for (let key1 in data8)
          if (key1 !== "name") {
            let err18 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/1/then/properties/payload/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
          }
        if (data8.name !== void 0) {
          let data9 = data8.name;
          if (typeof data9 == "string") {
            if (func2(data9) < 1) {
              let err19 = { instancePath: instancePath + "/payload/name", schemaPath: "#/allOf/1/then/properties/payload/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
            }
          } else {
            let err20 = { instancePath: instancePath + "/payload/name", schemaPath: "#/allOf/1/then/properties/payload/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
          }
        }
      } else {
        let err21 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/1/then/properties/payload/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
      }
    }
    var _valid1 = _errs22 === errors;
    valid5 = _valid1;
  }
  if (!valid5) {
    let err22 = { instancePath, schemaPath: "#/allOf/1/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
  }
  let _errs29 = errors, valid9 = !0, _errs30 = errors;
  if (data && typeof data == "object" && !Array.isArray(data) && data.kind !== void 0 && data.kind !== "scope.add") {
    let err23 = {};
    vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
  }
  var _valid2 = _errs30 === errors;
  if (errors = _errs29, vErrors !== null && (_errs29 ? vErrors.length = _errs29 : vErrors = null), _valid2) {
    let _errs32 = errors;
    if (data && typeof data == "object" && !Array.isArray(data) && data.payload !== void 0) {
      let data11 = data.payload;
      if (data11 && typeof data11 == "object" && !Array.isArray(data11)) {
        if (data11.id === void 0) {
          let err24 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/2/then/properties/payload/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
          vErrors === null ? vErrors = [err24] : vErrors.push(err24), errors++;
        }
        if (data11.key === void 0) {
          let err25 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/2/then/properties/payload/required", keyword: "required", params: { missingProperty: "key" }, message: "must have required property 'key'" };
          vErrors === null ? vErrors = [err25] : vErrors.push(err25), errors++;
        }
        if (data11.label === void 0) {
          let err26 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/2/then/properties/payload/required", keyword: "required", params: { missingProperty: "label" }, message: "must have required property 'label'" };
          vErrors === null ? vErrors = [err26] : vErrors.push(err26), errors++;
        }
        if (data11.kind === void 0) {
          let err27 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/2/then/properties/payload/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
          vErrors === null ? vErrors = [err27] : vErrors.push(err27), errors++;
        }
        if (data11.path === void 0) {
          let err28 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/2/then/properties/payload/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
          vErrors === null ? vErrors = [err28] : vErrors.push(err28), errors++;
        }
        for (let key2 in data11)
          if (!(key2 === "id" || key2 === "key" || key2 === "label" || key2 === "kind" || key2 === "path" || key2 === "owner")) {
            let err29 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/2/then/properties/payload/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err29] : vErrors.push(err29), errors++;
          }
        if (data11.id !== void 0) {
          let data12 = data11.id;
          if (typeof data12 == "string") {
            if (!pattern1.test(data12)) {
              let err30 = { instancePath: instancePath + "/payload/id", schemaPath: "#/allOf/2/then/properties/payload/properties/id/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, message: 'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"' };
              vErrors === null ? vErrors = [err30] : vErrors.push(err30), errors++;
            }
          } else {
            let err31 = { instancePath: instancePath + "/payload/id", schemaPath: "#/allOf/2/then/properties/payload/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err31] : vErrors.push(err31), errors++;
          }
        }
        if (data11.key !== void 0) {
          let data13 = data11.key;
          if (typeof data13 == "string") {
            if (func2(data13) < 1) {
              let err32 = { instancePath: instancePath + "/payload/key", schemaPath: "#/allOf/2/then/properties/payload/properties/key/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err32] : vErrors.push(err32), errors++;
            }
          } else {
            let err33 = { instancePath: instancePath + "/payload/key", schemaPath: "#/allOf/2/then/properties/payload/properties/key/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err33] : vErrors.push(err33), errors++;
          }
        }
        if (data11.label !== void 0) {
          let data14 = data11.label;
          if (typeof data14 == "string") {
            if (func2(data14) < 1) {
              let err34 = { instancePath: instancePath + "/payload/label", schemaPath: "#/allOf/2/then/properties/payload/properties/label/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err34] : vErrors.push(err34), errors++;
            }
          } else {
            let err35 = { instancePath: instancePath + "/payload/label", schemaPath: "#/allOf/2/then/properties/payload/properties/label/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err35] : vErrors.push(err35), errors++;
          }
        }
        if (data11.kind !== void 0) {
          let data15 = data11.kind;
          if (!(data15 === "code" || data15 === "non_code")) {
            let err36 = { instancePath: instancePath + "/payload/kind", schemaPath: "#/allOf/2/then/properties/payload/properties/kind/enum", keyword: "enum", params: { allowedValues: schema11.allOf[2].then.properties.payload.properties.kind.enum }, message: "must be equal to one of the allowed values" };
            vErrors === null ? vErrors = [err36] : vErrors.push(err36), errors++;
          }
        }
        if (data11.path !== void 0) {
          let data16 = data11.path;
          if (typeof data16 == "string") {
            if (func2(data16) < 1) {
              let err37 = { instancePath: instancePath + "/payload/path", schemaPath: "#/allOf/2/then/properties/payload/properties/path/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err37] : vErrors.push(err37), errors++;
            }
          } else {
            let err38 = { instancePath: instancePath + "/payload/path", schemaPath: "#/allOf/2/then/properties/payload/properties/path/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err38] : vErrors.push(err38), errors++;
          }
        }
        if (data11.owner !== void 0) {
          let data17 = data11.owner;
          if (typeof data17 != "string" && data17 !== null) {
            let err39 = { instancePath: instancePath + "/payload/owner", schemaPath: "#/allOf/2/then/properties/payload/properties/owner/type", keyword: "type", params: { type: schema11.allOf[2].then.properties.payload.properties.owner.type }, message: "must be string,null" };
            vErrors === null ? vErrors = [err39] : vErrors.push(err39), errors++;
          }
        }
      } else {
        let err40 = { instancePath: instancePath + "/payload", schemaPath: "#/allOf/2/then/properties/payload/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err40] : vErrors.push(err40), errors++;
      }
    }
    var _valid2 = _errs32 === errors;
    valid9 = _valid2;
  }
  if (!valid9) {
    let err41 = { instancePath, schemaPath: "#/allOf/2/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    vErrors === null ? vErrors = [err41] : vErrors.push(err41), errors++;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.schemaVersion === void 0) {
      let err42 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schemaVersion" }, message: "must have required property 'schemaVersion'" };
      vErrors === null ? vErrors = [err42] : vErrors.push(err42), errors++;
    }
    if (data.operationId === void 0) {
      let err43 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operationId" }, message: "must have required property 'operationId'" };
      vErrors === null ? vErrors = [err43] : vErrors.push(err43), errors++;
    }
    if (data.kind === void 0) {
      let err44 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err44] : vErrors.push(err44), errors++;
    }
    if (data.target === void 0) {
      let err45 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "target" }, message: "must have required property 'target'" };
      vErrors === null ? vErrors = [err45] : vErrors.push(err45), errors++;
    }
    if (data.baseRevisions === void 0) {
      let err46 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "baseRevisions" }, message: "must have required property 'baseRevisions'" };
      vErrors === null ? vErrors = [err46] : vErrors.push(err46), errors++;
    }
    if (data.payload === void 0) {
      let err47 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "payload" }, message: "must have required property 'payload'" };
      vErrors === null ? vErrors = [err47] : vErrors.push(err47), errors++;
    }
    if (data.hash === void 0) {
      let err48 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "hash" }, message: "must have required property 'hash'" };
      vErrors === null ? vErrors = [err48] : vErrors.push(err48), errors++;
    }
    for (let key3 in data)
      if (!(key3 === "schemaVersion" || key3 === "operationId" || key3 === "kind" || key3 === "target" || key3 === "baseRevisions" || key3 === "payload" || key3 === "hash")) {
        let err49 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err49] : vErrors.push(err49), errors++;
      }
    if (data.schemaVersion !== void 0 && data.schemaVersion !== 1) {
      let err50 = { instancePath: instancePath + "/schemaVersion", schemaPath: "#/properties/schemaVersion/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err50] : vErrors.push(err50), errors++;
    }
    if (data.operationId !== void 0) {
      let data19 = data.operationId;
      if (typeof data19 == "string") {
        if (!pattern1.test(data19)) {
          let err51 = { instancePath: instancePath + "/operationId", schemaPath: "#/properties/operationId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, message: 'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"' };
          vErrors === null ? vErrors = [err51] : vErrors.push(err51), errors++;
        }
      } else {
        let err52 = { instancePath: instancePath + "/operationId", schemaPath: "#/properties/operationId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err52] : vErrors.push(err52), errors++;
      }
    }
    if (data.kind !== void 0) {
      let data20 = data.kind;
      if (!(data20 === "workspace.init" || data20 === "config.update" || data20 === "scope.add")) {
        let err53 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema11.properties.kind.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err53] : vErrors.push(err53), errors++;
      }
    }
    if (data.target !== void 0) {
      let data21 = data.target;
      if (!(data21 && typeof data21 == "object" && !Array.isArray(data21))) {
        let err54 = { instancePath: instancePath + "/target", schemaPath: "#/properties/target/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err54] : vErrors.push(err54), errors++;
      }
    }
    if (data.baseRevisions !== void 0) {
      let data22 = data.baseRevisions;
      if (data22 && typeof data22 == "object" && !Array.isArray(data22))
        for (let key4 in data22) {
          let data23 = data22[key4];
          if (data23 && typeof data23 == "object" && !Array.isArray(data23)) {
            if (data23.revisionHash === void 0) {
              let err55 = { instancePath: instancePath + "/baseRevisions/" + key4.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/baseRevisions/additionalProperties/required", keyword: "required", params: { missingProperty: "revisionHash" }, message: "must have required property 'revisionHash'" };
              vErrors === null ? vErrors = [err55] : vErrors.push(err55), errors++;
            }
            if (data23.contentHash === void 0) {
              let err56 = { instancePath: instancePath + "/baseRevisions/" + key4.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/baseRevisions/additionalProperties/required", keyword: "required", params: { missingProperty: "contentHash" }, message: "must have required property 'contentHash'" };
              vErrors === null ? vErrors = [err56] : vErrors.push(err56), errors++;
            }
            for (let key5 in data23)
              if (!(key5 === "revisionHash" || key5 === "contentHash")) {
                let err57 = { instancePath: instancePath + "/baseRevisions/" + key4.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/baseRevisions/additionalProperties/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
                vErrors === null ? vErrors = [err57] : vErrors.push(err57), errors++;
              }
            if (data23.revisionHash !== void 0) {
              let data24 = data23.revisionHash;
              if (typeof data24 == "string") {
                if (!pattern3.test(data24)) {
                  let err58 = { instancePath: instancePath + "/baseRevisions/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/revisionHash", schemaPath: "#/properties/baseRevisions/additionalProperties/properties/revisionHash/pattern", keyword: "pattern", params: { pattern: "^([0-9a-f]{64}|ABSENT)$" }, message: 'must match pattern "^([0-9a-f]{64}|ABSENT)$"' };
                  vErrors === null ? vErrors = [err58] : vErrors.push(err58), errors++;
                }
              } else {
                let err59 = { instancePath: instancePath + "/baseRevisions/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/revisionHash", schemaPath: "#/properties/baseRevisions/additionalProperties/properties/revisionHash/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err59] : vErrors.push(err59), errors++;
              }
            }
            if (data23.contentHash !== void 0) {
              let data25 = data23.contentHash;
              if (typeof data25 == "string") {
                if (!pattern3.test(data25)) {
                  let err60 = { instancePath: instancePath + "/baseRevisions/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/contentHash", schemaPath: "#/properties/baseRevisions/additionalProperties/properties/contentHash/pattern", keyword: "pattern", params: { pattern: "^([0-9a-f]{64}|ABSENT)$" }, message: 'must match pattern "^([0-9a-f]{64}|ABSENT)$"' };
                  vErrors === null ? vErrors = [err60] : vErrors.push(err60), errors++;
                }
              } else {
                let err61 = { instancePath: instancePath + "/baseRevisions/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/contentHash", schemaPath: "#/properties/baseRevisions/additionalProperties/properties/contentHash/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err61] : vErrors.push(err61), errors++;
              }
            }
          } else {
            let err62 = { instancePath: instancePath + "/baseRevisions/" + key4.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/baseRevisions/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            vErrors === null ? vErrors = [err62] : vErrors.push(err62), errors++;
          }
        }
      else {
        let err63 = { instancePath: instancePath + "/baseRevisions", schemaPath: "#/properties/baseRevisions/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err63] : vErrors.push(err63), errors++;
      }
    }
    if (data.payload !== void 0) {
      let data26 = data.payload;
      if (!(data26 && typeof data26 == "object" && !Array.isArray(data26))) {
        let err64 = { instancePath: instancePath + "/payload", schemaPath: "#/properties/payload/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err64] : vErrors.push(err64), errors++;
      }
    }
    if (data.hash !== void 0) {
      let data27 = data.hash;
      if (typeof data27 == "string") {
        if (!pattern5.test(data27)) {
          let err65 = { instancePath: instancePath + "/hash", schemaPath: "#/properties/hash/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
          vErrors === null ? vErrors = [err65] : vErrors.push(err65), errors++;
        }
      } else {
        let err66 = { instancePath: instancePath + "/hash", schemaPath: "#/properties/hash/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err66] : vErrors.push(err66), errors++;
      }
    }
  } else {
    let err67 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err67] : vErrors.push(err67), errors++;
  }
  return validate10.errors = vErrors, errors === 0;
}
var validate_config = validate11, schema12 = { $id: "https://shipping-mode.dev/schemas/config.schema.json", type: "object", additionalProperties: !1, required: ["schemaVersion", "name", "vcs", "scopeRefs"], properties: { schemaVersion: { const: 1 }, name: { type: "string", minLength: 1 }, baseBranch: { type: ["string", "null"] }, vcs: { enum: ["git", "none"] }, scopeRefs: { type: "array", items: { type: "object", additionalProperties: !1, required: ["id", "key"], properties: { id: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, key: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" } } } } } }, pattern7 = new RegExp("^[a-z0-9]+(-[a-z0-9]+)*$", "u");
function validate11(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null, errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.schemaVersion === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schemaVersion" }, message: "must have required property 'schemaVersion'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.name === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.vcs === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "vcs" }, message: "must have required property 'vcs'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.scopeRefs === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "scopeRefs" }, message: "must have required property 'scopeRefs'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "schemaVersion" || key0 === "name" || key0 === "baseBranch" || key0 === "vcs" || key0 === "scopeRefs")) {
        let err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
      }
    if (data.schemaVersion !== void 0 && data.schemaVersion !== 1) {
      let err5 = { instancePath: instancePath + "/schemaVersion", schemaPath: "#/properties/schemaVersion/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.name !== void 0) {
      let data1 = data.name;
      if (typeof data1 == "string") {
        if (func2(data1) < 1) {
          let err6 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
        }
      } else {
        let err7 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    }
    if (data.baseBranch !== void 0) {
      let data2 = data.baseBranch;
      if (typeof data2 != "string" && data2 !== null) {
        let err8 = { instancePath: instancePath + "/baseBranch", schemaPath: "#/properties/baseBranch/type", keyword: "type", params: { type: schema12.properties.baseBranch.type }, message: "must be string,null" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
    if (data.vcs !== void 0) {
      let data3 = data.vcs;
      if (!(data3 === "git" || data3 === "none")) {
        let err9 = { instancePath: instancePath + "/vcs", schemaPath: "#/properties/vcs/enum", keyword: "enum", params: { allowedValues: schema12.properties.vcs.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
    if (data.scopeRefs !== void 0) {
      let data4 = data.scopeRefs;
      if (Array.isArray(data4)) {
        let len0 = data4.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data5 = data4[i0];
          if (data5 && typeof data5 == "object" && !Array.isArray(data5)) {
            if (data5.id === void 0) {
              let err10 = { instancePath: instancePath + "/scopeRefs/" + i0, schemaPath: "#/properties/scopeRefs/items/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
            }
            if (data5.key === void 0) {
              let err11 = { instancePath: instancePath + "/scopeRefs/" + i0, schemaPath: "#/properties/scopeRefs/items/required", keyword: "required", params: { missingProperty: "key" }, message: "must have required property 'key'" };
              vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
            }
            for (let key1 in data5)
              if (!(key1 === "id" || key1 === "key")) {
                let err12 = { instancePath: instancePath + "/scopeRefs/" + i0, schemaPath: "#/properties/scopeRefs/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
              }
            if (data5.id !== void 0) {
              let data6 = data5.id;
              if (typeof data6 == "string") {
                if (!pattern1.test(data6)) {
                  let err13 = { instancePath: instancePath + "/scopeRefs/" + i0 + "/id", schemaPath: "#/properties/scopeRefs/items/properties/id/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, message: 'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"' };
                  vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
                }
              } else {
                let err14 = { instancePath: instancePath + "/scopeRefs/" + i0 + "/id", schemaPath: "#/properties/scopeRefs/items/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
              }
            }
            if (data5.key !== void 0) {
              let data7 = data5.key;
              if (typeof data7 == "string") {
                if (!pattern7.test(data7)) {
                  let err15 = { instancePath: instancePath + "/scopeRefs/" + i0 + "/key", schemaPath: "#/properties/scopeRefs/items/properties/key/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" }, message: 'must match pattern "^[a-z0-9]+(-[a-z0-9]+)*$"' };
                  vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
                }
              } else {
                let err16 = { instancePath: instancePath + "/scopeRefs/" + i0 + "/key", schemaPath: "#/properties/scopeRefs/items/properties/key/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
              }
            }
          } else {
            let err17 = { instancePath: instancePath + "/scopeRefs/" + i0, schemaPath: "#/properties/scopeRefs/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
          }
        }
      } else {
        let err18 = { instancePath: instancePath + "/scopeRefs", schemaPath: "#/properties/scopeRefs/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
      }
    }
  } else {
    let err19 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
  }
  return validate11.errors = vErrors, errors === 0;
}
var validate_event = validate12, schema13 = { $id: "https://shipping-mode.dev/schemas/event.schema.json", type: "object", additionalProperties: !1, required: ["eventId", "schemaVersion", "type", "aggregate", "occurredAt", "actor", "operationId", "idempotencyKey", "payload"], properties: { eventId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, schemaVersion: { const: 1 }, type: { type: "string", minLength: 1 }, aggregate: { type: "object", additionalProperties: !1, required: ["type", "id"], properties: { type: { type: "string" }, id: { type: "string" } } }, occurredAt: { type: "string" }, actor: { type: "string" }, operationId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, idempotencyKey: { type: "string" }, payload: { type: "object" }, inputHash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" }, outputHash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" } } }, func9 = Object.prototype.hasOwnProperty;
function validate12(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null, errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.eventId === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "eventId" }, message: "must have required property 'eventId'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.schemaVersion === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schemaVersion" }, message: "must have required property 'schemaVersion'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.type === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.aggregate === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "aggregate" }, message: "must have required property 'aggregate'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.occurredAt === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "occurredAt" }, message: "must have required property 'occurredAt'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.actor === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "actor" }, message: "must have required property 'actor'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.operationId === void 0) {
      let err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operationId" }, message: "must have required property 'operationId'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.idempotencyKey === void 0) {
      let err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "idempotencyKey" }, message: "must have required property 'idempotencyKey'" };
      vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
    }
    if (data.payload === void 0) {
      let err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "payload" }, message: "must have required property 'payload'" };
      vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
    }
    for (let key0 in data)
      if (!func9.call(schema13.properties, key0)) {
        let err9 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    if (data.eventId !== void 0) {
      let data0 = data.eventId;
      if (typeof data0 == "string") {
        if (!pattern1.test(data0)) {
          let err10 = { instancePath: instancePath + "/eventId", schemaPath: "#/properties/eventId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, message: 'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"' };
          vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
        }
      } else {
        let err11 = { instancePath: instancePath + "/eventId", schemaPath: "#/properties/eventId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    }
    if (data.schemaVersion !== void 0 && data.schemaVersion !== 1) {
      let err12 = { instancePath: instancePath + "/schemaVersion", schemaPath: "#/properties/schemaVersion/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
    }
    if (data.type !== void 0) {
      let data2 = data.type;
      if (typeof data2 == "string") {
        if (func2(data2) < 1) {
          let err13 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
        }
      } else {
        let err14 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
    }
    if (data.aggregate !== void 0) {
      let data3 = data.aggregate;
      if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
        if (data3.type === void 0) {
          let err15 = { instancePath: instancePath + "/aggregate", schemaPath: "#/properties/aggregate/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
          vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
        }
        if (data3.id === void 0) {
          let err16 = { instancePath: instancePath + "/aggregate", schemaPath: "#/properties/aggregate/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
          vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
        }
        for (let key1 in data3)
          if (!(key1 === "type" || key1 === "id")) {
            let err17 = { instancePath: instancePath + "/aggregate", schemaPath: "#/properties/aggregate/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
          }
        if (data3.type !== void 0 && typeof data3.type != "string") {
          let err18 = { instancePath: instancePath + "/aggregate/type", schemaPath: "#/properties/aggregate/properties/type/type", keyword: "type", params: { type: "string" }, message: "must be string" };
          vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
        }
        if (data3.id !== void 0 && typeof data3.id != "string") {
          let err19 = { instancePath: instancePath + "/aggregate/id", schemaPath: "#/properties/aggregate/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
          vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
        }
      } else {
        let err20 = { instancePath: instancePath + "/aggregate", schemaPath: "#/properties/aggregate/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
      }
    }
    if (data.occurredAt !== void 0 && typeof data.occurredAt != "string") {
      let err21 = { instancePath: instancePath + "/occurredAt", schemaPath: "#/properties/occurredAt/type", keyword: "type", params: { type: "string" }, message: "must be string" };
      vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
    }
    if (data.actor !== void 0 && typeof data.actor != "string") {
      let err22 = { instancePath: instancePath + "/actor", schemaPath: "#/properties/actor/type", keyword: "type", params: { type: "string" }, message: "must be string" };
      vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
    }
    if (data.operationId !== void 0) {
      let data8 = data.operationId;
      if (typeof data8 == "string") {
        if (!pattern1.test(data8)) {
          let err23 = { instancePath: instancePath + "/operationId", schemaPath: "#/properties/operationId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, message: 'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"' };
          vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
        }
      } else {
        let err24 = { instancePath: instancePath + "/operationId", schemaPath: "#/properties/operationId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err24] : vErrors.push(err24), errors++;
      }
    }
    if (data.idempotencyKey !== void 0 && typeof data.idempotencyKey != "string") {
      let err25 = { instancePath: instancePath + "/idempotencyKey", schemaPath: "#/properties/idempotencyKey/type", keyword: "type", params: { type: "string" }, message: "must be string" };
      vErrors === null ? vErrors = [err25] : vErrors.push(err25), errors++;
    }
    if (data.payload !== void 0) {
      let data10 = data.payload;
      if (!(data10 && typeof data10 == "object" && !Array.isArray(data10))) {
        let err26 = { instancePath: instancePath + "/payload", schemaPath: "#/properties/payload/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err26] : vErrors.push(err26), errors++;
      }
    }
    if (data.inputHash !== void 0) {
      let data11 = data.inputHash;
      if (typeof data11 != "string" && data11 !== null) {
        let err27 = { instancePath: instancePath + "/inputHash", schemaPath: "#/properties/inputHash/type", keyword: "type", params: { type: schema13.properties.inputHash.type }, message: "must be string,null" };
        vErrors === null ? vErrors = [err27] : vErrors.push(err27), errors++;
      }
      if (typeof data11 == "string" && !pattern5.test(data11)) {
        let err28 = { instancePath: instancePath + "/inputHash", schemaPath: "#/properties/inputHash/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
        vErrors === null ? vErrors = [err28] : vErrors.push(err28), errors++;
      }
    }
    if (data.outputHash !== void 0) {
      let data12 = data.outputHash;
      if (typeof data12 != "string" && data12 !== null) {
        let err29 = { instancePath: instancePath + "/outputHash", schemaPath: "#/properties/outputHash/type", keyword: "type", params: { type: schema13.properties.outputHash.type }, message: "must be string,null" };
        vErrors === null ? vErrors = [err29] : vErrors.push(err29), errors++;
      }
      if (typeof data12 == "string" && !pattern5.test(data12)) {
        let err30 = { instancePath: instancePath + "/outputHash", schemaPath: "#/properties/outputHash/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
        vErrors === null ? vErrors = [err30] : vErrors.push(err30), errors++;
      }
    }
  } else {
    let err31 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err31] : vErrors.push(err31), errors++;
  }
  return validate12.errors = vErrors, errors === 0;
}
var validate_operation = validate13, schema14 = { $id: "https://shipping-mode.dev/schemas/operation.schema.json", type: "object", additionalProperties: !1, required: ["id", "kind", "status", "proposedBy", "proposedAt", "reservedEvents", "history"], properties: { id: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, kind: { enum: ["workspace.init", "config.update", "scope.add"] }, status: { enum: ["PROPOSED", "VALIDATED", "APPROVED", "APPLYING", "APPLIED", "INVALID", "STALE", "RECOVERY_REQUIRED"] }, proposedBy: { type: "string" }, proposedAt: { type: "string" }, reservedEvents: { type: "array", minItems: 1, items: { type: "object", additionalProperties: !1, required: ["eventId", "type"], properties: { eventId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, type: { type: "string", minLength: 1 } } } }, validation: { type: "object", additionalProperties: !1, properties: { validatedAt: { type: ["string", "null"] }, changeSetHash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" }, errors: { type: "array", items: { type: "string" } } } }, approval: { type: "object", additionalProperties: !1, properties: { actor: { type: ["string", "null"] }, approvedAt: { type: ["string", "null"] }, changeSetHash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" }, selfApproval: { type: ["boolean", "null"] } } }, filePlan: { type: "array", items: { type: "object", additionalProperties: !1, required: ["target", "stagedRelativePath", "expectedBefore", "beforeContentHash", "beforeRevisionHash", "stagedContentHash", "stagedRevisionHash"], properties: { target: { type: "string" }, stagedRelativePath: { type: "string" }, expectedBefore: { enum: ["ABSENT", "PRESENT"] }, beforeContentHash: { type: "string", pattern: "^([0-9a-f]{64}|ABSENT)$" }, beforeRevisionHash: { type: "string", pattern: "^([0-9a-f]{64}|ABSENT)$" }, stagedContentHash: { type: "string", pattern: "^[0-9a-f]{64}$" }, stagedRevisionHash: { type: "string", pattern: "^[0-9a-f]{64}$" } } } }, expectedEvents: { type: "array", items: { type: "object", additionalProperties: !1, required: ["eventId", "relativePath", "contentHash", "document"], properties: { eventId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, relativePath: { type: "string" }, contentHash: { type: "string", pattern: "^[0-9a-f]{64}$" }, document: { type: "object" } } } }, appliedAt: { type: ["string", "null"] }, conflict: { type: ["object", "null"] }, history: { type: "array", items: { type: "object", additionalProperties: !1, required: ["at", "to", "actor"], properties: { at: { type: "string" }, from: { type: ["string", "null"] }, to: { type: "string" }, actor: { type: "string" }, reason: { type: ["string", "null"] } } } } }, allOf: [{ if: { properties: { status: { enum: ["VALIDATED", "APPROVED", "APPLYING", "APPLIED"] } } }, then: { required: ["validation"], properties: { validation: { type: "object", required: ["validatedAt", "changeSetHash"], properties: { validatedAt: { type: "string" }, changeSetHash: { type: "string", pattern: "^[0-9a-f]{64}$" } } } } } }, { if: { properties: { status: { enum: ["APPROVED", "APPLYING", "APPLIED"] } } }, then: { required: ["approval"], properties: { approval: { type: "object", required: ["actor", "approvedAt", "changeSetHash", "selfApproval"], properties: { actor: { type: "string" }, approvedAt: { type: "string" }, changeSetHash: { type: "string", pattern: "^[0-9a-f]{64}$" }, selfApproval: { type: "boolean" } } } } } }, { if: { properties: { status: { enum: ["APPLYING", "APPLIED"] } } }, then: { required: ["filePlan", "expectedEvents"], properties: { filePlan: { type: "array", minItems: 1 }, expectedEvents: { type: "array", minItems: 1 } } } }, { if: { properties: { status: { const: "APPLIED" } } }, then: { required: ["appliedAt"], properties: { appliedAt: { type: "string" } } } }, { if: { properties: { status: { const: "RECOVERY_REQUIRED" } } }, then: { required: ["conflict"], properties: { conflict: { type: "object" } } } }] };
function validate13(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null, errors = 0, _errs2 = errors, valid1 = !0, _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data) && data.status !== void 0) {
    let data0 = data.status;
    if (!(data0 === "VALIDATED" || data0 === "APPROVED" || data0 === "APPLYING" || data0 === "APPLIED")) {
      let err0 = {};
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
  }
  var _valid0 = _errs3 === errors;
  if (errors = _errs2, vErrors !== null && (_errs2 ? vErrors.length = _errs2 : vErrors = null), _valid0) {
    let _errs5 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.validation === void 0) {
        let err1 = { instancePath, schemaPath: "#/allOf/0/then/required", keyword: "required", params: { missingProperty: "validation" }, message: "must have required property 'validation'" };
        vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
      }
      if (data.validation !== void 0) {
        let data1 = data.validation;
        if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
          if (data1.validatedAt === void 0) {
            let err2 = { instancePath: instancePath + "/validation", schemaPath: "#/allOf/0/then/properties/validation/required", keyword: "required", params: { missingProperty: "validatedAt" }, message: "must have required property 'validatedAt'" };
            vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
          }
          if (data1.changeSetHash === void 0) {
            let err3 = { instancePath: instancePath + "/validation", schemaPath: "#/allOf/0/then/properties/validation/required", keyword: "required", params: { missingProperty: "changeSetHash" }, message: "must have required property 'changeSetHash'" };
            vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
          }
          if (data1.validatedAt !== void 0 && typeof data1.validatedAt != "string") {
            let err4 = { instancePath: instancePath + "/validation/validatedAt", schemaPath: "#/allOf/0/then/properties/validation/properties/validatedAt/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
          }
          if (data1.changeSetHash !== void 0) {
            let data3 = data1.changeSetHash;
            if (typeof data3 == "string") {
              if (!pattern5.test(data3)) {
                let err5 = { instancePath: instancePath + "/validation/changeSetHash", schemaPath: "#/allOf/0/then/properties/validation/properties/changeSetHash/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
                vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
              }
            } else {
              let err6 = { instancePath: instancePath + "/validation/changeSetHash", schemaPath: "#/allOf/0/then/properties/validation/properties/changeSetHash/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
            }
          }
        } else {
          let err7 = { instancePath: instancePath + "/validation", schemaPath: "#/allOf/0/then/properties/validation/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
        }
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
  }
  if (!valid1) {
    let err8 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
  }
  let _errs13 = errors, valid5 = !0, _errs14 = errors;
  if (data && typeof data == "object" && !Array.isArray(data) && data.status !== void 0) {
    let data4 = data.status;
    if (!(data4 === "APPROVED" || data4 === "APPLYING" || data4 === "APPLIED")) {
      let err9 = {};
      vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
    }
  }
  var _valid1 = _errs14 === errors;
  if (errors = _errs13, vErrors !== null && (_errs13 ? vErrors.length = _errs13 : vErrors = null), _valid1) {
    let _errs16 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.approval === void 0) {
        let err10 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "approval" }, message: "must have required property 'approval'" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
      if (data.approval !== void 0) {
        let data5 = data.approval;
        if (data5 && typeof data5 == "object" && !Array.isArray(data5)) {
          if (data5.actor === void 0) {
            let err11 = { instancePath: instancePath + "/approval", schemaPath: "#/allOf/1/then/properties/approval/required", keyword: "required", params: { missingProperty: "actor" }, message: "must have required property 'actor'" };
            vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
          }
          if (data5.approvedAt === void 0) {
            let err12 = { instancePath: instancePath + "/approval", schemaPath: "#/allOf/1/then/properties/approval/required", keyword: "required", params: { missingProperty: "approvedAt" }, message: "must have required property 'approvedAt'" };
            vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
          }
          if (data5.changeSetHash === void 0) {
            let err13 = { instancePath: instancePath + "/approval", schemaPath: "#/allOf/1/then/properties/approval/required", keyword: "required", params: { missingProperty: "changeSetHash" }, message: "must have required property 'changeSetHash'" };
            vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
          }
          if (data5.selfApproval === void 0) {
            let err14 = { instancePath: instancePath + "/approval", schemaPath: "#/allOf/1/then/properties/approval/required", keyword: "required", params: { missingProperty: "selfApproval" }, message: "must have required property 'selfApproval'" };
            vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
          }
          if (data5.actor !== void 0 && typeof data5.actor != "string") {
            let err15 = { instancePath: instancePath + "/approval/actor", schemaPath: "#/allOf/1/then/properties/approval/properties/actor/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
          }
          if (data5.approvedAt !== void 0 && typeof data5.approvedAt != "string") {
            let err16 = { instancePath: instancePath + "/approval/approvedAt", schemaPath: "#/allOf/1/then/properties/approval/properties/approvedAt/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
          }
          if (data5.changeSetHash !== void 0) {
            let data8 = data5.changeSetHash;
            if (typeof data8 == "string") {
              if (!pattern5.test(data8)) {
                let err17 = { instancePath: instancePath + "/approval/changeSetHash", schemaPath: "#/allOf/1/then/properties/approval/properties/changeSetHash/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
                vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
              }
            } else {
              let err18 = { instancePath: instancePath + "/approval/changeSetHash", schemaPath: "#/allOf/1/then/properties/approval/properties/changeSetHash/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
            }
          }
          if (data5.selfApproval !== void 0 && typeof data5.selfApproval != "boolean") {
            let err19 = { instancePath: instancePath + "/approval/selfApproval", schemaPath: "#/allOf/1/then/properties/approval/properties/selfApproval/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
          }
        } else {
          let err20 = { instancePath: instancePath + "/approval", schemaPath: "#/allOf/1/then/properties/approval/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
        }
      }
    }
    var _valid1 = _errs16 === errors;
    valid5 = _valid1;
  }
  if (!valid5) {
    let err21 = { instancePath, schemaPath: "#/allOf/1/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
  }
  let _errs28 = errors, valid9 = !0, _errs29 = errors;
  if (data && typeof data == "object" && !Array.isArray(data) && data.status !== void 0) {
    let data10 = data.status;
    if (!(data10 === "APPLYING" || data10 === "APPLIED")) {
      let err22 = {};
      vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
    }
  }
  var _valid2 = _errs29 === errors;
  if (errors = _errs28, vErrors !== null && (_errs28 ? vErrors.length = _errs28 : vErrors = null), _valid2) {
    let _errs31 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.filePlan === void 0) {
        let err23 = { instancePath, schemaPath: "#/allOf/2/then/required", keyword: "required", params: { missingProperty: "filePlan" }, message: "must have required property 'filePlan'" };
        vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
      }
      if (data.expectedEvents === void 0) {
        let err24 = { instancePath, schemaPath: "#/allOf/2/then/required", keyword: "required", params: { missingProperty: "expectedEvents" }, message: "must have required property 'expectedEvents'" };
        vErrors === null ? vErrors = [err24] : vErrors.push(err24), errors++;
      }
      if (data.filePlan !== void 0) {
        let data11 = data.filePlan;
        if (Array.isArray(data11)) {
          if (data11.length < 1) {
            let err25 = { instancePath: instancePath + "/filePlan", schemaPath: "#/allOf/2/then/properties/filePlan/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            vErrors === null ? vErrors = [err25] : vErrors.push(err25), errors++;
          }
        } else {
          let err26 = { instancePath: instancePath + "/filePlan", schemaPath: "#/allOf/2/then/properties/filePlan/type", keyword: "type", params: { type: "array" }, message: "must be array" };
          vErrors === null ? vErrors = [err26] : vErrors.push(err26), errors++;
        }
      }
      if (data.expectedEvents !== void 0) {
        let data12 = data.expectedEvents;
        if (Array.isArray(data12)) {
          if (data12.length < 1) {
            let err27 = { instancePath: instancePath + "/expectedEvents", schemaPath: "#/allOf/2/then/properties/expectedEvents/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            vErrors === null ? vErrors = [err27] : vErrors.push(err27), errors++;
          }
        } else {
          let err28 = { instancePath: instancePath + "/expectedEvents", schemaPath: "#/allOf/2/then/properties/expectedEvents/type", keyword: "type", params: { type: "array" }, message: "must be array" };
          vErrors === null ? vErrors = [err28] : vErrors.push(err28), errors++;
        }
      }
    }
    var _valid2 = _errs31 === errors;
    valid9 = _valid2;
  }
  if (!valid9) {
    let err29 = { instancePath, schemaPath: "#/allOf/2/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    vErrors === null ? vErrors = [err29] : vErrors.push(err29), errors++;
  }
  let _errs37 = errors, valid12 = !0, _errs38 = errors;
  if (data && typeof data == "object" && !Array.isArray(data) && data.status !== void 0 && data.status !== "APPLIED") {
    let err30 = {};
    vErrors === null ? vErrors = [err30] : vErrors.push(err30), errors++;
  }
  var _valid3 = _errs38 === errors;
  if (errors = _errs37, vErrors !== null && (_errs37 ? vErrors.length = _errs37 : vErrors = null), _valid3) {
    let _errs40 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.appliedAt === void 0) {
        let err31 = { instancePath, schemaPath: "#/allOf/3/then/required", keyword: "required", params: { missingProperty: "appliedAt" }, message: "must have required property 'appliedAt'" };
        vErrors === null ? vErrors = [err31] : vErrors.push(err31), errors++;
      }
      if (data.appliedAt !== void 0 && typeof data.appliedAt != "string") {
        let err32 = { instancePath: instancePath + "/appliedAt", schemaPath: "#/allOf/3/then/properties/appliedAt/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err32] : vErrors.push(err32), errors++;
      }
    }
    var _valid3 = _errs40 === errors;
    valid12 = _valid3;
  }
  if (!valid12) {
    let err33 = { instancePath, schemaPath: "#/allOf/3/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    vErrors === null ? vErrors = [err33] : vErrors.push(err33), errors++;
  }
  let _errs44 = errors, valid15 = !0, _errs45 = errors;
  if (data && typeof data == "object" && !Array.isArray(data) && data.status !== void 0 && data.status !== "RECOVERY_REQUIRED") {
    let err34 = {};
    vErrors === null ? vErrors = [err34] : vErrors.push(err34), errors++;
  }
  var _valid4 = _errs45 === errors;
  if (errors = _errs44, vErrors !== null && (_errs44 ? vErrors.length = _errs44 : vErrors = null), _valid4) {
    let _errs47 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.conflict === void 0) {
        let err35 = { instancePath, schemaPath: "#/allOf/4/then/required", keyword: "required", params: { missingProperty: "conflict" }, message: "must have required property 'conflict'" };
        vErrors === null ? vErrors = [err35] : vErrors.push(err35), errors++;
      }
      if (data.conflict !== void 0) {
        let data16 = data.conflict;
        if (!(data16 && typeof data16 == "object" && !Array.isArray(data16))) {
          let err36 = { instancePath: instancePath + "/conflict", schemaPath: "#/allOf/4/then/properties/conflict/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          vErrors === null ? vErrors = [err36] : vErrors.push(err36), errors++;
        }
      }
    }
    var _valid4 = _errs47 === errors;
    valid15 = _valid4;
  }
  if (!valid15) {
    let err37 = { instancePath, schemaPath: "#/allOf/4/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    vErrors === null ? vErrors = [err37] : vErrors.push(err37), errors++;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      let err38 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      vErrors === null ? vErrors = [err38] : vErrors.push(err38), errors++;
    }
    if (data.kind === void 0) {
      let err39 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err39] : vErrors.push(err39), errors++;
    }
    if (data.status === void 0) {
      let err40 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "status" }, message: "must have required property 'status'" };
      vErrors === null ? vErrors = [err40] : vErrors.push(err40), errors++;
    }
    if (data.proposedBy === void 0) {
      let err41 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "proposedBy" }, message: "must have required property 'proposedBy'" };
      vErrors === null ? vErrors = [err41] : vErrors.push(err41), errors++;
    }
    if (data.proposedAt === void 0) {
      let err42 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "proposedAt" }, message: "must have required property 'proposedAt'" };
      vErrors === null ? vErrors = [err42] : vErrors.push(err42), errors++;
    }
    if (data.reservedEvents === void 0) {
      let err43 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "reservedEvents" }, message: "must have required property 'reservedEvents'" };
      vErrors === null ? vErrors = [err43] : vErrors.push(err43), errors++;
    }
    if (data.history === void 0) {
      let err44 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "history" }, message: "must have required property 'history'" };
      vErrors === null ? vErrors = [err44] : vErrors.push(err44), errors++;
    }
    for (let key0 in data)
      if (!func9.call(schema14.properties, key0)) {
        let err45 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err45] : vErrors.push(err45), errors++;
      }
    if (data.id !== void 0) {
      let data17 = data.id;
      if (typeof data17 == "string") {
        if (!pattern1.test(data17)) {
          let err46 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, message: 'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"' };
          vErrors === null ? vErrors = [err46] : vErrors.push(err46), errors++;
        }
      } else {
        let err47 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err47] : vErrors.push(err47), errors++;
      }
    }
    if (data.kind !== void 0) {
      let data18 = data.kind;
      if (!(data18 === "workspace.init" || data18 === "config.update" || data18 === "scope.add")) {
        let err48 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema14.properties.kind.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err48] : vErrors.push(err48), errors++;
      }
    }
    if (data.status !== void 0) {
      let data19 = data.status;
      if (!(data19 === "PROPOSED" || data19 === "VALIDATED" || data19 === "APPROVED" || data19 === "APPLYING" || data19 === "APPLIED" || data19 === "INVALID" || data19 === "STALE" || data19 === "RECOVERY_REQUIRED")) {
        let err49 = { instancePath: instancePath + "/status", schemaPath: "#/properties/status/enum", keyword: "enum", params: { allowedValues: schema14.properties.status.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err49] : vErrors.push(err49), errors++;
      }
    }
    if (data.proposedBy !== void 0 && typeof data.proposedBy != "string") {
      let err50 = { instancePath: instancePath + "/proposedBy", schemaPath: "#/properties/proposedBy/type", keyword: "type", params: { type: "string" }, message: "must be string" };
      vErrors === null ? vErrors = [err50] : vErrors.push(err50), errors++;
    }
    if (data.proposedAt !== void 0 && typeof data.proposedAt != "string") {
      let err51 = { instancePath: instancePath + "/proposedAt", schemaPath: "#/properties/proposedAt/type", keyword: "type", params: { type: "string" }, message: "must be string" };
      vErrors === null ? vErrors = [err51] : vErrors.push(err51), errors++;
    }
    if (data.reservedEvents !== void 0) {
      let data22 = data.reservedEvents;
      if (Array.isArray(data22)) {
        if (data22.length < 1) {
          let err52 = { instancePath: instancePath + "/reservedEvents", schemaPath: "#/properties/reservedEvents/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          vErrors === null ? vErrors = [err52] : vErrors.push(err52), errors++;
        }
        let len0 = data22.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data23 = data22[i0];
          if (data23 && typeof data23 == "object" && !Array.isArray(data23)) {
            if (data23.eventId === void 0) {
              let err53 = { instancePath: instancePath + "/reservedEvents/" + i0, schemaPath: "#/properties/reservedEvents/items/required", keyword: "required", params: { missingProperty: "eventId" }, message: "must have required property 'eventId'" };
              vErrors === null ? vErrors = [err53] : vErrors.push(err53), errors++;
            }
            if (data23.type === void 0) {
              let err54 = { instancePath: instancePath + "/reservedEvents/" + i0, schemaPath: "#/properties/reservedEvents/items/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
              vErrors === null ? vErrors = [err54] : vErrors.push(err54), errors++;
            }
            for (let key1 in data23)
              if (!(key1 === "eventId" || key1 === "type")) {
                let err55 = { instancePath: instancePath + "/reservedEvents/" + i0, schemaPath: "#/properties/reservedEvents/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                vErrors === null ? vErrors = [err55] : vErrors.push(err55), errors++;
              }
            if (data23.eventId !== void 0) {
              let data24 = data23.eventId;
              if (typeof data24 == "string") {
                if (!pattern1.test(data24)) {
                  let err56 = { instancePath: instancePath + "/reservedEvents/" + i0 + "/eventId", schemaPath: "#/properties/reservedEvents/items/properties/eventId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, message: 'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"' };
                  vErrors === null ? vErrors = [err56] : vErrors.push(err56), errors++;
                }
              } else {
                let err57 = { instancePath: instancePath + "/reservedEvents/" + i0 + "/eventId", schemaPath: "#/properties/reservedEvents/items/properties/eventId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err57] : vErrors.push(err57), errors++;
              }
            }
            if (data23.type !== void 0) {
              let data25 = data23.type;
              if (typeof data25 == "string") {
                if (func2(data25) < 1) {
                  let err58 = { instancePath: instancePath + "/reservedEvents/" + i0 + "/type", schemaPath: "#/properties/reservedEvents/items/properties/type/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  vErrors === null ? vErrors = [err58] : vErrors.push(err58), errors++;
                }
              } else {
                let err59 = { instancePath: instancePath + "/reservedEvents/" + i0 + "/type", schemaPath: "#/properties/reservedEvents/items/properties/type/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err59] : vErrors.push(err59), errors++;
              }
            }
          } else {
            let err60 = { instancePath: instancePath + "/reservedEvents/" + i0, schemaPath: "#/properties/reservedEvents/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            vErrors === null ? vErrors = [err60] : vErrors.push(err60), errors++;
          }
        }
      } else {
        let err61 = { instancePath: instancePath + "/reservedEvents", schemaPath: "#/properties/reservedEvents/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err61] : vErrors.push(err61), errors++;
      }
    }
    if (data.validation !== void 0) {
      let data26 = data.validation;
      if (data26 && typeof data26 == "object" && !Array.isArray(data26)) {
        for (let key2 in data26)
          if (!(key2 === "validatedAt" || key2 === "changeSetHash" || key2 === "errors")) {
            let err62 = { instancePath: instancePath + "/validation", schemaPath: "#/properties/validation/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err62] : vErrors.push(err62), errors++;
          }
        if (data26.validatedAt !== void 0) {
          let data27 = data26.validatedAt;
          if (typeof data27 != "string" && data27 !== null) {
            let err63 = { instancePath: instancePath + "/validation/validatedAt", schemaPath: "#/properties/validation/properties/validatedAt/type", keyword: "type", params: { type: schema14.properties.validation.properties.validatedAt.type }, message: "must be string,null" };
            vErrors === null ? vErrors = [err63] : vErrors.push(err63), errors++;
          }
        }
        if (data26.changeSetHash !== void 0) {
          let data28 = data26.changeSetHash;
          if (typeof data28 != "string" && data28 !== null) {
            let err64 = { instancePath: instancePath + "/validation/changeSetHash", schemaPath: "#/properties/validation/properties/changeSetHash/type", keyword: "type", params: { type: schema14.properties.validation.properties.changeSetHash.type }, message: "must be string,null" };
            vErrors === null ? vErrors = [err64] : vErrors.push(err64), errors++;
          }
          if (typeof data28 == "string" && !pattern5.test(data28)) {
            let err65 = { instancePath: instancePath + "/validation/changeSetHash", schemaPath: "#/properties/validation/properties/changeSetHash/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
            vErrors === null ? vErrors = [err65] : vErrors.push(err65), errors++;
          }
        }
        if (data26.errors !== void 0) {
          let data29 = data26.errors;
          if (Array.isArray(data29)) {
            let len1 = data29.length;
            for (let i1 = 0; i1 < len1; i1++)
              if (typeof data29[i1] != "string") {
                let err66 = { instancePath: instancePath + "/validation/errors/" + i1, schemaPath: "#/properties/validation/properties/errors/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err66] : vErrors.push(err66), errors++;
              }
          } else {
            let err67 = { instancePath: instancePath + "/validation/errors", schemaPath: "#/properties/validation/properties/errors/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            vErrors === null ? vErrors = [err67] : vErrors.push(err67), errors++;
          }
        }
      } else {
        let err68 = { instancePath: instancePath + "/validation", schemaPath: "#/properties/validation/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err68] : vErrors.push(err68), errors++;
      }
    }
    if (data.approval !== void 0) {
      let data31 = data.approval;
      if (data31 && typeof data31 == "object" && !Array.isArray(data31)) {
        for (let key3 in data31)
          if (!(key3 === "actor" || key3 === "approvedAt" || key3 === "changeSetHash" || key3 === "selfApproval")) {
            let err69 = { instancePath: instancePath + "/approval", schemaPath: "#/properties/approval/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err69] : vErrors.push(err69), errors++;
          }
        if (data31.actor !== void 0) {
          let data32 = data31.actor;
          if (typeof data32 != "string" && data32 !== null) {
            let err70 = { instancePath: instancePath + "/approval/actor", schemaPath: "#/properties/approval/properties/actor/type", keyword: "type", params: { type: schema14.properties.approval.properties.actor.type }, message: "must be string,null" };
            vErrors === null ? vErrors = [err70] : vErrors.push(err70), errors++;
          }
        }
        if (data31.approvedAt !== void 0) {
          let data33 = data31.approvedAt;
          if (typeof data33 != "string" && data33 !== null) {
            let err71 = { instancePath: instancePath + "/approval/approvedAt", schemaPath: "#/properties/approval/properties/approvedAt/type", keyword: "type", params: { type: schema14.properties.approval.properties.approvedAt.type }, message: "must be string,null" };
            vErrors === null ? vErrors = [err71] : vErrors.push(err71), errors++;
          }
        }
        if (data31.changeSetHash !== void 0) {
          let data34 = data31.changeSetHash;
          if (typeof data34 != "string" && data34 !== null) {
            let err72 = { instancePath: instancePath + "/approval/changeSetHash", schemaPath: "#/properties/approval/properties/changeSetHash/type", keyword: "type", params: { type: schema14.properties.approval.properties.changeSetHash.type }, message: "must be string,null" };
            vErrors === null ? vErrors = [err72] : vErrors.push(err72), errors++;
          }
          if (typeof data34 == "string" && !pattern5.test(data34)) {
            let err73 = { instancePath: instancePath + "/approval/changeSetHash", schemaPath: "#/properties/approval/properties/changeSetHash/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
            vErrors === null ? vErrors = [err73] : vErrors.push(err73), errors++;
          }
        }
        if (data31.selfApproval !== void 0) {
          let data35 = data31.selfApproval;
          if (typeof data35 != "boolean" && data35 !== null) {
            let err74 = { instancePath: instancePath + "/approval/selfApproval", schemaPath: "#/properties/approval/properties/selfApproval/type", keyword: "type", params: { type: schema14.properties.approval.properties.selfApproval.type }, message: "must be boolean,null" };
            vErrors === null ? vErrors = [err74] : vErrors.push(err74), errors++;
          }
        }
      } else {
        let err75 = { instancePath: instancePath + "/approval", schemaPath: "#/properties/approval/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err75] : vErrors.push(err75), errors++;
      }
    }
    if (data.filePlan !== void 0) {
      let data36 = data.filePlan;
      if (Array.isArray(data36)) {
        let len2 = data36.length;
        for (let i2 = 0; i2 < len2; i2++) {
          let data37 = data36[i2];
          if (data37 && typeof data37 == "object" && !Array.isArray(data37)) {
            if (data37.target === void 0) {
              let err76 = { instancePath: instancePath + "/filePlan/" + i2, schemaPath: "#/properties/filePlan/items/required", keyword: "required", params: { missingProperty: "target" }, message: "must have required property 'target'" };
              vErrors === null ? vErrors = [err76] : vErrors.push(err76), errors++;
            }
            if (data37.stagedRelativePath === void 0) {
              let err77 = { instancePath: instancePath + "/filePlan/" + i2, schemaPath: "#/properties/filePlan/items/required", keyword: "required", params: { missingProperty: "stagedRelativePath" }, message: "must have required property 'stagedRelativePath'" };
              vErrors === null ? vErrors = [err77] : vErrors.push(err77), errors++;
            }
            if (data37.expectedBefore === void 0) {
              let err78 = { instancePath: instancePath + "/filePlan/" + i2, schemaPath: "#/properties/filePlan/items/required", keyword: "required", params: { missingProperty: "expectedBefore" }, message: "must have required property 'expectedBefore'" };
              vErrors === null ? vErrors = [err78] : vErrors.push(err78), errors++;
            }
            if (data37.beforeContentHash === void 0) {
              let err79 = { instancePath: instancePath + "/filePlan/" + i2, schemaPath: "#/properties/filePlan/items/required", keyword: "required", params: { missingProperty: "beforeContentHash" }, message: "must have required property 'beforeContentHash'" };
              vErrors === null ? vErrors = [err79] : vErrors.push(err79), errors++;
            }
            if (data37.beforeRevisionHash === void 0) {
              let err80 = { instancePath: instancePath + "/filePlan/" + i2, schemaPath: "#/properties/filePlan/items/required", keyword: "required", params: { missingProperty: "beforeRevisionHash" }, message: "must have required property 'beforeRevisionHash'" };
              vErrors === null ? vErrors = [err80] : vErrors.push(err80), errors++;
            }
            if (data37.stagedContentHash === void 0) {
              let err81 = { instancePath: instancePath + "/filePlan/" + i2, schemaPath: "#/properties/filePlan/items/required", keyword: "required", params: { missingProperty: "stagedContentHash" }, message: "must have required property 'stagedContentHash'" };
              vErrors === null ? vErrors = [err81] : vErrors.push(err81), errors++;
            }
            if (data37.stagedRevisionHash === void 0) {
              let err82 = { instancePath: instancePath + "/filePlan/" + i2, schemaPath: "#/properties/filePlan/items/required", keyword: "required", params: { missingProperty: "stagedRevisionHash" }, message: "must have required property 'stagedRevisionHash'" };
              vErrors === null ? vErrors = [err82] : vErrors.push(err82), errors++;
            }
            for (let key4 in data37)
              if (!(key4 === "target" || key4 === "stagedRelativePath" || key4 === "expectedBefore" || key4 === "beforeContentHash" || key4 === "beforeRevisionHash" || key4 === "stagedContentHash" || key4 === "stagedRevisionHash")) {
                let err83 = { instancePath: instancePath + "/filePlan/" + i2, schemaPath: "#/properties/filePlan/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
                vErrors === null ? vErrors = [err83] : vErrors.push(err83), errors++;
              }
            if (data37.target !== void 0 && typeof data37.target != "string") {
              let err84 = { instancePath: instancePath + "/filePlan/" + i2 + "/target", schemaPath: "#/properties/filePlan/items/properties/target/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              vErrors === null ? vErrors = [err84] : vErrors.push(err84), errors++;
            }
            if (data37.stagedRelativePath !== void 0 && typeof data37.stagedRelativePath != "string") {
              let err85 = { instancePath: instancePath + "/filePlan/" + i2 + "/stagedRelativePath", schemaPath: "#/properties/filePlan/items/properties/stagedRelativePath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              vErrors === null ? vErrors = [err85] : vErrors.push(err85), errors++;
            }
            if (data37.expectedBefore !== void 0) {
              let data40 = data37.expectedBefore;
              if (!(data40 === "ABSENT" || data40 === "PRESENT")) {
                let err86 = { instancePath: instancePath + "/filePlan/" + i2 + "/expectedBefore", schemaPath: "#/properties/filePlan/items/properties/expectedBefore/enum", keyword: "enum", params: { allowedValues: schema14.properties.filePlan.items.properties.expectedBefore.enum }, message: "must be equal to one of the allowed values" };
                vErrors === null ? vErrors = [err86] : vErrors.push(err86), errors++;
              }
            }
            if (data37.beforeContentHash !== void 0) {
              let data41 = data37.beforeContentHash;
              if (typeof data41 == "string") {
                if (!pattern3.test(data41)) {
                  let err87 = { instancePath: instancePath + "/filePlan/" + i2 + "/beforeContentHash", schemaPath: "#/properties/filePlan/items/properties/beforeContentHash/pattern", keyword: "pattern", params: { pattern: "^([0-9a-f]{64}|ABSENT)$" }, message: 'must match pattern "^([0-9a-f]{64}|ABSENT)$"' };
                  vErrors === null ? vErrors = [err87] : vErrors.push(err87), errors++;
                }
              } else {
                let err88 = { instancePath: instancePath + "/filePlan/" + i2 + "/beforeContentHash", schemaPath: "#/properties/filePlan/items/properties/beforeContentHash/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err88] : vErrors.push(err88), errors++;
              }
            }
            if (data37.beforeRevisionHash !== void 0) {
              let data42 = data37.beforeRevisionHash;
              if (typeof data42 == "string") {
                if (!pattern3.test(data42)) {
                  let err89 = { instancePath: instancePath + "/filePlan/" + i2 + "/beforeRevisionHash", schemaPath: "#/properties/filePlan/items/properties/beforeRevisionHash/pattern", keyword: "pattern", params: { pattern: "^([0-9a-f]{64}|ABSENT)$" }, message: 'must match pattern "^([0-9a-f]{64}|ABSENT)$"' };
                  vErrors === null ? vErrors = [err89] : vErrors.push(err89), errors++;
                }
              } else {
                let err90 = { instancePath: instancePath + "/filePlan/" + i2 + "/beforeRevisionHash", schemaPath: "#/properties/filePlan/items/properties/beforeRevisionHash/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err90] : vErrors.push(err90), errors++;
              }
            }
            if (data37.stagedContentHash !== void 0) {
              let data43 = data37.stagedContentHash;
              if (typeof data43 == "string") {
                if (!pattern5.test(data43)) {
                  let err91 = { instancePath: instancePath + "/filePlan/" + i2 + "/stagedContentHash", schemaPath: "#/properties/filePlan/items/properties/stagedContentHash/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
                  vErrors === null ? vErrors = [err91] : vErrors.push(err91), errors++;
                }
              } else {
                let err92 = { instancePath: instancePath + "/filePlan/" + i2 + "/stagedContentHash", schemaPath: "#/properties/filePlan/items/properties/stagedContentHash/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err92] : vErrors.push(err92), errors++;
              }
            }
            if (data37.stagedRevisionHash !== void 0) {
              let data44 = data37.stagedRevisionHash;
              if (typeof data44 == "string") {
                if (!pattern5.test(data44)) {
                  let err93 = { instancePath: instancePath + "/filePlan/" + i2 + "/stagedRevisionHash", schemaPath: "#/properties/filePlan/items/properties/stagedRevisionHash/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
                  vErrors === null ? vErrors = [err93] : vErrors.push(err93), errors++;
                }
              } else {
                let err94 = { instancePath: instancePath + "/filePlan/" + i2 + "/stagedRevisionHash", schemaPath: "#/properties/filePlan/items/properties/stagedRevisionHash/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err94] : vErrors.push(err94), errors++;
              }
            }
          } else {
            let err95 = { instancePath: instancePath + "/filePlan/" + i2, schemaPath: "#/properties/filePlan/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            vErrors === null ? vErrors = [err95] : vErrors.push(err95), errors++;
          }
        }
      } else {
        let err96 = { instancePath: instancePath + "/filePlan", schemaPath: "#/properties/filePlan/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err96] : vErrors.push(err96), errors++;
      }
    }
    if (data.expectedEvents !== void 0) {
      let data45 = data.expectedEvents;
      if (Array.isArray(data45)) {
        let len3 = data45.length;
        for (let i3 = 0; i3 < len3; i3++) {
          let data46 = data45[i3];
          if (data46 && typeof data46 == "object" && !Array.isArray(data46)) {
            if (data46.eventId === void 0) {
              let err97 = { instancePath: instancePath + "/expectedEvents/" + i3, schemaPath: "#/properties/expectedEvents/items/required", keyword: "required", params: { missingProperty: "eventId" }, message: "must have required property 'eventId'" };
              vErrors === null ? vErrors = [err97] : vErrors.push(err97), errors++;
            }
            if (data46.relativePath === void 0) {
              let err98 = { instancePath: instancePath + "/expectedEvents/" + i3, schemaPath: "#/properties/expectedEvents/items/required", keyword: "required", params: { missingProperty: "relativePath" }, message: "must have required property 'relativePath'" };
              vErrors === null ? vErrors = [err98] : vErrors.push(err98), errors++;
            }
            if (data46.contentHash === void 0) {
              let err99 = { instancePath: instancePath + "/expectedEvents/" + i3, schemaPath: "#/properties/expectedEvents/items/required", keyword: "required", params: { missingProperty: "contentHash" }, message: "must have required property 'contentHash'" };
              vErrors === null ? vErrors = [err99] : vErrors.push(err99), errors++;
            }
            if (data46.document === void 0) {
              let err100 = { instancePath: instancePath + "/expectedEvents/" + i3, schemaPath: "#/properties/expectedEvents/items/required", keyword: "required", params: { missingProperty: "document" }, message: "must have required property 'document'" };
              vErrors === null ? vErrors = [err100] : vErrors.push(err100), errors++;
            }
            for (let key5 in data46)
              if (!(key5 === "eventId" || key5 === "relativePath" || key5 === "contentHash" || key5 === "document")) {
                let err101 = { instancePath: instancePath + "/expectedEvents/" + i3, schemaPath: "#/properties/expectedEvents/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
                vErrors === null ? vErrors = [err101] : vErrors.push(err101), errors++;
              }
            if (data46.eventId !== void 0) {
              let data47 = data46.eventId;
              if (typeof data47 == "string") {
                if (!pattern1.test(data47)) {
                  let err102 = { instancePath: instancePath + "/expectedEvents/" + i3 + "/eventId", schemaPath: "#/properties/expectedEvents/items/properties/eventId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, message: 'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"' };
                  vErrors === null ? vErrors = [err102] : vErrors.push(err102), errors++;
                }
              } else {
                let err103 = { instancePath: instancePath + "/expectedEvents/" + i3 + "/eventId", schemaPath: "#/properties/expectedEvents/items/properties/eventId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err103] : vErrors.push(err103), errors++;
              }
            }
            if (data46.relativePath !== void 0 && typeof data46.relativePath != "string") {
              let err104 = { instancePath: instancePath + "/expectedEvents/" + i3 + "/relativePath", schemaPath: "#/properties/expectedEvents/items/properties/relativePath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              vErrors === null ? vErrors = [err104] : vErrors.push(err104), errors++;
            }
            if (data46.contentHash !== void 0) {
              let data49 = data46.contentHash;
              if (typeof data49 == "string") {
                if (!pattern5.test(data49)) {
                  let err105 = { instancePath: instancePath + "/expectedEvents/" + i3 + "/contentHash", schemaPath: "#/properties/expectedEvents/items/properties/contentHash/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
                  vErrors === null ? vErrors = [err105] : vErrors.push(err105), errors++;
                }
              } else {
                let err106 = { instancePath: instancePath + "/expectedEvents/" + i3 + "/contentHash", schemaPath: "#/properties/expectedEvents/items/properties/contentHash/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err106] : vErrors.push(err106), errors++;
              }
            }
            if (data46.document !== void 0) {
              let data50 = data46.document;
              if (!(data50 && typeof data50 == "object" && !Array.isArray(data50))) {
                let err107 = { instancePath: instancePath + "/expectedEvents/" + i3 + "/document", schemaPath: "#/properties/expectedEvents/items/properties/document/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                vErrors === null ? vErrors = [err107] : vErrors.push(err107), errors++;
              }
            }
          } else {
            let err108 = { instancePath: instancePath + "/expectedEvents/" + i3, schemaPath: "#/properties/expectedEvents/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            vErrors === null ? vErrors = [err108] : vErrors.push(err108), errors++;
          }
        }
      } else {
        let err109 = { instancePath: instancePath + "/expectedEvents", schemaPath: "#/properties/expectedEvents/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err109] : vErrors.push(err109), errors++;
      }
    }
    if (data.appliedAt !== void 0) {
      let data51 = data.appliedAt;
      if (typeof data51 != "string" && data51 !== null) {
        let err110 = { instancePath: instancePath + "/appliedAt", schemaPath: "#/properties/appliedAt/type", keyword: "type", params: { type: schema14.properties.appliedAt.type }, message: "must be string,null" };
        vErrors === null ? vErrors = [err110] : vErrors.push(err110), errors++;
      }
    }
    if (data.conflict !== void 0) {
      let data52 = data.conflict;
      if (!(data52 && typeof data52 == "object" && !Array.isArray(data52)) && data52 !== null) {
        let err111 = { instancePath: instancePath + "/conflict", schemaPath: "#/properties/conflict/type", keyword: "type", params: { type: schema14.properties.conflict.type }, message: "must be object,null" };
        vErrors === null ? vErrors = [err111] : vErrors.push(err111), errors++;
      }
    }
    if (data.history !== void 0) {
      let data53 = data.history;
      if (Array.isArray(data53)) {
        let len4 = data53.length;
        for (let i4 = 0; i4 < len4; i4++) {
          let data54 = data53[i4];
          if (data54 && typeof data54 == "object" && !Array.isArray(data54)) {
            if (data54.at === void 0) {
              let err112 = { instancePath: instancePath + "/history/" + i4, schemaPath: "#/properties/history/items/required", keyword: "required", params: { missingProperty: "at" }, message: "must have required property 'at'" };
              vErrors === null ? vErrors = [err112] : vErrors.push(err112), errors++;
            }
            if (data54.to === void 0) {
              let err113 = { instancePath: instancePath + "/history/" + i4, schemaPath: "#/properties/history/items/required", keyword: "required", params: { missingProperty: "to" }, message: "must have required property 'to'" };
              vErrors === null ? vErrors = [err113] : vErrors.push(err113), errors++;
            }
            if (data54.actor === void 0) {
              let err114 = { instancePath: instancePath + "/history/" + i4, schemaPath: "#/properties/history/items/required", keyword: "required", params: { missingProperty: "actor" }, message: "must have required property 'actor'" };
              vErrors === null ? vErrors = [err114] : vErrors.push(err114), errors++;
            }
            for (let key6 in data54)
              if (!(key6 === "at" || key6 === "from" || key6 === "to" || key6 === "actor" || key6 === "reason")) {
                let err115 = { instancePath: instancePath + "/history/" + i4, schemaPath: "#/properties/history/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key6 }, message: "must NOT have additional properties" };
                vErrors === null ? vErrors = [err115] : vErrors.push(err115), errors++;
              }
            if (data54.at !== void 0 && typeof data54.at != "string") {
              let err116 = { instancePath: instancePath + "/history/" + i4 + "/at", schemaPath: "#/properties/history/items/properties/at/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              vErrors === null ? vErrors = [err116] : vErrors.push(err116), errors++;
            }
            if (data54.from !== void 0) {
              let data56 = data54.from;
              if (typeof data56 != "string" && data56 !== null) {
                let err117 = { instancePath: instancePath + "/history/" + i4 + "/from", schemaPath: "#/properties/history/items/properties/from/type", keyword: "type", params: { type: schema14.properties.history.items.properties.from.type }, message: "must be string,null" };
                vErrors === null ? vErrors = [err117] : vErrors.push(err117), errors++;
              }
            }
            if (data54.to !== void 0 && typeof data54.to != "string") {
              let err118 = { instancePath: instancePath + "/history/" + i4 + "/to", schemaPath: "#/properties/history/items/properties/to/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              vErrors === null ? vErrors = [err118] : vErrors.push(err118), errors++;
            }
            if (data54.actor !== void 0 && typeof data54.actor != "string") {
              let err119 = { instancePath: instancePath + "/history/" + i4 + "/actor", schemaPath: "#/properties/history/items/properties/actor/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              vErrors === null ? vErrors = [err119] : vErrors.push(err119), errors++;
            }
            if (data54.reason !== void 0) {
              let data59 = data54.reason;
              if (typeof data59 != "string" && data59 !== null) {
                let err120 = { instancePath: instancePath + "/history/" + i4 + "/reason", schemaPath: "#/properties/history/items/properties/reason/type", keyword: "type", params: { type: schema14.properties.history.items.properties.reason.type }, message: "must be string,null" };
                vErrors === null ? vErrors = [err120] : vErrors.push(err120), errors++;
              }
            }
          } else {
            let err121 = { instancePath: instancePath + "/history/" + i4, schemaPath: "#/properties/history/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            vErrors === null ? vErrors = [err121] : vErrors.push(err121), errors++;
          }
        }
      } else {
        let err122 = { instancePath: instancePath + "/history", schemaPath: "#/properties/history/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err122] : vErrors.push(err122), errors++;
      }
    }
  } else {
    let err123 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err123] : vErrors.push(err123), errors++;
  }
  return validate13.errors = vErrors, errors === 0;
}
var validate_plugin_lock = validate14;
function validate14(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null, errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.schemaVersion === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schemaVersion" }, message: "must have required property 'schemaVersion'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.pluginVersion === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "pluginVersion" }, message: "must have required property 'pluginVersion'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.templatePackFingerprint === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "templatePackFingerprint" }, message: "must have required property 'templatePackFingerprint'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "schemaVersion" || key0 === "pluginVersion" || key0 === "templatePackFingerprint")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.schemaVersion !== void 0 && data.schemaVersion !== 1) {
      let err4 = { instancePath: instancePath + "/schemaVersion", schemaPath: "#/properties/schemaVersion/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.pluginVersion !== void 0) {
      let data1 = data.pluginVersion;
      if (typeof data1 == "string") {
        if (func2(data1) < 1) {
          let err5 = { instancePath: instancePath + "/pluginVersion", schemaPath: "#/properties/pluginVersion/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
        }
      } else {
        let err6 = { instancePath: instancePath + "/pluginVersion", schemaPath: "#/properties/pluginVersion/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    }
    if (data.templatePackFingerprint !== void 0) {
      let data2 = data.templatePackFingerprint;
      if (typeof data2 == "string") {
        if (!pattern0.test(data2)) {
          let err7 = { instancePath: instancePath + "/templatePackFingerprint", schemaPath: "#/properties/templatePackFingerprint/pattern", keyword: "pattern", params: { pattern: "^sha256:[0-9a-f]{64}$" }, message: 'must match pattern "^sha256:[0-9a-f]{64}$"' };
          vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
        }
      } else {
        let err8 = { instancePath: instancePath + "/templatePackFingerprint", schemaPath: "#/properties/templatePackFingerprint/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
  } else {
    let err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
  }
  return validate14.errors = vErrors, errors === 0;
}
var validate_result = validate15;
function validate15(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null, errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.operationId === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operationId" }, message: "must have required property 'operationId'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.files === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "files" }, message: "must have required property 'files'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "operationId" || key0 === "files")) {
        let err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
      }
    if (data.operationId !== void 0) {
      let data0 = data.operationId;
      if (typeof data0 == "string") {
        if (!pattern1.test(data0)) {
          let err3 = { instancePath: instancePath + "/operationId", schemaPath: "#/properties/operationId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, message: 'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"' };
          vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
        }
      } else {
        let err4 = { instancePath: instancePath + "/operationId", schemaPath: "#/properties/operationId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
      }
    }
    if (data.files !== void 0) {
      let data1 = data.files;
      if (Array.isArray(data1)) {
        let len0 = data1.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data2 = data1[i0];
          if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
            if (data2.target === void 0) {
              let err5 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/required", keyword: "required", params: { missingProperty: "target" }, message: "must have required property 'target'" };
              vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
            }
            if (data2.contentHash === void 0) {
              let err6 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/required", keyword: "required", params: { missingProperty: "contentHash" }, message: "must have required property 'contentHash'" };
              vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
            }
            for (let key1 in data2)
              if (!(key1 === "target" || key1 === "contentHash")) {
                let err7 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
              }
            if (data2.target !== void 0 && typeof data2.target != "string") {
              let err8 = { instancePath: instancePath + "/files/" + i0 + "/target", schemaPath: "#/properties/files/items/properties/target/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
            }
            if (data2.contentHash !== void 0) {
              let data4 = data2.contentHash;
              if (typeof data4 == "string") {
                if (!pattern5.test(data4)) {
                  let err9 = { instancePath: instancePath + "/files/" + i0 + "/contentHash", schemaPath: "#/properties/files/items/properties/contentHash/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
                  vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
                }
              } else {
                let err10 = { instancePath: instancePath + "/files/" + i0 + "/contentHash", schemaPath: "#/properties/files/items/properties/contentHash/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
              }
            }
          } else {
            let err11 = { instancePath: instancePath + "/files/" + i0, schemaPath: "#/properties/files/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
          }
        }
      } else {
        let err12 = { instancePath: instancePath + "/files", schemaPath: "#/properties/files/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
  } else {
    let err13 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
  }
  return validate15.errors = vErrors, errors === 0;
}
var validate_scope = validate16, schema17 = { $id: "https://shipping-mode.dev/schemas/scope.schema.json", type: "object", additionalProperties: !1, required: ["schemaVersion", "id", "key", "label", "kind", "path"], properties: { schemaVersion: { const: 1 }, id: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, key: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" }, label: { type: "string", minLength: 1 }, kind: { enum: ["code", "non_code"] }, path: { type: "string", minLength: 1 }, owner: { type: ["string", "null"] }, commands: { $ref: "#/$defs/commands" } }, $defs: { uuid: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, sourceRefs: { type: "array", items: { $ref: "#/$defs/uuid" }, minItems: 1, uniqueItems: !0 }, confidence: { enum: ["low", "medium", "high"] }, alternative: { type: "object", additionalProperties: !1, required: ["command", "sourceRefs", "sourceFingerprintAtSelection", "confidence", "requiresEnvironment", "requiresSecrets"], properties: { command: { type: "string", minLength: 1 }, sourceRefs: { $ref: "#/$defs/sourceRefs" }, sourceFingerprintAtSelection: { type: "object", additionalProperties: { type: "string", pattern: "^[0-9a-f]{64}$" } }, confidence: { $ref: "#/$defs/confidence" }, requiresEnvironment: { type: "boolean" }, requiresSecrets: { type: "boolean" } } }, commandEntry: { oneOf: [{ type: "object", additionalProperties: !1, required: ["command", "method", "declaredBy", "declaredAt", "declaredOperationId", "requiresEnvironment", "requiresSecrets", "alternatives"], properties: { command: { type: "string", minLength: 1 }, method: { const: "declared" }, declaredBy: { type: "string", minLength: 1 }, declaredAt: { type: "string", minLength: 1 }, declaredOperationId: { $ref: "#/$defs/uuid" }, requiresEnvironment: { type: "boolean" }, requiresSecrets: { type: "boolean" }, alternatives: { type: "array", maxItems: 0 } } }, { type: "object", additionalProperties: !1, required: ["command", "method", "confidence", "sourceRefs", "sourceFingerprintAtSelection", "requiresEnvironment", "requiresSecrets", "alternatives"], properties: { command: { type: "string", minLength: 1 }, method: { enum: ["inferred", "reviewed"] }, confidence: { $ref: "#/$defs/confidence" }, sourceRefs: { $ref: "#/$defs/sourceRefs" }, sourceFingerprintAtSelection: { type: "object", additionalProperties: { type: "string", pattern: "^[0-9a-f]{64}$" } }, requiresEnvironment: { type: "boolean" }, requiresSecrets: { type: "boolean" }, alternatives: { type: "array", items: { $ref: "#/$defs/alternative" } } } }] }, commands: { type: "object", additionalProperties: !1, properties: { build: { $ref: "#/$defs/commandEntry" }, test: { $ref: "#/$defs/commandEntry" }, smoke: { $ref: "#/$defs/commandEntry" }, lint: { $ref: "#/$defs/commandEntry" }, verify: { $ref: "#/$defs/commandEntry" }, custom: { type: "object", additionalProperties: { $ref: "#/$defs/commandEntry" }, propertyNames: { pattern: "^[a-z][a-z0-9-]{0,63}$", not: { enum: ["build", "test", "smoke", "lint", "verify"] } } } } } } };
var schema19 = { oneOf: [{ type: "object", additionalProperties: !1, required: ["command", "method", "declaredBy", "declaredAt", "declaredOperationId", "requiresEnvironment", "requiresSecrets", "alternatives"], properties: { command: { type: "string", minLength: 1 }, method: { const: "declared" }, declaredBy: { type: "string", minLength: 1 }, declaredAt: { type: "string", minLength: 1 }, declaredOperationId: { $ref: "#/$defs/uuid" }, requiresEnvironment: { type: "boolean" }, requiresSecrets: { type: "boolean" }, alternatives: { type: "array", maxItems: 0 } } }, { type: "object", additionalProperties: !1, required: ["command", "method", "confidence", "sourceRefs", "sourceFingerprintAtSelection", "requiresEnvironment", "requiresSecrets", "alternatives"], properties: { command: { type: "string", minLength: 1 }, method: { enum: ["inferred", "reviewed"] }, confidence: { $ref: "#/$defs/confidence" }, sourceRefs: { $ref: "#/$defs/sourceRefs" }, sourceFingerprintAtSelection: { type: "object", additionalProperties: { type: "string", pattern: "^[0-9a-f]{64}$" } }, requiresEnvironment: { type: "boolean" }, requiresSecrets: { type: "boolean" }, alternatives: { type: "array", items: { $ref: "#/$defs/alternative" } } } }] };
var schema21 = { enum: ["low", "medium", "high"] };
var func0 = __deepEqual;
function validate19(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null, errors = 0;
  if (Array.isArray(data)) {
    if (data.length < 1) {
      let err0 = { instancePath, schemaPath: "#/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    let len0 = data.length;
    for (let i0 = 0; i0 < len0; i0++) {
      let data0 = data[i0];
      if (typeof data0 == "string") {
        if (!pattern1.test(data0)) {
          let err1 = { instancePath: instancePath + "/" + i0, schemaPath: "#/$defs/uuid/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, message: 'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"' };
          vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
        }
      } else {
        let err2 = { instancePath: instancePath + "/" + i0, schemaPath: "#/$defs/uuid/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
      }
    }
    let i1 = data.length, j0;
    if (i1 > 1) {
      outer0: for (; i1--; )
        for (j0 = i1; j0--; )
          if (func0(data[i1], data[j0])) {
            let err3 = { instancePath, schemaPath: "#/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
            vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
            break outer0;
          }
    }
  } else {
    let err4 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "array" }, message: "must be array" };
    vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
  }
  return validate19.errors = vErrors, errors === 0;
}
function validate21(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null, errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.command === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "command" }, message: "must have required property 'command'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.sourceRefs === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sourceRefs" }, message: "must have required property 'sourceRefs'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.sourceFingerprintAtSelection === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sourceFingerprintAtSelection" }, message: "must have required property 'sourceFingerprintAtSelection'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.confidence === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "confidence" }, message: "must have required property 'confidence'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.requiresEnvironment === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "requiresEnvironment" }, message: "must have required property 'requiresEnvironment'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.requiresSecrets === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "requiresSecrets" }, message: "must have required property 'requiresSecrets'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "command" || key0 === "sourceRefs" || key0 === "sourceFingerprintAtSelection" || key0 === "confidence" || key0 === "requiresEnvironment" || key0 === "requiresSecrets")) {
        let err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    if (data.command !== void 0) {
      let data0 = data.command;
      if (typeof data0 == "string") {
        if (func2(data0) < 1) {
          let err7 = { instancePath: instancePath + "/command", schemaPath: "#/properties/command/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
        }
      } else {
        let err8 = { instancePath: instancePath + "/command", schemaPath: "#/properties/command/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
    if (data.sourceRefs !== void 0 && (validate19(data.sourceRefs, { instancePath: instancePath + "/sourceRefs", parentData: data, parentDataProperty: "sourceRefs", rootData }) || (vErrors = vErrors === null ? validate19.errors : vErrors.concat(validate19.errors), errors = vErrors.length)), data.sourceFingerprintAtSelection !== void 0) {
      let data2 = data.sourceFingerprintAtSelection;
      if (data2 && typeof data2 == "object" && !Array.isArray(data2))
        for (let key1 in data2) {
          let data3 = data2[key1];
          if (typeof data3 == "string") {
            if (!pattern5.test(data3)) {
              let err9 = { instancePath: instancePath + "/sourceFingerprintAtSelection/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/sourceFingerprintAtSelection/additionalProperties/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
              vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
            }
          } else {
            let err10 = { instancePath: instancePath + "/sourceFingerprintAtSelection/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/sourceFingerprintAtSelection/additionalProperties/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
          }
        }
      else {
        let err11 = { instancePath: instancePath + "/sourceFingerprintAtSelection", schemaPath: "#/properties/sourceFingerprintAtSelection/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    }
    if (data.confidence !== void 0) {
      let data4 = data.confidence;
      if (!(data4 === "low" || data4 === "medium" || data4 === "high")) {
        let err12 = { instancePath: instancePath + "/confidence", schemaPath: "#/$defs/confidence/enum", keyword: "enum", params: { allowedValues: schema21.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
    if (data.requiresEnvironment !== void 0 && typeof data.requiresEnvironment != "boolean") {
      let err13 = { instancePath: instancePath + "/requiresEnvironment", schemaPath: "#/properties/requiresEnvironment/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
    }
    if (data.requiresSecrets !== void 0 && typeof data.requiresSecrets != "boolean") {
      let err14 = { instancePath: instancePath + "/requiresSecrets", schemaPath: "#/properties/requiresSecrets/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
    }
  } else {
    let err15 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
  }
  return validate21.errors = vErrors, errors === 0;
}
function validate18(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null, errors = 0, _errs0 = errors, valid0 = !1, passing0 = null, _errs1 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.command === void 0) {
      let err0 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "command" }, message: "must have required property 'command'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.method === void 0) {
      let err1 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.declaredBy === void 0) {
      let err2 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "declaredBy" }, message: "must have required property 'declaredBy'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.declaredAt === void 0) {
      let err3 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "declaredAt" }, message: "must have required property 'declaredAt'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.declaredOperationId === void 0) {
      let err4 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "declaredOperationId" }, message: "must have required property 'declaredOperationId'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.requiresEnvironment === void 0) {
      let err5 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "requiresEnvironment" }, message: "must have required property 'requiresEnvironment'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.requiresSecrets === void 0) {
      let err6 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "requiresSecrets" }, message: "must have required property 'requiresSecrets'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.alternatives === void 0) {
      let err7 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "alternatives" }, message: "must have required property 'alternatives'" };
      vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "command" || key0 === "method" || key0 === "declaredBy" || key0 === "declaredAt" || key0 === "declaredOperationId" || key0 === "requiresEnvironment" || key0 === "requiresSecrets" || key0 === "alternatives")) {
        let err8 = { instancePath, schemaPath: "#/oneOf/0/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    if (data.command !== void 0) {
      let data0 = data.command;
      if (typeof data0 == "string") {
        if (func2(data0) < 1) {
          let err9 = { instancePath: instancePath + "/command", schemaPath: "#/oneOf/0/properties/command/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
        }
      } else {
        let err10 = { instancePath: instancePath + "/command", schemaPath: "#/oneOf/0/properties/command/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
    }
    if (data.method !== void 0 && data.method !== "declared") {
      let err11 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/0/properties/method/const", keyword: "const", params: { allowedValue: "declared" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
    }
    if (data.declaredBy !== void 0) {
      let data2 = data.declaredBy;
      if (typeof data2 == "string") {
        if (func2(data2) < 1) {
          let err12 = { instancePath: instancePath + "/declaredBy", schemaPath: "#/oneOf/0/properties/declaredBy/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
        }
      } else {
        let err13 = { instancePath: instancePath + "/declaredBy", schemaPath: "#/oneOf/0/properties/declaredBy/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
    }
    if (data.declaredAt !== void 0) {
      let data3 = data.declaredAt;
      if (typeof data3 == "string") {
        if (func2(data3) < 1) {
          let err14 = { instancePath: instancePath + "/declaredAt", schemaPath: "#/oneOf/0/properties/declaredAt/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
        }
      } else {
        let err15 = { instancePath: instancePath + "/declaredAt", schemaPath: "#/oneOf/0/properties/declaredAt/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
      }
    }
    if (data.declaredOperationId !== void 0) {
      let data4 = data.declaredOperationId;
      if (typeof data4 == "string") {
        if (!pattern1.test(data4)) {
          let err16 = { instancePath: instancePath + "/declaredOperationId", schemaPath: "#/$defs/uuid/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, message: 'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"' };
          vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
        }
      } else {
        let err17 = { instancePath: instancePath + "/declaredOperationId", schemaPath: "#/$defs/uuid/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
      }
    }
    if (data.requiresEnvironment !== void 0 && typeof data.requiresEnvironment != "boolean") {
      let err18 = { instancePath: instancePath + "/requiresEnvironment", schemaPath: "#/oneOf/0/properties/requiresEnvironment/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
    }
    if (data.requiresSecrets !== void 0 && typeof data.requiresSecrets != "boolean") {
      let err19 = { instancePath: instancePath + "/requiresSecrets", schemaPath: "#/oneOf/0/properties/requiresSecrets/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
    }
    if (data.alternatives !== void 0) {
      let data7 = data.alternatives;
      if (Array.isArray(data7)) {
        if (data7.length > 0) {
          let err20 = { instancePath: instancePath + "/alternatives", schemaPath: "#/oneOf/0/properties/alternatives/maxItems", keyword: "maxItems", params: { limit: 0 }, message: "must NOT have more than 0 items" };
          vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
        }
      } else {
        let err21 = { instancePath: instancePath + "/alternatives", schemaPath: "#/oneOf/0/properties/alternatives/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
      }
    }
  } else {
    let err22 = { instancePath, schemaPath: "#/oneOf/0/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
  }
  var _valid0 = _errs1 === errors;
  _valid0 && (valid0 = !0, passing0 = 0);
  let _errs20 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.command === void 0) {
      let err23 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "command" }, message: "must have required property 'command'" };
      vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
    }
    if (data.method === void 0) {
      let err24 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
      vErrors === null ? vErrors = [err24] : vErrors.push(err24), errors++;
    }
    if (data.confidence === void 0) {
      let err25 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "confidence" }, message: "must have required property 'confidence'" };
      vErrors === null ? vErrors = [err25] : vErrors.push(err25), errors++;
    }
    if (data.sourceRefs === void 0) {
      let err26 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "sourceRefs" }, message: "must have required property 'sourceRefs'" };
      vErrors === null ? vErrors = [err26] : vErrors.push(err26), errors++;
    }
    if (data.sourceFingerprintAtSelection === void 0) {
      let err27 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "sourceFingerprintAtSelection" }, message: "must have required property 'sourceFingerprintAtSelection'" };
      vErrors === null ? vErrors = [err27] : vErrors.push(err27), errors++;
    }
    if (data.requiresEnvironment === void 0) {
      let err28 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "requiresEnvironment" }, message: "must have required property 'requiresEnvironment'" };
      vErrors === null ? vErrors = [err28] : vErrors.push(err28), errors++;
    }
    if (data.requiresSecrets === void 0) {
      let err29 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "requiresSecrets" }, message: "must have required property 'requiresSecrets'" };
      vErrors === null ? vErrors = [err29] : vErrors.push(err29), errors++;
    }
    if (data.alternatives === void 0) {
      let err30 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "alternatives" }, message: "must have required property 'alternatives'" };
      vErrors === null ? vErrors = [err30] : vErrors.push(err30), errors++;
    }
    for (let key1 in data)
      if (!(key1 === "command" || key1 === "method" || key1 === "confidence" || key1 === "sourceRefs" || key1 === "sourceFingerprintAtSelection" || key1 === "requiresEnvironment" || key1 === "requiresSecrets" || key1 === "alternatives")) {
        let err31 = { instancePath, schemaPath: "#/oneOf/1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err31] : vErrors.push(err31), errors++;
      }
    if (data.command !== void 0) {
      let data8 = data.command;
      if (typeof data8 == "string") {
        if (func2(data8) < 1) {
          let err32 = { instancePath: instancePath + "/command", schemaPath: "#/oneOf/1/properties/command/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err32] : vErrors.push(err32), errors++;
        }
      } else {
        let err33 = { instancePath: instancePath + "/command", schemaPath: "#/oneOf/1/properties/command/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err33] : vErrors.push(err33), errors++;
      }
    }
    if (data.method !== void 0) {
      let data9 = data.method;
      if (!(data9 === "inferred" || data9 === "reviewed")) {
        let err34 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/1/properties/method/enum", keyword: "enum", params: { allowedValues: schema19.oneOf[1].properties.method.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err34] : vErrors.push(err34), errors++;
      }
    }
    if (data.confidence !== void 0) {
      let data10 = data.confidence;
      if (!(data10 === "low" || data10 === "medium" || data10 === "high")) {
        let err35 = { instancePath: instancePath + "/confidence", schemaPath: "#/$defs/confidence/enum", keyword: "enum", params: { allowedValues: schema21.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err35] : vErrors.push(err35), errors++;
      }
    }
    if (data.sourceRefs !== void 0 && (validate19(data.sourceRefs, { instancePath: instancePath + "/sourceRefs", parentData: data, parentDataProperty: "sourceRefs", rootData }) || (vErrors = vErrors === null ? validate19.errors : vErrors.concat(validate19.errors), errors = vErrors.length)), data.sourceFingerprintAtSelection !== void 0) {
      let data12 = data.sourceFingerprintAtSelection;
      if (data12 && typeof data12 == "object" && !Array.isArray(data12))
        for (let key2 in data12) {
          let data13 = data12[key2];
          if (typeof data13 == "string") {
            if (!pattern5.test(data13)) {
              let err36 = { instancePath: instancePath + "/sourceFingerprintAtSelection/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/oneOf/1/properties/sourceFingerprintAtSelection/additionalProperties/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
              vErrors === null ? vErrors = [err36] : vErrors.push(err36), errors++;
            }
          } else {
            let err37 = { instancePath: instancePath + "/sourceFingerprintAtSelection/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/oneOf/1/properties/sourceFingerprintAtSelection/additionalProperties/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err37] : vErrors.push(err37), errors++;
          }
        }
      else {
        let err38 = { instancePath: instancePath + "/sourceFingerprintAtSelection", schemaPath: "#/oneOf/1/properties/sourceFingerprintAtSelection/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err38] : vErrors.push(err38), errors++;
      }
    }
    if (data.requiresEnvironment !== void 0 && typeof data.requiresEnvironment != "boolean") {
      let err39 = { instancePath: instancePath + "/requiresEnvironment", schemaPath: "#/oneOf/1/properties/requiresEnvironment/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      vErrors === null ? vErrors = [err39] : vErrors.push(err39), errors++;
    }
    if (data.requiresSecrets !== void 0 && typeof data.requiresSecrets != "boolean") {
      let err40 = { instancePath: instancePath + "/requiresSecrets", schemaPath: "#/oneOf/1/properties/requiresSecrets/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      vErrors === null ? vErrors = [err40] : vErrors.push(err40), errors++;
    }
    if (data.alternatives !== void 0) {
      let data16 = data.alternatives;
      if (Array.isArray(data16)) {
        let len0 = data16.length;
        for (let i0 = 0; i0 < len0; i0++)
          validate21(data16[i0], { instancePath: instancePath + "/alternatives/" + i0, parentData: data16, parentDataProperty: i0, rootData }) || (vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors), errors = vErrors.length);
      } else {
        let err41 = { instancePath: instancePath + "/alternatives", schemaPath: "#/oneOf/1/properties/alternatives/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err41] : vErrors.push(err41), errors++;
      }
    }
  } else {
    let err42 = { instancePath, schemaPath: "#/oneOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err42] : vErrors.push(err42), errors++;
  }
  var _valid0 = _errs20 === errors;
  if (_valid0 && valid0 ? (valid0 = !1, passing0 = [passing0, 1]) : _valid0 && (valid0 = !0, passing0 = 1), valid0)
    errors = _errs0, vErrors !== null && (_errs0 ? vErrors.length = _errs0 : vErrors = null);
  else {
    let err43 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    vErrors === null ? vErrors = [err43] : vErrors.push(err43), errors++;
  }
  return validate18.errors = vErrors, errors === 0;
}
var pattern33 = new RegExp("^[a-z][a-z0-9-]{0,63}$", "u");
function validate17(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null, errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    for (let key0 in data)
      if (!(key0 === "build" || key0 === "test" || key0 === "smoke" || key0 === "lint" || key0 === "verify" || key0 === "custom")) {
        let err0 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
      }
    if (data.build !== void 0 && (validate18(data.build, { instancePath: instancePath + "/build", parentData: data, parentDataProperty: "build", rootData }) || (vErrors = vErrors === null ? validate18.errors : vErrors.concat(validate18.errors), errors = vErrors.length)), data.test !== void 0 && (validate18(data.test, { instancePath: instancePath + "/test", parentData: data, parentDataProperty: "test", rootData }) || (vErrors = vErrors === null ? validate18.errors : vErrors.concat(validate18.errors), errors = vErrors.length)), data.smoke !== void 0 && (validate18(data.smoke, { instancePath: instancePath + "/smoke", parentData: data, parentDataProperty: "smoke", rootData }) || (vErrors = vErrors === null ? validate18.errors : vErrors.concat(validate18.errors), errors = vErrors.length)), data.lint !== void 0 && (validate18(data.lint, { instancePath: instancePath + "/lint", parentData: data, parentDataProperty: "lint", rootData }) || (vErrors = vErrors === null ? validate18.errors : vErrors.concat(validate18.errors), errors = vErrors.length)), data.verify !== void 0 && (validate18(data.verify, { instancePath: instancePath + "/verify", parentData: data, parentDataProperty: "verify", rootData }) || (vErrors = vErrors === null ? validate18.errors : vErrors.concat(validate18.errors), errors = vErrors.length)), data.custom !== void 0) {
      let data5 = data.custom;
      if (data5 && typeof data5 == "object" && !Array.isArray(data5)) {
        for (let key1 in data5) {
          let _errs9 = errors, _errs10 = errors, _errs11 = errors;
          if (!(key1 === "build" || key1 === "test" || key1 === "smoke" || key1 === "lint" || key1 === "verify")) {
            let err1 = {};
            vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
          }
          var valid2 = _errs11 === errors;
          if (valid2) {
            let err2 = { instancePath: instancePath + "/custom", schemaPath: "#/properties/custom/propertyNames/not", keyword: "not", params: {}, message: "must NOT be valid", propertyName: key1 };
            vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
          } else
            errors = _errs10, vErrors !== null && (_errs10 ? vErrors.length = _errs10 : vErrors = null);
          if (typeof key1 == "string" && !pattern33.test(key1)) {
            let err3 = { instancePath: instancePath + "/custom", schemaPath: "#/properties/custom/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9-]{0,63}$" }, message: 'must match pattern "^[a-z][a-z0-9-]{0,63}$"', propertyName: key1 };
            vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
          }
          var valid1 = _errs9 === errors;
          if (!valid1) {
            let err4 = { instancePath: instancePath + "/custom", schemaPath: "#/properties/custom/propertyNames", keyword: "propertyNames", params: { propertyName: key1 }, message: "property name must be valid" };
            vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
          }
        }
        for (let key2 in data5)
          validate18(data5[key2], { instancePath: instancePath + "/custom/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"), parentData: data5, parentDataProperty: key2, rootData }) || (vErrors = vErrors === null ? validate18.errors : vErrors.concat(validate18.errors), errors = vErrors.length);
      } else {
        let err5 = { instancePath: instancePath + "/custom", schemaPath: "#/properties/custom/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
  } else {
    let err6 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
  }
  return validate17.errors = vErrors, errors === 0;
}
function validate16(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null, errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.schemaVersion === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schemaVersion" }, message: "must have required property 'schemaVersion'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.id === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.key === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "key" }, message: "must have required property 'key'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.label === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "label" }, message: "must have required property 'label'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.kind === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.path === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "schemaVersion" || key0 === "id" || key0 === "key" || key0 === "label" || key0 === "kind" || key0 === "path" || key0 === "owner" || key0 === "commands")) {
        let err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    if (data.schemaVersion !== void 0 && data.schemaVersion !== 1) {
      let err7 = { instancePath: instancePath + "/schemaVersion", schemaPath: "#/properties/schemaVersion/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
    }
    if (data.id !== void 0) {
      let data1 = data.id;
      if (typeof data1 == "string") {
        if (!pattern1.test(data1)) {
          let err8 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, message: 'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"' };
          vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
        }
      } else {
        let err9 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
    if (data.key !== void 0) {
      let data2 = data.key;
      if (typeof data2 == "string") {
        if (!pattern7.test(data2)) {
          let err10 = { instancePath: instancePath + "/key", schemaPath: "#/properties/key/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" }, message: 'must match pattern "^[a-z0-9]+(-[a-z0-9]+)*$"' };
          vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
        }
      } else {
        let err11 = { instancePath: instancePath + "/key", schemaPath: "#/properties/key/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    }
    if (data.label !== void 0) {
      let data3 = data.label;
      if (typeof data3 == "string") {
        if (func2(data3) < 1) {
          let err12 = { instancePath: instancePath + "/label", schemaPath: "#/properties/label/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
        }
      } else {
        let err13 = { instancePath: instancePath + "/label", schemaPath: "#/properties/label/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
    }
    if (data.kind !== void 0) {
      let data4 = data.kind;
      if (!(data4 === "code" || data4 === "non_code")) {
        let err14 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema17.properties.kind.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
    }
    if (data.path !== void 0) {
      let data5 = data.path;
      if (typeof data5 == "string") {
        if (func2(data5) < 1) {
          let err15 = { instancePath: instancePath + "/path", schemaPath: "#/properties/path/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
        }
      } else {
        let err16 = { instancePath: instancePath + "/path", schemaPath: "#/properties/path/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
      }
    }
    if (data.owner !== void 0) {
      let data6 = data.owner;
      if (typeof data6 != "string" && data6 !== null) {
        let err17 = { instancePath: instancePath + "/owner", schemaPath: "#/properties/owner/type", keyword: "type", params: { type: schema17.properties.owner.type }, message: "must be string,null" };
        vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
      }
    }
    data.commands !== void 0 && (validate17(data.commands, { instancePath: instancePath + "/commands", parentData: data, parentDataProperty: "commands", rootData }) || (vErrors = vErrors === null ? validate17.errors : vErrors.concat(validate17.errors), errors = vErrors.length));
  } else {
    let err18 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
  }
  return validate16.errors = vErrors, errors === 0;
}
var validate_source = validate31, schema26 = { $id: "https://shipping-mode.dev/schemas/source.schema.json", type: "object", additionalProperties: !1, required: ["schemaVersion", "id", "path", "family", "kind", "role", "authority", "availability", "confirmedFingerprint", "confirmedContentHash", "provenance"], properties: { schemaVersion: { const: 1 }, id: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, path: { type: "string", minLength: 1 }, family: { enum: ["product-sources", "functional-sources", "technical-sources", "agent-repository-instructions", "project-module-manifests", "execution-commands", "quality-definitions", "local-runtime-environment", "public-data-contracts", "delivery-ci-deployment", "ownership", "decision-sources", "developer-guides", "engineering-standards", "repository-map", "evidence-contracts", "design-system", "prompt-sources", "custom-automation"] }, kind: { enum: ["product", "requirements", "architecture", "decision", "developer-guide", "engineering-standard", "agent-instructions", "repository-map", "api-contract", "data-contract", "database", "testing", "quality", "security", "observability", "design-system", "i18n", "runtime", "environment", "deployment", "ci", "ownership", "prompt", "generator", "evidence", "planning"] }, role: { enum: ["canonical", "decision", "derived", "operational", "evidence", "generated", "historical", "reference"] }, authority: { type: "object", additionalProperties: !1, required: ["standing", "force"], properties: { standing: { enum: ["contextual", "supporting", "authoritative"] }, force: { enum: ["unknown", "informational", "advisory", "normative"] } } }, availability: { enum: ["implemented", "partial", "planned", "deprecated", "historical", "mixed", "unknown"] }, confirmedFingerprint: { type: "string", pattern: "^[0-9a-f]{64}$" }, confirmedContentHash: { type: "string", pattern: "^[0-9a-f]{64}$" }, provenance: { type: "object", additionalProperties: !1, required: ["discoveredBy", "confirmedBy", "confirmedAt", "confirmedOperationId"], properties: { discoveredBy: { type: "string", minLength: 1 }, confirmedBy: { type: "string", minLength: 1 }, confirmedAt: { type: "string", minLength: 1 }, confirmedOperationId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" } } } } };
function validate31(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null, errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.schemaVersion === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schemaVersion" }, message: "must have required property 'schemaVersion'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.id === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.path === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.family === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "family" }, message: "must have required property 'family'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.kind === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.role === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "role" }, message: "must have required property 'role'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.authority === void 0) {
      let err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "authority" }, message: "must have required property 'authority'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.availability === void 0) {
      let err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "availability" }, message: "must have required property 'availability'" };
      vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
    }
    if (data.confirmedFingerprint === void 0) {
      let err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "confirmedFingerprint" }, message: "must have required property 'confirmedFingerprint'" };
      vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
    }
    if (data.confirmedContentHash === void 0) {
      let err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "confirmedContentHash" }, message: "must have required property 'confirmedContentHash'" };
      vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
    }
    if (data.provenance === void 0) {
      let err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "provenance" }, message: "must have required property 'provenance'" };
      vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
    }
    for (let key0 in data)
      if (!func9.call(schema26.properties, key0)) {
        let err11 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    if (data.schemaVersion !== void 0 && data.schemaVersion !== 1) {
      let err12 = { instancePath: instancePath + "/schemaVersion", schemaPath: "#/properties/schemaVersion/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
    }
    if (data.id !== void 0) {
      let data1 = data.id;
      if (typeof data1 == "string") {
        if (!pattern1.test(data1)) {
          let err13 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, message: 'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"' };
          vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
        }
      } else {
        let err14 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
    }
    if (data.path !== void 0) {
      let data2 = data.path;
      if (typeof data2 == "string") {
        if (func2(data2) < 1) {
          let err15 = { instancePath: instancePath + "/path", schemaPath: "#/properties/path/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
        }
      } else {
        let err16 = { instancePath: instancePath + "/path", schemaPath: "#/properties/path/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
      }
    }
    if (data.family !== void 0) {
      let data3 = data.family;
      if (!(data3 === "product-sources" || data3 === "functional-sources" || data3 === "technical-sources" || data3 === "agent-repository-instructions" || data3 === "project-module-manifests" || data3 === "execution-commands" || data3 === "quality-definitions" || data3 === "local-runtime-environment" || data3 === "public-data-contracts" || data3 === "delivery-ci-deployment" || data3 === "ownership" || data3 === "decision-sources" || data3 === "developer-guides" || data3 === "engineering-standards" || data3 === "repository-map" || data3 === "evidence-contracts" || data3 === "design-system" || data3 === "prompt-sources" || data3 === "custom-automation")) {
        let err17 = { instancePath: instancePath + "/family", schemaPath: "#/properties/family/enum", keyword: "enum", params: { allowedValues: schema26.properties.family.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
      }
    }
    if (data.kind !== void 0) {
      let data4 = data.kind;
      if (!(data4 === "product" || data4 === "requirements" || data4 === "architecture" || data4 === "decision" || data4 === "developer-guide" || data4 === "engineering-standard" || data4 === "agent-instructions" || data4 === "repository-map" || data4 === "api-contract" || data4 === "data-contract" || data4 === "database" || data4 === "testing" || data4 === "quality" || data4 === "security" || data4 === "observability" || data4 === "design-system" || data4 === "i18n" || data4 === "runtime" || data4 === "environment" || data4 === "deployment" || data4 === "ci" || data4 === "ownership" || data4 === "prompt" || data4 === "generator" || data4 === "evidence" || data4 === "planning")) {
        let err18 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema26.properties.kind.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
      }
    }
    if (data.role !== void 0) {
      let data5 = data.role;
      if (!(data5 === "canonical" || data5 === "decision" || data5 === "derived" || data5 === "operational" || data5 === "evidence" || data5 === "generated" || data5 === "historical" || data5 === "reference")) {
        let err19 = { instancePath: instancePath + "/role", schemaPath: "#/properties/role/enum", keyword: "enum", params: { allowedValues: schema26.properties.role.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
      }
    }
    if (data.authority !== void 0) {
      let data6 = data.authority;
      if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
        if (data6.standing === void 0) {
          let err20 = { instancePath: instancePath + "/authority", schemaPath: "#/properties/authority/required", keyword: "required", params: { missingProperty: "standing" }, message: "must have required property 'standing'" };
          vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
        }
        if (data6.force === void 0) {
          let err21 = { instancePath: instancePath + "/authority", schemaPath: "#/properties/authority/required", keyword: "required", params: { missingProperty: "force" }, message: "must have required property 'force'" };
          vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
        }
        for (let key1 in data6)
          if (!(key1 === "standing" || key1 === "force")) {
            let err22 = { instancePath: instancePath + "/authority", schemaPath: "#/properties/authority/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
          }
        if (data6.standing !== void 0) {
          let data7 = data6.standing;
          if (!(data7 === "contextual" || data7 === "supporting" || data7 === "authoritative")) {
            let err23 = { instancePath: instancePath + "/authority/standing", schemaPath: "#/properties/authority/properties/standing/enum", keyword: "enum", params: { allowedValues: schema26.properties.authority.properties.standing.enum }, message: "must be equal to one of the allowed values" };
            vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
          }
        }
        if (data6.force !== void 0) {
          let data8 = data6.force;
          if (!(data8 === "unknown" || data8 === "informational" || data8 === "advisory" || data8 === "normative")) {
            let err24 = { instancePath: instancePath + "/authority/force", schemaPath: "#/properties/authority/properties/force/enum", keyword: "enum", params: { allowedValues: schema26.properties.authority.properties.force.enum }, message: "must be equal to one of the allowed values" };
            vErrors === null ? vErrors = [err24] : vErrors.push(err24), errors++;
          }
        }
      } else {
        let err25 = { instancePath: instancePath + "/authority", schemaPath: "#/properties/authority/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err25] : vErrors.push(err25), errors++;
      }
    }
    if (data.availability !== void 0) {
      let data9 = data.availability;
      if (!(data9 === "implemented" || data9 === "partial" || data9 === "planned" || data9 === "deprecated" || data9 === "historical" || data9 === "mixed" || data9 === "unknown")) {
        let err26 = { instancePath: instancePath + "/availability", schemaPath: "#/properties/availability/enum", keyword: "enum", params: { allowedValues: schema26.properties.availability.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err26] : vErrors.push(err26), errors++;
      }
    }
    if (data.confirmedFingerprint !== void 0) {
      let data10 = data.confirmedFingerprint;
      if (typeof data10 == "string") {
        if (!pattern5.test(data10)) {
          let err27 = { instancePath: instancePath + "/confirmedFingerprint", schemaPath: "#/properties/confirmedFingerprint/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
          vErrors === null ? vErrors = [err27] : vErrors.push(err27), errors++;
        }
      } else {
        let err28 = { instancePath: instancePath + "/confirmedFingerprint", schemaPath: "#/properties/confirmedFingerprint/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err28] : vErrors.push(err28), errors++;
      }
    }
    if (data.confirmedContentHash !== void 0) {
      let data11 = data.confirmedContentHash;
      if (typeof data11 == "string") {
        if (!pattern5.test(data11)) {
          let err29 = { instancePath: instancePath + "/confirmedContentHash", schemaPath: "#/properties/confirmedContentHash/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
          vErrors === null ? vErrors = [err29] : vErrors.push(err29), errors++;
        }
      } else {
        let err30 = { instancePath: instancePath + "/confirmedContentHash", schemaPath: "#/properties/confirmedContentHash/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err30] : vErrors.push(err30), errors++;
      }
    }
    if (data.provenance !== void 0) {
      let data12 = data.provenance;
      if (data12 && typeof data12 == "object" && !Array.isArray(data12)) {
        if (data12.discoveredBy === void 0) {
          let err31 = { instancePath: instancePath + "/provenance", schemaPath: "#/properties/provenance/required", keyword: "required", params: { missingProperty: "discoveredBy" }, message: "must have required property 'discoveredBy'" };
          vErrors === null ? vErrors = [err31] : vErrors.push(err31), errors++;
        }
        if (data12.confirmedBy === void 0) {
          let err32 = { instancePath: instancePath + "/provenance", schemaPath: "#/properties/provenance/required", keyword: "required", params: { missingProperty: "confirmedBy" }, message: "must have required property 'confirmedBy'" };
          vErrors === null ? vErrors = [err32] : vErrors.push(err32), errors++;
        }
        if (data12.confirmedAt === void 0) {
          let err33 = { instancePath: instancePath + "/provenance", schemaPath: "#/properties/provenance/required", keyword: "required", params: { missingProperty: "confirmedAt" }, message: "must have required property 'confirmedAt'" };
          vErrors === null ? vErrors = [err33] : vErrors.push(err33), errors++;
        }
        if (data12.confirmedOperationId === void 0) {
          let err34 = { instancePath: instancePath + "/provenance", schemaPath: "#/properties/provenance/required", keyword: "required", params: { missingProperty: "confirmedOperationId" }, message: "must have required property 'confirmedOperationId'" };
          vErrors === null ? vErrors = [err34] : vErrors.push(err34), errors++;
        }
        for (let key2 in data12)
          if (!(key2 === "discoveredBy" || key2 === "confirmedBy" || key2 === "confirmedAt" || key2 === "confirmedOperationId")) {
            let err35 = { instancePath: instancePath + "/provenance", schemaPath: "#/properties/provenance/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err35] : vErrors.push(err35), errors++;
          }
        if (data12.discoveredBy !== void 0) {
          let data13 = data12.discoveredBy;
          if (typeof data13 == "string") {
            if (func2(data13) < 1) {
              let err36 = { instancePath: instancePath + "/provenance/discoveredBy", schemaPath: "#/properties/provenance/properties/discoveredBy/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err36] : vErrors.push(err36), errors++;
            }
          } else {
            let err37 = { instancePath: instancePath + "/provenance/discoveredBy", schemaPath: "#/properties/provenance/properties/discoveredBy/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err37] : vErrors.push(err37), errors++;
          }
        }
        if (data12.confirmedBy !== void 0) {
          let data14 = data12.confirmedBy;
          if (typeof data14 == "string") {
            if (func2(data14) < 1) {
              let err38 = { instancePath: instancePath + "/provenance/confirmedBy", schemaPath: "#/properties/provenance/properties/confirmedBy/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err38] : vErrors.push(err38), errors++;
            }
          } else {
            let err39 = { instancePath: instancePath + "/provenance/confirmedBy", schemaPath: "#/properties/provenance/properties/confirmedBy/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err39] : vErrors.push(err39), errors++;
          }
        }
        if (data12.confirmedAt !== void 0) {
          let data15 = data12.confirmedAt;
          if (typeof data15 == "string") {
            if (func2(data15) < 1) {
              let err40 = { instancePath: instancePath + "/provenance/confirmedAt", schemaPath: "#/properties/provenance/properties/confirmedAt/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err40] : vErrors.push(err40), errors++;
            }
          } else {
            let err41 = { instancePath: instancePath + "/provenance/confirmedAt", schemaPath: "#/properties/provenance/properties/confirmedAt/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err41] : vErrors.push(err41), errors++;
          }
        }
        if (data12.confirmedOperationId !== void 0) {
          let data16 = data12.confirmedOperationId;
          if (typeof data16 == "string") {
            if (!pattern1.test(data16)) {
              let err42 = { instancePath: instancePath + "/provenance/confirmedOperationId", schemaPath: "#/properties/provenance/properties/confirmedOperationId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }, message: 'must match pattern "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"' };
              vErrors === null ? vErrors = [err42] : vErrors.push(err42), errors++;
            }
          } else {
            let err43 = { instancePath: instancePath + "/provenance/confirmedOperationId", schemaPath: "#/properties/provenance/properties/confirmedOperationId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err43] : vErrors.push(err43), errors++;
          }
        }
      } else {
        let err44 = { instancePath: instancePath + "/provenance", schemaPath: "#/properties/provenance/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err44] : vErrors.push(err44), errors++;
      }
    }
  } else {
    let err45 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err45] : vErrors.push(err45), errors++;
  }
  return validate31.errors = vErrors, errors === 0;
}

// runtime/src/lib/schema.mjs
var exportNameByPublicName = {
  config: "validate_config",
  "plugin-lock": "validate_plugin_lock",
  scope: "validate_scope",
  source: "validate_source",
  "change-set": "validate_change_set",
  operation: "validate_operation",
  event: "validate_event",
  result: "validate_result"
};
function validate(schemaName, data) {
  let exportName = exportNameByPublicName[schemaName];
  if (!exportName) throw new Error(`unknown schema: ${schemaName}`);
  let validateFn = validators_exports[exportName], valid = validateFn(data), errors = valid ? [] : (validateFn.errors || []).map((error) => ({
    path: error.instancePath || "",
    message: error.message || "invalid"
  }));
  return { valid, errors };
}

// runtime/src/lib/journal.mjs
var RecoveryRequiredError = class extends Error {
  constructor(message) {
    super(message), this.name = "RecoveryRequiredError";
  }
};
function serializeEvent(document) {
  return `${JSON.stringify(canonicalize(document), null, 2)}
`;
}
function buildExpectedEvent({ eventId, type, aggregate, actor, operationId, idempotencyKey, payload, inputHash = null, outputHash = null, occurredAt = (/* @__PURE__ */ new Date()).toISOString(), schemaVersion = 1 }) {
  let document = {
    eventId,
    schemaVersion,
    type,
    aggregate,
    occurredAt,
    actor,
    operationId,
    idempotencyKey,
    payload,
    inputHash,
    outputHash
  }, serialized = serializeEvent(document), yyyy = occurredAt.slice(0, 4), mm = occurredAt.slice(5, 7);
  return {
    eventId,
    relativePath: `${yyyy}/${mm}/${eventId}.json`,
    contentHash: contentHash(serialized),
    document
  };
}
function writeEventIdempotent(eventsRoot, expectedEvent) {
  let schemaResult = validate("event", expectedEvent.document);
  if (!schemaResult.valid)
    throw new Error(`event document is schema-invalid: ${schemaResult.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
  let planningRoot = path5.dirname(eventsRoot);
  ensureDirectoryTree(planningRoot, path5.basename(eventsRoot));
  let confinedPath = confineWritePath(eventsRoot, expectedEvent.relativePath), serialized = serializeEvent(expectedEvent.document);
  if (contentHash(serialized) !== expectedEvent.contentHash)
    throw new Error(`expectedEvent.contentHash does not match its own document for ${expectedEvent.relativePath}`);
  if (!fs5.existsSync(confinedPath))
    try {
      return createFileAtomic(eventsRoot, expectedEvent.relativePath, serialized), "CREATED";
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  let existingPath = confineWritePath(eventsRoot, expectedEvent.relativePath);
  if (contentHash(fs5.readFileSync(existingPath)) === expectedEvent.contentHash)
    return "ALREADY_APPLIED";
  throw new RecoveryRequiredError(`event file ${expectedEvent.relativePath} exists with unexpected content`);
}

// runtime/src/lib/recovery.mjs
function currentContentHash(planningRoot, relativePath) {
  let absolutePath = confineRuntimeWritePath(planningRoot, relativePath);
  return fs6.existsSync(absolutePath) ? contentHash(fs6.readFileSync(absolutePath)) : ABSENT;
}
function classify(entry, actualHash) {
  return actualHash === entry.stagedContentHash ? "APPLIED" : actualHash === entry.beforeContentHash ? "PENDING" : "DIVERGENT";
}
function markRecoveryRequired(operationsRoot, operationId, operation, conflict) {
  let detectedAt = (/* @__PURE__ */ new Date()).toISOString();
  writeOperation(operationsRoot, operationId, {
    ...operation,
    status: "RECOVERY_REQUIRED",
    conflict: { detectedAt, ...conflict },
    history: [...operation.history, { at: detectedAt, from: "APPLYING", to: "RECOVERY_REQUIRED", actor: "system:recovery", reason: conflict.reason }]
  });
}
function runRecovery({ operationsRoot, planningRoot, lock }) {
  if (!lock || typeof lock.token != "string")
    throw new Error("runRecovery requires an acquired workspace lock");
  if (!fs6.existsSync(operationsRoot)) return [];
  let outcomes = [], runtimeOperationsRelative = path6.join(".runtime", "operations");
  for (let operationId of fs6.readdirSync(operationsRoot)) {
    if (!isUuidV7(operationId)) continue;
    let operation;
    try {
      operation = readOperation(operationsRoot, operationId);
    } catch {
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }
    if (!validate("operation", operation).valid || operation.id !== operationId) {
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }
    if (operation.status === "RECOVERY_REQUIRED") {
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }
    if (operation.status === "APPLIED") {
      let residueRelative = path6.join(runtimeOperationsRelative, operationId), residue2 = confineRuntimeWritePath(planningRoot, residueRelative);
      fs6.existsSync(residue2) ? (fs6.rmSync(residue2, { recursive: !0, force: !0 }), outcomes.push({ operationId, outcome: "CLEANED_UP" })) : outcomes.push({ operationId, outcome: "NOT_APPLICABLE" });
      continue;
    }
    if (operation.status !== "APPLYING") {
      outcomes.push({ operationId, outcome: "NOT_APPLICABLE" });
      continue;
    }
    let divergent = !1;
    for (let entry of operation.filePlan || []) {
      let actualHash = currentContentHash(planningRoot, entry.target), classification = classify(entry, actualHash);
      if (classification === "DIVERGENT") {
        markRecoveryRequired(operationsRoot, operationId, operation, {
          file: entry.target,
          expectedBeforeContentHash: entry.beforeContentHash,
          expectedStagedContentHash: entry.stagedContentHash,
          actualContentHash: actualHash,
          reason: "canonical file diverged from both before and staged expectations"
        }), divergent = !0;
        break;
      }
      if (classification === "PENDING") {
        let stagedRelative = path6.join(runtimeOperationsRelative, operationId, "staged", entry.stagedRelativePath), stagedPath;
        try {
          stagedPath = confineRuntimeWritePath(planningRoot, stagedRelative);
        } catch (error) {
          markRecoveryRequired(operationsRoot, operationId, operation, {
            file: entry.target,
            expectedBeforeContentHash: entry.beforeContentHash,
            expectedStagedContentHash: entry.stagedContentHash,
            actualContentHash: actualHash,
            reason: `staged path is not trusted: ${error.message}`
          }), divergent = !0;
          break;
        }
        if (!fs6.existsSync(stagedPath) || contentHash(fs6.readFileSync(stagedPath)) !== entry.stagedContentHash) {
          markRecoveryRequired(operationsRoot, operationId, operation, {
            file: entry.target,
            expectedBeforeContentHash: entry.beforeContentHash,
            expectedStagedContentHash: entry.stagedContentHash,
            actualContentHash: actualHash,
            reason: "staged file missing or altered; cannot safely redo the write"
          }), divergent = !0;
          break;
        }
        renameWithinRoot(planningRoot, stagedRelative, entry.target);
      }
    }
    if (divergent) {
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }
    let expectedResult = {
      operationId,
      files: (operation.filePlan || []).map((entry) => ({ target: entry.target, contentHash: entry.stagedContentHash }))
    }, resultPath = confineWritePath(operationsRoot, path6.join(operationId, "result.json"));
    if (fs6.existsSync(resultPath)) {
      let existingResult = null;
      try {
        existingResult = readResult(operationsRoot, operationId);
      } catch {
        existingResult = null;
      }
      if (!(existingResult !== null && validate("result", existingResult).valid) || JSON.stringify(existingResult) !== JSON.stringify(expectedResult)) {
        markRecoveryRequired(operationsRoot, operationId, operation, {
          file: "result.json",
          reason: "result.json exists but does not match the outcome expected from filePlan, or is schema-invalid"
        }), outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
        continue;
      }
    } else
      writeResult(operationsRoot, operationId, expectedResult);
    let eventDivergent = !1;
    for (let expectedEvent of operation.expectedEvents || []) {
      if (!(expectedEvent.eventId === expectedEvent.document.eventId && expectedEvent.document.operationId === operation.id && expectedEvent.relativePath.endsWith(`/${expectedEvent.eventId}.json`))) {
        markRecoveryRequired(operationsRoot, operationId, operation, {
          file: expectedEvent.relativePath,
          reason: "expectedEvent is internally inconsistent (eventId/operationId/relativePath mismatch)"
        }), eventDivergent = !0;
        break;
      }
      try {
        writeEventIdempotent(path6.join(planningRoot, "events"), expectedEvent);
      } catch (error) {
        if (error instanceof RecoveryRequiredError) {
          markRecoveryRequired(operationsRoot, operationId, operation, {
            file: expectedEvent.relativePath,
            expectedStagedContentHash: expectedEvent.contentHash,
            reason: "event file exists with unexpected content"
          }), eventDivergent = !0;
          break;
        }
        throw error;
      }
    }
    if (eventDivergent) {
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }
    let appliedAt = (/* @__PURE__ */ new Date()).toISOString(), current = readOperation(operationsRoot, operationId);
    writeOperation(operationsRoot, operationId, {
      ...current,
      status: "APPLIED",
      appliedAt,
      history: [...current.history, { at: appliedAt, from: "APPLYING", to: "APPLIED", actor: "system:recovery", reason: null }]
    });
    let residue = confineRuntimeWritePath(planningRoot, path6.join(runtimeOperationsRelative, operationId));
    fs6.rmSync(residue, { recursive: !0, force: !0 }), outcomes.push({ operationId, outcome: "COMPLETED" });
  }
  return outcomes;
}

// runtime/src/lib/mutation.mjs
function withWorkspaceMutation({ planningRoot, operationsRoot, operationId = null }, callback) {
  assertTrustedRoots(planningRoot);
  let lock = acquireWorkspaceLock(planningRoot, operationId);
  try {
    let conflict = runRecovery({ operationsRoot, planningRoot, lock }).find((outcome) => outcome.outcome === "RECOVERY_REQUIRED");
    if (conflict)
      throw new RecoveryRequiredError(`operation ${conflict.operationId} requires manual recovery before any further mutation can proceed`);
    return callback();
  } finally {
    lock.release();
  }
}

// runtime/src/lib/faultInjection.mjs
var SimulatedCrashError = class extends Error {
}, activeCheckpoint = null, hardExitOnCheckpoint = !1;
function checkpoint(name) {
  if (activeCheckpoint === name) {
    let triggered = activeCheckpoint;
    throw activeCheckpoint = null, hardExitOnCheckpoint && process.exit(97), new SimulatedCrashError(triggered);
  }
}

// runtime/src/lib/changeset.mjs
function readFileState(planningRoot, relativePath) {
  let absolutePath = confineRuntimeWritePath(planningRoot, relativePath);
  if (!fs7.existsSync(absolutePath))
    return { revisionHash: ABSENT, contentHash: ABSENT };
  let bytes = fs7.readFileSync(absolutePath), isStructured = relativePath.endsWith(".yml") || relativePath.endsWith(".yaml") || relativePath.endsWith(".json"), structuredValue = isStructured ? relativePath.endsWith(".json") ? JSON.parse(bytes.toString("utf8")) : parseYaml(bytes.toString("utf8")) : null;
  return {
    revisionHash: isStructured ? revisionHash(structuredValue) : contentHash(bytes),
    contentHash: contentHash(bytes)
  };
}
function computePersistedChangeSetHash(changeSet) {
  let { hash, ...withoutHash } = changeSet;
  return revisionHash(withoutHash);
}
function eventTypeFor(kind) {
  return { "workspace.init": "workspace.initialized", "config.update": "config.updated", "scope.add": "scope.added" }[kind];
}
function propose({ operationsRoot, planningRoot, kind, target, payload, targetFiles, actor }) {
  return withWorkspaceMutation({ planningRoot, operationsRoot, operationId: null }, () => {
    let operationId = generateUuidV7();
    assertDistinctMutationTargets(planningRoot, targetFiles);
    let baseRevisions = {};
    for (let relativePath of targetFiles)
      baseRevisions[relativePath] = readFileState(planningRoot, relativePath);
    let changeSetWithoutHash = { schemaVersion: 1, operationId, kind, target, baseRevisions, payload }, hash = computePersistedChangeSetHash(changeSetWithoutHash);
    writeChangeSet(operationsRoot, operationId, { ...changeSetWithoutHash, hash });
    let reservedEvents = [{ eventId: generateUuidV7(), type: eventTypeFor(kind) }], proposedAt = (/* @__PURE__ */ new Date()).toISOString();
    return writeOperation(operationsRoot, operationId, {
      id: operationId,
      kind,
      status: "PROPOSED",
      proposedBy: actor,
      proposedAt,
      reservedEvents,
      validation: { validatedAt: null, changeSetHash: null, errors: [] },
      approval: { actor: null, approvedAt: null, changeSetHash: null, selfApproval: null },
      history: [{ at: proposedAt, from: null, to: "PROPOSED", actor, reason: null }]
    }), operationId;
  });
}
function schemaNameForRenderedPath(relativePath) {
  return relativePath === "config.yml" ? "config" : relativePath === "plugin.lock.yml" ? "plugin-lock" : /^scopes\/[^/]+\/scope\.yml$/.test(relativePath) ? "scope" : null;
}
function checkKindInvariants(changeSet) {
  let errors = [];
  if (changeSet.kind === "workspace.init")
    for (let relativePath of ["config.yml", "plugin.lock.yml", ".gitignore"]) {
      let entry = changeSet.baseRevisions[relativePath];
      (!entry || entry.revisionHash !== ABSENT || entry.contentHash !== ABSENT) && errors.push(`${relativePath} must be ABSENT for workspace.init; the workspace already appears initialized -- use config set to update it instead`);
    }
  if (changeSet.kind === "scope.add") {
    let scopePath = `scopes/${changeSet.payload.id}/scope.yml`, entry = changeSet.baseRevisions[scopePath];
    (!entry || entry.revisionHash !== ABSENT || entry.contentHash !== ABSENT) && errors.push(`${scopePath} must be ABSENT for a new scope.add, but baseRevisions recorded something else`);
  }
  return errors;
}
function revalidateChangeSet({ operationsRoot, planningRoot, operationId, render }) {
  let changeSet = readChangeSet(operationsRoot, operationId);
  if (changeSet.operationId !== operationId)
    return { ok: !1, status: "INVALID", errors: [`change-set.json operationId ${changeSet.operationId} does not match operation ${operationId}`], recomputedHash: null };
  let recomputedHash = computePersistedChangeSetHash(changeSet);
  if (recomputedHash !== changeSet.hash)
    return { ok: !1, status: "INVALID", errors: ["change-set.json hash does not match its own recomputed content; the file has been tampered with or corrupted"], recomputedHash };
  let changeSetResult = validate("change-set", changeSet);
  if (!changeSetResult.valid)
    return { ok: !1, status: "INVALID", errors: changeSetResult.errors.map((e) => `change-set${e.path}: ${e.message}`), recomputedHash };
  let invariantErrors = checkKindInvariants(changeSet);
  if (invariantErrors.length > 0)
    return { ok: !1, status: "INVALID", errors: invariantErrors, recomputedHash };
  let rendered;
  try {
    rendered = render(changeSet.payload), assertDistinctMutationTargets(planningRoot, [...rendered.keys()]);
  } catch (error) {
    return { ok: !1, status: "INVALID", errors: [error.message], recomputedHash };
  }
  let renderedPaths = new Set(rendered.keys()), baseRevisionPaths = new Set(Object.keys(changeSet.baseRevisions)), missingFromBaseRevisions = [...renderedPaths].filter((p) => !baseRevisionPaths.has(p)), extraInBaseRevisions = [...baseRevisionPaths].filter((p) => !renderedPaths.has(p));
  if (missingFromBaseRevisions.length > 0 || extraInBaseRevisions.length > 0)
    return {
      ok: !1,
      status: "INVALID",
      errors: [`baseRevisions must exactly match the rendered file set; missing=${JSON.stringify(missingFromBaseRevisions)} extra=${JSON.stringify(extraInBaseRevisions)}`],
      recomputedHash
    };
  for (let [relativePath, expected] of Object.entries(changeSet.baseRevisions)) {
    let actual = readFileState(planningRoot, relativePath);
    if (actual.revisionHash !== expected.revisionHash || actual.contentHash !== expected.contentHash)
      return { ok: !1, status: "STALE", errors: [`${relativePath} changed since propose`], recomputedHash };
  }
  let renderErrors = [];
  for (let [relativePath, content] of rendered) {
    let schemaName = schemaNameForRenderedPath(relativePath);
    if (!schemaName) continue;
    let value = parseYaml(content), result = validate(schemaName, value);
    if (!result.valid)
      for (let error of result.errors) renderErrors.push(`${relativePath}${error.path}: ${error.message}`);
  }
  return renderErrors.length > 0 ? { ok: !1, status: "INVALID", errors: renderErrors, recomputedHash } : { ok: !0, recomputedHash, changeSet, rendered };
}
function transitionToStale(operationsRoot, operationId, operation, reason) {
  let staleAt = (/* @__PURE__ */ new Date()).toISOString();
  throw writeOperation(operationsRoot, operationId, {
    ...operation,
    status: "STALE",
    history: [...operation.history, { at: staleAt, from: operation.status, to: "STALE", actor: "system:validator", reason }]
  }), new StaleError(reason);
}
function validateOperation({ operationsRoot, planningRoot, operationId, render }) {
  return withWorkspaceMutation({ planningRoot, operationsRoot, operationId }, () => {
    let operation = readOperation(operationsRoot, operationId);
    if (operation.status !== "PROPOSED")
      throw new StateError(`cannot validate operation in status ${operation.status}`);
    let result = revalidateChangeSet({ operationsRoot, planningRoot, operationId, render }), validatedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (!result.ok) {
      writeOperation(operationsRoot, operationId, {
        ...operation,
        status: result.status,
        validation: { validatedAt, changeSetHash: result.recomputedHash, errors: result.errors },
        history: [...operation.history, { at: validatedAt, from: operation.status, to: result.status, actor: "system:validator", reason: result.errors[0] }]
      });
      return;
    }
    writeOperation(operationsRoot, operationId, {
      ...operation,
      status: "VALIDATED",
      validation: { validatedAt, changeSetHash: result.recomputedHash, errors: [] },
      history: [...operation.history, { at: validatedAt, from: operation.status, to: "VALIDATED", actor: "system:validator", reason: null }]
    });
  });
}
function approveOperation({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval = !1 }) {
  return withWorkspaceMutation({ planningRoot, operationsRoot, operationId }, () => {
    let operation = readOperation(operationsRoot, operationId);
    if (operation.status !== "VALIDATED")
      throw new StateError(`cannot approve operation in status ${operation.status}`);
    let changeSet = readChangeSet(operationsRoot, operationId), recomputedHash = computePersistedChangeSetHash(changeSet);
    (recomputedHash !== changeSet.hash || recomputedHash !== operation.validation.changeSetHash) && transitionToStale(operationsRoot, operationId, operation, "change-set.json changed since validate; propose and validate again before approving");
    let selfApproval = actor === operation.proposedBy;
    if (selfApproval && !allowSelfApproval)
      throw new StateError("self-approval requires allowSelfApproval to be explicitly set");
    let approvedAt = (/* @__PURE__ */ new Date()).toISOString();
    writeOperation(operationsRoot, operationId, {
      ...operation,
      status: "APPROVED",
      approval: { actor, approvedAt, changeSetHash: recomputedHash, selfApproval },
      history: [...operation.history, { at: approvedAt, from: "VALIDATED", to: "APPROVED", actor, reason: selfApproval ? "self-approved" : null }]
    });
  });
}
function prepareApply({ operationsRoot, planningRoot, operationId, render, actor }) {
  let operation = readOperation(operationsRoot, operationId);
  if (operation.status !== "APPROVED")
    throw new StateError(`cannot apply operation in status ${operation.status}`);
  let changeSet = readChangeSet(operationsRoot, operationId), revalidation = revalidateChangeSet({ operationsRoot, planningRoot, operationId, render });
  revalidation.ok || transitionToStale(operationsRoot, operationId, operation, revalidation.errors[0]);
  let recomputedHash = revalidation.recomputedHash;
  (recomputedHash !== changeSet.hash || recomputedHash !== operation.validation.changeSetHash || recomputedHash !== operation.approval.changeSetHash) && transitionToStale(operationsRoot, operationId, operation, "changeSetHash no longer matches validate/approve; the change-set has drifted since approval");
  let rendered = revalidation.rendered, runtimeOperationRelative = path7.join(".runtime", "operations", operationId), stagingRelative = path7.join(runtimeOperationRelative, "staged"), beforeRelative = path7.join(runtimeOperationRelative, "before");
  ensureDirectoryTree(planningRoot, stagingRelative), ensureDirectoryTree(planningRoot, beforeRelative), assertDistinctMutationTargets(planningRoot, [...rendered.keys()]);
  let filePlan = [];
  for (let [relativePath, newContent] of rendered) {
    let before = changeSet.baseRevisions[relativePath];
    confineRuntimeWritePath(planningRoot, relativePath), before.contentHash !== ABSENT && copyFileAtomic(planningRoot, relativePath, path7.join(beforeRelative, relativePath)), filePlan.push({
      target: relativePath,
      stagedRelativePath: relativePath,
      expectedBefore: before.contentHash === ABSENT ? "ABSENT" : "PRESENT",
      beforeContentHash: before.contentHash,
      beforeRevisionHash: before.revisionHash,
      stagedContentHash: contentHash(newContent),
      stagedRevisionHash: relativePath.endsWith(".gitignore") ? contentHash(newContent) : revisionHash(parseYaml(newContent))
    });
  }
  checkpoint("AFTER_BEFORE");
  for (let [relativePath, newContent] of rendered)
    writeFileAtomic(planningRoot, path7.join(stagingRelative, relativePath), newContent);
  checkpoint("AFTER_STAGED");
  let expectedEvents = operation.expectedEvents?.length ? operation.expectedEvents.map((expectedEvent) => {
    let relationallyConsistent = expectedEvent.eventId === expectedEvent.document?.eventId && expectedEvent.document?.operationId === operation.id && expectedEvent.relativePath.endsWith(`/${expectedEvent.eventId}.json`), eventSchemaCheck = validate("event", expectedEvent.document);
    if (!relationallyConsistent || !eventSchemaCheck.valid)
      throw new StateError("persisted expectedEvents manifest is invalid or internally inconsistent");
    return expectedEvent;
  }) : operation.reservedEvents.map((reserved) => buildExpectedEvent({
    eventId: reserved.eventId,
    type: reserved.type,
    aggregate: { type: operation.kind.split(".")[0], id: operationId },
    actor,
    operationId,
    idempotencyKey: operationId,
    payload: changeSet.payload
  }));
  operation = readOperation(operationsRoot, operationId), writeOperation(operationsRoot, operationId, { ...operation, filePlan, expectedEvents }), checkpoint("AFTER_MANIFEST"), operation = readOperation(operationsRoot, operationId);
  let applyingAt = (/* @__PURE__ */ new Date()).toISOString();
  return writeOperation(operationsRoot, operationId, {
    ...operation,
    status: "APPLYING",
    history: [...operation.history, { at: applyingAt, from: "APPROVED", to: "APPLYING", actor, reason: null }]
  }), checkpoint("AFTER_APPLYING"), { filePlan, expectedEvents, stagingRelative, runtimeOperationRelative };
}
function applyOperation({ operationsRoot, planningRoot, operationId, render, actor }) {
  return withWorkspaceMutation({ planningRoot, operationsRoot, operationId }, () => {
    let operation = readOperation(operationsRoot, operationId);
    if (operation.status !== "APPROVED")
      throw new StateError(`cannot apply operation in status ${operation.status}`);
    let { filePlan, expectedEvents, stagingRelative, runtimeOperationRelative } = prepareApply({ operationsRoot, planningRoot, operationId, render, actor }), files = [];
    for (let [index, entry] of filePlan.entries())
      renameWithinRoot(planningRoot, path7.join(stagingRelative, entry.stagedRelativePath), entry.target), files.push({ target: entry.target, contentHash: entry.stagedContentHash }), index === 0 && checkpoint("AFTER_FIRST_RENAME");
    checkpoint("AFTER_ALL_RENAMES");
    let result = { operationId, files }, resultSchemaCheck = validate("result", result);
    if (!resultSchemaCheck.valid)
      throw new Error(`constructed result is schema-invalid: ${resultSchemaCheck.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
    writeResult(operationsRoot, operationId, result), checkpoint("AFTER_RESULT");
    let eventsRoot = path7.join(planningRoot, "events");
    for (let [index, expectedEvent] of expectedEvents.entries())
      writeEventIdempotent(eventsRoot, expectedEvent), index === 0 && checkpoint("AFTER_FIRST_EVENT");
    checkpoint("AFTER_ALL_EVENTS"), checkpoint("BEFORE_APPLIED");
    let appliedAt = (/* @__PURE__ */ new Date()).toISOString(), current = readOperation(operationsRoot, operationId);
    writeOperation(operationsRoot, operationId, {
      ...current,
      status: "APPLIED",
      appliedAt,
      history: [...current.history, { at: appliedAt, from: "APPLYING", to: "APPLIED", actor, reason: null }]
    });
    let residuePath = confineRuntimeWritePath(planningRoot, runtimeOperationRelative);
    return fs7.rmSync(residuePath, { recursive: !0, force: !0 }), { status: "APPLIED", files };
  });
}

// runtime/src/commands/proposalPreparation.mjs
var SUPPORTED_KINDS = /* @__PURE__ */ new Set(["workspace.init", "config.update", "scope.add"]);
function requireObjectPayload(rawPayload) {
  if (rawPayload === null || typeof rawPayload != "object" || Array.isArray(rawPayload))
    throw new UsageError("changeset payload must be a mapping/object");
  return rawPayload;
}
function prepareProposal(kind, rawPayload) {
  if (!SUPPORTED_KINDS.has(kind)) throw new UsageError(`unsupported changeset kind: ${kind}`);
  if (requireObjectPayload(rawPayload), kind === "workspace.init")
    return { payload: rawPayload, targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore"] };
  if (kind === "config.update")
    return { payload: rawPayload, targetFiles: ["config.yml"] };
  let payload = rawPayload.id ? rawPayload : { ...rawPayload, id: generateUuidV7() };
  return { payload, targetFiles: ["config.yml", `scopes/${payload.id}/scope.yml`] };
}

// runtime/src/generated/build-meta.mjs
var PLUGIN_VERSION = "1.0.0", TEMPLATE_PACK_FINGERPRINT = "sha256:b97c7bb4bac7e4ea70dfde510a536c90e6be0d38f1c9cdd242d2661ce9a570cc";

// runtime/src/commands/init.mjs
function runInit({ planningRoot, args }) {
  let operationsRoot = path8.join(planningRoot, "operations"), { payload, targetFiles } = prepareProposal("workspace.init", {
    name: args.name,
    baseBranch: args.baseBranch || null,
    vcs: args.vcs || "none",
    pluginVersion: PLUGIN_VERSION,
    templatePackFingerprint: TEMPLATE_PACK_FINGERPRINT
  });
  return { operationId: propose({ operationsRoot, planningRoot, kind: "workspace.init", target: {}, payload, targetFiles, actor: args.actor }) };
}
function runConfigSet({ planningRoot, args }) {
  let operationsRoot = path8.join(planningRoot, "operations"), { payload, targetFiles } = prepareProposal("config.update", { name: args.name });
  return { operationId: propose({ operationsRoot, planningRoot, kind: "config.update", target: {}, payload, targetFiles, actor: args.actor }) };
}
function runConfigScopeAdd({ planningRoot, args }) {
  let operationsRoot = path8.join(planningRoot, "operations"), { payload, targetFiles } = prepareProposal("scope.add", {
    key: args.key,
    label: args.label,
    kind: args.kind,
    path: args.path,
    owner: args.owner || null
  });
  return { operationId: propose({ operationsRoot, planningRoot, kind: "scope.add", target: { scopeId: payload.id }, payload, targetFiles, actor: args.actor }), scopeId: payload.id };
}

// runtime/src/commands/changesetCommand.mjs
import fs8 from "node:fs";
import path9 from "node:path";

// runtime/src/commands/renderers.mjs
function toKebabCase(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
}
function renderWorkspaceInit({ name, baseBranch = null, vcs, pluginVersion, templatePackFingerprint }) {
  let config = { schemaVersion: 1, name, baseBranch, vcs, scopeRefs: [] }, pluginLock = { schemaVersion: 1, pluginVersion, templatePackFingerprint };
  return /* @__PURE__ */ new Map([
    ["config.yml", stringifyYaml(config)],
    ["plugin.lock.yml", stringifyYaml(pluginLock)],
    [".gitignore", `.runtime/
`]
  ]);
}
function renderConfigUpdate({ name }, currentConfig) {
  let nextConfig = { ...currentConfig, name };
  return /* @__PURE__ */ new Map([["config.yml", stringifyYaml(nextConfig)]]);
}
function renderScopeAdd({ id, key, label, kind, path: scopePath, owner = null }, currentConfig, workspaceRoot) {
  confineScopePath(workspaceRoot, scopePath);
  let normalizedKey = toKebabCase(key);
  if (new Set((currentConfig.scopeRefs || []).map((ref) => ref.key.toLowerCase())).has(normalizedKey))
    throw new Error(`scope key already exists: ${normalizedKey}`);
  let nextConfig = {
    ...currentConfig,
    scopeRefs: [...currentConfig.scopeRefs || [], { id, key: normalizedKey }]
  }, scope = { schemaVersion: 1, id, key: normalizedKey, label, kind, path: scopePath, owner };
  return /* @__PURE__ */ new Map([
    ["config.yml", stringifyYaml(nextConfig)],
    [`scopes/${id}/scope.yml`, stringifyYaml(scope)]
  ]);
}

// runtime/src/commands/changesetCommand.mjs
function readCurrentConfig(planningRoot) {
  let configPath = confineRuntimeWritePath(planningRoot, "config.yml");
  return fs8.existsSync(configPath) ? parseYaml(fs8.readFileSync(configPath, "utf8")) : null;
}
function renderFor(kind, payload, currentConfig, workspaceRoot) {
  if (kind === "workspace.init") return renderWorkspaceInit(payload);
  if (kind === "config.update") return renderConfigUpdate(payload, currentConfig);
  if (kind === "scope.add") return renderScopeAdd(payload, currentConfig, workspaceRoot);
  throw new UsageError(`unsupported changeset kind: ${kind}`);
}
function runChangesetPropose({ planningRoot, kind, payloadText, actor }) {
  let rawPayload;
  try {
    let trimmed = payloadText.trim();
    rawPayload = trimmed.startsWith("{") ? JSON.parse(trimmed) : parseYaml(trimmed);
  } catch (error) {
    throw new UsageError(`invalid payload: ${error.message}`);
  }
  if (rawPayload === null || typeof rawPayload != "object" || Array.isArray(rawPayload))
    throw new UsageError("changeset payload must be a mapping/object");
  let { payload, targetFiles } = prepareProposal(kind, rawPayload), operationsRoot = path9.join(planningRoot, "operations");
  return { operationId: propose({ operationsRoot, planningRoot, kind, target: {}, payload, targetFiles, actor }) };
}
function runChangesetValidate({ planningRoot, operationsRoot, operationId }) {
  let changeSet = readChangeSet(operationsRoot, operationId), currentConfig = changeSet.kind === "workspace.init" ? null : readCurrentConfig(planningRoot);
  validateOperation({ operationsRoot, planningRoot, operationId, render: (payload) => renderFor(changeSet.kind, payload, currentConfig, path9.dirname(planningRoot)) });
  let operation = readOperation(operationsRoot, operationId);
  return { status: operation.status, errors: operation.validation?.errors || [] };
}
function runChangesetApprove({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval }) {
  return approveOperation({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval: !!allowSelfApproval }), { status: readOperation(operationsRoot, operationId).status };
}
function runChangesetApply({ planningRoot, operationsRoot, operationId, actor }) {
  let changeSet = readChangeSet(operationsRoot, operationId), currentConfig = changeSet.kind === "workspace.init" ? null : readCurrentConfig(planningRoot);
  return applyOperation({ operationsRoot, planningRoot, operationId, actor, render: (payload) => renderFor(changeSet.kind, payload, currentConfig, path9.dirname(planningRoot)) });
}

// runtime/src/commands/check.mjs
import fs9 from "node:fs";
import path10 from "node:path";
function commandRoleEntries(scope) {
  if (!scope.commands) return [];
  let entries = [];
  for (let role of ["build", "test", "smoke", "lint", "verify"])
    scope.commands[role] && entries.push({ label: role, entry: scope.commands[role] });
  for (let [role, entry] of Object.entries(scope.commands.custom || {}))
    entries.push({ label: `custom.${role}`, entry });
  return entries;
}
function fingerprintKeyMismatch(label, entry) {
  if (!entry.sourceRefs) return null;
  let refSet = new Set(entry.sourceRefs), keySet = new Set(Object.keys(entry.sourceFingerprintAtSelection || {})), missing = [...refSet].filter((r) => !keySet.has(r)), extra = [...keySet].filter((k) => !refSet.has(k));
  return missing.length === 0 && extra.length === 0 ? null : { label, missing, extra };
}
function findCommandFingerprintKeyMismatches(scope) {
  let mismatches = [];
  for (let { label, entry } of commandRoleEntries(scope)) {
    let selfMismatch = fingerprintKeyMismatch(label, entry);
    selfMismatch && mismatches.push(selfMismatch);
    for (let [index, alternative] of (entry.alternatives || []).entries()) {
      let altMismatch = fingerprintKeyMismatch(`${label}.alternatives[${index}]`, alternative);
      altMismatch && mismatches.push(altMismatch);
    }
  }
  return mismatches;
}
function checkRequiredFile(planningRoot, relativePath, schemaName, findings) {
  let filePath;
  try {
    filePath = confineWritePath(planningRoot, relativePath);
  } catch (error) {
    findings.push(`${relativePath}: untrusted path (${error.message})`);
    return;
  }
  if (!fs9.existsSync(filePath)) {
    findings.push(`${relativePath}: required file is missing`);
    return;
  }
  let value;
  try {
    value = parseYaml(fs9.readFileSync(filePath, "utf8"));
  } catch (error) {
    findings.push(`${relativePath}: failed to parse (${error.message})`);
    return;
  }
  let result = validate(schemaName, value);
  if (!result.valid)
    for (let error of result.errors) findings.push(`${relativePath}${error.path}: ${error.message}`);
}
function checkSchema({ planningRoot }) {
  if (!fs9.existsSync(planningRoot))
    return { status: "NOT_INITIALIZED", findings: ["workspace is not initialized: .planning/ does not exist"], pendingOperations: [] };
  let findings = [];
  try {
    assertTrustedRoots(planningRoot);
  } catch (error) {
    return { status: "FAIL", findings: [`trusted roots: ${error.message}`], pendingOperations: [] };
  }
  checkRequiredFile(planningRoot, "config.yml", "config", findings), checkRequiredFile(planningRoot, "plugin.lock.yml", "plugin-lock", findings);
  let scopesRoot = path10.join(planningRoot, "scopes");
  if (fs9.existsSync(scopesRoot))
    for (let scopeId of fs9.readdirSync(scopesRoot)) {
      if (!isUuidV7(scopeId)) {
        findings.push(`scopes/${scopeId}: not a valid scope id`);
        continue;
      }
      let scopeEntryPath = path10.join(scopesRoot, scopeId), scopeStat = fs9.lstatSync(scopeEntryPath);
      if (scopeStat.isSymbolicLink()) {
        findings.push(`scopes/${scopeId}: symlink entries are not permitted`);
        continue;
      }
      if (!scopeStat.isDirectory()) {
        findings.push(`scopes/${scopeId}: entry must be a directory`);
        continue;
      }
      let scopeBeforeCount = findings.length;
      if (checkRequiredFile(planningRoot, path10.join("scopes", scopeId, "scope.yml"), "scope", findings), findings.length === scopeBeforeCount) {
        let scopeFile = confineWritePath(planningRoot, path10.join("scopes", scopeId, "scope.yml")), scope = parseYaml(fs9.readFileSync(scopeFile, "utf8"));
        for (let mismatch of findCommandFingerprintKeyMismatches(scope))
          findings.push(`scopes/${scopeId}/scope.yml: commands.${mismatch.label} sourceFingerprintAtSelection keys do not match sourceRefs (missing=${JSON.stringify(mismatch.missing)}, extra=${JSON.stringify(mismatch.extra)})`);
      }
    }
  let sourcesRoot = path10.join(planningRoot, "sources");
  if (fs9.existsSync(sourcesRoot))
    for (let sourceId of fs9.readdirSync(sourcesRoot)) {
      if (!isUuidV7(sourceId)) {
        findings.push(`sources/${sourceId}: not a valid source id`);
        continue;
      }
      let sourceEntryPath = path10.join(sourcesRoot, sourceId), sourceStat = fs9.lstatSync(sourceEntryPath);
      if (sourceStat.isSymbolicLink()) {
        findings.push(`sources/${sourceId}: symlink entries are not permitted`);
        continue;
      }
      if (!sourceStat.isDirectory()) {
        findings.push(`sources/${sourceId}: entry must be a directory`);
        continue;
      }
      let sourceBeforeCount = findings.length;
      if (checkRequiredFile(planningRoot, path10.join("sources", sourceId, "source.yml"), "source", findings), findings.length === sourceBeforeCount) {
        let sourceFile = confineWritePath(planningRoot, path10.join("sources", sourceId, "source.yml")), source = parseYaml(fs9.readFileSync(sourceFile, "utf8"));
        source.id !== sourceId && findings.push(`sources/${sourceId}/source.yml: source.id ${source.id} does not match its directory`);
      }
    }
  let pendingOperations = [], operationsRoot = path10.join(planningRoot, "operations");
  if (fs9.existsSync(operationsRoot))
    for (let operationId of fs9.readdirSync(operationsRoot)) {
      if (!isUuidV7(operationId)) {
        findings.push(`operations/${operationId}: not a valid operation id`);
        continue;
      }
      let operationEntryPath = path10.join(operationsRoot, operationId), operationStat = fs9.lstatSync(operationEntryPath);
      if (operationStat.isSymbolicLink()) {
        findings.push(`operations/${operationId}: symlink entries are not permitted`);
        continue;
      }
      if (!operationStat.isDirectory()) {
        findings.push(`operations/${operationId}: entry must be a directory`);
        continue;
      }
      let operation;
      try {
        operation = readOperation(operationsRoot, operationId);
      } catch (error) {
        findings.push(`operations/${operationId}/operation.yml: failed to read or parse (${error.message})`);
        continue;
      }
      let operationSchemaCheck = validate("operation", operation);
      if (!operationSchemaCheck.valid) {
        for (let error of operationSchemaCheck.errors) findings.push(`operations/${operationId}/operation.yml${error.path}: ${error.message}`);
        continue;
      }
      if (operation.id !== operationId) {
        findings.push(`operations/${operationId}/operation.yml: operation.id ${operation.id} does not match its directory`);
        continue;
      }
      (operation.status === "APPLYING" || operation.status === "RECOVERY_REQUIRED") && pendingOperations.push({ operationId, status: operation.status });
    }
  return { status: findings.length === 0 ? "PASS" : "FAIL", findings, pendingOperations };
}

// runtime/src/lib/discoverScan.mjs
import fs11 from "node:fs";
import path12 from "node:path";
import { execFileSync } from "node:child_process";

// runtime/src/lib/fingerprint.mjs
import fs10 from "node:fs";
import path11 from "node:path";
var FingerprintError = class extends Error {
  constructor(code, message, details = {}) {
    super(message), this.name = "FingerprintError", this.code = code, this.details = details;
  }
};
function asFingerprintObservationError(error, absolutePath, operation) {
  if (error instanceof FingerprintError) return error;
  let details = { path: absolutePath, operation, causeCode: error?.code ?? null }, wrapped;
  return error?.code === "EACCES" || error?.code === "EPERM" ? wrapped = new FingerprintError("unreadable", `unreadable during ${operation}: ${absolutePath}`, details) : error?.code === "ENOENT" ? wrapped = new FingerprintError("observation_race", `path changed during ${operation}: ${absolutePath}`, details) : wrapped = new FingerprintError("observation_failed", `filesystem observation failed during ${operation}: ${absolutePath}`, details), wrapped.cause = error, wrapped;
}
function computeFileFingerprint(absolutePath, { maxBytes, statFn = fs10.statSync, readFn = fs10.readFileSync } = {}) {
  let stat;
  try {
    stat = statFn(absolutePath);
  } catch (error) {
    throw asFingerprintObservationError(error, absolutePath, "stat");
  }
  if (stat.size > maxBytes)
    throw new FingerprintError("source_too_large", `source exceeds size limit: ${absolutePath}`, {
      path: absolutePath,
      limitBytes: maxBytes,
      observedBytes: stat.size
    });
  let bytes;
  try {
    bytes = readFn(absolutePath);
  } catch (error) {
    throw asFingerprintObservationError(error, absolutePath, "read");
  }
  let hash = contentHash(bytes);
  return { fingerprint: hash, contentHash: hash };
}
function isValidUtf8Buffer(buf) {
  return Buffer.from(buf.toString("utf8"), "utf8").equals(buf);
}
function compareUtf8Bytes(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
function collectEntries(absoluteRoot, { readdirFn, lstatFn }) {
  let entries = [];
  function walk(currentAbs, currentRelSegments) {
    let names;
    try {
      names = readdirFn(currentAbs, { encoding: "buffer" });
    } catch (error) {
      throw asFingerprintObservationError(error, currentAbs, "readdir");
    }
    for (let nameBuf of names) {
      if (!isValidUtf8Buffer(nameBuf))
        throw new FingerprintError("invalid_utf8", `path is not valid UTF-8 under ${currentAbs}`, { path: currentAbs });
      let name = nameBuf.toString("utf8");
      if (name === ".git") continue;
      let absChild = path11.join(currentAbs, name), relSegments = [...currentRelSegments, name], stat;
      try {
        stat = lstatFn(absChild);
      } catch (error) {
        throw asFingerprintObservationError(error, absChild, "lstat");
      }
      stat.isSymbolicLink() ? entries.push({ relSegments, absPath: absChild, isSymlink: !0 }) : stat.isDirectory() ? walk(absChild, relSegments) : stat.isFile() && entries.push({ relSegments, absPath: absChild, isSymlink: !1 });
    }
  }
  return walk(absoluteRoot, []), entries;
}
function computeDirectoryFingerprint(absoluteRoot, {
  maxBytes,
  readdirFn = fs10.readdirSync,
  lstatFn = fs10.lstatSync,
  readFileFn = fs10.readFileSync,
  readlinkFn = fs10.readlinkSync
} = {}) {
  let entries = collectEntries(absoluteRoot, { readdirFn, lstatFn }), byNormalized = /* @__PURE__ */ new Map();
  for (let entry of entries) {
    let rawRelPath = entry.relSegments.join("/"), normalizedRelPath = entry.relSegments.map((segment) => segment.normalize("NFC")).join("/");
    entry.relPath = normalizedRelPath;
    let existing = byNormalized.get(normalizedRelPath);
    if (existing !== void 0 && existing !== rawRelPath)
      throw new FingerprintError("normalized_path_collision", `normalized path collision under ${absoluteRoot}: ${normalizedRelPath}`, {
        normalizedPath: normalizedRelPath,
        originalPaths: [existing, rawRelPath]
      });
    byNormalized.set(normalizedRelPath, rawRelPath);
  }
  let totalBytes = 0;
  for (let entry of entries)
    if (!entry.isSymlink)
      try {
        totalBytes += lstatFn(entry.absPath).size;
      } catch (error) {
        throw asFingerprintObservationError(error, entry.absPath, "preflight-lstat");
      }
  if (totalBytes > maxBytes)
    throw new FingerprintError("source_too_large", `source exceeds size limit: ${absoluteRoot}`, {
      path: absoluteRoot,
      limitBytes: maxBytes,
      observedBytes: totalBytes
    });
  entries.sort((a, b) => compareUtf8Bytes(a.relPath, b.relPath));
  let fingerprintLines = [], contentLines = [];
  for (let entry of entries)
    if (entry.isSymlink) {
      let targetBuf;
      try {
        targetBuf = readlinkFn(entry.absPath, "buffer");
      } catch (error) {
        throw asFingerprintObservationError(error, entry.absPath, "readlink");
      }
      if (!isValidUtf8Buffer(targetBuf))
        throw new FingerprintError("invalid_utf8", `symlink target is not valid UTF-8: ${entry.absPath}`, { path: entry.absPath });
      let relHash = contentHash(Buffer.from(entry.relPath, "utf8")), targetHash = contentHash(targetBuf);
      fingerprintLines.push(`symlink\0${relHash}\0${targetHash}
`), contentLines.push(`symlink\0${targetHash}
`);
    } else {
      let bytes;
      try {
        bytes = readFileFn(entry.absPath);
      } catch (error) {
        throw asFingerprintObservationError(error, entry.absPath, "read");
      }
      let fileHash = contentHash(bytes), relHash = contentHash(Buffer.from(entry.relPath, "utf8"));
      fingerprintLines.push(`file\0${relHash}\0${fileHash}
`), contentLines.push(`file\0${fileHash}
`);
    }
  return contentLines.sort(), {
    fingerprint: contentHash(Buffer.from(fingerprintLines.join(""), "utf8")),
    contentHash: contentHash(Buffer.from(contentLines.join(""), "utf8"))
  };
}
function computeSourceFingerprint(absolutePath, options = {}) {
  let { lstatFn = fs10.lstatSync } = options, stat;
  try {
    stat = lstatFn(absolutePath);
  } catch (error) {
    throw asFingerprintObservationError(error, absolutePath, "lstat");
  }
  if (stat.isDirectory()) return computeDirectoryFingerprint(absolutePath, options);
  if (stat.isFile()) return computeFileFingerprint(absolutePath, options);
  throw new FingerprintError("unreadable", `not a regular file or directory: ${absolutePath}`, { path: absolutePath });
}
function detectMoved(missingSources, newCandidates) {
  return missingSources.map((missing) => {
    let matches = newCandidates.filter((candidate) => candidate.observedContentHash === missing.confirmedContentHash);
    return matches.length === 1 ? { sourceId: missing.sourceId, driftState: "moved", observedAtPath: matches[0].path } : { sourceId: missing.sourceId, driftState: "missing", observedAtPath: null };
  });
}

// runtime/src/lib/discoverScan.mjs
function defaultExecFile(command, args, options) {
  return execFileSync(command, args, { encoding: "utf8", ...options });
}
function detectGit(workspaceRoot, { execFileFn = defaultExecFile } = {}) {
  let revision;
  try {
    revision = execFileFn("git", ["-C", workspaceRoot, "rev-parse", "HEAD"]).trim();
  } catch {
    return { enabled: !1, revision: null, branch: null, remote: null, vcs: "none" };
  }
  let branch = execFileFn("git", ["-C", workspaceRoot, "rev-parse", "--abbrev-ref", "HEAD"]).trim(), remote = null;
  try {
    remote = execFileFn("git", ["-C", workspaceRoot, "config", "--get", "remote.origin.url"]).trim() || null, remote && (remote = "origin");
  } catch {
    remote = null;
  }
  return { enabled: !0, revision, branch, remote, vcs: "git" };
}
var SCOPE_MANIFEST_RULES = [
  { fileName: "package.json", ruleId: "scope.node-package", kind: "code" },
  { fileName: "pom.xml", ruleId: "scope.maven-project", kind: "code" },
  { fileName: "pyproject.toml", ruleId: "scope.python-project", kind: "code" },
  { fileName: "go.mod", ruleId: "scope.go-module", kind: "code" }
], SOURCE_FILE_RULES = [
  { fileName: "package.json", ruleId: "source.package-manifest", families: ["project-module-manifests"] },
  { fileName: "pom.xml", ruleId: "source.package-manifest", families: ["project-module-manifests"] },
  { fileName: "pyproject.toml", ruleId: "source.package-manifest", families: ["project-module-manifests"] },
  { fileName: "go.mod", ruleId: "source.package-manifest", families: ["project-module-manifests"] },
  { fileName: "Cargo.toml", ruleId: "source.package-manifest", families: ["project-module-manifests"] },
  { fileName: "CODEOWNERS", ruleId: "source.ownership", families: ["ownership"] },
  { fileName: "AGENTS.md", ruleId: "source.agent-instructions", families: ["agent-repository-instructions"] },
  { fileName: "CLAUDE.md", ruleId: "source.agent-instructions", families: ["agent-repository-instructions"] },
  { fileName: "README.md", ruleId: "source.agent-instructions", families: ["agent-repository-instructions"] },
  { fileName: "CONTRIBUTING.md", ruleId: "source.agent-instructions", families: ["agent-repository-instructions"] },
  { fileName: "Dockerfile", ruleId: "source.env-runtime", families: ["local-runtime-environment"] },
  { fileName: "docker-compose.yml", ruleId: "source.env-runtime", families: ["local-runtime-environment"] },
  { fileName: ".env.example", ruleId: "source.env-runtime", families: ["local-runtime-environment"] },
  { fileName: ".eslintrc.json", ruleId: "source.quality-config", families: ["quality-definitions"] },
  { fileName: ".eslintrc.js", ruleId: "source.quality-config", families: ["quality-definitions"] },
  { fileName: ".prettierrc", ruleId: "source.quality-config", families: ["quality-definitions"] },
  { fileName: "sonar-project.properties", ruleId: "source.quality-config", families: ["quality-definitions"] },
  { fileName: "openapi.yaml", ruleId: "source.api-contract", families: ["public-data-contracts"] },
  { fileName: "openapi.yml", ruleId: "source.api-contract", families: ["public-data-contracts"] },
  { fileName: "openapi.json", ruleId: "source.api-contract", families: ["public-data-contracts"] },
  { fileName: "STYLEGUIDE.md", ruleId: "source.engineering-standard", families: ["engineering-standards"] },
  { fileName: "REPOSITORY_MAP.md", ruleId: "source.repository-map", families: ["repository-map"] }
], SOURCE_DIRECTORY_RULES = [
  { dirName: "adr", underDocs: !0, ruleId: "source.adr-directory", families: ["decision-sources"] },
  { dirName: "decisions", underDocs: !0, ruleId: "source.adr-directory", families: ["decision-sources"] },
  { relativePath: ".github/workflows", ruleId: "source.ci-workflows", families: ["delivery-ci-deployment"] },
  { dirName: "product", underDocs: !0, ruleId: "source.product-docs", families: ["product-sources"] },
  { dirName: "requirements", underDocs: !0, ruleId: "source.functional-requirements", families: ["functional-sources"] },
  { dirName: "architecture", underDocs: !0, ruleId: "source.technical-architecture", families: ["technical-sources"] },
  { dirName: "developer-guide", underDocs: !0, ruleId: "source.developer-guide", families: ["developer-guides"] },
  { dirName: "evidence", underDocs: !0, ruleId: "source.evidence-docs", families: ["evidence-contracts"] },
  { dirName: "migrations", ruleId: "source.db-migrations", families: ["public-data-contracts"] },
  { dirName: "scripts", ruleId: "source.scripts-directory", families: ["execution-commands", "custom-automation"] },
  { dirName: "design-system", ruleId: "source.design-system", families: ["design-system"] },
  { dirName: "prompts", ruleId: "source.prompt-sources", families: ["prompt-sources"] },
  { dirName: "tools", ruleId: "source.custom-automation", families: ["custom-automation"] },
  { dirName: "bin", ruleId: "source.custom-automation", families: ["custom-automation"] }
];
function listTopLevel(currentDir, { readdirFn = fs11.readdirSync, lstatFn = fs11.lstatSync } = {}) {
  return readdirFn(currentDir).map((name) => ({
    name,
    absPath: path12.join(currentDir, name),
    stat: lstatFn(path12.join(currentDir, name))
  }));
}
function enumerateCandidates(workspaceRoot, { readdirFn = fs11.readdirSync, lstatFn = fs11.lstatSync } = {}) {
  let scopeCandidates = [], sourceCandidates = [], diagnostics = [];
  function walk(currentDir, relativeDir) {
    let children;
    try {
      children = listTopLevel(currentDir, { readdirFn, lstatFn });
    } catch (error) {
      diagnostics.push({ code: "enumeration_error", path: relativeDir || ".", message: error.message });
      return;
    }
    let fileNames = new Set(children.filter((c) => c.stat.isFile()).map((c) => c.name));
    for (let scopeRule of SCOPE_MANIFEST_RULES)
      if (fileNames.has(scopeRule.fileName) && relativeDir !== "") {
        let existing = scopeCandidates.find((c) => c.path === `${relativeDir}/`);
        existing ? (existing.signals.push(scopeRule.fileName), existing.suggestions.ruleIds.push(scopeRule.ruleId)) : scopeCandidates.push({ path: `${relativeDir}/`, signals: [scopeRule.fileName], suggestions: { kind: scopeRule.kind, ruleIds: [scopeRule.ruleId] } });
      }
    for (let child of children) {
      if (child.stat.isSymbolicLink()) continue;
      let childRelative = relativeDir ? `${relativeDir}/${child.name}` : child.name;
      if (child.stat.isFile()) {
        let fileRule = SOURCE_FILE_RULES.find((r) => r.fileName === child.name);
        fileRule && sourceCandidates.push({ path: childRelative, candidateFamilies: fileRule.families, ruleIds: [fileRule.ruleId] });
      }
      if (child.stat.isDirectory()) {
        if (child.name === "node_modules" || child.name === ".git") continue;
        let dirRule = SOURCE_DIRECTORY_RULES.find(
          (r) => r.relativePath ? childRelative === r.relativePath : r.dirName === child.name && (!r.underDocs || relativeDir === "docs")
        );
        dirRule && sourceCandidates.push({ path: `${childRelative}/`, candidateFamilies: dirRule.families, ruleIds: [dirRule.ruleId] }), walk(child.absPath, childRelative);
      }
    }
  }
  return walk(workspaceRoot, ""), { scopeCandidates, sourceCandidates, diagnostics };
}
function readConfirmedSources(planningRoot) {
  let sourcesRoot = path12.join(planningRoot, "sources");
  if (!fs11.existsSync(sourcesRoot)) return [];
  let sources = [];
  for (let id of fs11.readdirSync(sourcesRoot)) {
    if (!isUuidV7(id)) continue;
    let sourceFile = confineWritePath(planningRoot, path12.join("sources", id, "source.yml"));
    fs11.existsSync(sourceFile) && sources.push(parseYaml(fs11.readFileSync(sourceFile, "utf8")));
  }
  return sources;
}
function resolveHostPath(workspaceRoot, relativePath) {
  return confineScopePath(workspaceRoot, relativePath);
}
function fingerprintOne(absolutePath, maxSourceBytes) {
  return computeSourceFingerprint(absolutePath, { maxBytes: maxSourceBytes });
}
function computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates, maxSourceBytes }) {
  let confirmedSources = readConfirmedSources(planningRoot), results = [], diagnostics = [], missingForMoveDetection = [];
  for (let source of confirmedSources) {
    let absolutePath;
    try {
      absolutePath = resolveHostPath(workspaceRoot, source.path);
    } catch (error) {
      if (!(error instanceof PathConfinementError)) throw error;
      diagnostics.push({ code: "untrusted_source_path", path: source.path, sourceId: source.id, message: error.message });
      continue;
    }
    if (!fs11.existsSync(absolutePath)) {
      missingForMoveDetection.push({ sourceId: source.id, path: source.path, confirmedFingerprint: source.confirmedFingerprint, confirmedContentHash: source.confirmedContentHash });
      continue;
    }
    let observed;
    try {
      observed = fingerprintOne(absolutePath, maxSourceBytes);
    } catch (error) {
      if (!(error instanceof FingerprintError)) throw error;
      diagnostics.push({ code: error.code, path: source.path, sourceId: source.id, message: error.message });
      continue;
    }
    let driftState = observed.fingerprint === source.confirmedFingerprint ? "unchanged" : "changed";
    results.push({
      sourceId: source.id,
      path: source.path,
      confirmedFingerprint: source.confirmedFingerprint,
      confirmedContentHash: source.confirmedContentHash,
      observedFingerprint: observed.fingerprint,
      observedContentHash: observed.contentHash,
      driftState,
      freshness: driftState === "unchanged" ? "current" : "stale",
      observedAtPath: null
    });
  }
  let fingerprintedSourceCandidates = [];
  for (let candidate of sourceCandidates) {
    let absolutePath;
    try {
      absolutePath = resolveHostPath(workspaceRoot, candidate.path);
    } catch (error) {
      if (!(error instanceof PathConfinementError)) throw error;
      diagnostics.push({ code: "untrusted_source_path", path: candidate.path, message: error.message });
      continue;
    }
    try {
      let observed = fingerprintOne(absolutePath, maxSourceBytes);
      fingerprintedSourceCandidates.push({ ...candidate, observedFingerprint: observed.fingerprint, observedContentHash: observed.contentHash });
    } catch (error) {
      if (!(error instanceof FingerprintError)) throw error;
      diagnostics.push({ code: error.code, path: candidate.path, message: error.message });
    }
  }
  if (missingForMoveDetection.length > 0) {
    let movedResults = detectMoved(missingForMoveDetection, fingerprintedSourceCandidates);
    for (let missing of missingForMoveDetection) {
      let moveResult = movedResults.find((r) => r.sourceId === missing.sourceId);
      results.push({
        sourceId: missing.sourceId,
        path: missing.path,
        confirmedFingerprint: missing.confirmedFingerprint,
        confirmedContentHash: missing.confirmedContentHash,
        observedFingerprint: null,
        observedContentHash: null,
        driftState: moveResult.driftState,
        observedAtPath: moveResult.observedAtPath
        // no `freshness` key at all for missing/moved -- see the Interfaces note above
      });
    }
  }
  return { results, diagnostics, fingerprintedSourceCandidates };
}
function readConfirmedScopes(planningRoot) {
  let scopesRoot = path12.join(planningRoot, "scopes");
  if (!fs11.existsSync(scopesRoot)) return [];
  let scopes = [];
  for (let id of fs11.readdirSync(scopesRoot)) {
    if (!isUuidV7(id)) continue;
    let scopeFile = confineWritePath(planningRoot, path12.join("scopes", id, "scope.yml"));
    fs11.existsSync(scopeFile) && scopes.push(parseYaml(fs11.readFileSync(scopeFile, "utf8")));
  }
  return scopes;
}
function allCommandEntries(scope) {
  if (!scope.commands) return [];
  let entries = [];
  for (let role of ["build", "test", "smoke", "lint", "verify"])
    scope.commands[role] && entries.push({ role, entry: scope.commands[role] });
  for (let [role, entry] of Object.entries(scope.commands.custom || {}))
    entries.push({ role: `custom.${role}`, entry });
  return entries;
}
function evaluateCommandEvidence(commandEntry, knownSourceDrift) {
  if (!commandEntry.sourceRefs || commandEntry.sourceRefs.length === 0)
    return { evidenceState: "not-evidence-backed", reasons: [] };
  let driftById = new Map(knownSourceDrift.map((d) => [d.sourceId, d])), refDrifts = commandEntry.sourceRefs.map((ref) => driftById.get(ref));
  if (refDrifts.some((d) => d === void 0 || d.driftState === "missing" || d.driftState === "moved"))
    return { evidenceState: "evidence-missing", reasons: [] };
  if (refDrifts.some((d) => d.observedFingerprint === void 0 || d.observedFingerprint === null))
    return { evidenceState: "unknown", reasons: [] };
  let reasons = /* @__PURE__ */ new Set(), anyDrifted = !1, anyUpdated = !1;
  for (let ref of commandEntry.sourceRefs) {
    let drift = driftById.get(ref);
    drift.driftState === "changed" && (anyDrifted = !0, reasons.add("live-source-differs-from-catalog")), commandEntry.sourceFingerprintAtSelection[ref] !== drift.confirmedFingerprint && (anyUpdated = !0, reasons.add("catalog-advanced-since-selection"));
  }
  return anyDrifted ? { evidenceState: "evidence-drifted", reasons: [...reasons] } : anyUpdated ? { evidenceState: "evidence-updated", reasons: [...reasons] } : { evidenceState: "current", reasons: [] };
}
function computeCommandEvidence({ planningRoot, knownSourceDrift }) {
  let scopes = readConfirmedScopes(planningRoot), results = [];
  for (let scope of scopes)
    for (let { role, entry } of allCommandEntries(scope)) {
      let { evidenceState, reasons } = evaluateCommandEvidence(entry, knownSourceDrift);
      results.push({ scopeId: scope.id, role, evidenceState, reasons });
    }
  return results;
}
function stringSetHash(strings) {
  let lines = strings.map((s) => `${contentHash(Buffer.from(s, "utf8"))}
`).sort();
  return contentHash(Buffer.from(lines.join(""), "utf8"));
}
function hashOrEmpty(value) {
  return contentHash(Buffer.from(value ?? "", "utf8"));
}
function computeWorkspaceHash({ scopeCandidates, sourceCandidates, knownSources, knownCommandsEvidence }) {
  let lines = [];
  for (let c of scopeCandidates)
    lines.push(`scope\0${hashOrEmpty(c.path)}\0${stringSetHash(c.signals)}\0${hashOrEmpty(c.suggestions?.kind)}\0${stringSetHash(c.suggestions?.ruleIds || [])}
`);
  for (let c of sourceCandidates)
    lines.push(`sourceCandidate\0${hashOrEmpty(c.path)}\0${stringSetHash(c.candidateFamilies)}\0${c.observedFingerprint}\0${c.observedContentHash}\0${stringSetHash(c.ruleIds)}
`);
  for (let s of knownSources) {
    let fp = s.observedFingerprint ?? hashOrEmpty("missing"), ch = s.observedContentHash ?? hashOrEmpty("missing");
    lines.push(`knownSource\0${s.sourceId}\0${s.driftState}\0${hashOrEmpty(s.path)}\0${fp}\0${ch}\0${hashOrEmpty(s.observedAtPath)}
`);
  }
  for (let e of knownCommandsEvidence)
    lines.push(`commandEvidence\0${e.scopeId}\0${e.role}\0${e.evidenceState}\0${stringSetHash(e.reasons)}
`);
  return lines.sort(), contentHash(Buffer.from(lines.join(""), "utf8"));
}

// runtime/src/commands/discover.mjs
var DEFAULT_MAX_SOURCE_BYTES = 536870912, MIN_MAX_SOURCE_BYTES = 1048576, MAX_MAX_SOURCE_BYTES = 2147483648;
function runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES }) {
  if (maxSourceBytes < MIN_MAX_SOURCE_BYTES || maxSourceBytes > MAX_MAX_SOURCE_BYTES)
    throw new UsageError(`--max-source-bytes must be between ${MIN_MAX_SOURCE_BYTES} and ${MAX_MAX_SOURCE_BYTES}, got ${maxSourceBytes}`);
  let git = detectGit(workspaceRoot), { scopeCandidates, sourceCandidates: rawSourceCandidates, diagnostics: enumerationDiagnostics } = enumerateCandidates(workspaceRoot), {
    results: knownSources,
    diagnostics: driftDiagnostics,
    fingerprintedSourceCandidates
  } = computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates: rawSourceCandidates, maxSourceBytes }), knownCommandsEvidence = computeCommandEvidence({ planningRoot, knownSourceDrift: knownSources }), diagnostics = [...enumerationDiagnostics, ...driftDiagnostics], workspaceHash = computeWorkspaceHash({
    scopeCandidates,
    sourceCandidates: fingerprintedSourceCandidates,
    knownSources,
    knownCommandsEvidence
  });
  return {
    schemaVersion: 1,
    scanId: generateUuidV7(),
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    baseRevision: { vcsRevision: git.enabled ? `git:${git.revision}` : "none", workspaceHash },
    scanParameters: { maxSourceBytes },
    git,
    scopeCandidates,
    sourceCandidates: fingerprintedSourceCandidates,
    knownSources,
    knownCommandsEvidence,
    diagnostics
  };
}

// runtime/src/index.mjs
var IN_SCOPE_KINDS = /* @__PURE__ */ new Set(["workspace.init", "config.update", "scope.add"]);
function notImplemented(command) {
  return {
    status: "NOT_IMPLEMENTED",
    command,
    corte: "0",
    message: "deferred to Corte N, see docs/plugin-redesign-release-flow/03-plan-incremental.md"
  };
}
function argsToOptions(args) {
  let options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) continue;
    let key = args[index].slice(2).replaceAll("-", "_"), next = args[index + 1];
    options[key] = next === void 0 || next.startsWith("--") ? !0 : args[++index];
  }
  return options;
}
function requireOperationId(value) {
  if (!isUuidV7(value)) throw new UsageError(`invalid operation id: ${value}`);
  return value;
}
function readPayloadText(payloadFileArg, cwd) {
  if (!payloadFileArg || payloadFileArg === !0) throw new UsageError("changeset propose requires --payload-file <file|->");
  if (payloadFileArg === "-") return fs12.readFileSync(0, "utf8");
  let resolved = path13.resolve(cwd, payloadFileArg);
  if (!fs12.existsSync(resolved)) throw new UsageError(`payload file not found: ${payloadFileArg}`);
  return fs12.readFileSync(resolved, "utf8");
}
function dispatch(command, args, cwd) {
  let planningRoot = path13.join(cwd, ".planning"), operationsRoot = path13.join(planningRoot, "operations");
  if (command === "init") {
    let options = argsToOptions(args);
    if (!options.name || !options.actor) throw new UsageError("init requires --name and --actor");
    return runInit({ planningRoot, args: { name: options.name, vcs: options.vcs, baseBranch: options.base_branch, actor: options.actor } });
  }
  if (command === "config") {
    let [stage, ...rest] = args;
    if (stage === "set") {
      let options = argsToOptions(rest);
      if (!options.name || !options.actor) throw new UsageError("config set requires --name and --actor");
      return runConfigSet({ planningRoot, args: { name: options.name, actor: options.actor } });
    }
    if (stage === "scope" && rest[0] === "add") {
      let options = argsToOptions(rest.slice(1));
      if (!options.key || !options.label || !options.kind || !options.path || !options.actor)
        throw new UsageError("config scope add requires --key, --label, --kind, --path, --actor");
      return runConfigScopeAdd({ planningRoot, args: { key: options.key, label: options.label, kind: options.kind, path: options.path, owner: options.owner, actor: options.actor } });
    }
    return notImplemented(`config ${stage || ""}`.trim());
  }
  if (command === "changeset") {
    let [stage, ...rest] = args;
    if (stage === "propose") {
      let options = argsToOptions(rest);
      if (!IN_SCOPE_KINDS.has(options.kind)) return notImplemented(`changeset propose --kind ${options.kind}`);
      if (!options.actor) throw new UsageError("changeset propose requires --actor");
      let payloadText = readPayloadText(options.payload_file, cwd);
      return runChangesetPropose({ planningRoot, kind: options.kind, payloadText, actor: options.actor });
    }
    if (stage === "validate") {
      let operationId = requireOperationId(rest[0]);
      return runChangesetValidate({ planningRoot, operationsRoot, operationId });
    }
    if (stage === "approve") {
      let operationId = requireOperationId(rest[0]), options = argsToOptions(rest.slice(1));
      if (!options.actor) throw new UsageError("changeset approve requires --actor");
      return runChangesetApprove({ operationsRoot, planningRoot, operationId, actor: options.actor, allowSelfApproval: !!options.allow_self_approval });
    }
    if (stage === "apply") {
      let operationId = requireOperationId(rest[0]), options = argsToOptions(rest.slice(1));
      if (!options.actor) throw new UsageError("changeset apply requires --actor");
      return runChangesetApply({ planningRoot, operationsRoot, operationId, actor: options.actor });
    }
    return notImplemented(`changeset ${stage || ""}`.trim());
  }
  if (command === "check") {
    let [stage] = args;
    return stage === "schema" ? checkSchema({ planningRoot }) : notImplemented(`check ${stage || ""}`.trim());
  }
  if (command === "discover") {
    let [stage, ...rest] = args;
    if (stage === "scan") {
      let options = argsToOptions(rest), scanArgs = { planningRoot, workspaceRoot: cwd };
      if (options.max_source_bytes !== void 0) {
        let parsed = Number(options.max_source_bytes);
        if (!Number.isInteger(parsed)) throw new UsageError(`--max-source-bytes must be an integer, got ${options.max_source_bytes}`);
        scanArgs.maxSourceBytes = parsed;
      }
      return runDiscoverScan(scanArgs);
    }
    return notImplemented(`discover ${stage || ""}`.trim());
  }
  return notImplemented(command);
}
export {
  LockHeldError,
  PathConfinementError,
  RecoveryRequiredError,
  StaleError,
  StateError,
  UsageError,
  dispatch
};
