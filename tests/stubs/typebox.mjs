const schema = (type, value = {}) => ({ type, ...value });

export const Type = {
  Array: (items, options = {}) => schema('array', { items, ...options }),
  Boolean: (options = {}) => schema('boolean', options),
  Literal: (value) => ({ const: value }),
  Null: (options = {}) => schema('null', options),
  Number: (options = {}) => schema('number', options),
  Object: (properties, options = {}) => schema('object', { properties, ...options }),
  Optional: (value) => value,
  Record: (_key, value, options = {}) => schema('object', { additionalProperties: value, ...options }),
  String: (options = {}) => schema('string', options),
  Unknown: () => ({}),
  Union: (anyOf, options = {}) => ({ anyOf, ...options }),
};
