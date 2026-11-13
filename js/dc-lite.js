/*
 * dc-lite — a tiny standalone runtime for this portfolio page.
 *
 * The page was designed as a Claude Design component: an HTML template with {{holes}},
 * <sc-if>/<sc-for> blocks and onClick="{{handler}}" bindings, driven by a `Component`
 * class (state, setState, componentDidMount/componentDidUpdate). This file renders that
 * same template in a plain browser, so the site runs on any static host (GitHub Pages).
 *
 * Re-renders are morphed into the live DOM (not replaced), so playing videos keep playing
 * and classes/styles that the page's own scripts add at runtime (reveals, tilt, parallax)
 * survive a state change.
 */
(function () {
  'use strict';

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var ONLY_HOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  // classes added by the page scripts after render; a re-render must not strip them
  var RUNTIME_CLASSES = ['in', 'revealing', 'seen', 'shine', 'motion-paused'];

  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return parseFloat(path);
    var parts = path.split('.');
    var v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }

  function text(v) {
    return v == null || v === false ? '' : String(v);
  }

  function interp(str, scope) {
    return str.replace(HOLE, function (_, p) { return text(lookup(p, scope)); });
  }

  // raw value for a whole-hole attribute, interpolated string otherwise
  function attrValue(str, scope) {
    var m = str.match(ONLY_HOLE);
    return m ? lookup(m[1], scope) : interp(str, scope);
  }

  function child(scope, extra) {
    var s = Object.create(scope);
    for (var k in extra) s[k] = extra[k];
    return s;
  }

  function build(tplParent, scope, out) {
    var nodes = tplParent.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) {
        out.appendChild(document.createTextNode(n.nodeValue.indexOf('{{') < 0 ? n.nodeValue : interp(n.nodeValue, scope)));
        continue;
      }
      if (n.nodeType !== 1) continue; // comments
      var tag = n.localName;
      if (tag === 'sc-if') {
        if (attrValue(n.getAttribute('value') || '', scope)) build(n, scope, out);
        continue;
      }
      if (tag === 'sc-for') {
        var list = attrValue(n.getAttribute('list') || '', scope) || [];
        var as = n.getAttribute('as') || 'item';
        for (var j = 0; j < list.length; j++) {
          var extra = { $index: j };
          extra[as] = list[j];
          build(n, child(scope, extra), out);
        }
        continue;
      }
      var el = document.importNode(n, false);
      // re-apply attributes from the template with holes resolved
      while (el.attributes.length) el.removeAttribute(el.attributes[0].name);
      var attrs = n.attributes;
      for (var a = 0; a < attrs.length; a++) {
        var name = attrs[a].name;
        var raw = attrs[a].value;
        if (name.indexOf('hint-') === 0) continue;
        if (name.indexOf('on') === 0 && raw.indexOf('{{') >= 0) {
          var fn = attrValue(raw, scope);
          if (typeof fn === 'function') {
            el.__dc = el.__dc || {};
            el.__dc[name.slice(2)] = fn;
          }
          continue;
        }
        var v = raw.indexOf('{{') < 0 ? raw : attrValue(raw, scope);
        if (v === true) el.setAttribute(name, '');
        else if (v === false || v == null) continue;
        else el.setAttribute(name, String(v));
      }
      build(n, scope, el);
      out.appendChild(el);
    }
  }

  // ── morph: update the live DOM to match a freshly built tree, keeping runtime state ──
  function syncAttributes(from, to) {
    var keepStyle = from.hasAttribute('data-tilt') || from.hasAttribute('data-parallax') || from.classList.contains('reveal');
    var kept = keepStyle ? { transform: from.style.transform, transition: from.style.transition, willChange: from.style.willChange } : null;
    var runtime = [];
    if (from.classList) {
      for (var r = 0; r < RUNTIME_CLASSES.length; r++) if (from.classList.contains(RUNTIME_CLASSES[r])) runtime.push(RUNTIME_CLASSES[r]);
    }
    // remove attributes that disappeared (videos keep the muted/playsinline flags set by script)
    for (var i = from.attributes.length - 1; i >= 0; i--) {
      var name = from.attributes[i].name;
      if (!to.hasAttribute(name)) {
        if (from.localName === 'video' && (name === 'muted' || name === 'playsinline')) continue;
        from.removeAttribute(name);
      }
    }
    for (var j = 0; j < to.attributes.length; j++) {
      var a = to.attributes[j];
      if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
    }
    for (var k = 0; k < runtime.length; k++) from.classList.add(runtime[k]);
    if (kept) {
      if (kept.transform) from.style.transform = kept.transform;
      if (kept.transition) from.style.transition = kept.transition;
      if (kept.willChange) from.style.willChange = kept.willChange;
    }
    from.__dc = to.__dc;
  }

  function morphChildren(fromParent, toParent) {
    var fromKids = fromParent.childNodes;
    var toKids = Array.prototype.slice.call(toParent.childNodes);
    for (var i = 0; i < toKids.length; i++) {
      var t = toKids[i];
      var f = fromKids[i];
      if (!f) { fromParent.appendChild(t); continue; }
      if (f.nodeType !== t.nodeType || (f.nodeType === 1 && f.localName !== t.localName)) {
        fromParent.replaceChild(t, f);
        continue;
      }
      if (f.nodeType === 3) {
        if (f.nodeValue !== t.nodeValue) f.nodeValue = t.nodeValue;
        continue;
      }
      if (f.nodeType === 1) {
        syncAttributes(f, t);
        morphChildren(f, t);
      }
    }
    while (fromParent.childNodes.length > toKids.length) fromParent.removeChild(fromParent.lastChild);
  }

  // ── component base class used by the page's logic ──
  var instance = null;
  var pending = false;

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (update, cb) {
    var u = typeof update === 'function' ? update(this.state, this.props) : update;
    this.state = Object.assign({}, this.state, u);
    schedule(cb);
  };
  DCLogic.prototype.forceUpdate = function (cb) { schedule(cb); };
  window.DCLogic = DCLogic;

  var callbacks = [];
  function schedule(cb) {
    if (typeof cb === 'function') callbacks.push(cb);
    if (pending) return;
    pending = true;
    Promise.resolve().then(flush);
  }

  var root, tpl, mounted = false;

  function render() {
    var frag = document.createDocumentFragment();
    build(tpl.content, instance.renderVals() || {}, frag);
    if (!mounted) {
      root.appendChild(frag);
    } else {
      var holder = document.createElement('div');
      holder.appendChild(frag);
      morphChildren(root, holder);
    }
  }

  function flush() {
    pending = false;
    if (!instance) return;
    render();
    if (instance.componentDidUpdate) instance.componentDidUpdate();
    var cbs = callbacks.splice(0);
    cbs.forEach(function (cb) { cb(); });
  }

  // one delegated listener per event type, routed to onX="{{handler}}" bindings
  function delegate(type) {
    root.addEventListener(type, function (e) {
      var n = e.target;
      while (n && n !== root) {
        if (n.__dc && n.__dc[type]) { n.__dc[type].call(null, e); return; }
        n = n.parentNode;
      }
    });
  }

  window.DCLite = {
    mount: function (Component, props) {
      root = document.getElementById('dc-root');
      tpl = document.getElementById('dc-view');
      instance = new Component(props || {});
      render();
      mounted = true;
      ['click', 'input', 'change', 'keydown', 'submit'].forEach(delegate);
      if (instance.componentDidMount) instance.componentDidMount();
    }
  };
})();
