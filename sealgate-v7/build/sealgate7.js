function _applyDecoratedDescriptor(i, e, r, n, l) {
  var a = {};
  return Object.keys(n).forEach(function (i) {
    a[i] = n[i];
  }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) {
    return n(i, e, r) || r;
  }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a;
}

/** Detect free variable `global` from Node.js. */
var freeGlobal = typeof global == 'object' && global && global.Object === Object && global;
var freeGlobal$1 = freeGlobal;

/** Detect free variable `self`. */
var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

/** Used as a reference to the global object. */
var root = freeGlobal$1 || freeSelf || Function('return this')();
var root$1 = root;

/** Built-in value references. */
var Symbol = root$1.Symbol;
var Symbol$1 = Symbol;

/** Used for built-in method references. */
var objectProto$c = Object.prototype;

/** Used to check objects for own properties. */
var hasOwnProperty$9 = objectProto$c.hasOwnProperty;

/**
 * Used to resolve the
 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
 * of values.
 */
var nativeObjectToString$1 = objectProto$c.toString;

/** Built-in value references. */
var symToStringTag$1 = Symbol$1 ? Symbol$1.toStringTag : undefined;

/**
 * A specialized version of `baseGetTag` which ignores `Symbol.toStringTag` values.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the raw `toStringTag`.
 */
function getRawTag(value) {
  var isOwn = hasOwnProperty$9.call(value, symToStringTag$1),
    tag = value[symToStringTag$1];
  try {
    value[symToStringTag$1] = undefined;
    var unmasked = true;
  } catch (e) {}
  var result = nativeObjectToString$1.call(value);
  if (unmasked) {
    if (isOwn) {
      value[symToStringTag$1] = tag;
    } else {
      delete value[symToStringTag$1];
    }
  }
  return result;
}

/** Used for built-in method references. */
var objectProto$b = Object.prototype;

/**
 * Used to resolve the
 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
 * of values.
 */
var nativeObjectToString = objectProto$b.toString;

/**
 * Converts `value` to a string using `Object.prototype.toString`.
 *
 * @private
 * @param {*} value The value to convert.
 * @returns {string} Returns the converted string.
 */
function objectToString(value) {
  return nativeObjectToString.call(value);
}

/** `Object#toString` result references. */
var nullTag = '[object Null]',
  undefinedTag = '[object Undefined]';

/** Built-in value references. */
var symToStringTag = Symbol$1 ? Symbol$1.toStringTag : undefined;

/**
 * The base implementation of `getTag` without fallbacks for buggy environments.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the `toStringTag`.
 */
function baseGetTag(value) {
  if (value == null) {
    return value === undefined ? undefinedTag : nullTag;
  }
  return symToStringTag && symToStringTag in Object(value) ? getRawTag(value) : objectToString(value);
}

/**
 * Checks if `value` is object-like. A value is object-like if it's not `null`
 * and has a `typeof` result of "object".
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
 * @example
 *
 * _.isObjectLike({});
 * // => true
 *
 * _.isObjectLike([1, 2, 3]);
 * // => true
 *
 * _.isObjectLike(_.noop);
 * // => false
 *
 * _.isObjectLike(null);
 * // => false
 */
function isObjectLike(value) {
  return value != null && typeof value == 'object';
}

/**
 * Checks if `value` is classified as an `Array` object.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an array, else `false`.
 * @example
 *
 * _.isArray([1, 2, 3]);
 * // => true
 *
 * _.isArray(document.body.children);
 * // => false
 *
 * _.isArray('abc');
 * // => false
 *
 * _.isArray(_.noop);
 * // => false
 */
var isArray = Array.isArray;
var isArray$1 = isArray;

/**
 * Checks if `value` is the
 * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
 * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an object, else `false`.
 * @example
 *
 * _.isObject({});
 * // => true
 *
 * _.isObject([1, 2, 3]);
 * // => true
 *
 * _.isObject(_.noop);
 * // => true
 *
 * _.isObject(null);
 * // => false
 */
function isObject(value) {
  var type = typeof value;
  return value != null && (type == 'object' || type == 'function');
}

/** `Object#toString` result references. */
var asyncTag = '[object AsyncFunction]',
  funcTag$2 = '[object Function]',
  genTag$1 = '[object GeneratorFunction]',
  proxyTag = '[object Proxy]';

/**
 * Checks if `value` is classified as a `Function` object.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a function, else `false`.
 * @example
 *
 * _.isFunction(_);
 * // => true
 *
 * _.isFunction(/abc/);
 * // => false
 */
function isFunction(value) {
  if (!isObject(value)) {
    return false;
  }
  // The use of `Object#toString` avoids issues with the `typeof` operator
  // in Safari 9 which returns 'object' for typed arrays and other constructors.
  var tag = baseGetTag(value);
  return tag == funcTag$2 || tag == genTag$1 || tag == asyncTag || tag == proxyTag;
}

/** Used to detect overreaching core-js shims. */
var coreJsData = root$1['__core-js_shared__'];
var coreJsData$1 = coreJsData;

/** Used to detect methods masquerading as native. */
var maskSrcKey = function () {
  var uid = /[^.]+$/.exec(coreJsData$1 && coreJsData$1.keys && coreJsData$1.keys.IE_PROTO || '');
  return uid ? 'Symbol(src)_1.' + uid : '';
}();

/**
 * Checks if `func` has its source masked.
 *
 * @private
 * @param {Function} func The function to check.
 * @returns {boolean} Returns `true` if `func` is masked, else `false`.
 */
function isMasked(func) {
  return !!maskSrcKey && maskSrcKey in func;
}

/** Used for built-in method references. */
var funcProto$1 = Function.prototype;

/** Used to resolve the decompiled source of functions. */
var funcToString$1 = funcProto$1.toString;

/**
 * Converts `func` to its source code.
 *
 * @private
 * @param {Function} func The function to convert.
 * @returns {string} Returns the source code.
 */
function toSource(func) {
  if (func != null) {
    try {
      return funcToString$1.call(func);
    } catch (e) {}
    try {
      return func + '';
    } catch (e) {}
  }
  return '';
}

/**
 * Used to match `RegExp`
 * [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
 */
var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;

/** Used to detect host constructors (Safari). */
var reIsHostCtor = /^\[object .+?Constructor\]$/;

/** Used for built-in method references. */
var funcProto = Function.prototype,
  objectProto$a = Object.prototype;

/** Used to resolve the decompiled source of functions. */
var funcToString = funcProto.toString;

/** Used to check objects for own properties. */
var hasOwnProperty$8 = objectProto$a.hasOwnProperty;

/** Used to detect if a method is native. */
var reIsNative = RegExp('^' + funcToString.call(hasOwnProperty$8).replace(reRegExpChar, '\\$&').replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$');

/**
 * The base implementation of `_.isNative` without bad shim checks.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a native function,
 *  else `false`.
 */
function baseIsNative(value) {
  if (!isObject(value) || isMasked(value)) {
    return false;
  }
  var pattern = isFunction(value) ? reIsNative : reIsHostCtor;
  return pattern.test(toSource(value));
}

/**
 * Gets the value at `key` of `object`.
 *
 * @private
 * @param {Object} [object] The object to query.
 * @param {string} key The key of the property to get.
 * @returns {*} Returns the property value.
 */
function getValue(object, key) {
  return object == null ? undefined : object[key];
}

/**
 * Gets the native function at `key` of `object`.
 *
 * @private
 * @param {Object} object The object to query.
 * @param {string} key The key of the method to get.
 * @returns {*} Returns the function if it's native, else `undefined`.
 */
function getNative(object, key) {
  var value = getValue(object, key);
  return baseIsNative(value) ? value : undefined;
}

/* Built-in method references that are verified to be native. */
var WeakMap = getNative(root$1, 'WeakMap');
var WeakMap$1 = WeakMap;

/** Built-in value references. */
var objectCreate = Object.create;

/**
 * The base implementation of `_.create` without support for assigning
 * properties to the created object.
 *
 * @private
 * @param {Object} proto The object to inherit from.
 * @returns {Object} Returns the new object.
 */
var baseCreate = function () {
  function object() {}
  return function (proto) {
    if (!isObject(proto)) {
      return {};
    }
    if (objectCreate) {
      return objectCreate(proto);
    }
    object.prototype = proto;
    var result = new object();
    object.prototype = undefined;
    return result;
  };
}();
var baseCreate$1 = baseCreate;

/**
 * Copies the values of `source` to `array`.
 *
 * @private
 * @param {Array} source The array to copy values from.
 * @param {Array} [array=[]] The array to copy values to.
 * @returns {Array} Returns `array`.
 */
function copyArray(source, array) {
  var index = -1,
    length = source.length;
  array || (array = Array(length));
  while (++index < length) {
    array[index] = source[index];
  }
  return array;
}

var defineProperty = function () {
  try {
    var func = getNative(Object, 'defineProperty');
    func({}, '', {});
    return func;
  } catch (e) {}
}();
var defineProperty$1 = defineProperty;

/**
 * A specialized version of `_.forEach` for arrays without support for
 * iteratee shorthands.
 *
 * @private
 * @param {Array} [array] The array to iterate over.
 * @param {Function} iteratee The function invoked per iteration.
 * @returns {Array} Returns `array`.
 */
function arrayEach(array, iteratee) {
  var index = -1,
    length = array == null ? 0 : array.length;
  while (++index < length) {
    if (iteratee(array[index], index, array) === false) {
      break;
    }
  }
  return array;
}

/** Used as references for various `Number` constants. */
var MAX_SAFE_INTEGER$1 = 9007199254740991;

/** Used to detect unsigned integer values. */
var reIsUint = /^(?:0|[1-9]\d*)$/;

/**
 * Checks if `value` is a valid array-like index.
 *
 * @private
 * @param {*} value The value to check.
 * @param {number} [length=MAX_SAFE_INTEGER] The upper bounds of a valid index.
 * @returns {boolean} Returns `true` if `value` is a valid index, else `false`.
 */
function isIndex(value, length) {
  var type = typeof value;
  length = length == null ? MAX_SAFE_INTEGER$1 : length;
  return !!length && (type == 'number' || type != 'symbol' && reIsUint.test(value)) && value > -1 && value % 1 == 0 && value < length;
}

/**
 * The base implementation of `assignValue` and `assignMergeValue` without
 * value checks.
 *
 * @private
 * @param {Object} object The object to modify.
 * @param {string} key The key of the property to assign.
 * @param {*} value The value to assign.
 */
function baseAssignValue(object, key, value) {
  if (key == '__proto__' && defineProperty$1) {
    defineProperty$1(object, key, {
      'configurable': true,
      'enumerable': true,
      'value': value,
      'writable': true
    });
  } else {
    object[key] = value;
  }
}

/**
 * Performs a
 * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
 * comparison between two values to determine if they are equivalent.
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to compare.
 * @param {*} other The other value to compare.
 * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
 * @example
 *
 * var object = { 'a': 1 };
 * var other = { 'a': 1 };
 *
 * _.eq(object, object);
 * // => true
 *
 * _.eq(object, other);
 * // => false
 *
 * _.eq('a', 'a');
 * // => true
 *
 * _.eq('a', Object('a'));
 * // => false
 *
 * _.eq(NaN, NaN);
 * // => true
 */
function eq(value, other) {
  return value === other || value !== value && other !== other;
}

/** Used for built-in method references. */
var objectProto$9 = Object.prototype;

/** Used to check objects for own properties. */
var hasOwnProperty$7 = objectProto$9.hasOwnProperty;

/**
 * Assigns `value` to `key` of `object` if the existing value is not equivalent
 * using [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
 * for equality comparisons.
 *
 * @private
 * @param {Object} object The object to modify.
 * @param {string} key The key of the property to assign.
 * @param {*} value The value to assign.
 */
function assignValue(object, key, value) {
  var objValue = object[key];
  if (!(hasOwnProperty$7.call(object, key) && eq(objValue, value)) || value === undefined && !(key in object)) {
    baseAssignValue(object, key, value);
  }
}

/**
 * Copies properties of `source` to `object`.
 *
 * @private
 * @param {Object} source The object to copy properties from.
 * @param {Array} props The property identifiers to copy.
 * @param {Object} [object={}] The object to copy properties to.
 * @param {Function} [customizer] The function to customize copied values.
 * @returns {Object} Returns `object`.
 */
function copyObject(source, props, object, customizer) {
  var isNew = !object;
  object || (object = {});
  var index = -1,
    length = props.length;
  while (++index < length) {
    var key = props[index];
    var newValue = customizer ? customizer(object[key], source[key], key, object, source) : undefined;
    if (newValue === undefined) {
      newValue = source[key];
    }
    if (isNew) {
      baseAssignValue(object, key, newValue);
    } else {
      assignValue(object, key, newValue);
    }
  }
  return object;
}

/** Used as references for various `Number` constants. */
var MAX_SAFE_INTEGER = 9007199254740991;

/**
 * Checks if `value` is a valid array-like length.
 *
 * **Note:** This method is loosely based on
 * [`ToLength`](http://ecma-international.org/ecma-262/7.0/#sec-tolength).
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a valid length, else `false`.
 * @example
 *
 * _.isLength(3);
 * // => true
 *
 * _.isLength(Number.MIN_VALUE);
 * // => false
 *
 * _.isLength(Infinity);
 * // => false
 *
 * _.isLength('3');
 * // => false
 */
function isLength(value) {
  return typeof value == 'number' && value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
}

/**
 * Checks if `value` is array-like. A value is considered array-like if it's
 * not a function and has a `value.length` that's an integer greater than or
 * equal to `0` and less than or equal to `Number.MAX_SAFE_INTEGER`.
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is array-like, else `false`.
 * @example
 *
 * _.isArrayLike([1, 2, 3]);
 * // => true
 *
 * _.isArrayLike(document.body.children);
 * // => true
 *
 * _.isArrayLike('abc');
 * // => true
 *
 * _.isArrayLike(_.noop);
 * // => false
 */
function isArrayLike(value) {
  return value != null && isLength(value.length) && !isFunction(value);
}

/** Used for built-in method references. */
var objectProto$8 = Object.prototype;

/**
 * Checks if `value` is likely a prototype object.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a prototype, else `false`.
 */
function isPrototype(value) {
  var Ctor = value && value.constructor,
    proto = typeof Ctor == 'function' && Ctor.prototype || objectProto$8;
  return value === proto;
}

/**
 * The base implementation of `_.times` without support for iteratee shorthands
 * or max array length checks.
 *
 * @private
 * @param {number} n The number of times to invoke `iteratee`.
 * @param {Function} iteratee The function invoked per iteration.
 * @returns {Array} Returns the array of results.
 */
function baseTimes(n, iteratee) {
  var index = -1,
    result = Array(n);
  while (++index < n) {
    result[index] = iteratee(index);
  }
  return result;
}

/** `Object#toString` result references. */
var argsTag$2 = '[object Arguments]';

/**
 * The base implementation of `_.isArguments`.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an `arguments` object,
 */
function baseIsArguments(value) {
  return isObjectLike(value) && baseGetTag(value) == argsTag$2;
}

/** Used for built-in method references. */
var objectProto$7 = Object.prototype;

/** Used to check objects for own properties. */
var hasOwnProperty$6 = objectProto$7.hasOwnProperty;

/** Built-in value references. */
var propertyIsEnumerable$1 = objectProto$7.propertyIsEnumerable;

/**
 * Checks if `value` is likely an `arguments` object.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an `arguments` object,
 *  else `false`.
 * @example
 *
 * _.isArguments(function() { return arguments; }());
 * // => true
 *
 * _.isArguments([1, 2, 3]);
 * // => false
 */
var isArguments = baseIsArguments(function () {
  return arguments;
}()) ? baseIsArguments : function (value) {
  return isObjectLike(value) && hasOwnProperty$6.call(value, 'callee') && !propertyIsEnumerable$1.call(value, 'callee');
};
var isArguments$1 = isArguments;

/**
 * This method returns `false`.
 *
 * @static
 * @memberOf _
 * @since 4.13.0
 * @category Util
 * @returns {boolean} Returns `false`.
 * @example
 *
 * _.times(2, _.stubFalse);
 * // => [false, false]
 */
function stubFalse() {
  return false;
}

/** Detect free variable `exports`. */
var freeExports$2 = typeof exports == 'object' && exports && !exports.nodeType && exports;

/** Detect free variable `module`. */
var freeModule$2 = freeExports$2 && typeof module == 'object' && module && !module.nodeType && module;

/** Detect the popular CommonJS extension `module.exports`. */
var moduleExports$2 = freeModule$2 && freeModule$2.exports === freeExports$2;

/** Built-in value references. */
var Buffer$1 = moduleExports$2 ? root$1.Buffer : undefined;

/* Built-in method references for those with the same name as other `lodash` methods. */
var nativeIsBuffer = Buffer$1 ? Buffer$1.isBuffer : undefined;

/**
 * Checks if `value` is a buffer.
 *
 * @static
 * @memberOf _
 * @since 4.3.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a buffer, else `false`.
 * @example
 *
 * _.isBuffer(new Buffer(2));
 * // => true
 *
 * _.isBuffer(new Uint8Array(2));
 * // => false
 */
var isBuffer = nativeIsBuffer || stubFalse;
var isBuffer$1 = isBuffer;

/** `Object#toString` result references. */
var argsTag$1 = '[object Arguments]',
  arrayTag$1 = '[object Array]',
  boolTag$2 = '[object Boolean]',
  dateTag$2 = '[object Date]',
  errorTag$1 = '[object Error]',
  funcTag$1 = '[object Function]',
  mapTag$4 = '[object Map]',
  numberTag$2 = '[object Number]',
  objectTag$2 = '[object Object]',
  regexpTag$2 = '[object RegExp]',
  setTag$4 = '[object Set]',
  stringTag$2 = '[object String]',
  weakMapTag$2 = '[object WeakMap]';
var arrayBufferTag$2 = '[object ArrayBuffer]',
  dataViewTag$3 = '[object DataView]',
  float32Tag$2 = '[object Float32Array]',
  float64Tag$2 = '[object Float64Array]',
  int8Tag$2 = '[object Int8Array]',
  int16Tag$2 = '[object Int16Array]',
  int32Tag$2 = '[object Int32Array]',
  uint8Tag$2 = '[object Uint8Array]',
  uint8ClampedTag$2 = '[object Uint8ClampedArray]',
  uint16Tag$2 = '[object Uint16Array]',
  uint32Tag$2 = '[object Uint32Array]';

/** Used to identify `toStringTag` values of typed arrays. */
var typedArrayTags = {};
typedArrayTags[float32Tag$2] = typedArrayTags[float64Tag$2] = typedArrayTags[int8Tag$2] = typedArrayTags[int16Tag$2] = typedArrayTags[int32Tag$2] = typedArrayTags[uint8Tag$2] = typedArrayTags[uint8ClampedTag$2] = typedArrayTags[uint16Tag$2] = typedArrayTags[uint32Tag$2] = true;
typedArrayTags[argsTag$1] = typedArrayTags[arrayTag$1] = typedArrayTags[arrayBufferTag$2] = typedArrayTags[boolTag$2] = typedArrayTags[dataViewTag$3] = typedArrayTags[dateTag$2] = typedArrayTags[errorTag$1] = typedArrayTags[funcTag$1] = typedArrayTags[mapTag$4] = typedArrayTags[numberTag$2] = typedArrayTags[objectTag$2] = typedArrayTags[regexpTag$2] = typedArrayTags[setTag$4] = typedArrayTags[stringTag$2] = typedArrayTags[weakMapTag$2] = false;

/**
 * The base implementation of `_.isTypedArray` without Node.js optimizations.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
 */
function baseIsTypedArray(value) {
  return isObjectLike(value) && isLength(value.length) && !!typedArrayTags[baseGetTag(value)];
}

/**
 * The base implementation of `_.unary` without support for storing metadata.
 *
 * @private
 * @param {Function} func The function to cap arguments for.
 * @returns {Function} Returns the new capped function.
 */
function baseUnary(func) {
  return function (value) {
    return func(value);
  };
}

/** Detect free variable `exports`. */
var freeExports$1 = typeof exports == 'object' && exports && !exports.nodeType && exports;

/** Detect free variable `module`. */
var freeModule$1 = freeExports$1 && typeof module == 'object' && module && !module.nodeType && module;

/** Detect the popular CommonJS extension `module.exports`. */
var moduleExports$1 = freeModule$1 && freeModule$1.exports === freeExports$1;

/** Detect free variable `process` from Node.js. */
var freeProcess = moduleExports$1 && freeGlobal$1.process;

/** Used to access faster Node.js helpers. */
var nodeUtil = function () {
  try {
    // Use `util.types` for Node.js 10+.
    var types = freeModule$1 && freeModule$1.require && freeModule$1.require('util').types;
    if (types) {
      return types;
    }

    // Legacy `process.binding('util')` for Node.js < 10.
    return freeProcess && freeProcess.binding && freeProcess.binding('util');
  } catch (e) {}
}();
var nodeUtil$1 = nodeUtil;

/* Node.js helper references. */
var nodeIsTypedArray = nodeUtil$1 && nodeUtil$1.isTypedArray;

/**
 * Checks if `value` is classified as a typed array.
 *
 * @static
 * @memberOf _
 * @since 3.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
 * @example
 *
 * _.isTypedArray(new Uint8Array);
 * // => true
 *
 * _.isTypedArray([]);
 * // => false
 */
var isTypedArray = nodeIsTypedArray ? baseUnary(nodeIsTypedArray) : baseIsTypedArray;
var isTypedArray$1 = isTypedArray;

/** Used for built-in method references. */
var objectProto$6 = Object.prototype;

/** Used to check objects for own properties. */
var hasOwnProperty$5 = objectProto$6.hasOwnProperty;

/**
 * Creates an array of the enumerable property names of the array-like `value`.
 *
 * @private
 * @param {*} value The value to query.
 * @param {boolean} inherited Specify returning inherited property names.
 * @returns {Array} Returns the array of property names.
 */
function arrayLikeKeys(value, inherited) {
  var isArr = isArray$1(value),
    isArg = !isArr && isArguments$1(value),
    isBuff = !isArr && !isArg && isBuffer$1(value),
    isType = !isArr && !isArg && !isBuff && isTypedArray$1(value),
    skipIndexes = isArr || isArg || isBuff || isType,
    result = skipIndexes ? baseTimes(value.length, String) : [],
    length = result.length;
  for (var key in value) {
    if ((inherited || hasOwnProperty$5.call(value, key)) && !(skipIndexes && (
    // Safari 9 has enumerable `arguments.length` in strict mode.
    key == 'length' ||
    // Node.js 0.10 has enumerable non-index properties on buffers.
    isBuff && (key == 'offset' || key == 'parent') ||
    // PhantomJS 2 has enumerable non-index properties on typed arrays.
    isType && (key == 'buffer' || key == 'byteLength' || key == 'byteOffset') ||
    // Skip index properties.
    isIndex(key, length)))) {
      result.push(key);
    }
  }
  return result;
}

/**
 * Creates a unary function that invokes `func` with its argument transformed.
 *
 * @private
 * @param {Function} func The function to wrap.
 * @param {Function} transform The argument transform.
 * @returns {Function} Returns the new function.
 */
function overArg(func, transform) {
  return function (arg) {
    return func(transform(arg));
  };
}

/* Built-in method references for those with the same name as other `lodash` methods. */
var nativeKeys = overArg(Object.keys, Object);
var nativeKeys$1 = nativeKeys;

/** Used for built-in method references. */
var objectProto$5 = Object.prototype;

/** Used to check objects for own properties. */
var hasOwnProperty$4 = objectProto$5.hasOwnProperty;

/**
 * The base implementation of `_.keys` which doesn't treat sparse arrays as dense.
 *
 * @private
 * @param {Object} object The object to query.
 * @returns {Array} Returns the array of property names.
 */
function baseKeys(object) {
  if (!isPrototype(object)) {
    return nativeKeys$1(object);
  }
  var result = [];
  for (var key in Object(object)) {
    if (hasOwnProperty$4.call(object, key) && key != 'constructor') {
      result.push(key);
    }
  }
  return result;
}

/**
 * Creates an array of the own enumerable property names of `object`.
 *
 * **Note:** Non-object values are coerced to objects. See the
 * [ES spec](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
 * for more details.
 *
 * @static
 * @since 0.1.0
 * @memberOf _
 * @category Object
 * @param {Object} object The object to query.
 * @returns {Array} Returns the array of property names.
 * @example
 *
 * function Foo() {
 *   this.a = 1;
 *   this.b = 2;
 * }
 *
 * Foo.prototype.c = 3;
 *
 * _.keys(new Foo);
 * // => ['a', 'b'] (iteration order is not guaranteed)
 *
 * _.keys('hi');
 * // => ['0', '1']
 */
function keys(object) {
  return isArrayLike(object) ? arrayLikeKeys(object) : baseKeys(object);
}

/**
 * This function is like
 * [`Object.keys`](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
 * except that it includes inherited enumerable properties.
 *
 * @private
 * @param {Object} object The object to query.
 * @returns {Array} Returns the array of property names.
 */
function nativeKeysIn(object) {
  var result = [];
  if (object != null) {
    for (var key in Object(object)) {
      result.push(key);
    }
  }
  return result;
}

/** Used for built-in method references. */
var objectProto$4 = Object.prototype;

/** Used to check objects for own properties. */
var hasOwnProperty$3 = objectProto$4.hasOwnProperty;

/**
 * The base implementation of `_.keysIn` which doesn't treat sparse arrays as dense.
 *
 * @private
 * @param {Object} object The object to query.
 * @returns {Array} Returns the array of property names.
 */
function baseKeysIn(object) {
  if (!isObject(object)) {
    return nativeKeysIn(object);
  }
  var isProto = isPrototype(object),
    result = [];
  for (var key in object) {
    if (!(key == 'constructor' && (isProto || !hasOwnProperty$3.call(object, key)))) {
      result.push(key);
    }
  }
  return result;
}

/**
 * Creates an array of the own and inherited enumerable property names of `object`.
 *
 * **Note:** Non-object values are coerced to objects.
 *
 * @static
 * @memberOf _
 * @since 3.0.0
 * @category Object
 * @param {Object} object The object to query.
 * @returns {Array} Returns the array of property names.
 * @example
 *
 * function Foo() {
 *   this.a = 1;
 *   this.b = 2;
 * }
 *
 * Foo.prototype.c = 3;
 *
 * _.keysIn(new Foo);
 * // => ['a', 'b', 'c'] (iteration order is not guaranteed)
 */
function keysIn(object) {
  return isArrayLike(object) ? arrayLikeKeys(object, true) : baseKeysIn(object);
}

/* Built-in method references that are verified to be native. */
var nativeCreate = getNative(Object, 'create');
var nativeCreate$1 = nativeCreate;

/**
 * Removes all key-value entries from the hash.
 *
 * @private
 * @name clear
 * @memberOf Hash
 */
function hashClear() {
  this.__data__ = nativeCreate$1 ? nativeCreate$1(null) : {};
  this.size = 0;
}

/**
 * Removes `key` and its value from the hash.
 *
 * @private
 * @name delete
 * @memberOf Hash
 * @param {Object} hash The hash to modify.
 * @param {string} key The key of the value to remove.
 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
 */
function hashDelete(key) {
  var result = this.has(key) && delete this.__data__[key];
  this.size -= result ? 1 : 0;
  return result;
}

/** Used to stand-in for `undefined` hash values. */
var HASH_UNDEFINED$1 = '__lodash_hash_undefined__';

/** Used for built-in method references. */
var objectProto$3 = Object.prototype;

/** Used to check objects for own properties. */
var hasOwnProperty$2 = objectProto$3.hasOwnProperty;

/**
 * Gets the hash value for `key`.
 *
 * @private
 * @name get
 * @memberOf Hash
 * @param {string} key The key of the value to get.
 * @returns {*} Returns the entry value.
 */
function hashGet(key) {
  var data = this.__data__;
  if (nativeCreate$1) {
    var result = data[key];
    return result === HASH_UNDEFINED$1 ? undefined : result;
  }
  return hasOwnProperty$2.call(data, key) ? data[key] : undefined;
}

/** Used for built-in method references. */
var objectProto$2 = Object.prototype;

/** Used to check objects for own properties. */
var hasOwnProperty$1 = objectProto$2.hasOwnProperty;

/**
 * Checks if a hash value for `key` exists.
 *
 * @private
 * @name has
 * @memberOf Hash
 * @param {string} key The key of the entry to check.
 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
 */
function hashHas(key) {
  var data = this.__data__;
  return nativeCreate$1 ? data[key] !== undefined : hasOwnProperty$1.call(data, key);
}

/** Used to stand-in for `undefined` hash values. */
var HASH_UNDEFINED = '__lodash_hash_undefined__';

/**
 * Sets the hash `key` to `value`.
 *
 * @private
 * @name set
 * @memberOf Hash
 * @param {string} key The key of the value to set.
 * @param {*} value The value to set.
 * @returns {Object} Returns the hash instance.
 */
function hashSet(key, value) {
  var data = this.__data__;
  this.size += this.has(key) ? 0 : 1;
  data[key] = nativeCreate$1 && value === undefined ? HASH_UNDEFINED : value;
  return this;
}

/**
 * Creates a hash object.
 *
 * @private
 * @constructor
 * @param {Array} [entries] The key-value pairs to cache.
 */
function Hash(entries) {
  var index = -1,
    length = entries == null ? 0 : entries.length;
  this.clear();
  while (++index < length) {
    var entry = entries[index];
    this.set(entry[0], entry[1]);
  }
}

// Add methods to `Hash`.
Hash.prototype.clear = hashClear;
Hash.prototype['delete'] = hashDelete;
Hash.prototype.get = hashGet;
Hash.prototype.has = hashHas;
Hash.prototype.set = hashSet;

/**
 * Removes all key-value entries from the list cache.
 *
 * @private
 * @name clear
 * @memberOf ListCache
 */
function listCacheClear() {
  this.__data__ = [];
  this.size = 0;
}

/**
 * Gets the index at which the `key` is found in `array` of key-value pairs.
 *
 * @private
 * @param {Array} array The array to inspect.
 * @param {*} key The key to search for.
 * @returns {number} Returns the index of the matched value, else `-1`.
 */
function assocIndexOf(array, key) {
  var length = array.length;
  while (length--) {
    if (eq(array[length][0], key)) {
      return length;
    }
  }
  return -1;
}

/** Used for built-in method references. */
var arrayProto = Array.prototype;

/** Built-in value references. */
var splice = arrayProto.splice;

/**
 * Removes `key` and its value from the list cache.
 *
 * @private
 * @name delete
 * @memberOf ListCache
 * @param {string} key The key of the value to remove.
 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
 */
function listCacheDelete(key) {
  var data = this.__data__,
    index = assocIndexOf(data, key);
  if (index < 0) {
    return false;
  }
  var lastIndex = data.length - 1;
  if (index == lastIndex) {
    data.pop();
  } else {
    splice.call(data, index, 1);
  }
  --this.size;
  return true;
}

/**
 * Gets the list cache value for `key`.
 *
 * @private
 * @name get
 * @memberOf ListCache
 * @param {string} key The key of the value to get.
 * @returns {*} Returns the entry value.
 */
function listCacheGet(key) {
  var data = this.__data__,
    index = assocIndexOf(data, key);
  return index < 0 ? undefined : data[index][1];
}

/**
 * Checks if a list cache value for `key` exists.
 *
 * @private
 * @name has
 * @memberOf ListCache
 * @param {string} key The key of the entry to check.
 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
 */
function listCacheHas(key) {
  return assocIndexOf(this.__data__, key) > -1;
}

/**
 * Sets the list cache `key` to `value`.
 *
 * @private
 * @name set
 * @memberOf ListCache
 * @param {string} key The key of the value to set.
 * @param {*} value The value to set.
 * @returns {Object} Returns the list cache instance.
 */
function listCacheSet(key, value) {
  var data = this.__data__,
    index = assocIndexOf(data, key);
  if (index < 0) {
    ++this.size;
    data.push([key, value]);
  } else {
    data[index][1] = value;
  }
  return this;
}

/**
 * Creates an list cache object.
 *
 * @private
 * @constructor
 * @param {Array} [entries] The key-value pairs to cache.
 */
function ListCache(entries) {
  var index = -1,
    length = entries == null ? 0 : entries.length;
  this.clear();
  while (++index < length) {
    var entry = entries[index];
    this.set(entry[0], entry[1]);
  }
}

// Add methods to `ListCache`.
ListCache.prototype.clear = listCacheClear;
ListCache.prototype['delete'] = listCacheDelete;
ListCache.prototype.get = listCacheGet;
ListCache.prototype.has = listCacheHas;
ListCache.prototype.set = listCacheSet;

/* Built-in method references that are verified to be native. */
var Map = getNative(root$1, 'Map');
var Map$1 = Map;

/**
 * Removes all key-value entries from the map.
 *
 * @private
 * @name clear
 * @memberOf MapCache
 */
function mapCacheClear() {
  this.size = 0;
  this.__data__ = {
    'hash': new Hash(),
    'map': new (Map$1 || ListCache)(),
    'string': new Hash()
  };
}

/**
 * Checks if `value` is suitable for use as unique object key.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is suitable, else `false`.
 */
function isKeyable(value) {
  var type = typeof value;
  return type == 'string' || type == 'number' || type == 'symbol' || type == 'boolean' ? value !== '__proto__' : value === null;
}

/**
 * Gets the data for `map`.
 *
 * @private
 * @param {Object} map The map to query.
 * @param {string} key The reference key.
 * @returns {*} Returns the map data.
 */
function getMapData(map, key) {
  var data = map.__data__;
  return isKeyable(key) ? data[typeof key == 'string' ? 'string' : 'hash'] : data.map;
}

/**
 * Removes `key` and its value from the map.
 *
 * @private
 * @name delete
 * @memberOf MapCache
 * @param {string} key The key of the value to remove.
 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
 */
function mapCacheDelete(key) {
  var result = getMapData(this, key)['delete'](key);
  this.size -= result ? 1 : 0;
  return result;
}

/**
 * Gets the map value for `key`.
 *
 * @private
 * @name get
 * @memberOf MapCache
 * @param {string} key The key of the value to get.
 * @returns {*} Returns the entry value.
 */
function mapCacheGet(key) {
  return getMapData(this, key).get(key);
}

/**
 * Checks if a map value for `key` exists.
 *
 * @private
 * @name has
 * @memberOf MapCache
 * @param {string} key The key of the entry to check.
 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
 */
function mapCacheHas(key) {
  return getMapData(this, key).has(key);
}

/**
 * Sets the map `key` to `value`.
 *
 * @private
 * @name set
 * @memberOf MapCache
 * @param {string} key The key of the value to set.
 * @param {*} value The value to set.
 * @returns {Object} Returns the map cache instance.
 */
function mapCacheSet(key, value) {
  var data = getMapData(this, key),
    size = data.size;
  data.set(key, value);
  this.size += data.size == size ? 0 : 1;
  return this;
}

/**
 * Creates a map cache object to store key-value pairs.
 *
 * @private
 * @constructor
 * @param {Array} [entries] The key-value pairs to cache.
 */
function MapCache(entries) {
  var index = -1,
    length = entries == null ? 0 : entries.length;
  this.clear();
  while (++index < length) {
    var entry = entries[index];
    this.set(entry[0], entry[1]);
  }
}

// Add methods to `MapCache`.
MapCache.prototype.clear = mapCacheClear;
MapCache.prototype['delete'] = mapCacheDelete;
MapCache.prototype.get = mapCacheGet;
MapCache.prototype.has = mapCacheHas;
MapCache.prototype.set = mapCacheSet;

/**
 * Appends the elements of `values` to `array`.
 *
 * @private
 * @param {Array} array The array to modify.
 * @param {Array} values The values to append.
 * @returns {Array} Returns `array`.
 */
function arrayPush(array, values) {
  var index = -1,
    length = values.length,
    offset = array.length;
  while (++index < length) {
    array[offset + index] = values[index];
  }
  return array;
}

/** Built-in value references. */
var getPrototype = overArg(Object.getPrototypeOf, Object);
var getPrototype$1 = getPrototype;

/**
 * Removes all key-value entries from the stack.
 *
 * @private
 * @name clear
 * @memberOf Stack
 */
function stackClear() {
  this.__data__ = new ListCache();
  this.size = 0;
}

/**
 * Removes `key` and its value from the stack.
 *
 * @private
 * @name delete
 * @memberOf Stack
 * @param {string} key The key of the value to remove.
 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
 */
function stackDelete(key) {
  var data = this.__data__,
    result = data['delete'](key);
  this.size = data.size;
  return result;
}

/**
 * Gets the stack value for `key`.
 *
 * @private
 * @name get
 * @memberOf Stack
 * @param {string} key The key of the value to get.
 * @returns {*} Returns the entry value.
 */
function stackGet(key) {
  return this.__data__.get(key);
}

/**
 * Checks if a stack value for `key` exists.
 *
 * @private
 * @name has
 * @memberOf Stack
 * @param {string} key The key of the entry to check.
 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
 */
function stackHas(key) {
  return this.__data__.has(key);
}

/** Used as the size to enable large array optimizations. */
var LARGE_ARRAY_SIZE = 200;

/**
 * Sets the stack `key` to `value`.
 *
 * @private
 * @name set
 * @memberOf Stack
 * @param {string} key The key of the value to set.
 * @param {*} value The value to set.
 * @returns {Object} Returns the stack cache instance.
 */
function stackSet(key, value) {
  var data = this.__data__;
  if (data instanceof ListCache) {
    var pairs = data.__data__;
    if (!Map$1 || pairs.length < LARGE_ARRAY_SIZE - 1) {
      pairs.push([key, value]);
      this.size = ++data.size;
      return this;
    }
    data = this.__data__ = new MapCache(pairs);
  }
  data.set(key, value);
  this.size = data.size;
  return this;
}

/**
 * Creates a stack cache object to store key-value pairs.
 *
 * @private
 * @constructor
 * @param {Array} [entries] The key-value pairs to cache.
 */
function Stack(entries) {
  var data = this.__data__ = new ListCache(entries);
  this.size = data.size;
}

// Add methods to `Stack`.
Stack.prototype.clear = stackClear;
Stack.prototype['delete'] = stackDelete;
Stack.prototype.get = stackGet;
Stack.prototype.has = stackHas;
Stack.prototype.set = stackSet;

/**
 * The base implementation of `_.assign` without support for multiple sources
 * or `customizer` functions.
 *
 * @private
 * @param {Object} object The destination object.
 * @param {Object} source The source object.
 * @returns {Object} Returns `object`.
 */
function baseAssign(object, source) {
  return object && copyObject(source, keys(source), object);
}

/**
 * The base implementation of `_.assignIn` without support for multiple sources
 * or `customizer` functions.
 *
 * @private
 * @param {Object} object The destination object.
 * @param {Object} source The source object.
 * @returns {Object} Returns `object`.
 */
function baseAssignIn(object, source) {
  return object && copyObject(source, keysIn(source), object);
}

/** Detect free variable `exports`. */
var freeExports = typeof exports == 'object' && exports && !exports.nodeType && exports;

/** Detect free variable `module`. */
var freeModule = freeExports && typeof module == 'object' && module && !module.nodeType && module;

/** Detect the popular CommonJS extension `module.exports`. */
var moduleExports = freeModule && freeModule.exports === freeExports;

/** Built-in value references. */
var Buffer = moduleExports ? root$1.Buffer : undefined,
  allocUnsafe = Buffer ? Buffer.allocUnsafe : undefined;

/**
 * Creates a clone of  `buffer`.
 *
 * @private
 * @param {Buffer} buffer The buffer to clone.
 * @param {boolean} [isDeep] Specify a deep clone.
 * @returns {Buffer} Returns the cloned buffer.
 */
function cloneBuffer(buffer, isDeep) {
  if (isDeep) {
    return buffer.slice();
  }
  var length = buffer.length,
    result = allocUnsafe ? allocUnsafe(length) : new buffer.constructor(length);
  buffer.copy(result);
  return result;
}

/**
 * A specialized version of `_.filter` for arrays without support for
 * iteratee shorthands.
 *
 * @private
 * @param {Array} [array] The array to iterate over.
 * @param {Function} predicate The function invoked per iteration.
 * @returns {Array} Returns the new filtered array.
 */
function arrayFilter(array, predicate) {
  var index = -1,
    length = array == null ? 0 : array.length,
    resIndex = 0,
    result = [];
  while (++index < length) {
    var value = array[index];
    if (predicate(value, index, array)) {
      result[resIndex++] = value;
    }
  }
  return result;
}

/**
 * This method returns a new empty array.
 *
 * @static
 * @memberOf _
 * @since 4.13.0
 * @category Util
 * @returns {Array} Returns the new empty array.
 * @example
 *
 * var arrays = _.times(2, _.stubArray);
 *
 * console.log(arrays);
 * // => [[], []]
 *
 * console.log(arrays[0] === arrays[1]);
 * // => false
 */
function stubArray() {
  return [];
}

/** Used for built-in method references. */
var objectProto$1 = Object.prototype;

/** Built-in value references. */
var propertyIsEnumerable = objectProto$1.propertyIsEnumerable;

/* Built-in method references for those with the same name as other `lodash` methods. */
var nativeGetSymbols$1 = Object.getOwnPropertySymbols;

/**
 * Creates an array of the own enumerable symbols of `object`.
 *
 * @private
 * @param {Object} object The object to query.
 * @returns {Array} Returns the array of symbols.
 */
var getSymbols = !nativeGetSymbols$1 ? stubArray : function (object) {
  if (object == null) {
    return [];
  }
  object = Object(object);
  return arrayFilter(nativeGetSymbols$1(object), function (symbol) {
    return propertyIsEnumerable.call(object, symbol);
  });
};
var getSymbols$1 = getSymbols;

/**
 * Copies own symbols of `source` to `object`.
 *
 * @private
 * @param {Object} source The object to copy symbols from.
 * @param {Object} [object={}] The object to copy symbols to.
 * @returns {Object} Returns `object`.
 */
function copySymbols(source, object) {
  return copyObject(source, getSymbols$1(source), object);
}

/* Built-in method references for those with the same name as other `lodash` methods. */
var nativeGetSymbols = Object.getOwnPropertySymbols;

/**
 * Creates an array of the own and inherited enumerable symbols of `object`.
 *
 * @private
 * @param {Object} object The object to query.
 * @returns {Array} Returns the array of symbols.
 */
var getSymbolsIn = !nativeGetSymbols ? stubArray : function (object) {
  var result = [];
  while (object) {
    arrayPush(result, getSymbols$1(object));
    object = getPrototype$1(object);
  }
  return result;
};
var getSymbolsIn$1 = getSymbolsIn;

/**
 * Copies own and inherited symbols of `source` to `object`.
 *
 * @private
 * @param {Object} source The object to copy symbols from.
 * @param {Object} [object={}] The object to copy symbols to.
 * @returns {Object} Returns `object`.
 */
function copySymbolsIn(source, object) {
  return copyObject(source, getSymbolsIn$1(source), object);
}

/**
 * The base implementation of `getAllKeys` and `getAllKeysIn` which uses
 * `keysFunc` and `symbolsFunc` to get the enumerable property names and
 * symbols of `object`.
 *
 * @private
 * @param {Object} object The object to query.
 * @param {Function} keysFunc The function to get the keys of `object`.
 * @param {Function} symbolsFunc The function to get the symbols of `object`.
 * @returns {Array} Returns the array of property names and symbols.
 */
function baseGetAllKeys(object, keysFunc, symbolsFunc) {
  var result = keysFunc(object);
  return isArray$1(object) ? result : arrayPush(result, symbolsFunc(object));
}

/**
 * Creates an array of own enumerable property names and symbols of `object`.
 *
 * @private
 * @param {Object} object The object to query.
 * @returns {Array} Returns the array of property names and symbols.
 */
function getAllKeys(object) {
  return baseGetAllKeys(object, keys, getSymbols$1);
}

/**
 * Creates an array of own and inherited enumerable property names and
 * symbols of `object`.
 *
 * @private
 * @param {Object} object The object to query.
 * @returns {Array} Returns the array of property names and symbols.
 */
function getAllKeysIn(object) {
  return baseGetAllKeys(object, keysIn, getSymbolsIn$1);
}

/* Built-in method references that are verified to be native. */
var DataView = getNative(root$1, 'DataView');
var DataView$1 = DataView;

/* Built-in method references that are verified to be native. */
var Promise$1 = getNative(root$1, 'Promise');
var Promise$2 = Promise$1;

/* Built-in method references that are verified to be native. */
var Set = getNative(root$1, 'Set');
var Set$1 = Set;

/** `Object#toString` result references. */
var mapTag$3 = '[object Map]',
  objectTag$1 = '[object Object]',
  promiseTag = '[object Promise]',
  setTag$3 = '[object Set]',
  weakMapTag$1 = '[object WeakMap]';
var dataViewTag$2 = '[object DataView]';

/** Used to detect maps, sets, and weakmaps. */
var dataViewCtorString = toSource(DataView$1),
  mapCtorString = toSource(Map$1),
  promiseCtorString = toSource(Promise$2),
  setCtorString = toSource(Set$1),
  weakMapCtorString = toSource(WeakMap$1);

/**
 * Gets the `toStringTag` of `value`.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the `toStringTag`.
 */
var getTag = baseGetTag;

// Fallback for data views, maps, sets, and weak maps in IE 11 and promises in Node.js < 6.
if (DataView$1 && getTag(new DataView$1(new ArrayBuffer(1))) != dataViewTag$2 || Map$1 && getTag(new Map$1()) != mapTag$3 || Promise$2 && getTag(Promise$2.resolve()) != promiseTag || Set$1 && getTag(new Set$1()) != setTag$3 || WeakMap$1 && getTag(new WeakMap$1()) != weakMapTag$1) {
  getTag = function (value) {
    var result = baseGetTag(value),
      Ctor = result == objectTag$1 ? value.constructor : undefined,
      ctorString = Ctor ? toSource(Ctor) : '';
    if (ctorString) {
      switch (ctorString) {
        case dataViewCtorString:
          return dataViewTag$2;
        case mapCtorString:
          return mapTag$3;
        case promiseCtorString:
          return promiseTag;
        case setCtorString:
          return setTag$3;
        case weakMapCtorString:
          return weakMapTag$1;
      }
    }
    return result;
  };
}
var getTag$1 = getTag;

/** Used for built-in method references. */
var objectProto = Object.prototype;

/** Used to check objects for own properties. */
var hasOwnProperty = objectProto.hasOwnProperty;

/**
 * Initializes an array clone.
 *
 * @private
 * @param {Array} array The array to clone.
 * @returns {Array} Returns the initialized clone.
 */
function initCloneArray(array) {
  var length = array.length,
    result = new array.constructor(length);

  // Add properties assigned by `RegExp#exec`.
  if (length && typeof array[0] == 'string' && hasOwnProperty.call(array, 'index')) {
    result.index = array.index;
    result.input = array.input;
  }
  return result;
}

/** Built-in value references. */
var Uint8Array$1 = root$1.Uint8Array;
var Uint8Array$2 = Uint8Array$1;

/**
 * Creates a clone of `arrayBuffer`.
 *
 * @private
 * @param {ArrayBuffer} arrayBuffer The array buffer to clone.
 * @returns {ArrayBuffer} Returns the cloned array buffer.
 */
function cloneArrayBuffer(arrayBuffer) {
  var result = new arrayBuffer.constructor(arrayBuffer.byteLength);
  new Uint8Array$2(result).set(new Uint8Array$2(arrayBuffer));
  return result;
}

/**
 * Creates a clone of `dataView`.
 *
 * @private
 * @param {Object} dataView The data view to clone.
 * @param {boolean} [isDeep] Specify a deep clone.
 * @returns {Object} Returns the cloned data view.
 */
function cloneDataView(dataView, isDeep) {
  var buffer = isDeep ? cloneArrayBuffer(dataView.buffer) : dataView.buffer;
  return new dataView.constructor(buffer, dataView.byteOffset, dataView.byteLength);
}

/** Used to match `RegExp` flags from their coerced string values. */
var reFlags = /\w*$/;

/**
 * Creates a clone of `regexp`.
 *
 * @private
 * @param {Object} regexp The regexp to clone.
 * @returns {Object} Returns the cloned regexp.
 */
function cloneRegExp(regexp) {
  var result = new regexp.constructor(regexp.source, reFlags.exec(regexp));
  result.lastIndex = regexp.lastIndex;
  return result;
}

/** Used to convert symbols to primitives and strings. */
var symbolProto = Symbol$1 ? Symbol$1.prototype : undefined,
  symbolValueOf = symbolProto ? symbolProto.valueOf : undefined;

/**
 * Creates a clone of the `symbol` object.
 *
 * @private
 * @param {Object} symbol The symbol object to clone.
 * @returns {Object} Returns the cloned symbol object.
 */
function cloneSymbol(symbol) {
  return symbolValueOf ? Object(symbolValueOf.call(symbol)) : {};
}

/**
 * Creates a clone of `typedArray`.
 *
 * @private
 * @param {Object} typedArray The typed array to clone.
 * @param {boolean} [isDeep] Specify a deep clone.
 * @returns {Object} Returns the cloned typed array.
 */
function cloneTypedArray(typedArray, isDeep) {
  var buffer = isDeep ? cloneArrayBuffer(typedArray.buffer) : typedArray.buffer;
  return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
}

/** `Object#toString` result references. */
var boolTag$1 = '[object Boolean]',
  dateTag$1 = '[object Date]',
  mapTag$2 = '[object Map]',
  numberTag$1 = '[object Number]',
  regexpTag$1 = '[object RegExp]',
  setTag$2 = '[object Set]',
  stringTag$1 = '[object String]',
  symbolTag$1 = '[object Symbol]';
var arrayBufferTag$1 = '[object ArrayBuffer]',
  dataViewTag$1 = '[object DataView]',
  float32Tag$1 = '[object Float32Array]',
  float64Tag$1 = '[object Float64Array]',
  int8Tag$1 = '[object Int8Array]',
  int16Tag$1 = '[object Int16Array]',
  int32Tag$1 = '[object Int32Array]',
  uint8Tag$1 = '[object Uint8Array]',
  uint8ClampedTag$1 = '[object Uint8ClampedArray]',
  uint16Tag$1 = '[object Uint16Array]',
  uint32Tag$1 = '[object Uint32Array]';

/**
 * Initializes an object clone based on its `toStringTag`.
 *
 * **Note:** This function only supports cloning values with tags of
 * `Boolean`, `Date`, `Error`, `Map`, `Number`, `RegExp`, `Set`, or `String`.
 *
 * @private
 * @param {Object} object The object to clone.
 * @param {string} tag The `toStringTag` of the object to clone.
 * @param {boolean} [isDeep] Specify a deep clone.
 * @returns {Object} Returns the initialized clone.
 */
function initCloneByTag(object, tag, isDeep) {
  var Ctor = object.constructor;
  switch (tag) {
    case arrayBufferTag$1:
      return cloneArrayBuffer(object);
    case boolTag$1:
    case dateTag$1:
      return new Ctor(+object);
    case dataViewTag$1:
      return cloneDataView(object, isDeep);
    case float32Tag$1:
    case float64Tag$1:
    case int8Tag$1:
    case int16Tag$1:
    case int32Tag$1:
    case uint8Tag$1:
    case uint8ClampedTag$1:
    case uint16Tag$1:
    case uint32Tag$1:
      return cloneTypedArray(object, isDeep);
    case mapTag$2:
      return new Ctor();
    case numberTag$1:
    case stringTag$1:
      return new Ctor(object);
    case regexpTag$1:
      return cloneRegExp(object);
    case setTag$2:
      return new Ctor();
    case symbolTag$1:
      return cloneSymbol(object);
  }
}

/**
 * Initializes an object clone.
 *
 * @private
 * @param {Object} object The object to clone.
 * @returns {Object} Returns the initialized clone.
 */
function initCloneObject(object) {
  return typeof object.constructor == 'function' && !isPrototype(object) ? baseCreate$1(getPrototype$1(object)) : {};
}

/** `Object#toString` result references. */
var mapTag$1 = '[object Map]';

/**
 * The base implementation of `_.isMap` without Node.js optimizations.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a map, else `false`.
 */
function baseIsMap(value) {
  return isObjectLike(value) && getTag$1(value) == mapTag$1;
}

/* Node.js helper references. */
var nodeIsMap = nodeUtil$1 && nodeUtil$1.isMap;

/**
 * Checks if `value` is classified as a `Map` object.
 *
 * @static
 * @memberOf _
 * @since 4.3.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a map, else `false`.
 * @example
 *
 * _.isMap(new Map);
 * // => true
 *
 * _.isMap(new WeakMap);
 * // => false
 */
var isMap = nodeIsMap ? baseUnary(nodeIsMap) : baseIsMap;
var isMap$1 = isMap;

/** `Object#toString` result references. */
var setTag$1 = '[object Set]';

/**
 * The base implementation of `_.isSet` without Node.js optimizations.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a set, else `false`.
 */
function baseIsSet(value) {
  return isObjectLike(value) && getTag$1(value) == setTag$1;
}

/* Node.js helper references. */
var nodeIsSet = nodeUtil$1 && nodeUtil$1.isSet;

/**
 * Checks if `value` is classified as a `Set` object.
 *
 * @static
 * @memberOf _
 * @since 4.3.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a set, else `false`.
 * @example
 *
 * _.isSet(new Set);
 * // => true
 *
 * _.isSet(new WeakSet);
 * // => false
 */
var isSet = nodeIsSet ? baseUnary(nodeIsSet) : baseIsSet;
var isSet$1 = isSet;

/** Used to compose bitmasks for cloning. */
var CLONE_DEEP_FLAG$1 = 1,
  CLONE_FLAT_FLAG = 2,
  CLONE_SYMBOLS_FLAG$1 = 4;

/** `Object#toString` result references. */
var argsTag = '[object Arguments]',
  arrayTag = '[object Array]',
  boolTag = '[object Boolean]',
  dateTag = '[object Date]',
  errorTag = '[object Error]',
  funcTag = '[object Function]',
  genTag = '[object GeneratorFunction]',
  mapTag = '[object Map]',
  numberTag = '[object Number]',
  objectTag = '[object Object]',
  regexpTag = '[object RegExp]',
  setTag = '[object Set]',
  stringTag = '[object String]',
  symbolTag = '[object Symbol]',
  weakMapTag = '[object WeakMap]';
var arrayBufferTag = '[object ArrayBuffer]',
  dataViewTag = '[object DataView]',
  float32Tag = '[object Float32Array]',
  float64Tag = '[object Float64Array]',
  int8Tag = '[object Int8Array]',
  int16Tag = '[object Int16Array]',
  int32Tag = '[object Int32Array]',
  uint8Tag = '[object Uint8Array]',
  uint8ClampedTag = '[object Uint8ClampedArray]',
  uint16Tag = '[object Uint16Array]',
  uint32Tag = '[object Uint32Array]';

/** Used to identify `toStringTag` values supported by `_.clone`. */
var cloneableTags = {};
cloneableTags[argsTag] = cloneableTags[arrayTag] = cloneableTags[arrayBufferTag] = cloneableTags[dataViewTag] = cloneableTags[boolTag] = cloneableTags[dateTag] = cloneableTags[float32Tag] = cloneableTags[float64Tag] = cloneableTags[int8Tag] = cloneableTags[int16Tag] = cloneableTags[int32Tag] = cloneableTags[mapTag] = cloneableTags[numberTag] = cloneableTags[objectTag] = cloneableTags[regexpTag] = cloneableTags[setTag] = cloneableTags[stringTag] = cloneableTags[symbolTag] = cloneableTags[uint8Tag] = cloneableTags[uint8ClampedTag] = cloneableTags[uint16Tag] = cloneableTags[uint32Tag] = true;
cloneableTags[errorTag] = cloneableTags[funcTag] = cloneableTags[weakMapTag] = false;

/**
 * The base implementation of `_.clone` and `_.cloneDeep` which tracks
 * traversed objects.
 *
 * @private
 * @param {*} value The value to clone.
 * @param {boolean} bitmask The bitmask flags.
 *  1 - Deep clone
 *  2 - Flatten inherited properties
 *  4 - Clone symbols
 * @param {Function} [customizer] The function to customize cloning.
 * @param {string} [key] The key of `value`.
 * @param {Object} [object] The parent object of `value`.
 * @param {Object} [stack] Tracks traversed objects and their clone counterparts.
 * @returns {*} Returns the cloned value.
 */
function baseClone(value, bitmask, customizer, key, object, stack) {
  var result,
    isDeep = bitmask & CLONE_DEEP_FLAG$1,
    isFlat = bitmask & CLONE_FLAT_FLAG,
    isFull = bitmask & CLONE_SYMBOLS_FLAG$1;
  if (customizer) {
    result = object ? customizer(value, key, object, stack) : customizer(value);
  }
  if (result !== undefined) {
    return result;
  }
  if (!isObject(value)) {
    return value;
  }
  var isArr = isArray$1(value);
  if (isArr) {
    result = initCloneArray(value);
    if (!isDeep) {
      return copyArray(value, result);
    }
  } else {
    var tag = getTag$1(value),
      isFunc = tag == funcTag || tag == genTag;
    if (isBuffer$1(value)) {
      return cloneBuffer(value, isDeep);
    }
    if (tag == objectTag || tag == argsTag || isFunc && !object) {
      result = isFlat || isFunc ? {} : initCloneObject(value);
      if (!isDeep) {
        return isFlat ? copySymbolsIn(value, baseAssignIn(result, value)) : copySymbols(value, baseAssign(result, value));
      }
    } else {
      if (!cloneableTags[tag]) {
        return object ? value : {};
      }
      result = initCloneByTag(value, tag, isDeep);
    }
  }
  // Check for circular references and return its corresponding clone.
  stack || (stack = new Stack());
  var stacked = stack.get(value);
  if (stacked) {
    return stacked;
  }
  stack.set(value, result);
  if (isSet$1(value)) {
    value.forEach(function (subValue) {
      result.add(baseClone(subValue, bitmask, customizer, subValue, value, stack));
    });
  } else if (isMap$1(value)) {
    value.forEach(function (subValue, key) {
      result.set(key, baseClone(subValue, bitmask, customizer, key, value, stack));
    });
  }
  var keysFunc = isFull ? isFlat ? getAllKeysIn : getAllKeys : isFlat ? keysIn : keys;
  var props = isArr ? undefined : keysFunc(value);
  arrayEach(props || value, function (subValue, key) {
    if (props) {
      key = subValue;
      subValue = value[key];
    }
    // Recursively populate clone (susceptible to call stack limits).
    assignValue(result, key, baseClone(subValue, bitmask, customizer, key, value, stack));
  });
  return result;
}

/** Used to compose bitmasks for cloning. */
var CLONE_DEEP_FLAG = 1,
  CLONE_SYMBOLS_FLAG = 4;

/**
 * This method is like `_.clone` except that it recursively clones `value`.
 *
 * @static
 * @memberOf _
 * @since 1.0.0
 * @category Lang
 * @param {*} value The value to recursively clone.
 * @returns {*} Returns the deep cloned value.
 * @see _.clone
 * @example
 *
 * var objects = [{ 'a': 1 }, { 'b': 2 }];
 *
 * var deep = _.cloneDeep(objects);
 * console.log(deep[0] === objects[0]);
 * // => false
 */
function cloneDeep(value) {
  return baseClone(value, CLONE_DEEP_FLAG | CLONE_SYMBOLS_FLAG);
}

const TYPE_KEY = "typeInfo";
var TypeBrand;
(function (TypeBrand) {
  TypeBrand["BIGINT"] = "bigint";
  TypeBrand["DATE"] = "date";
})(TypeBrand || (TypeBrand = {}));
function getValueWithOptions(subDatatype, value, options = {
  deserializer: deserialize
}) {
  if (value === null) {
    return options?.defaultValue ?? null;
  }
  // here is an obj
  let deserialized = deserialize(value);
  if (deserialized === undefined || deserialized === null) {
    return options?.defaultValue ?? null;
  }
  if (options?.reconstructor) {
    // example: // { collection: {reconstructor: LookupMap.reconstruct, value: 'string'}}
    const collection = options.reconstructor(deserialized);
    if (subDatatype !== undefined &&
    // eslint-disable-next-line no-prototype-builtins
    subDatatype.hasOwnProperty("class") &&
    // eslint-disable-next-line no-prototype-builtins
    subDatatype["class"].hasOwnProperty("value")) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      collection.subtype = function () {
        // example: {class: UnorderedMap, value: UnorderedMap}
        return subDatatype["class"]["value"];
      };
    }
    return collection;
  }
  // example: { collection: {reconstructor: LookupMap.reconstruct, value: 'string'}}
  if (subDatatype !== undefined) {
    // subtype info is a class constructor, Such as Car
    if (typeof subDatatype === "function") {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      deserialized = decodeObj2class(new subDatatype(), deserialized);
    } else if (typeof subDatatype === "object") {
      // normal collections of array, map; subtype will be:
      //  {map: { key: 'string', value: 'string' }} or {array: {value: 'string'}} ..
      // eslint-disable-next-line no-prototype-builtins
      if (subDatatype.hasOwnProperty("map")) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        for (const mkey in deserialized) {
          if (subDatatype["map"]["value"] !== "string") {
            deserialized[mkey] = decodeObj2class(new subDatatype["map"]["value"](), value[mkey]);
          }
        }
        // eslint-disable-next-line no-prototype-builtins
      } else if (subDatatype.hasOwnProperty("array")) {
        const new_vec = [];
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        for (const k in deserialized) {
          if (subDatatype["array"]["value"] !== "string") {
            new_vec.push(decodeObj2class(new subDatatype["array"]["value"](), value[k]));
          }
        }
        deserialized = new_vec;
        // eslint-disable-next-line no-prototype-builtins
      }
    }
  }
  return deserialized;
}
function serializeValueWithOptions(value, {
  serializer
} = {
  serializer: serialize
}) {
  return serializer(value);
}
function serialize(valueToSerialize) {
  return encode(JSON.stringify(valueToSerialize, function (key, value) {
    if (typeof value === "bigint") {
      return {
        value: value.toString(),
        [TYPE_KEY]: TypeBrand.BIGINT
      };
    }
    if (typeof this[key] === "object" && this[key] !== null && this[key] instanceof Date) {
      return {
        value: this[key].toISOString(),
        [TYPE_KEY]: TypeBrand.DATE
      };
    }
    return value;
  }));
}
function deserialize(valueToDeserialize) {
  return JSON.parse(decode(valueToDeserialize), (_, value) => {
    if (value !== null && typeof value === "object" && Object.keys(value).length === 2 && Object.keys(value).every(key => ["value", TYPE_KEY].includes(key))) {
      switch (value[TYPE_KEY]) {
        case TypeBrand.BIGINT:
          return BigInt(value["value"]);
        case TypeBrand.DATE:
          return new Date(value["value"]);
      }
    }
    return value;
  });
}
function decodeObj2class(class_instance, obj) {
  if (typeof obj != "object" || typeof obj === "bigint" || obj instanceof Date || class_instance.constructor.schema === undefined) {
    return obj;
  }
  let key;
  for (key in obj) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const value = obj[key];
    if (typeof value == "object") {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const ty = class_instance.constructor.schema[key];
      // eslint-disable-next-line no-prototype-builtins
      if (ty !== undefined && ty.hasOwnProperty("map")) {
        for (const mkey in value) {
          if (ty["map"]["value"] === "string") {
            class_instance[key][mkey] = value[mkey];
          } else {
            class_instance[key][mkey] = decodeObj2class(new ty["map"]["value"](), value[mkey]);
          }
        }
        // eslint-disable-next-line no-prototype-builtins
      } else if (ty !== undefined && ty.hasOwnProperty("array")) {
        for (const k in value) {
          if (ty["array"]["value"] === "string") {
            class_instance[key].push(value[k]);
          } else {
            class_instance[key].push(decodeObj2class(new ty["array"]["value"](), value[k]));
          }
        }
        // eslint-disable-next-line no-prototype-builtins
      } else if (ty !== undefined && ty.hasOwnProperty("class")) {
        // => nested_lookup_recordes:  {class: UnorderedMap, value: {class: LookupMap }},
        class_instance[key] = ty["class"].reconstruct(obj[key]);
        // eslint-disable-next-line no-prototype-builtins
        if (ty.hasOwnProperty("value")) {
          const subtype_value = ty["value"];
          class_instance[key].subtype = function () {
            // example: { collection: {reconstructor: LookupMap.reconstruct, value: 'string'}}
            // example: UnorderedMap or {class: UnorderedMap, value: 'string'}
            return subtype_value;
          };
        }
      } else if (ty !== undefined && typeof ty.reconstruct === "function") {
        class_instance[key] = ty.reconstruct(obj[key]);
      } else {
        // normal case with nested Class, such as field is truck: Truck,
        class_instance[key] = decodeObj2class(class_instance[key], obj[key]);
      }
    } else {
      class_instance[key] = obj[key];
    }
  }
  const instance_tmp = cloneDeep(class_instance);
  for (key in obj) {
    if (typeof class_instance[key] == "object" && !(class_instance[key] instanceof Date)) {
      class_instance[key] = instance_tmp[key];
    }
  }
  return class_instance;
}
/**
 * Convert a string to Uint8Array, each character must have a char code between 0-255.
 * @param s - string that with only Latin1 character to convert
 * @returns result Uint8Array
 */
function bytes(s) {
  return env.latin1_string_to_uint8array(s);
}
/**
 * Convert a Uint8Array to string, each uint8 to the single character of that char code
 * @param a - Uint8Array to convert
 * @returns result string
 */
function str(a) {
  return env.uint8array_to_latin1_string(a);
}
/**
 * Encode the string to Uint8Array with UTF-8 encoding
 * @param s - String to encode
 * @returns result Uint8Array
 */
function encode(s) {
  return env.utf8_string_to_uint8array(s);
}
/**
 * Decode the Uint8Array to string in UTF-8 encoding
 * @param a - array to decode
 * @returns result string
 */
function decode(a) {
  return env.uint8array_to_utf8_string(a);
}

var CurveType;
(function (CurveType) {
  CurveType[CurveType["ED25519"] = 0] = "ED25519";
  CurveType[CurveType["SECP256K1"] = 1] = "SECP256K1";
})(CurveType || (CurveType = {}));
var DataLength;
(function (DataLength) {
  DataLength[DataLength["ED25519"] = 32] = "ED25519";
  DataLength[DataLength["SECP256K1"] = 64] = "SECP256K1";
})(DataLength || (DataLength = {}));

/**
 * A Promise result in near can be one of:
 * - NotReady = 0 - the promise you are specifying is still not ready, not yet failed nor successful.
 * - Successful = 1 - the promise has been successfully executed and you can retrieve the resulting value.
 * - Failed = 2 - the promise execution has failed.
 */
var PromiseResult;
(function (PromiseResult) {
  PromiseResult[PromiseResult["NotReady"] = 0] = "NotReady";
  PromiseResult[PromiseResult["Successful"] = 1] = "Successful";
  PromiseResult[PromiseResult["Failed"] = 2] = "Failed";
})(PromiseResult || (PromiseResult = {}));
/**
 * A promise error can either be due to the promise failing or not yet being ready.
 */
var PromiseError;
(function (PromiseError) {
  PromiseError[PromiseError["Failed"] = 0] = "Failed";
  PromiseError[PromiseError["NotReady"] = 1] = "NotReady";
})(PromiseError || (PromiseError = {}));

const U64_MAX = 2n ** 64n - 1n;
const EVICTED_REGISTER = U64_MAX - 1n;
/**
 * Logs parameters in the NEAR WASM virtual machine.
 *
 * @param params - Parameters to log.
 */
function log(...params) {
  env.log(params.reduce((accumulated, parameter, index) => {
    // Stringify undefined
    const param = parameter === undefined ? "undefined" : parameter;
    // Convert Objects to strings and convert to string
    const stringified = typeof param === "object" ? JSON.stringify(param) : `${param}`;
    if (index === 0) {
      return stringified;
    }
    return `${accumulated} ${stringified}`;
  }, ""));
}
/**
 * Returns the account ID of the account that called the function.
 * Can only be called in a call or initialize function.
 */
function predecessorAccountId() {
  env.predecessor_account_id(0);
  return str(env.read_register(0));
}
/**
 * Returns the account ID of the current contract - the contract that is being executed.
 */
function currentAccountId() {
  env.current_account_id(0);
  return str(env.read_register(0));
}
/**
 * Returns the current block timestamp.
 */
function blockTimestamp() {
  return env.block_timestamp();
}
/**
 * Returns the amount of NEAR attached to this function call.
 * Can only be called in payable functions.
 */
function attachedDeposit() {
  return env.attached_deposit();
}
/**
 * Reads the value from NEAR storage that is stored under the provided key.
 *
 * @param key - The key to read from storage.
 */
function storageReadRaw(key) {
  const returnValue = env.storage_read(key, 0);
  if (returnValue !== 1n) {
    return null;
  }
  return env.read_register(0);
}
/**
 * Checks for the existance of a value under the provided key in NEAR storage.
 *
 * @param key - The key to check for in storage.
 */
function storageHasKeyRaw(key) {
  return env.storage_has_key(key) === 1n;
}
/**
 * Checks for the existance of a value under the provided utf-8 string key in NEAR storage.
 *
 * @param key - The utf-8 string key to check for in storage.
 */
function storageHasKey(key) {
  return storageHasKeyRaw(encode(key));
}
/**
 * Get the last written or removed value from NEAR storage.
 */
function storageGetEvictedRaw() {
  return env.read_register(EVICTED_REGISTER);
}
/**
 * Writes the provided bytes to NEAR storage under the provided key.
 *
 * @param key - The key under which to store the value.
 * @param value - The value to store.
 */
function storageWriteRaw(key, value) {
  return env.storage_write(key, value, EVICTED_REGISTER) === 1n;
}
/**
 * Removes the value of the provided key from NEAR storage.
 *
 * @param key - The key to be removed.
 */
function storageRemoveRaw(key) {
  return env.storage_remove(key, EVICTED_REGISTER) === 1n;
}
/**
 * Removes the value of the provided utf-8 string key from NEAR storage.
 *
 * @param key - The utf-8 string key to be removed.
 */
function storageRemove(key) {
  return storageRemoveRaw(encode(key));
}
/**
 * Returns the arguments passed to the current smart contract call.
 */
function inputRaw() {
  env.input(0);
  return env.read_register(0);
}
/**
 * Returns the arguments passed to the current smart contract call as utf-8 string.
 */
function input() {
  return decode(inputRaw());
}
/**
 * Create a NEAR promise which will have multiple promise actions inside.
 *
 * @param accountId - The account ID of the target contract.
 */
function promiseBatchCreate(accountId) {
  return env.promise_batch_create(accountId);
}
/**
 * Attach a transfer promise action to the NEAR promise index with the provided promise index.
 *
 * @param promiseIndex - The index of the promise to attach a transfer action to.
 * @param amount - The amount of NEAR to transfer.
 */
function promiseBatchActionTransfer(promiseIndex, amount) {
  env.promise_batch_action_transfer(promiseIndex, amount);
}
/**
 * Returns sha256 hash of given value
 * @param value - value to be hashed, in Bytes
 * @returns hash result in Bytes
 */
function sha256$1(value) {
  env.sha256(value, 0);
  return env.read_register(0);
}

class SubType {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  /* eslint-disable @typescript-eslint/no-empty-function */
  subtype() {}
  set_reconstructor(options) {
    if (options == undefined) {
      options = {};
    }
    const subtype = this.subtype();
    if (options.reconstructor == undefined && subtype != undefined) {
      if (
      // eslint-disable-next-line no-prototype-builtins
      subtype.hasOwnProperty("class") && typeof subtype.class.reconstruct === "function") {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        options.reconstructor = subtype.class.reconstruct;
      } else if (typeof subtype.reconstruct === "function") {
        options.reconstructor = subtype.reconstruct;
      }
    }
    return options;
  }
}

/**
 * A lookup map that stores data in NEAR storage.
 */
class LookupMap extends SubType {
  /**
   * @param keyPrefix - The byte prefix to use when storing elements inside this collection.
   */
  constructor(keyPrefix) {
    super();
    this.keyPrefix = keyPrefix;
  }
  /**
   * Checks whether the collection contains the value.
   *
   * @param key - The value for which to check the presence.
   */
  containsKey(key) {
    const storageKey = this.keyPrefix + key;
    return storageHasKey(storageKey);
  }
  /**
   * Get the data stored at the provided key.
   *
   * @param key - The key at which to look for the data.
   * @param options - Options for retrieving the data.
   */
  get(key, options) {
    const storageKey = this.keyPrefix + key;
    const value = storageReadRaw(encode(storageKey));
    if (options == undefined) {
      options = {};
    }
    options = this.set_reconstructor(options);
    return getValueWithOptions(this.subtype(), value, options);
  }
  /**
   * Removes and retrieves the element with the provided key.
   *
   * @param key - The key at which to remove data.
   * @param options - Options for retrieving the data.
   */
  remove(key, options) {
    const storageKey = this.keyPrefix + key;
    if (!storageRemove(storageKey)) {
      return options?.defaultValue ?? null;
    }
    const value = storageGetEvictedRaw();
    return getValueWithOptions(this.subtype(), value, options);
  }
  /**
   * Store a new value at the provided key.
   *
   * @param key - The key at which to store in the collection.
   * @param newValue - The value to store in the collection.
   * @param options - Options for retrieving and storing the data.
   */
  set(key, newValue, options) {
    const storageKey = this.keyPrefix + key;
    const storageValue = serializeValueWithOptions(newValue, options);
    if (!storageWriteRaw(encode(storageKey), storageValue)) {
      return options?.defaultValue ?? null;
    }
    const value = storageGetEvictedRaw();
    return getValueWithOptions(this.subtype(), value, options);
  }
  /**
   * Extends the current collection with the passed in array of key-value pairs.
   *
   * @param keyValuePairs - The key-value pairs to extend the collection with.
   * @param options - Options for storing the data.
   */
  extend(keyValuePairs, options) {
    for (const [key, value] of keyValuePairs) {
      this.set(key, value, options);
    }
  }
  /**
   * Serialize the collection.
   *
   * @param options - Options for storing the data.
   */
  serialize(options) {
    return serializeValueWithOptions(this, options);
  }
  /**
   * Converts the deserialized data from storage to a JavaScript instance of the collection.
   *
   * @param data - The deserialized data to create an instance from.
   */
  static reconstruct(data) {
    return new LookupMap(data.keyPrefix);
  }
}

/**
 * Tells the SDK to use this function as the initialization function of the contract.
 *
 * @param _empty - An empty object.
 */
function initialize(_empty) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function (_target, _key, _descriptor
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  ) {};
}
/**
 * Tells the SDK to expose this function as a view function.
 *
 * @param _empty - An empty object.
 */
function view(_empty) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function (_target, _key, _descriptor
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  ) {};
}
function call({
  privateFunction = false,
  payableFunction = false
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function (_target, _key, descriptor) {
    const originalMethod = descriptor.value;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    descriptor.value = function (...args) {
      if (privateFunction && predecessorAccountId() !== currentAccountId()) {
        throw new Error("Function is private");
      }
      if (!payableFunction && attachedDeposit() > 0n) {
        throw new Error("Function is not payable");
      }
      return originalMethod.apply(this, args);
    };
  };
}
function NearBindgen({
  requireInit = false,
  serializer = serialize,
  deserializer = deserialize
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return target => {
    return class extends target {
      static _create() {
        return new target();
      }
      static _getState() {
        const rawState = storageReadRaw(bytes("STATE"));
        return rawState ? this._deserialize(rawState) : null;
      }
      static _saveToStorage(objectToSave) {
        storageWriteRaw(bytes("STATE"), this._serialize(objectToSave));
      }
      static _getArgs() {
        return JSON.parse(input() || "{}");
      }
      static _serialize(value, forReturn = false) {
        if (forReturn) {
          return encode(JSON.stringify(value, (_, value) => typeof value === "bigint" ? `${value}` : value));
        }
        return serializer(value);
      }
      static _deserialize(value) {
        return deserializer(value);
      }
      static _reconstruct(classObject, plainObject) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (classObject.constructor.schema === undefined) {
          for (const item in classObject) {
            const reconstructor = classObject[item].constructor?.reconstruct;
            classObject[item] = reconstructor ? reconstructor(plainObject[item]) : plainObject[item];
          }
          return classObject;
        }
        return decodeObj2class(classObject, plainObject);
      }
      static _requireInit() {
        return requireInit;
      }
    };
  };
}

// Fixed values of the v7 profile (SPEC-v7-KERNEL §10.3, §7.3, §7.4, §10.1,
// §10.2) and the small helpers every kernel module shares (errors, argument
// parsing, byte-length arithmetic).
//
// Runtime constraints: this file is bundled into the NEAR contract (QuickJS),
// so it must not use TextEncoder, Buffer, atob or any Node API. BigInt is
// available in both hosts.

const NEAR = 10n ** 24n;

// --- storage (§10.3) ---
const STORAGE_PRICE_PER_BYTE = 10n ** 19n; // 0.00001 NEAR per byte, paid by the writer, never refunded
const RECORD_FEE = 3n * 10n ** 22n; // 0.03 NEAR fixed record fee per case

// --- material formats (§7.3, §7.4) ---
const HASH_LEN = 32; // sha256 commitments, the lock, k2
const SALT_LEN = 16; // §2.2
const NONCE_LEN = 24; // Enc: leading random nonce
const TAG_LEN = 16; // XChaCha20-Poly1305 tag
const LEN_PREFIX = 2; // pad(): u16be length prefix
const PAD_UNIT = 1024; // std/sub buckets
const MAX_PADDED_MESSAGE = 65535; // a u16be prefix cannot describe longer messages
const RESP0_PAD = 1008; // primary response padded size (§10.3)
const RESP1_PAD = 8192; // appeal record padded size (§10.3)
const RESP0_CT_LEN = NONCE_LEN + RESP0_PAD + TAG_LEN; // 1048
const RESP1_CT_LEN = NONCE_LEN + RESP1_PAD + TAG_LEN; // 8232
const ENV_S_LEN = 32 + 32 + TAG_LEN; // Seal(S, SK, "wSkS"): E || AEAD(SK)       = 80
const ENV_C_LEN = 32 + 3 * 32 + TAG_LEN; // Seal(C, SK||K||K2, "wC")                 = 144
const ENV_R_LEN = 32 + 32 + TAG_LEN; // Seal(R, K1, "wR")                        = 80

// --- judgment / appeal (§6.1, §8.4, §10.3) ---
const PRIMARY_MAX_CALLS = 1;
const PANEL_MAX_CALLS = 3; // blind panel runs 3 times
const COMPARISON_MAX_CALLS = 1;
const USAGE_UNIT = 1024; // declared usage is rounded up to 1,024-token units

// --- creator parameters (§10.1) and clerk registration bounds (§10.2), seconds ---
const HOUR_S = 3600;
const DAY_S = 86400;
const W_DEFAULT_S = 24 * HOUR_S;
const W_MIN_S = HOUR_S;
const W_MAX_S = 30 * DAY_S;
const SUBMIT_MIN_S = HOUR_S;
const SUBMIT_MAX_S = 180 * DAY_S;
const W1_MIN_S = 30 * 60;
const W1_MAX_S = 7 * DAY_S;
const BOND_DEFAULT_PERCENT = 20n; // default bond = max(floor, 20% of the amount)
const ZERO_AMOUNT_BOND_CAP = NEAR; // bond cap when the amount is 0: max(floor, 1 NEAR)

// --- template declarations (§5.5, §7.5) ---
const CONSTRAINT_AMOUNT_ZERO = 'amount_zero'; // the only constraint kind defined in v7
const INPUT_SIDES = ['case_file', 'submission'];

// --- errors ---
// Every rejection is an Error whose message starts with a stable code. The
// spec names one code (E_K2_UNEXPECTED, §5.4); the rest are implementation codes.
function fail(code, detail) {
  throw new Error(detail ? `${code}: ${detail}` : code);
}

// --- argument parsing (strict: near-sdk-js passes JSON through unchecked) ---
const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
function accountArg(x, name) {
  if (typeof x !== 'string' || x.length < 2 || x.length > 64 || !ACCOUNT_RE.test(x)) fail('E_ARG', `${name} must be a NEAR account id`);
  return x;
}
function intArg(x, name, min, max) {
  if (typeof x !== 'number' || !Number.isSafeInteger(x)) fail('E_ARG', `${name} must be an integer`);
  if (min !== undefined && x < min) fail('E_RANGE', `${name} must be >= ${min}`);
  if (max !== undefined && x > max) fail('E_RANGE', `${name} must be <= ${max}`);
  return x;
}
function yoctoArg(x, name) {
  if (typeof x !== 'string' || !/^(0|[1-9][0-9]*)$/.test(x)) fail('E_ARG', `${name} must be a decimal integer string (yocto)`);
  return BigInt(x);
}
function strArg(x, name, maxLen) {
  if (typeof x !== 'string' || x.length === 0 || x.length > maxLen) fail('E_ARG', `${name} must be a string of 1..${maxLen} chars`);
  return x;
}
const HEX64 = /^[0-9a-f]{64}$/;
function hex32Arg(x, name) {
  if (typeof x !== 'string' || !HEX64.test(x)) fail('E_ARG', `${name} must be 32 bytes as 64 lowercase hex chars`);
  return x;
}
// Byte length of a canonical, padded standard base64 string.
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
function b64Arg(x, name) {
  if (typeof x !== 'string' || x.length === 0 || x.length % 4 !== 0 || !B64.test(x)) fail('E_ARG', `${name} must be padded standard base64`);
  const pad = x.endsWith('==') ? 2 : x.endsWith('=') ? 1 : 0;
  return {
    value: x,
    len: x.length / 4 * 3 - pad
  };
}

// --- byte helpers ---
function utf8Bytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + (cp - 0xd800 << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd; // lone surrogate -> U+FFFD, as TextEncoder does
    if (cp < 0x80) out.push(cp);else if (cp < 0x800) out.push(0xc0 | cp >> 6, 0x80 | cp & 0x3f);else if (cp < 0x10000) out.push(0xe0 | cp >> 12, 0x80 | cp >> 6 & 0x3f, 0x80 | cp & 0x3f);else out.push(0xf0 | cp >> 18, 0x80 | cp >> 12 & 0x3f, 0x80 | cp >> 6 & 0x3f, 0x80 | cp & 0x3f);
  }
  return new Uint8Array(out);
}
function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  return s;
}
const ceilDiv = (a, b) => Math.floor((a + b - 1) / b);
const ceilDivBig = (a, b) => (a + b - 1n) / b;
const minBig = (a, b) => a < b ? a : b;
const maxBig = (a, b) => a > b ? a : b;

// Component ① Fixing (SPEC-v7-KERNEL §1 table, §7). Commitments (salted

// §7.3 pad(): N = max(1024, ceil((|m| + 2) / 1024) * 1024) for "std" / "sub".
function paddedLen(messageLen) {
  return Math.max(PAD_UNIT, ceilDiv(messageLen + LEN_PREFIX, PAD_UNIT) * PAD_UNIT);
}

// §6.1: |ciphertext|_max = |pad(salt || body)|_max + |nonce| + |tag|, with
// |body| = L (L_crit or L_sub) and |salt| = 16 (§2.2).
function maxBucketCiphertextLen(limit) {
  return paddedLen(SALT_LEN + limit) + NONCE_LEN + TAG_LEN;
}

// The largest body limit whose padded form a u16be length prefix can describe.
const MAX_BODY_LIMIT = MAX_PADDED_MESSAGE - SALT_LEN;

// A "std"/"sub" ciphertext is nonce || AEAD(pad(salt || body)): its length is
// 40 + a multiple of 1024 (at least one bucket) and at most the maximum for
// the pinned size limit.
function checkBucketCiphertext(len, limit, name) {
  const body = len - NONCE_LEN - TAG_LEN;
  if (body < PAD_UNIT || body % PAD_UNIT !== 0) fail('E_LENGTH', `${name} must be 40 + a positive multiple of 1024 bytes`);
  if (len > maxBucketCiphertextLen(limit)) fail('E_LENGTH', `${name} exceeds the size limit pinned on the case`);
}
function fixedLenB64(x, name, want) {
  const b = b64Arg(x, name);
  if (b.len !== want) fail('E_LENGTH', `${name} must be exactly ${want} bytes`);
  return b;
}

// create_case material (§7.4, "at creation"): criteria hash, criteria
// ciphertext Enc(SK, "std", salt || criteria), and S's envelope of SK.
function fixCriteria(args, lCrit) {
  const hash = hex32Arg(args.criteria_hash, 'criteria_hash');
  const ct = b64Arg(args.criteria_ct, 'criteria_ct');
  checkBucketCiphertext(ct.len, lCrit, 'criteria_ct');
  const env = fixedLenB64(args.env_s, 'env_s', ENV_S_LEN);
  return {
    record: {
      hash,
      ctLen: ct.len
    },
    blobs: {
      criteria_ct: ct.value,
      env_s: env.value
    },
    storageBytes: HASH_LEN + ct.len + ENV_S_LEN
  };
}

// submit material (§7.4, "at submission"): the clerk's whole input.
function fixSubmission(args, lSub) {
  const hash = hex32Arg(args.sub_hash, 'sub_hash');
  const ct = b64Arg(args.sub_ct, 'sub_ct');
  checkBucketCiphertext(ct.len, lSub, 'sub_ct');
  const envC = fixedLenB64(args.env_c, 'env_c', ENV_C_LEN);
  const envR = fixedLenB64(args.env_r, 'env_r', ENV_R_LEN);
  const lock = hex32Arg(args.lock, 'lock');
  return {
    record: {
      hash,
      ctLen: ct.len,
      lock
    },
    blobs: {
      sub_ct: ct.value,
      env_c: envC.value,
      env_r: envR.value
    },
    storageBytes: HASH_LEN + ct.len + ENV_C_LEN + ENV_R_LEN + HASH_LEN
  };
}

// Response ciphertexts are packed to fixed sizes (§7.3, §10.3).
function fixResponse(x, which) {
  const want = which === 'resp0' ? RESP0_CT_LEN : RESP1_CT_LEN;
  const name = which === 'resp0' ? 'response' : 'record';
  const b = fixedLenB64(x, name, want);
  return {
    blob: b.value,
    storageBytes: want
  };
}
const blobKey = (caseId, slot) => `${caseId}:${slot}`;

// Component ② Judgment (SPEC-v7-KERNEL §1 table, §6.1, §8.1, §8.2).
function requireClerkCaller(c, caller) {
  if (caller !== c.clerk.account) fail('E_NOT_CLERK', 'only the clerk pinned on the case may post');
}
function verdictArg(v, name) {
  if (v !== 'PASS' && v !== 'FAIL') fail('E_ARG', `${name} must be "PASS" or "FAIL"`);
  return v;
}

// Declared usage of one call: input and output token counts, each rounded up
// to 1,024-token units by the declarer (§6.1 step 1). Unrounded values are
// rejected: the declaration itself must not leak finer than the unit.
function usageCall(x, name) {
  if (!x || typeof x !== 'object') fail('E_ARG', `${name} must be {in, out}`);
  const inT = intArg(x.in, `${name}.in`, 0);
  const outT = intArg(x.out, `${name}.out`, 0);
  if (inT % USAGE_UNIT !== 0 || outT % USAGE_UNIT !== 0) fail('E_USAGE_UNIT', `${name} must be declared in ${USAGE_UNIT}-token units`);
  return {
    in: inT,
    out: outT
  };
}
function usageCalls(x, name, max) {
  const list = x === undefined ? [] : x;
  if (!Array.isArray(list)) fail('E_ARG', `${name} must be an array of {in, out}`);
  if (list.length > max) fail('E_TOO_MANY_CALLS', `${name} carries at most ${max} call(s)`);
  return list.map((u, i) => usageCall(u, `${name}[${i}]`));
}

// post_decision arguments: verdict, Enc(K1, "resp0", response) packed to its
// fixed size, and the usage of the call included in the response (0 calls
// for a formal-defect posting, otherwise 1).
function parsePrimaryPosting(args) {
  const verdict = verdictArg(args.verdict, 'verdict');
  const resp = fixResponse(args.response, 'resp0');
  const usage = usageCalls(args.usage, 'usage', PRIMARY_MAX_CALLS);
  return {
    verdict,
    response: resp.blob,
    storageBytes: resp.storageBytes,
    usage
  };
}

// Component ③ Appeal (SPEC-v7-KERNEL §1 table, §8.3, §8.4). One appeal per

// The disadvantaged side appeals: PASS went against R, FAIL against S.
function appellantOf(c) {
  return c.decision.verdict === 'PASS' ? c.requester : c.submitter;
}
function respondentOf(c) {
  return c.decision.verdict === 'PASS' ? c.submitter : c.requester;
}
function requireAppellant(c, caller) {
  if (caller !== appellantOf(c)) fail('E_NOT_APPELLANT', 'only the side the primary judgment went against may appeal');
}
function requireRespondent(c, caller) {
  if (caller !== respondentOf(c)) fail('E_NOT_RESPONDENT', 'only the favored side may respond');
}

// post_appeal_decision arguments: result, Enc(K1, "resp1", record) packed to
// 8192, and the usage of the calls included in the record: at most 3 panel
// calls and at most 1 comparison call (none when the comparison was skipped).
function parseAppealPosting(args) {
  const result = verdictArg(args.result, 'result');
  const rec = fixResponse(args.record, 'resp1');
  const u = args.usage === undefined ? {} : args.usage;
  if (!u || typeof u !== 'object' || Array.isArray(u)) fail('E_ARG', 'usage must be {panel: [...], comparison: [...]}');
  for (const k of Object.keys(u)) if (k !== 'panel' && k !== 'comparison') fail('E_ARG', `unknown usage stage ${k}`);
  const usage = {
    panel: usageCalls(u.panel, 'usage.panel', PANEL_MAX_CALLS),
    comparison: usageCalls(u.comparison, 'usage.comparison', COMPARISON_MAX_CALLS)
  };
  return {
    result,
    record: rec.blob,
    storageBytes: rec.storageBytes,
    usage
  };
}

// How the appeal ended, for the bond rule of §6: only "the result equals the
// primary decision or not" matters for a posted review (§8.4 step 4).
//   'none'       no appeal
//   'default'    respondent never posted a bond (appellant wins, no review)
//   'silence'    clerk silent in review (primary stands, no review)
//   'overturned' review posted, result differs from the primary decision
//   'upheld'     review posted, result equals the primary decision
function appealEnding(c, fin) {
  if (!c.appeal) return 'none';
  if (fin.mode === 'default') return 'default';
  if (fin.mode === 'clerk_silence') return 'silence';
  return c.appeal.decision.result !== c.decision.verdict ? 'overturned' : 'upheld';
}

// Component ④ Settlement (SPEC-v7-KERNEL §1 table, §5.3, §5.4, §6, §6.1, §7.6).
const B = x => BigInt(x);

// ---------------------------------------------------------------- deposits

function requireNoDeposit(attached) {
  if (attached !== 0n) fail('E_DEPOSIT', 'this method takes no deposit');
}
function requireExact(attached, expected, what) {
  if (attached !== expected) fail('E_DEPOSIT', `${what}: attached ${attached} yocto, required exactly ${expected}`);
}
const storageFee = bytes => B(bytes) * STORAGE_PRICE_PER_BYTE;

// ------------------------------------------------------- fee arithmetic (§6.1)
// All lengths are on-chain byte lengths: |criteria ct|, |submission ct|,
// |template body|. Prices are integer yocto per token, so every term is an
// integer and no rounding arises.

function inputBounds(clerk, critLen, subLen, tplLen) {
  const common = critLen + subLen + tplLen;
  const s = clerk.stages;
  return {
    in1: common + s.primary.overheadTokens,
    inP: common + s.panel.overheadTokens,
    inC: common + s.comparison.overheadTokens + RESP0_PAD + 3 * s.panel.maxTokens
  };
}
function capPrimaryOf(clerk, critLen, subLen, tplLen) {
  const {
    in1
  } = inputBounds(clerk, critLen, subLen, tplLen);
  const p = clerk.stages.primary;
  return B(clerk.base1) + B(p.pIn) * B(in1) + B(p.pOut) * B(p.maxTokens);
}
function capAppealOf(clerk, critLen, subLen, tplLen) {
  const {
    inP,
    inC
  } = inputBounds(clerk, critLen, subLen, tplLen);
  const p = clerk.stages.panel,
    k = clerk.stages.comparison;
  return B(clerk.baseA) + 3n * (B(p.pIn) * B(inP) + B(p.pOut) * B(p.maxTokens)) + (B(k.pIn) * B(inC) + B(k.pOut) * B(k.maxTokens));
}

// One call's contribution: p_in * min(in, IN_s) + p_out * min(out, M_s).
function callCost(stage, bound, u) {
  return B(stage.pIn) * minBig(B(u.in), B(bound)) + B(stage.pOut) * minBig(B(u.out), B(stage.maxTokens));
}

// charge = min(CAP, base + sum over the calls in the posted record).
function chargePrimaryOf(clerk, cap, lens, calls) {
  const {
    in1
  } = inputBounds(clerk, lens.crit, lens.sub, lens.tpl);
  let sum = B(clerk.base1);
  for (const u of calls) sum += callCost(clerk.stages.primary, in1, u);
  return minBig(cap, sum);
}
function chargeAppealOf(clerk, cap, lens, usage) {
  const {
    inP,
    inC
  } = inputBounds(clerk, lens.crit, lens.sub, lens.tpl);
  let sum = B(clerk.baseA);
  for (const u of usage.panel) sum += callCost(clerk.stages.panel, inP, u);
  for (const u of usage.comparison) sum += callCost(clerk.stages.comparison, inC, u); // skipped comparison: no term
  return minBig(cap, sum);
}
const caseLens = c => ({
  crit: c.criteria.ctLen,
  sub: c.submission.ctLen,
  tpl: c.template.bodyLen
});

// quote_fee (§5.5): the fee part of the deposit submit/appeal require.
function quoteFee(c, kind, subLen) {
  if (kind === 'primary') return capPrimaryOf(c.clerk, c.criteria.ctLen, subLen, c.template.bodyLen);
  if (kind === 'appeal') return capAppealOf(c.clerk, c.criteria.ctLen, subLen, c.template.bodyLen);
  return fail('E_ARG', 'kind must be "primary" (CAP_1) or "appeal" (CAP_A)');
}

// ------------------------------------------------------------ bonds (§10.1)

// Floor = CAP_A at the maximum submission size (|sub| = L_sub, ciphertext at
// its maximum length for L_sub, §6.1).
function bondFloorOf(clerk, critLen, tplLen) {
  return capAppealOf(clerk, critLen, maxBucketCiphertextLen(clerk.lSub), tplLen);
}
function bondBounds(amount, floor) {
  const max = amount > 0n ? maxBig(floor, ceilDivBig(amount, 2n)) : maxBig(floor, ZERO_AMOUNT_BOND_CAP);
  const dflt = maxBig(floor, ceilDivBig(amount * BOND_DEFAULT_PERCENT, 100n));
  return {
    min: floor,
    max,
    dflt
  };
}
function chooseBond(amount, floor, arg) {
  const b = bondBounds(amount, floor);
  if (arg === undefined || arg === null) return b.dflt;
  const bond = yoctoArg(arg, 'bond');
  if (bond < b.min) fail('E_BOND_FLOOR', `bond is below the floor CAP_A(L_sub) = ${b.min}`);
  if (bond > b.max) fail('E_BOND_CAP', `bond is above the cap ${b.max}`);
  return bond;
}

// --------------------------------------------------------------- balances

function credit(store, c, who, amt) {
  if (amt <= 0n) return;
  store.putBalance(who, store.getBalance(who) + amt);
  if (c) c.money.out = (B(c.money.out) + amt).toString();
}
function escrowIn(c, amt) {
  c.money.in = (B(c.money.in) + amt).toString();
}
function storageIn(c, amt) {
  c.money.storage = (B(c.money.storage) + amt).toString();
}
function withdraw$2(store, who, amountArg) {
  const bal = store.getBalance(who);
  const amt = amountArg === undefined || amountArg === null ? bal : yoctoArg(amountArg, 'amount');
  if (amt <= 0n || amt > bal) fail('E_BALANCE', 'nothing to withdraw or amount exceeds the balance');
  store.putBalance(who, bal - amt);
  return amt; // the host transfers it
}

// --------------------------------------------------- per-transition deposits

// create_case: price + fixed record fee + storage of the written bytes.
function acceptCaseDeposit(c, attached, storageBytes) {
  const amount = B(c.amount);
  const storage = RECORD_FEE + storageFee(storageBytes);
  requireExact(attached, amount + storage, 'create_case deposit (amount + record fee + storage)');
  c.money = {
    in: '0',
    out: '0',
    storage: '0'
  };
  escrowIn(c, amount);
  storageIn(c, storage);
}

// submit: CAP_1 for the actual submission length + storage of the written bytes.
function acceptSubmitDeposit(c, attached, storageBytes) {
  const cap = capPrimaryOf(c.clerk, c.criteria.ctLen, c.submission.ctLen, c.template.bodyLen);
  const storage = storageFee(storageBytes);
  requireExact(attached, cap + storage, 'submit deposit (CAP_1 + storage)');
  c.fee1 = {
    deposit: cap.toString(),
    charge: null,
    refund: null
  };
  escrowIn(c, cap);
  storageIn(c, storage);
}

// post_decision / post_appeal_decision: the clerk's own storage only.
function acceptPostingStorage(c, attached, storageBytes) {
  const storage = storageFee(storageBytes);
  requireExact(attached, storage, 'posting deposit (storage of the response ciphertext)');
  storageIn(c, storage);
}

// register_template: storage of body + declarations, not tied to any case.
function acceptTemplateStorage(attached, storageBytes) {
  requireExact(attached, storageFee(storageBytes), 'register_template deposit (storage of body + declarations)');
}

// appeal: bond + CAP_A for the actual submission length.
function acceptAppealDeposit(c, attached) {
  const bond = B(c.bond);
  const cap = capAppealOf(c.clerk, c.criteria.ctLen, c.submission.ctLen, c.template.bodyLen);
  requireExact(attached, bond + cap, 'appeal deposit (bond + CAP_A)');
  c.appeal.bond = bond.toString();
  c.appeal.fee = {
    deposit: cap.toString(),
    charge: null,
    refund: null
  };
  escrowIn(c, bond + cap);
}

// respond: the same bond.
function acceptRespondDeposit(c, attached) {
  const bond = B(c.bond);
  requireExact(attached, bond, 'respond deposit (bond)');
  c.appeal.respondentBond = bond.toString();
  escrowIn(c, bond);
}

// ---------------------------------------------- fee settlement at posting

function settlePrimaryFee(store, c, calls) {
  const cap = B(c.fee1.deposit);
  const charge = chargePrimaryOf(c.clerk, cap, caseLens(c), calls);
  credit(store, c, c.clerk.feeAccount, charge);
  credit(store, c, c.submitter, cap - charge);
  c.fee1.charge = charge.toString();
  c.fee1.refund = (cap - charge).toString();
}
function settleAppealFee(store, c, usage) {
  const cap = B(c.appeal.fee.deposit);
  const charge = chargeAppealOf(c.clerk, cap, caseLens(c), usage);
  credit(store, c, c.clerk.feeAccount, charge);
  credit(store, c, c.appeal.by, cap - charge);
  c.appeal.fee.charge = charge.toString();
  c.appeal.fee.refund = (cap - charge).toString();
}
function refundFeeDeposit(store, c, fee, payer) {
  credit(store, c, payer, B(fee.deposit));
  fee.charge = '0';
  fee.refund = fee.deposit;
}

// -------------------------------------------------------------- k2 (§5.4)

function k2Supplied(args) {
  return !!args && args.k2 !== undefined && args.k2 !== null;
}
// Every call that does not pay the submitter rejects a supplied k2.
function assertK2Absent(args) {
  if (k2Supplied(args)) fail('E_K2_UNEXPECTED', 'k2 is accepted only by a finalize that pays the submitter');
}

// ----------------------------------------------------------- closing a case
//
// plan (built by the profile from a computed finality or expiry):
//   priceTo:     'S' | 'R'   recipient of the price (amount)
//   refundFee1:  boolean     return CAP_1 in full to S (no primary posting)
//   appeal:      'none' | 'default' | 'silence' | 'overturned' | 'upheld'
//
// The k2 rule: a close that pays a positive amount (the price) to the
// submitter requires k2 with sha256(k2) == lock and records it in the same
// transaction; every other close rejects k2.
function closeCase(store, c, plan, args, sha256) {
  const amount = B(c.amount);
  const pays = plan.priceTo === 'S' && amount > 0n;
  if (pays) {
    if (!k2Supplied(args)) fail('E_K2_REQUIRED', 'paying the submitter requires k2 (release window still open)');
    const k2 = hex32Arg(args.k2, 'k2');
    if (bytesToHex(sha256(hexToBytes(k2))) !== c.submission.lock) fail('E_K2_MISMATCH', 'sha256(k2) does not match the lock');
    c.k2 = k2; // the release: k2 goes on-chain in the paying transaction
  } else {
    assertK2Absent(args);
  }
  credit(store, c, plan.priceTo === 'S' ? c.submitter : c.requester, amount);
  if (plan.refundFee1) refundFeeDeposit(store, c, c.fee1, c.submitter);
  const a = c.appeal;
  switch (plan.appeal) {
    case 'none':
      break;
    case 'default':
      // no review: appellant's bond and the whole CAP_A return
      credit(store, c, a.by, B(a.bond));
      refundFeeDeposit(store, c, a.fee, a.by);
      break;
    case 'silence':
      // no review: both bonds return to their posters, CAP_A returns
      credit(store, c, a.by, B(a.bond));
      credit(store, c, a.respondent, B(a.respondentBond));
      refundFeeDeposit(store, c, a.fee, a.by);
      break;
    case 'overturned':
      // respondent's bond moves to the appellant
      credit(store, c, a.by, B(a.bond) + B(a.respondentBond));
      break;
    case 'upheld':
      // appellant's bond moves to the respondent
      credit(store, c, a.respondent, B(a.bond) + B(a.respondentBond));
      break;
    default:
      fail('E_INTERNAL', `unknown appeal ending ${plan.appeal}`);
  }

  // Conservation (§6): everything deposited into the case has been credited.
  if (B(c.money.in) !== B(c.money.out)) fail('E_INTERNAL', `conservation violated: in ${c.money.in} != out ${c.money.out}`);
  return pays;
}

// Component ⑤ Registry (SPEC-v7-KERNEL §1 table, §5.5, §8.2, §9.2, §10.2).
const STAGES = ['primary', 'panel', 'comparison'];

// --- sealing keys (one per account; replaceable, cases pin R's at creation) ---
function registerKey(store, caller, args) {
  const pk = hex32Arg(args.pubkey, 'pubkey');
  store.putKey(caller, pk);
}
function requireKey(store, account, who) {
  const k = store.getKey(account);
  if (!k) fail('E_NO_KEY', `${who} has not registered a sealing key`);
  return k;
}

// --- owner ---
function requireOwner(store, caller) {
  if (caller !== store.getOwner()) fail('E_NOT_OWNER', 'only the owner may call this');
}

// --- TEE signers ---
function registerSigner(store, args) {
  const algo = strArg(args.algo, 'algo', 32);
  if (!/^[a-z0-9_-]+$/.test(algo)) fail('E_ARG', 'algo must be lowercase alphanumeric');
  const address = strArg(args.address, 'address', 256).toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]+$/.test(address)) fail('E_ARG', 'address must be hex');
  const key = `${algo}:${address}`;
  const list = store.getSigners();
  if (!list.includes(key)) {
    list.push(key);
    store.putSigners(list);
  }
  return key;
}

// --- clerks (§10.2) ---
function stageArg(x, name) {
  if (!x || typeof x !== 'object') fail('E_ARG', `${name} is required`);
  return {
    pIn: yoctoArg(x.p_in, `${name}.p_in`).toString(),
    pOut: yoctoArg(x.p_out, `${name}.p_out`).toString(),
    maxTokens: intArg(x.max_tokens, `${name}.max_tokens`, 0),
    overheadTokens: intArg(x.overhead_tokens, `${name}.overhead_tokens`, 0)
  };
}
function registerClerk(store, args) {
  const account = accountArg(args.account, 'account');
  const stagesIn = args.stages || {};
  const stages = {};
  for (const s of STAGES) stages[s] = stageArg(stagesIn[s], `stages.${s}`);
  const reg = {
    account,
    sealKey: hex32Arg(args.seal_key, 'seal_key'),
    w1Sec: intArg(args.w1_sec, 'w1_sec', W1_MIN_S, W1_MAX_S),
    base1: yoctoArg(args.base_1, 'base_1').toString(),
    baseA: yoctoArg(args.base_a, 'base_a').toString(),
    stages,
    feeAccount: accountArg(args.fee_account, 'fee_account'),
    // The panel model serves both the blind panel and the comparison stage (§10.2).
    primaryModel: strArg(args.primary_model, 'primary_model', 256),
    panelModel: strArg(args.panel_model, 'panel_model', 256),
    lCrit: intArg(args.l_crit, 'l_crit', 1, MAX_BODY_LIMIT),
    lSub: intArg(args.l_sub, 'l_sub', 1, MAX_BODY_LIMIT),
    lTpl: intArg(args.l_tpl, 'l_tpl', 1)
  };
  store.putClerk(account, reg);
  return reg;
}
function requireClerk(store, account) {
  const reg = store.getClerk(account);
  if (!reg) fail('E_NOT_CLERK', `${account} is not a registered clerk`);
  return reg;
}

// --- templates (§5.5, §8.2) ---
const TEMPLATE_ID = /^[A-Za-z0-9._-]{1,64}$/;
const templateKey = (clerk, id, version) => `${clerk}|${id}|${version}`;

// Canonical declarations: constraints (v7 defines only "amount_zero") and
// required inputs [(side, heading[, on_missing])] (§7.5). A missing
// submission-side input is always FAIL (the submitter's defect); a missing
// case-file-side input maps to the result the template declares, and the v7
// profile defines only PASS for that mapping (the "no decision" mapping would
// need a profile transition v7 does not have, §7.5).
function canonicalDeclarations(args) {
  const cIn = args.constraints === undefined ? [] : args.constraints;
  if (!Array.isArray(cIn)) fail('E_ARG', 'constraints must be an array');
  const constraints = [];
  for (const c of cIn) {
    if (c !== CONSTRAINT_AMOUNT_ZERO) fail('E_DECLARATION', `unknown constraint kind ${JSON.stringify(c)} (v7 defines only "${CONSTRAINT_AMOUNT_ZERO}")`);
    if (constraints.includes(c)) fail('E_DECLARATION', 'duplicate constraint');
    constraints.push(c);
  }
  const rIn = args.required_inputs === undefined ? [] : args.required_inputs;
  if (!Array.isArray(rIn)) fail('E_ARG', 'required_inputs must be an array');
  const requiredInputs = [];
  for (const r of rIn) {
    if (!r || typeof r !== 'object') fail('E_DECLARATION', 'a required input is {side, heading[, on_missing]}');
    if (!INPUT_SIDES.includes(r.side)) fail('E_DECLARATION', 'required input side must be case_file or submission');
    const heading = strArg(r.heading, 'required input heading', 256);
    if (r.side === 'submission') {
      if (r.on_missing !== undefined) fail('E_DECLARATION', 'a missing submission-side input is always FAIL; on_missing is not declarable');
      requiredInputs.push({
        side: r.side,
        heading
      });
    } else {
      if (r.on_missing !== 'PASS') fail('E_DECLARATION', 'a case_file-side input must declare on_missing: "PASS" (the only mapping the v7 profile defines)');
      requiredInputs.push({
        side: r.side,
        heading,
        on_missing: 'PASS'
      });
    }
  }
  return {
    constraints,
    required_inputs: requiredInputs
  };
}

// Bytes the registrant pays storage for: the body (UTF-8) and the canonical
// declarations (UTF-8 of their JSON serialization).
function templateStorageBytes(body, declarations) {
  return utf8Bytes(body).length + utf8Bytes(JSON.stringify(declarations)).length;
}

// Validates and builds a new template version. Does not write: the profile
// writes after settlement accepted the storage deposit.
function prepareTemplate(store, caller, args, sha256) {
  const reg = requireClerk(store, caller); // only an owner-registered clerk may register templates
  if (typeof args.template_id !== 'string' || !TEMPLATE_ID.test(args.template_id)) fail('E_ARG', 'template_id must match [A-Za-z0-9._-]{1,64}');
  if (typeof args.body !== 'string' || args.body.length === 0) fail('E_ARG', 'body must be a non-empty string');
  const bodyBytes = utf8Bytes(args.body);
  if (bodyBytes.length > reg.lTpl) fail('E_LENGTH', `template body exceeds the clerk's L_tpl (${reg.lTpl} bytes)`);
  const declarations = canonicalDeclarations(args);
  const version = store.getTemplateCount(caller, args.template_id) + 1; // versions start at 1
  const tpl = {
    clerk: caller,
    id: args.template_id,
    version,
    body: args.body,
    bodyLen: bodyBytes.length,
    bodyHash: bytesToHex(sha256(bodyBytes)),
    constraints: declarations.constraints,
    requiredInputs: declarations.required_inputs
  };
  return {
    tpl,
    storageBytes: templateStorageBytes(args.body, declarations)
  };
}
function commitTemplate(store, tpl) {
  // Immutability: a (clerk, id, version) slot is written exactly once.
  if (store.getTemplate(templateKey(tpl.clerk, tpl.id, tpl.version))) fail('E_TEMPLATE_IMMUTABLE', 'template version already registered');
  store.putTemplate(templateKey(tpl.clerk, tpl.id, tpl.version), tpl);
  store.putTemplateCount(tpl.clerk, tpl.id, tpl.version);
}
function requireTemplate(store, clerk, id, version) {
  if (typeof id !== 'string') fail('E_ARG', 'template_id is required');
  intArg(version, 'template_version', 1);
  const tpl = store.getTemplate(templateKey(clerk, id, version));
  if (!tpl) fail('E_NO_TEMPLATE', `template ${id}@${version} is not registered by clerk ${clerk}`);
  return tpl;
}

// Constraint verification at create_case (§5.1, §5.5).
function checkTemplateConstraints(tpl, {
  amount
}) {
  for (const c of tpl.constraints) {
    if (c === CONSTRAINT_AMOUNT_ZERO && amount !== 0n) fail('E_TEMPLATE_CONSTRAINT', `template ${tpl.id}@${tpl.version} declares: amount must be 0`);
  }
}

// What a case pins at creation (§5.5): the clerk's whole registration and
// the template id + version (with its body hash and length, immutable anyway).
function pinClerk(reg) {
  return JSON.parse(JSON.stringify(reg));
}
function pinTemplate(tpl) {
  return {
    clerk: tpl.clerk,
    id: tpl.id,
    version: tpl.version,
    bodyHash: tpl.bodyHash,
    bodyLen: tpl.bodyLen,
    constraints: tpl.constraints.slice(),
    requiredInputs: tpl.requiredInputs.map(r => ({
      ...r
    }))
  };
}

// Component ⑥ Deadlines (SPEC-v7-KERNEL §1 table, §5.1, §5.2, §5.3, §8.5).
const halfW = c => c.wMs / 2;
const w1 = c => c.clerk.w1Sec * 1000;
const submitDeadline = c => c.submitDeadline; // creation + submit window
const decisionDeadline = c => c.submission.at + w1(c); // submission + W1
const appealDeadline = c => c.decision.at + halfW(c); // decision + W/2
const respondDeadline = c => c.appeal.at + halfW(c); // appeal + W/2
const reviewDeadline = c => c.appeal.respondedAt + w1(c); // review start (respond) + W1

function requireBefore(now, deadline, what) {
  if (now > deadline) fail('E_DEADLINE', `${what} deadline has passed`);
}

// Pre-judgment expiries (§5.1): no judgment exists, the case ends without one.
function preJudgmentExpiry(c, now) {
  if (c.phase === 'AwaitingSubmission' && now > submitDeadline(c)) return 'UNSUBMITTED';
  if (c.phase === 'AwaitingDecision' && now > decisionDeadline(c)) return 'NO_DECISION';
  return null;
}

// Finality (§5.2): not a stored state, computed from the record and the time.
// Returns null while the decision can still change.
//   mode 'no_appeal'      final at the appeal deadline, primary verdict stands
//   mode 'default'        final at the respond deadline, primary verdict negated
//   mode 'appeal_decision' final at the posting time, the appeal result
//   mode 'clerk_silence'  final at the review deadline, primary verdict stands
function finality(c, now) {
  const negate = v => v === 'PASS' ? 'FAIL' : 'PASS';
  switch (c.phase) {
    case 'Decided':
      {
        const t = appealDeadline(c);
        return now > t ? {
          mode: 'no_appeal',
          outcome: c.decision.verdict,
          finalAt: t
        } : null;
      }
    case 'Appealed':
      {
        const t = respondDeadline(c);
        return now > t ? {
          mode: 'default',
          outcome: negate(c.decision.verdict),
          finalAt: t
        } : null;
      }
    case 'UnderReview':
      {
        const t = reviewDeadline(c);
        return now > t ? {
          mode: 'clerk_silence',
          outcome: c.decision.verdict,
          finalAt: t
        } : null;
      }
    case 'Reviewed':
      return {
        mode: 'appeal_decision',
        outcome: c.appeal.decision.result,
        finalAt: c.appeal.decision.at
      };
    default:
      return null;
  }
}

// The time split of the hash-locked release (§5.3): a k2 finalize is valid
// iff now <= finalAt + W/2; a k2-less finalize of a final PASS with amount > 0
// iff now > finalAt + W/2. Which one passes depends on the block time alone.
const releaseDeadline = (c, fin) => fin.finalAt + halfW(c);
const releaseOpen = (c, fin, now) => now <= releaseDeadline(c, fin);

// The v7 profile (SPEC-v7-KERNEL §5): the fixed wiring of the six framework
function loadCase(store, id) {
  intArg(id, 'case_id', 0);
  const c = store.getCase(id);
  if (!c) fail('E_NO_CASE', `no case ${id}`);
  return c;
}
function requirePhase(c, phase, action) {
  if (c.phase !== phase) fail('E_PHASE', `cannot ${action} in phase ${c.phase}`);
}
// Calls other than finalize never take k2 (§5.4). Checked first, so the
// rejection code is the same whatever else is wrong with the call.
function noK2(args) {
  assertK2Absent(args);
}

// ------------------------------------------------------------- registry

function register_key$1(store, ctx, args) {
  noK2(args);
  requireNoDeposit(ctx.deposit);
  registerKey(store, ctx.caller, args);
}
function register_clerk$1(store, ctx, args) {
  noK2(args);
  requireNoDeposit(ctx.deposit);
  requireOwner(store, ctx.caller);
  registerClerk(store, args);
}
function register_signer$1(store, ctx, args) {
  noK2(args);
  requireNoDeposit(ctx.deposit);
  requireOwner(store, ctx.caller);
  return registerSigner(store, args);
}
function register_template$1(store, ctx, args) {
  noK2(args);
  const {
    tpl,
    storageBytes
  } = prepareTemplate(store, ctx.caller, args, ctx.sha256);
  acceptTemplateStorage(ctx.deposit, storageBytes);
  commitTemplate(store, tpl);
  store.log(`template ${tpl.clerk}/${tpl.id}@${tpl.version} registered (sha256 ${tpl.bodyHash})`);
  return {
    template_id: tpl.id,
    version: tpl.version,
    body_hash: tpl.bodyHash
  };
}

// ------------------------------------------------------------- lifecycle

function create_case$1(store, ctx, args) {
  noK2(args);
  const requester = ctx.caller;
  const clerkAcct = accountArg(args.clerk, 'clerk');
  const clerkReg = requireClerk(store, clerkAcct);
  const tpl = requireTemplate(store, clerkAcct, args.template_id, args.template_version);
  const amount = yoctoArg(args.amount, 'amount');
  checkTemplateConstraints(tpl, {
    amount
  });
  const submitter = accountArg(args.submitter, 'submitter');
  if (submitter === requester) fail('E_PARTY', 'the submitter must differ from the requester');
  if (submitter === clerkAcct) fail('E_PARTY', 'the submitter must not be the clerk');
  const requesterKey = requireKey(store, requester, 'the requester');
  requireKey(store, submitter, 'the submitter');
  const wSec = args.w_sec === undefined ? W_DEFAULT_S : intArg(args.w_sec, 'w_sec', W_MIN_S, W_MAX_S);
  const submitSec = intArg(args.submit_window_sec, 'submit_window_sec', SUBMIT_MIN_S, SUBMIT_MAX_S);
  const fixed = fixCriteria(args, clerkReg.lCrit);
  const id = store.peekCaseId();
  // The context string binds the case id (§7.3), so the requester encrypts
  // for a predicted id; an optional expected_case_id turns a lost race into
  // a rejected call instead of a case whose material cannot be opened.
  if (args.expected_case_id !== undefined && args.expected_case_id !== id) fail('E_CASE_ID', `the next case id is ${id}`);
  const pinnedClerk = pinClerk(clerkReg);
  const pinnedTpl = pinTemplate(tpl);
  const floor = bondFloorOf(pinnedClerk, fixed.record.ctLen, pinnedTpl.bodyLen);
  const bond = chooseBond(amount, floor, args.bond);
  const c = {
    id,
    requester,
    submitter,
    clerk: pinnedClerk,
    template: pinnedTpl,
    requesterKey,
    amount: amount.toString(),
    bond: bond.toString(),
    bondFloor: floor.toString(),
    wMs: wSec * 1000,
    createdAt: ctx.now,
    submitDeadline: ctx.now + submitSec * 1000,
    criteria: fixed.record,
    submission: null,
    fee1: null,
    decision: null,
    appeal: null,
    phase: 'AwaitingSubmission',
    ending: null,
    outcome: null,
    finalAt: null,
    closedAt: null,
    k2: null
  };
  acceptCaseDeposit(c, ctx.deposit, fixed.storageBytes);
  store.takeCaseId();
  for (const [slot, v] of Object.entries(fixed.blobs)) store.putBlob(blobKey(id, slot), v);
  store.putCase(id, c);
  store.log(`case ${id} created: ${pinnedTpl.id}@${pinnedTpl.version}, amount ${c.amount}`);
  return id;
}
function submit$1(store, ctx, args) {
  noK2(args);
  const c = loadCase(store, args.case_id);
  requirePhase(c, 'AwaitingSubmission', 'submit');
  if (ctx.caller !== c.submitter) fail('E_NOT_SUBMITTER', 'only the named submitter may submit');
  requireBefore(ctx.now, submitDeadline(c), 'submission');
  const fixed = fixSubmission(args, c.clerk.lSub);
  c.submission = {
    ...fixed.record,
    at: ctx.now
  };
  acceptSubmitDeposit(c, ctx.deposit, fixed.storageBytes);
  for (const [slot, v] of Object.entries(fixed.blobs)) store.putBlob(blobKey(c.id, slot), v);
  c.phase = 'AwaitingDecision';
  store.putCase(c.id, c);
}
function post_decision$1(store, ctx, args) {
  noK2(args);
  const c = loadCase(store, args.case_id);
  requirePhase(c, 'AwaitingDecision', 'post a decision');
  requireClerkCaller(c, ctx.caller);
  requireBefore(ctx.now, decisionDeadline(c), 'decision');
  const p = parsePrimaryPosting(args);
  acceptPostingStorage(c, ctx.deposit, p.storageBytes);
  c.decision = {
    verdict: p.verdict,
    usage: p.usage,
    at: ctx.now
  };
  store.putBlob(blobKey(c.id, 'response'), p.response);
  settlePrimaryFee(store, c, p.usage);
  c.phase = 'Decided';
  store.putCase(c.id, c);
  store.log(`case ${c.id} decided ${p.verdict}`);
}
function appeal_(store, ctx, args) {
  noK2(args);
  const c = loadCase(store, args.case_id);
  requirePhase(c, 'Decided', 'appeal');
  requireAppellant(c, ctx.caller);
  requireBefore(ctx.now, appealDeadline(c), 'appeal');
  c.appeal = {
    by: ctx.caller,
    respondent: respondentOf(c),
    at: ctx.now,
    bond: null,
    fee: null,
    respondentBond: null,
    respondedAt: null,
    decision: null
  };
  acceptAppealDeposit(c, ctx.deposit);
  c.phase = 'Appealed';
  store.putCase(c.id, c);
}
function respond$1(store, ctx, args) {
  noK2(args);
  const c = loadCase(store, args.case_id);
  requirePhase(c, 'Appealed', 'respond');
  requireRespondent(c, ctx.caller);
  requireBefore(ctx.now, respondDeadline(c), 'response');
  acceptRespondDeposit(c, ctx.deposit);
  c.appeal.respondedAt = ctx.now; // review starts
  c.phase = 'UnderReview';
  store.putCase(c.id, c);
}
function post_appeal_decision$1(store, ctx, args) {
  noK2(args);
  const c = loadCase(store, args.case_id);
  requirePhase(c, 'UnderReview', 'post an appeal decision');
  requireClerkCaller(c, ctx.caller);
  requireBefore(ctx.now, reviewDeadline(c), 'review');
  const p = parseAppealPosting(args);
  acceptPostingStorage(c, ctx.deposit, p.storageBytes);
  c.appeal.decision = {
    result: p.result,
    usage: p.usage,
    at: ctx.now
  };
  store.putBlob(blobKey(c.id, 'record'), p.record);
  settleAppealFee(store, c, p.usage);
  c.phase = 'Reviewed';
  store.putCase(c.id, c);
  store.log(`case ${c.id} appeal decided ${p.result}`);
}

// The closing transition of the case (§5.1 expiry rows and final rows).
// Returns null when nothing can close yet.
function closingTransition(c, now) {
  const exp = preJudgmentExpiry(c, now);
  if (exp === 'UNSUBMITTED') return {
    ending: 'UNSUBMITTED',
    outcome: null,
    finalAt: null,
    plan: {
      priceTo: 'R',
      refundFee1: false,
      appeal: 'none'
    }
  };
  if (exp === 'NO_DECISION') return {
    ending: 'NO_DECISION',
    outcome: null,
    finalAt: null,
    plan: {
      priceTo: 'R',
      refundFee1: true,
      appeal: 'none'
    }
  };
  const fin = finality(c, now);
  if (!fin) return null;
  const appealEnd = appealEnding(c, fin);
  let priceTo = 'R',
    ending = fin.outcome;
  if (fin.outcome === 'PASS' && BigInt(c.amount) > 0n) {
    if (releaseOpen(c, fin, now)) {
      priceTo = 'S';
      ending = 'PASS_RELEASED';
    } else ending = 'PASS_UNRELEASED';
  }
  return {
    ending,
    outcome: fin.outcome,
    finalAt: fin.finalAt,
    mode: fin.mode,
    plan: {
      priceTo,
      refundFee1: false,
      appeal: appealEnd
    }
  };
}
function finalize$1(store, ctx, args) {
  requireNoDeposit(ctx.deposit);
  const c = loadCase(store, args.case_id);
  const t = c.phase === 'Closed' ? null : closingTransition(c, ctx.now);
  if (!t) {
    noK2(args); // a finalize that cannot run pays nobody: k2 is rejected first
    fail(c.phase === 'Closed' ? 'E_CLOSED' : 'E_NOT_FINAL', c.phase === 'Closed' ? 'case already closed' : 'nothing to finalize yet');
  }
  closeCase(store, c, t.plan, args, ctx.sha256);
  c.phase = 'Closed';
  c.ending = t.ending;
  c.outcome = t.outcome;
  c.finalAt = t.finalAt;
  c.closedAt = ctx.now;
  store.putCase(c.id, c);
  store.log(`case ${c.id} closed: ${t.ending}`);
  return t.ending;
}
function withdraw$1(store, ctx, args) {
  noK2(args);
  requireNoDeposit(ctx.deposit);
  const amount = withdraw$2(store, ctx.caller, args.amount);
  return {
    transfer: {
      to: ctx.caller,
      amount
    }
  };
}
function quote_fee$1(store, _ctx, args) {
  const c = loadCase(store, args.case_id);
  const subLen = intArg(args.sub_len, 'sub_len', 0);
  return quoteFee(c, args.kind, subLen).toString();
}

// The 13 methods of §5.5. `payable` mirrors the near-sdk-js decorator.
const METHODS = {
  register_key: {
    kind: 'call',
    payable: false,
    fn: register_key$1
  },
  register_clerk: {
    kind: 'call',
    payable: false,
    fn: register_clerk$1
  },
  register_signer: {
    kind: 'call',
    payable: false,
    fn: register_signer$1
  },
  register_template: {
    kind: 'call',
    payable: true,
    fn: register_template$1
  },
  create_case: {
    kind: 'call',
    payable: true,
    fn: create_case$1
  },
  submit: {
    kind: 'call',
    payable: true,
    fn: submit$1
  },
  post_decision: {
    kind: 'call',
    payable: true,
    fn: post_decision$1
  },
  appeal: {
    kind: 'call',
    payable: true,
    fn: appeal_
  },
  respond: {
    kind: 'call',
    payable: true,
    fn: respond$1
  },
  post_appeal_decision: {
    kind: 'call',
    payable: true,
    fn: post_appeal_decision$1
  },
  finalize: {
    kind: 'call',
    payable: false,
    fn: finalize$1
  },
  withdraw: {
    kind: 'call',
    payable: false,
    fn: withdraw$1
  },
  quote_fee: {
    kind: 'view',
    payable: false,
    fn: quote_fee$1
  }
};
function dispatch(store, ctx, method, args) {
  const m = METHODS[method];
  if (!m) fail('E_NO_METHOD', method);
  return m.fn(store, ctx, args || {});
}

// ------------------------------------------------- read-only state access
// Not protocol methods: plain getters a client needs to read the record.

const READERS = {
  get_case: (store, a) => loadCase(store, a.case_id),
  get_material: (store, a) => {
    loadCase(store, a.case_id);
    const v = store.getBlob(blobKey(a.case_id, a.slot));
    return v === null || v === undefined ? null : v;
  },
  next_case_id: store => store.peekCaseId(),
  get_clerk: (store, a) => store.getClerk(a.account) || null,
  get_template: (store, a) => store.getTemplate(templateKey(a.clerk, a.template_id, a.version)) || null,
  get_template_count: (store, a) => store.getTemplateCount(a.clerk, a.template_id),
  get_key: (store, a) => store.getKey(a.account) || null,
  get_signers: store => store.getSigners(),
  get_balance: (store, a) => store.getBalance(a.account).toString(),
  get_owner: store => store.getOwner()
};

var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec0, _dec1, _dec10, _dec11, _dec12, _dec13, _dec14, _dec15, _dec16, _dec17, _dec18, _dec19, _dec20, _dec21, _dec22, _dec23, _class, _class2;
const nowMs = () => Number(blockTimestamp() / 1_000_000n);
const sha256 = b => sha256$1(b);
let Sealgate7 = (_dec = NearBindgen({
  requireInit: true
}), _dec2 = initialize(), _dec3 = call({}), _dec4 = call({}), _dec5 = call({}), _dec6 = call({
  payableFunction: true
}), _dec7 = call({
  payableFunction: true
}), _dec8 = call({
  payableFunction: true
}), _dec9 = call({
  payableFunction: true
}), _dec0 = call({
  payableFunction: true
}), _dec1 = call({
  payableFunction: true
}), _dec10 = call({
  payableFunction: true
}), _dec11 = call({}), _dec12 = call({}), _dec13 = view(), _dec14 = view(), _dec15 = view(), _dec16 = view(), _dec17 = view(), _dec18 = view(), _dec19 = view(), _dec20 = view(), _dec21 = view(), _dec22 = view(), _dec23 = view(), _dec(_class = (_class2 = class Sealgate7 {
  owner = '';
  nextCaseId = 0;
  signers = '[]';
  cases = new LookupMap('c');
  blobs = new LookupMap('m');
  clerks = new LookupMap('k');
  templates = new LookupMap('t');
  tplCount = new LookupMap('n');
  keys = new LookupMap('s');
  balances = new LookupMap('b');

  // The store interface the kernel expects (same as machine.mjs).
  store() {
    const self = this;
    const getJ = (map, k) => {
      const v = map.get(k);
      return v === null || v === undefined ? null : JSON.parse(v);
    };
    const putJ = (map, k, v) => map.set(k, JSON.stringify(v));
    return {
      getOwner: () => self.owner,
      peekCaseId: () => self.nextCaseId,
      takeCaseId: () => self.nextCaseId++,
      getCase: id => getJ(self.cases, String(id)),
      putCase: (id, c) => putJ(self.cases, String(id), c),
      getBlob: k => {
        const v = self.blobs.get(k);
        return v === undefined ? null : v;
      },
      putBlob: (k, v) => self.blobs.set(k, v),
      getClerk: a => getJ(self.clerks, a),
      putClerk: (a, r) => putJ(self.clerks, a, r),
      getTemplate: k => getJ(self.templates, k),
      putTemplate: (k, t) => putJ(self.templates, k, t),
      getTemplateCount: (clerk, id) => Number(self.tplCount.get(`${clerk}|${id}`) || 0),
      putTemplateCount: (clerk, id, n) => self.tplCount.set(`${clerk}|${id}`, String(n)),
      getKey: a => {
        const v = self.keys.get(a);
        return v === undefined ? null : v;
      },
      putKey: (a, k) => self.keys.set(a, k),
      getBalance: a => BigInt(self.balances.get(a) || '0'),
      putBalance: (a, v) => self.balances.set(a, v.toString()),
      getSigners: () => JSON.parse(self.signers),
      putSigners: list => {
        self.signers = JSON.stringify(list);
      },
      log: msg => log(msg)
    };
  }
  run(method, args) {
    const ctx = {
      caller: predecessorAccountId(),
      deposit: attachedDeposit(),
      now: nowMs(),
      sha256
    };
    return dispatch(this.store(), ctx, method, args || {});
  }
  read(name, args) {
    return READERS[name](this.store(), args || {});
  }
  init({
    owner
  }) {
    this.owner = owner;
  }

  // ---- registry ⑤ ----
  register_key(args) {
    this.run('register_key', args);
  }
  register_clerk(args) {
    this.run('register_clerk', args);
  }
  register_signer(args) {
    return this.run('register_signer', args);
  }
  register_template(args) {
    return this.run('register_template', args);
  }

  // ---- lifecycle (v7 profile) ----
  create_case(args) {
    return this.run('create_case', args);
  }
  submit(args) {
    this.run('submit', args);
  }
  post_decision(args) {
    this.run('post_decision', args);
  }
  appeal(args) {
    this.run('appeal', args);
  }
  respond(args) {
    this.run('respond', args);
  }
  post_appeal_decision(args) {
    this.run('post_appeal_decision', args);
  }
  finalize(args) {
    return this.run('finalize', args);
  }

  // ---- settlement ④: the only outbound transfer ----
  withdraw(args) {
    const out = this.run('withdraw', args);
    const p = promiseBatchCreate(out.transfer.to);
    promiseBatchActionTransfer(p, out.transfer.amount);
  }
  quote_fee(args) {
    return dispatch(this.store(), {
      caller: '',
      deposit: 0n,
      now: 0,
      sha256
    }, 'quote_fee', args || {});
  }

  // ---- read-only getters (not protocol methods) ----
  get_case(args) {
    return this.read('get_case', args);
  }
  get_material(args) {
    return this.read('get_material', args);
  }
  next_case_id() {
    return this.read('next_case_id', {});
  }
  get_clerk(args) {
    return this.read('get_clerk', args);
  }
  get_template(args) {
    return this.read('get_template', args);
  }
  get_template_count(args) {
    return this.read('get_template_count', args);
  }
  get_key(args) {
    return this.read('get_key', args);
  }
  get_signers() {
    return this.read('get_signers', {});
  }
  get_balance(args) {
    return this.read('get_balance', args);
  }
  get_owner() {
    return this.read('get_owner', {});
  }
}, _applyDecoratedDescriptor(_class2.prototype, "init", [_dec2], Object.getOwnPropertyDescriptor(_class2.prototype, "init"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "register_key", [_dec3], Object.getOwnPropertyDescriptor(_class2.prototype, "register_key"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "register_clerk", [_dec4], Object.getOwnPropertyDescriptor(_class2.prototype, "register_clerk"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "register_signer", [_dec5], Object.getOwnPropertyDescriptor(_class2.prototype, "register_signer"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "register_template", [_dec6], Object.getOwnPropertyDescriptor(_class2.prototype, "register_template"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "create_case", [_dec7], Object.getOwnPropertyDescriptor(_class2.prototype, "create_case"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "submit", [_dec8], Object.getOwnPropertyDescriptor(_class2.prototype, "submit"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "post_decision", [_dec9], Object.getOwnPropertyDescriptor(_class2.prototype, "post_decision"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "appeal", [_dec0], Object.getOwnPropertyDescriptor(_class2.prototype, "appeal"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "respond", [_dec1], Object.getOwnPropertyDescriptor(_class2.prototype, "respond"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "post_appeal_decision", [_dec10], Object.getOwnPropertyDescriptor(_class2.prototype, "post_appeal_decision"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "finalize", [_dec11], Object.getOwnPropertyDescriptor(_class2.prototype, "finalize"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "withdraw", [_dec12], Object.getOwnPropertyDescriptor(_class2.prototype, "withdraw"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "quote_fee", [_dec13], Object.getOwnPropertyDescriptor(_class2.prototype, "quote_fee"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "get_case", [_dec14], Object.getOwnPropertyDescriptor(_class2.prototype, "get_case"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "get_material", [_dec15], Object.getOwnPropertyDescriptor(_class2.prototype, "get_material"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "next_case_id", [_dec16], Object.getOwnPropertyDescriptor(_class2.prototype, "next_case_id"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "get_clerk", [_dec17], Object.getOwnPropertyDescriptor(_class2.prototype, "get_clerk"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "get_template", [_dec18], Object.getOwnPropertyDescriptor(_class2.prototype, "get_template"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "get_template_count", [_dec19], Object.getOwnPropertyDescriptor(_class2.prototype, "get_template_count"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "get_key", [_dec20], Object.getOwnPropertyDescriptor(_class2.prototype, "get_key"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "get_signers", [_dec21], Object.getOwnPropertyDescriptor(_class2.prototype, "get_signers"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "get_balance", [_dec22], Object.getOwnPropertyDescriptor(_class2.prototype, "get_balance"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "get_owner", [_dec23], Object.getOwnPropertyDescriptor(_class2.prototype, "get_owner"), _class2.prototype), _class2)) || _class);
function get_owner() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.get_owner(_args);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function get_balance() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.get_balance(_args);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function get_signers() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.get_signers(_args);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function get_key() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.get_key(_args);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function get_template_count() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.get_template_count(_args);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function get_template() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.get_template(_args);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function get_clerk() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.get_clerk(_args);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function next_case_id() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.next_case_id(_args);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function get_material() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.get_material(_args);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function get_case() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.get_case(_args);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function quote_fee() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.quote_fee(_args);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function withdraw() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.withdraw(_args);
  Sealgate7._saveToStorage(_contract);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function finalize() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.finalize(_args);
  Sealgate7._saveToStorage(_contract);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function post_appeal_decision() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.post_appeal_decision(_args);
  Sealgate7._saveToStorage(_contract);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function respond() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.respond(_args);
  Sealgate7._saveToStorage(_contract);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function appeal() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.appeal(_args);
  Sealgate7._saveToStorage(_contract);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function post_decision() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.post_decision(_args);
  Sealgate7._saveToStorage(_contract);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function submit() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.submit(_args);
  Sealgate7._saveToStorage(_contract);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function create_case() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.create_case(_args);
  Sealgate7._saveToStorage(_contract);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function register_template() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.register_template(_args);
  Sealgate7._saveToStorage(_contract);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function register_signer() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.register_signer(_args);
  Sealgate7._saveToStorage(_contract);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function register_clerk() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.register_clerk(_args);
  Sealgate7._saveToStorage(_contract);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function register_key() {
  const _state = Sealgate7._getState();
  if (!_state && Sealgate7._requireInit()) {
    throw new Error("Contract must be initialized");
  }
  const _contract = Sealgate7._create();
  if (_state) {
    Sealgate7._reconstruct(_contract, _state);
  }
  const _args = Sealgate7._getArgs();
  const _result = _contract.register_key(_args);
  Sealgate7._saveToStorage(_contract);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}
function init() {
  const _state = Sealgate7._getState();
  if (_state) {
    throw new Error("Contract already initialized");
  }
  const _contract = Sealgate7._create();
  const _args = Sealgate7._getArgs();
  const _result = _contract.init(_args);
  Sealgate7._saveToStorage(_contract);
  if (_result !== undefined) if (_result && _result.constructor && _result.constructor.name === "NearPromise") _result.onReturn();else env.value_return(Sealgate7._serialize(_result, true));
}

export { appeal, create_case, finalize, get_balance, get_case, get_clerk, get_key, get_material, get_owner, get_signers, get_template, get_template_count, init, next_case_id, post_appeal_decision, post_decision, quote_fee, register_clerk, register_key, register_signer, register_template, respond, submit, withdraw };
//# sourceMappingURL=sealgate7.js.map
